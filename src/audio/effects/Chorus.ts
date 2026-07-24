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
  | 'dimensiond';

// Existing indices stay fixed for preset compatibility.
export const DRIFT_MODE_ORDER: DriftMode[] = [
  'chorus','ensemble','dimension','vibrato','rotary','doppler','liquid','orbit','ce1','dimensiond',
];

const MODE = { id: 'mode', label: 'Mode', min: 0, max: DRIFT_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const RATE = { id: 'rate', label: 'Rate', min: 0.05, max: 2.5, defaultValue: 0.28, step: 0.01, unit: 'Hz' };
const DEPTH = { id: 'depth', label: 'Depth', min: 0, max: 0.008, defaultValue: 0.0022, step: 0.0001, unit: 's' };
const SHAPE = { id: 'shape', label: 'Shape', min: 0, max: 1, defaultValue: 0.35, step: 0.01 };
const SPREAD = { id: 'spread', label: 'Spread', min: 0, max: 1, defaultValue: 0.62, step: 0.01 };
const MOTION = { id: 'motion', label: 'Motion', min: 0, max: 1, defaultValue: 0.32, step: 0.01 };
const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.14, step: 0.01 };

const IDENTITY_CURVE = makePreampCurve(0, 0);

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
  private readonly sum: GainNode;

  private mode: DriftMode = 'chorus';
  private rate = 0.28;
  private depth = 0.0022;
  private shape = 0.35;
  private spread = 0.62;
  private motion = 0.32;

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

      this.splitter.connect(delay, i % 2);
      delay.connect(hp);
      hp.connect(tone);
      tone.connect(pan);
      pan.connect(voiceGain);
      voiceGain.connect(this.sum);
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
    }

    this.sum.connect(this.wetGain);
    this.initializeParameters([MODE, RATE, DEPTH, SHAPE, SPREAD, MOTION, MIX]);
    for (const parameter of [MODE, RATE, DEPTH, SHAPE, SPREAD, MOTION, MIX]) {
      this.setParameter(parameter.id, parameter.defaultValue);
    }
  }

  public setParameter(id: string, value: number): void {
    if (id === 'mode') {
      const next = clampParameter(value, MODE);
      this.parameterValues.set(id, next);
      this.mode = DRIFT_MODE_ORDER[Math.round(next)] ?? 'chorus';
      this.apply();
      return;
    }
    if (id === 'rate') this.rate = clampParameter(value, RATE);
    else if (id === 'depth') this.depth = clampParameter(value, DEPTH);
    else if (id === 'shape') this.shape = clampParameter(value, SHAPE);
    else if (id === 'spread') this.spread = clampParameter(value, SPREAD);
    else if (id === 'motion') this.motion = clampParameter(value, MOTION);
    else if (id === 'mix') {
      const next = clampParameter(value, MIX);
      this.parameterValues.set(id, next);
      this.setWetDryMix(next);
      return;
    } else {
      console.warn(`Unknown parameter "${id}" for ${this.name}.`);
      return;
    }

    this.parameterValues.set(
      id,
      id === 'rate' ? this.rate : id === 'depth' ? this.depth : id === 'shape' ? this.shape : id === 'spread' ? this.spread : this.motion,
    );
    this.apply();
  }

  private apply(): void {
    const now = this.context.currentTime;

    if (this.mode === 'ce1') {
      // CE-1 study: BBD-style short delay, restricted bandwidth and the characterful input preamp.
      const intensity = 0.45 + this.shape * 0.75;
      this.preamp.curve = makePreampCurve(0.18 + this.motion * 0.36, 0.045);
      this.inputTone.frequency.setTargetAtTime(10_500 - this.motion * 2_400, now, 0.05);
      this.sum.gain.setTargetAtTime(0.72, now, 0.04);
      for (let i = 0; i < 4; i += 1) {
        const active = i < 2;
        const phaseRate = this.rate * (i === 0 ? 1 : 0.93);
        const base = 0.0152 + i * 0.00125;
        this.voiceGains[i].gain.setTargetAtTime(active ? (i === 0 ? 0.78 : 0.62) : 0, now, 0.04);
        this.lfos[i].frequency.setTargetAtTime(phaseRate, now, 0.05);
        this.depths[i].gain.setTargetAtTime(active ? this.depth * intensity * (i ? -0.78 : 1) : 0, now, 0.05);
        this.delays[i].delayTime.setTargetAtTime(base, now, 0.05);
        this.highpasses[i].frequency.setTargetAtTime(80, now, 0.05);
        this.tones[i].frequency.setTargetAtTime(7_200 + (1 - this.motion) * 1_800, now, 0.06);
        this.pans[i].pan.setTargetAtTime(i === 0 ? -0.82 * this.spread : 0.82 * this.spread, now, 0.05);
      }
      return;
    }

    if (this.mode === 'dimensiond') {
      // Dimension D study: four low-depth, decorrelated BBD taps. Shape selects the familiar 1-4 intensity family.
      const dimensionMode = Math.max(1, Math.min(4, 1 + Math.floor(this.shape * 3.999)));
      const modeDepth = [0, 0.42, 0.58, 0.74, 0.92][dimensionMode];
      const baseByVoice = [0.0082, 0.0116, 0.0158, 0.0206];
      const phaseSigns = [1, -1, -0.72, 0.72];
      this.preamp.curve = makePreampCurve(0.06 + this.motion * 0.12, 0.012);
      this.inputTone.frequency.setTargetAtTime(13_200 - this.motion * 1_900, now, 0.05);
      this.sum.gain.setTargetAtTime(0.54, now, 0.04);
      for (let i = 0; i < 4; i += 1) {
        this.voiceGains[i].gain.setTargetAtTime(0.55 + (i % 2) * 0.04, now, 0.05);
        this.lfos[i].frequency.setTargetAtTime((0.18 + this.rate * 0.32) * (1 + i * 0.037), now, 0.06);
        this.depths[i].gain.setTargetAtTime(this.depth * 0.34 * modeDepth * phaseSigns[i], now, 0.06);
        this.delays[i].delayTime.setTargetAtTime(baseByVoice[i], now, 0.06);
        this.highpasses[i].frequency.setTargetAtTime(95, now, 0.05);
        this.tones[i].frequency.setTargetAtTime(9_500 + this.spread * 2_200 - i * 310, now, 0.06);
        this.pans[i].pan.setTargetAtTime((i % 2 ? 1 : -1) * (0.58 + this.spread * 0.36), now, 0.05);
      }
      return;
    }

    this.preamp.curve = IDENTITY_CURVE;
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
      const orbit = this.mode === 'orbit' ? Math.sin((i / 4) * Math.PI * 2 + this.motion * Math.PI) * 0.95 : (i % 2 ? 1 : -1) * (0.18 + this.spread * 0.72);
      this.pans[i].pan.setTargetAtTime(orbit, now, 0.04);
      this.highpasses[i].frequency.setTargetAtTime(55 + this.motion * 45, now, 0.05);
      this.tones[i].frequency.setTargetAtTime(6500 + this.shape * 9000 - (this.mode === 'rotary' ? i * 900 : 0), now, 0.05);
    }
  }

  public override dispose(): void {
    for (const lfo of this.lfos) {
      try { lfo.stop(); } catch { /* already stopped */ }
    }
    for (const node of [this.preamp, this.inputTone, this.splitter, this.sum, ...this.delays, ...this.lfos, ...this.depths, ...this.highpasses, ...this.tones, ...this.pans, ...this.voiceGains]) node.disconnect();
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
