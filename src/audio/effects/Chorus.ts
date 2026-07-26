import { clampParameter } from '../Parameter';
import { BaseEffect } from './Effect';

export type DriftMode =
  | 'chorus'
  | 'ensemble'
  | 'dimension'
  | 'vibrato'
  | 'rotary'
  | 'doppler'
  | 'liquid'
  | 'orbit'
  | 'ce1'
  | 'dimensiond'
  | 'mxrflanger'
  | 'electricmistress'
  | 'adaflanger'
  | 'bf2';

// Existing indices stay fixed for preset compatibility; new studies append only.
export const DRIFT_MODE_ORDER: DriftMode[] = [
  'chorus','ensemble','dimension','vibrato','rotary','doppler','liquid','orbit','ce1','dimensiond',
  'mxrflanger','electricmistress','adaflanger','bf2',
];

const MODE = { id: 'mode', label: 'Mode', min: 0, max: DRIFT_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const RATE = { id: 'rate', label: 'Rate', min: 0.05, max: 2.5, defaultValue: 0.28, step: 0.01, unit: 'Hz' };
const DEPTH = { id: 'depth', label: 'Depth', min: 0, max: 0.008, defaultValue: 0.0022, step: 0.0001, unit: 's' };
const SHAPE = { id: 'shape', label: 'Shape', min: 0, max: 1, defaultValue: 0.35, step: 0.01 };
const SPREAD = { id: 'spread', label: 'Spread', min: 0, max: 1, defaultValue: 0.62, step: 0.01 };
const MOTION = { id: 'motion', label: 'Motion', min: 0, max: 1, defaultValue: 0.32, step: 0.01 };
const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.14, step: 0.01 };

const IDENTITY_CURVE = makePreampCurve(0, 0);
const DIMENSION_D_CURVE = makePreampCurve(0.018, 0.006);
const FLANGER_CURVES = {
  mxrflanger: makePreampCurve(0.042, 0.010),
  electricmistress: makePreampCurve(0.028, 0.008),
  adaflanger: makePreampCurve(0.052, 0.012),
  bf2: makePreampCurve(0.036, 0.009),
} as const;
const CE1_CURVE_STEPS = 64;
const CE1_CURVE_CACHE = new Map<number, Float32Array<ArrayBuffer>>();

function getCe1Curve(motion: number): Float32Array<ArrayBuffer> {
  const key = Math.max(0, Math.min(CE1_CURVE_STEPS, Math.round(motion * CE1_CURVE_STEPS)));
  const cached = CE1_CURVE_CACHE.get(key);
  if (cached) return cached;
  const quantizedMotion = key / CE1_CURVE_STEPS;
  const curve = makePreampCurve(0.018 + quantizedMotion * 0.09, 0.018);
  CE1_CURVE_CACHE.set(key, curve);
  return curve;
}

function isFlangerMode(mode: DriftMode): mode is keyof typeof FLANGER_CURVES {
  return mode === 'mxrflanger' || mode === 'electricmistress' || mode === 'adaflanger' || mode === 'bf2';
}

export class ChorusEffect extends BaseEffect {
  public readonly id = 'chorus';
  public readonly name = 'Drift';

  private readonly preamp: WaveShaperNode;
  private readonly inputTone: BiquadFilterNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly delays: DelayNode[] = [];
  private readonly lfos: OscillatorNode[] = [];
  private readonly depths: GainNode[] = [];
  private readonly tones: BiquadFilterNode[] = [];
  private readonly highpasses: BiquadFilterNode[] = [];
  private readonly pans: StereoPannerNode[] = [];
  private readonly voiceGains: GainNode[] = [];
  private readonly feedbacks: GainNode[] = [];
  private readonly sum: GainNode;
  private currentPreampCurve: Float32Array<ArrayBuffer> = IDENTITY_CURVE;

  private mode: DriftMode = 'chorus';
  private rate = RATE.defaultValue;
  private depth = DEPTH.defaultValue;
  private shape = SHAPE.defaultValue;
  private spread = SPREAD.defaultValue;
  private motion = MOTION.defaultValue;

  public constructor(context: AudioContext) {
    super(context);
    this.preamp = context.createWaveShaper();
    this.preamp.oversample = '2x';
    this.preamp.curve = IDENTITY_CURVE;
    this.inputTone = context.createBiquadFilter();
    this.inputTone.type = 'lowpass';
    this.inputTone.frequency.value = 18_000;
    this.inputTone.Q.value = 0.45;
    this.splitter = context.createChannelSplitter(2);
    this.sum = context.createGain();

    this.input.connect(this.preamp);
    this.preamp.connect(this.inputTone);
    this.inputTone.connect(this.splitter);

    for (let i = 0; i < 4; i += 1) {
      const delay = context.createDelay(0.09);
      const lfo = context.createOscillator();
      const depth = context.createGain();
      const hp = context.createBiquadFilter();
      const tone = context.createBiquadFilter();
      const pan = context.createStereoPanner();
      const voiceGain = context.createGain();
      const feedback = context.createGain();

      delay.delayTime.value = 0.012 + i * 0.0031;
      lfo.type = i % 2 === 0 ? 'sine' : 'triangle';
      hp.type = 'highpass';
      hp.frequency.value = 55;
      hp.Q.value = 0.5;
      tone.type = 'lowpass';
      tone.frequency.value = 11_500 - i * 700;
      tone.Q.value = 0.5;
      pan.pan.value = (i % 2 ? 1 : -1) * (0.38 + i * 0.12);
      voiceGain.gain.value = 0;
      feedback.gain.value = 0;

      this.splitter.connect(delay, i % 2);
      delay.connect(hp);
      hp.connect(tone);
      tone.connect(pan);
      pan.connect(voiceGain);
      voiceGain.connect(this.sum);
      // Delayed feedback is safe and gives the flange studies their moving comb resonance.
      tone.connect(feedback);
      feedback.connect(delay);
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      lfo.start(context.currentTime + i * 0.071);

      this.delays.push(delay);
      this.lfos.push(lfo);
      this.depths.push(depth);
      this.highpasses.push(hp);
      this.tones.push(tone);
      this.pans.push(pan);
      this.voiceGains.push(voiceGain);
      this.feedbacks.push(feedback);
    }

    this.sum.connect(this.wetGain);
    this.initializeParameters([MODE, RATE, DEPTH, SHAPE, SPREAD, MOTION, MIX]);
    this.apply();
    this.setWetDryMix(MIX.defaultValue);
  }

  public setParameter(id: string, value: number): void {
    if (id === 'mode') {
      const next = clampParameter(value, MODE);
      const nextMode = DRIFT_MODE_ORDER[Math.round(next)] ?? 'chorus';
      if (this.parameterValues.get(id) === next && this.mode === nextMode) return;
      this.parameterValues.set(id, next);
      this.mode = nextMode;
      this.apply();
      return;
    }
    if (id === 'mix') {
      const next = clampParameter(value, MIX);
      if (this.parameterValues.get(id) === next) return;
      this.parameterValues.set(id, next);
      this.setWetDryMix(next);
      return;
    }

    let next: number;
    if (id === 'rate') next = clampParameter(value, RATE);
    else if (id === 'depth') next = clampParameter(value, DEPTH);
    else if (id === 'shape') next = clampParameter(value, SHAPE);
    else if (id === 'spread') next = clampParameter(value, SPREAD);
    else if (id === 'motion') next = clampParameter(value, MOTION);
    else {
      console.warn(`Unknown parameter "${id}" for ${this.name}.`);
      return;
    }
    if (this.parameterValues.get(id) === next) return;
    this.parameterValues.set(id, next);
    if (id === 'rate') this.rate = next;
    else if (id === 'depth') this.depth = next;
    else if (id === 'shape') this.shape = next;
    else if (id === 'spread') this.spread = next;
    else this.motion = next;
    this.apply();
  }

  private setPreampCurve(curve: Float32Array<ArrayBuffer>): void {
    if (curve === this.currentPreampCurve) return;
    this.preamp.curve = curve;
    this.currentPreampCurve = curve;
  }

  private clearFeedback(now: number): void {
    for (const feedback of this.feedbacks) feedback.gain.setTargetAtTime(0, now, 0.012);
  }

  private applyFlanger(now: number): void {
    const mode = this.mode as keyof typeof FLANGER_CURVES;
    const settings = mode === 'mxrflanger'
      ? { base: 0.00135, sweep: 0.0048, rate: 0.92, feedback: 0.58, hp: 45, lp: 13_500, voices: 2, phase: 0.985 }
      : mode === 'electricmistress'
        ? { base: 0.0018, sweep: 0.0037, rate: 0.63, feedback: 0.34, hp: 70, lp: 10_800, voices: 2, phase: 0.975 }
        : mode === 'adaflanger'
          ? { base: 0.00075, sweep: 0.0068, rate: 1.12, feedback: 0.72, hp: 38, lp: 15_800, voices: 2, phase: 0.968 }
          : { base: 0.00155, sweep: 0.00425, rate: 0.78, feedback: 0.48, hp: 82, lp: 11_700, voices: 2, phase: 0.982 };

    const normalizedDepth = this.depth / DEPTH.max;
    const sweep = settings.sweep * (0.32 + normalizedDepth * 0.92);
    const feedback = Math.min(0.82, settings.feedback * (0.5 + this.shape * 0.72));
    const width = Math.min(0.98, 0.18 + this.spread * 0.8);
    const rate = Math.max(0.035, this.rate * settings.rate * (0.72 + this.motion * 0.48));

    this.setPreampCurve(FLANGER_CURVES[mode]);
    this.inputTone.frequency.setTargetAtTime(settings.lp + (this.motion - 0.5) * 1800, now, 0.04);
    this.sum.gain.setTargetAtTime(0.69, now, 0.025);
    for (let i = 0; i < 4; i += 1) {
      const active = i < settings.voices;
      this.voiceGains[i].gain.setTargetAtTime(active ? 0.78 : 0, now, 0.025);
      this.lfos[i].frequency.setTargetAtTime(rate * (i === 0 ? 1 : settings.phase), now, 0.035);
      this.depths[i].gain.setTargetAtTime(active ? sweep * (i ? -0.94 : 1) : 0, now, 0.035);
      this.delays[i].delayTime.setTargetAtTime(settings.base + i * 0.00024, now, 0.035);
      this.highpasses[i].frequency.setTargetAtTime(settings.hp, now, 0.035);
      this.tones[i].frequency.setTargetAtTime(settings.lp - i * 420, now, 0.04);
      this.pans[i].pan.setTargetAtTime(i === 0 ? -width : width, now, 0.035);
      this.feedbacks[i].gain.setTargetAtTime(active ? feedback * (i ? -0.965 : 1) : 0, now, 0.025);
    }
  }

  private apply(): void {
    const now = this.context.currentTime;

    if (isFlangerMode(this.mode)) {
      this.applyFlanger(now);
      return;
    }

    this.clearFeedback(now);

    if (this.mode === 'ce1') {
      const intensity = this.shape;
      const rateTrim = Math.pow(2, (this.rate - RATE.defaultValue) * 0.22);
      const depthTrim = 0.75 + (this.depth / Math.max(DEPTH.defaultValue, 1e-6)) * 0.25;
      const panWidth = Math.min(0.96, 0.246 + this.spread * 0.7);
      const chorusRate = (0.19 + intensity * 0.63) * rateTrim;
      const chorusDepth = (0.00055 + intensity * 0.00245) * depthTrim;
      this.setPreampCurve(getCe1Curve(this.motion));
      this.inputTone.frequency.setTargetAtTime(9_600 - this.motion * 1_900, now, 0.05);
      this.sum.gain.setTargetAtTime(0.82, now, 0.04);
      for (let i = 0; i < 4; i += 1) {
        const active = i < 2;
        this.voiceGains[i].gain.setTargetAtTime(active ? 0.72 : 0, now, 0.04);
        this.lfos[i].frequency.setTargetAtTime(chorusRate * (i === 0 ? 1 : 0.97), now, 0.05);
        this.depths[i].gain.setTargetAtTime(active ? chorusDepth * (i ? -0.92 : 1) : 0, now, 0.05);
        this.delays[i].delayTime.setTargetAtTime(0.0148 + i * 0.00115, now, 0.05);
        this.highpasses[i].frequency.setTargetAtTime(82, now, 0.05);
        this.tones[i].frequency.setTargetAtTime(7_100 + (1 - this.motion) * 1_500, now, 0.06);
        this.pans[i].pan.setTargetAtTime(i === 0 ? -panWidth : panWidth, now, 0.05);
      }
      return;
    }

    if (this.mode === 'dimensiond') {
      const modeIndex = Math.max(0, Math.min(6, Math.floor(this.shape * 7)));
      const modeDepth = [0.34, 0.46, 0.60, 0.76, 0.84, 0.91, 0.98][modeIndex];
      const modeRate = [0.165, 0.185, 0.215, 0.245, 0.178, 0.205, 0.232][modeIndex];
      const baseByVoice = [0.0084, 0.0118, 0.0159, 0.0204];
      const phaseSigns = [1, -1, -0.74, 0.74];
      const rateTrim = Math.pow(2, (this.rate - RATE.defaultValue) * 0.16);
      const depthTrim = 0.75 + (this.depth / Math.max(DEPTH.defaultValue, 1e-6)) * 0.25;
      const panWidth = Math.min(0.98, 0.30 + this.spread);
      const motionDelta = this.motion - MOTION.defaultValue;
      this.setPreampCurve(DIMENSION_D_CURVE);
      this.inputTone.frequency.setTargetAtTime(13_800 - motionDelta * 900, now, 0.05);
      this.sum.gain.setTargetAtTime(0.52, now, 0.04);
      for (let i = 0; i < 4; i += 1) {
        this.voiceGains[i].gain.setTargetAtTime(0.55 + (i % 2) * 0.035, now, 0.05);
        this.lfos[i].frequency.setTargetAtTime(modeRate * rateTrim * (1 + i * (0.031 + motionDelta * 0.006)), now, 0.06);
        this.depths[i].gain.setTargetAtTime(0.00092 * modeDepth * depthTrim * phaseSigns[i], now, 0.06);
        this.delays[i].delayTime.setTargetAtTime(baseByVoice[i] * (1 + motionDelta * 0.025 * (i + 1)), now, 0.06);
        this.highpasses[i].frequency.setTargetAtTime(92 + motionDelta * 18, now, 0.05);
        this.tones[i].frequency.setTargetAtTime(10_800 - i * 260 - motionDelta * 520, now, 0.06);
        this.pans[i].pan.setTargetAtTime(i % 2 ? panWidth : -panWidth, now, 0.05);
      }
      return;
    }

    this.setPreampCurve(IDENTITY_CURVE);
    this.inputTone.frequency.setTargetAtTime(18_000, now, 0.05);
    const index = DRIFT_MODE_ORDER.indexOf(this.mode);
    const rateMul = [1,0.73,0.41,1.18,0.58,0.92,0.31,0.48,1,1][index] ?? 1;
    const base = [0.015,0.018,0.011,0.006,0.021,0.012,0.024,0.016,0.015,0.012][index] ?? 0.015;
    const voiceCount = this.mode === 'ensemble' || this.mode === 'liquid' ? 4 : this.mode === 'dimension' ? 3 : 2;
    this.sum.gain.setTargetAtTime(1 / Math.sqrt(voiceCount), now, 0.04);

    for (let i = 0; i < 4; i += 1) {
      const active = i < voiceCount;
      this.voiceGains[i].gain.setTargetAtTime(active ? 1 : 0, now, 0.04);
      this.lfos[i].frequency.setTargetAtTime(this.rate * rateMul * (1 + i * 0.071 * this.motion), now, 0.04);
      this.depths[i].gain.setTargetAtTime(active ? this.depth * (0.65 + i * 0.12) * (i % 2 ? -1 : 1) * (this.mode === 'vibrato' ? 1.45 : 1) : 0, now, 0.04);
      this.delays[i].delayTime.setTargetAtTime(base + i * 0.0026 * (0.4 + this.shape), now, 0.04);
      const normalPan = (i % 2 ? 1 : -1) * (0.18 + this.spread * 0.72);
      const orbitWidth = Math.min(0.99, 0.58 + this.spread * 0.6);
      const orbitPan = Math.sin((i / 4) * Math.PI * 2 + this.motion * Math.PI) * orbitWidth;
      this.pans[i].pan.setTargetAtTime(this.mode === 'orbit' ? orbitPan : normalPan, now, 0.04);
      this.highpasses[i].frequency.setTargetAtTime(55 + this.motion * 45, now, 0.05);
      this.tones[i].frequency.setTargetAtTime(6500 + this.shape * 9000 - (this.mode === 'rotary' ? i * 900 : 0), now, 0.05);
    }
  }

  public override dispose(): void {
    for (const lfo of this.lfos) {
      try { lfo.stop(); } catch { /* already stopped */ }
    }
    for (const node of [this.preamp, this.inputTone, this.splitter, this.sum, ...this.delays, ...this.lfos, ...this.depths, ...this.highpasses, ...this.tones, ...this.pans, ...this.voiceGains, ...this.feedbacks]) node.disconnect();
    super.dispose();
  }
}

function makePreampCurve(drive: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const size = 4096;
  const curve = new Float32Array(size);
  if (drive <= 0.0001) {
    for (let i = 0; i < size; i += 1) curve[i] = (i / (size - 1)) * 2 - 1;
    return curve;
  }
  const gain = 1 + drive * 5.2;
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    const shifted = x + Math.max(0, x) * asymmetry;
    curve[i] = Math.tanh(shifted * gain) / Math.tanh(gain);
  }
  return curve;
}
