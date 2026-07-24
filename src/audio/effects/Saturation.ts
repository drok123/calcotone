import { clampParameter } from '../Parameter';
import { TubeColorStage, type TubeColorModel } from '../models/TubeColorStage';
import { BaseEffect } from './Effect';

export type EmberMode =
  | 'velvet'
  | 'tube'
  | 'console'
  | 'transformer'
  | 'furnace'
  | 'exciter'
  | 'broken'
  | 'goldlion'
  | 'mullard'
  | 'telefunken'
  | 'bugleboy'
  | 'rcablack';

// Existing mode indices stay fixed so old presets remain compatible.
export const EMBER_MODE_ORDER: EmberMode[] = [
  'velvet',
  'tube',
  'console',
  'transformer',
  'furnace',
  'exciter',
  'broken',
  'goldlion',
  'mullard',
  'telefunken',
  'bugleboy',
  'rcablack',
];

const MODE = { id: 'mode', label: 'Mode', min: 0, max: EMBER_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const DRIVE = { id: 'drive', label: 'Drive', min: 0, max: 1, defaultValue: 0.14, step: 0.01 };
const TONE = { id: 'tone', label: 'Tone', min: 200, max: 18000, defaultValue: 9500, step: 10, unit: 'Hz' };
const HEAT = { id: 'heat', label: 'Heat', min: 0, max: 1, defaultValue: 0.18, step: 0.01 };
const CHARACTER = { id: 'character', label: 'Character', min: 0, max: 1, defaultValue: 0.22, step: 0.01 };
const DYNAMICS = { id: 'dynamics', label: 'Dynamics', min: 0, max: 1, defaultValue: 0.38, step: 0.01 };
const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.22, step: 0.01 };

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

const NAMED_TUBE_MODEL: Partial<Record<EmberMode, TubeColorModel>> = {
  goldlion: 'goldlion',
  mullard: 'mullard',
  telefunken: 'telefunken',
  bugleboy: 'bugleboy',
  rcablack: 'rcablack',
};

export class SaturationEffect extends BaseEffect {
  public readonly id = 'saturation';
  public readonly name = 'Ember';

  private readonly preGain: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly genericGain: GainNode;
  private readonly tubeStage: TubeColorStage;
  private readonly tubeGain: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly post: GainNode;

  private mode: EmberMode = 'velvet';
  private drive = 0.14;
  private heat = 0.18;
  private character = 0.22;
  private dynamics = 0.38;
  private toneHz = 9500;

  public constructor(context: AudioContext) {
    super(context);
    this.preGain = context.createGain();
    this.hp = context.createBiquadFilter();
    this.shaper = context.createWaveShaper();
    this.genericGain = context.createGain();
    this.tubeStage = new TubeColorStage(context);
    this.tubeGain = context.createGain();
    this.tone = context.createBiquadFilter();
    this.presence = context.createBiquadFilter();
    this.compressor = context.createDynamicsCompressor();
    this.post = context.createGain();

    this.hp.type = 'highpass';
    this.hp.frequency.value = 22;
    this.hp.Q.value = 0.5;
    this.tone.type = 'lowpass';
    this.presence.type = 'peaking';
    this.presence.frequency.value = 3200;
    this.presence.Q.value = 0.65;
    this.shaper.oversample = '4x';
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.09;
    this.compressor.knee.value = 12;
    this.genericGain.gain.value = 1;
    this.tubeGain.gain.value = 0;

    this.input.connect(this.preGain);
    this.preGain.connect(this.hp);

    // Generic Ember branch: creative saturation modes.
    this.hp.connect(this.shaper);
    this.shaper.connect(this.genericGain);
    this.genericGain.connect(this.tone);

    // Reusable small-signal tube branch: named Tube Lab modes and future hardware preamps.
    this.hp.connect(this.tubeStage.input);
    this.tubeStage.connect(this.tubeGain);
    this.tubeGain.connect(this.tone);

    this.tone.connect(this.presence);
    this.presence.connect(this.compressor);
    this.compressor.connect(this.post);
    this.post.connect(this.wetGain);

    this.initializeParameters([MODE, DRIVE, TONE, HEAT, CHARACTER, DYNAMICS, MIX]);
    for (const parameter of [MODE, DRIVE, TONE, HEAT, CHARACTER, DYNAMICS, MIX]) {
      this.setParameter(parameter.id, parameter.defaultValue);
    }
  }

  // Audio quality floor: the adaptive governor may request `none` in Live mode,
  // but Ember's nonlinear stages are exactly where aliasing becomes most audible.
  public setOversampling(value: OverSampleType): void {
    this.shaper.oversample = value === 'none' ? '2x' : value;
    this.tubeStage.setQuality(value === '4x' ? 4 : 2);
  }

  public setParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    if (id === 'mode') {
      const next = clampParameter(value, MODE);
      this.parameterValues.set(id, next);
      this.mode = EMBER_MODE_ORDER[Math.round(next)] ?? 'velvet';
      this.apply(now);
      return;
    }

    if (id === 'drive') this.drive = clampParameter(value, DRIVE);
    else if (id === 'tone') this.toneHz = clampParameter(value, TONE);
    else if (id === 'heat') this.heat = clampParameter(value, HEAT);
    else if (id === 'character') this.character = clampParameter(value, CHARACTER);
    else if (id === 'dynamics') this.dynamics = clampParameter(value, DYNAMICS);
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
      id === 'drive'
        ? this.drive
        : id === 'tone'
          ? this.toneHz
          : id === 'heat'
            ? this.heat
            : id === 'character'
              ? this.character
              : this.dynamics,
    );
    this.apply(now);
  }

  private apply(now = this.context.currentTime): void {
    const tubeModel = NAMED_TUBE_MODEL[this.mode] ?? 'bypass';
    const namedTube = tubeModel !== 'bypass';

    this.tubeStage.setModel(tubeModel);
    this.tubeStage.setParameters(this.drive, this.heat, this.character, this.dynamics);

    if (namedTube) {
      // Named Tube Lab models are rack coloration stages, not distortion effects.
      // They retain unity-ish gain and let the reusable tube core supply only a
      // restrained nonlinear residual, bias memory and gentle transient rounding.
      this.preGain.gain.setTargetAtTime(1, now, 0.012);
      this.genericGain.gain.setTargetAtTime(0, now, 0.018);
      this.tubeGain.gain.setTargetAtTime(1, now, 0.018);
      this.shaper.curve = getIdentityCurve();
      this.tone.frequency.setTargetAtTime(Math.max(2200, this.toneHz * (1 - this.heat * 0.055)), now, 0.025);
      this.presence.gain.setTargetAtTime((this.character - 0.5) * 0.9, now, 0.025);
      this.presence.frequency.setTargetAtTime(3000 + this.character * 1600, now, 0.025);
      this.compressor.threshold.setTargetAtTime(-1.2 - this.dynamics * 2.8, now, 0.03);
      this.compressor.ratio.setTargetAtTime(1.02 + this.dynamics * 0.42, now, 0.03);
      this.post.gain.setTargetAtTime(0.99 - this.drive * 0.025, now, 0.02);
      return;
    }

    this.genericGain.gain.setTargetAtTime(1, now, 0.018);
    this.tubeGain.gain.setTargetAtTime(0, now, 0.018);
    const fallbackMode = this.mode;
    const modeIndex = EMBER_MODE_ORDER.indexOf(fallbackMode);
    const aggressionByMode: Record<EmberMode, number> = {
      velvet: 0.7,
      tube: 0.42,
      console: 1.15,
      transformer: 1.3,
      furnace: 2.2,
      exciter: 1.05,
      broken: 2.8,
      goldlion: 0.42,
      mullard: 0.42,
      telefunken: 0.42,
      bugleboy: 0.42,
      rcablack: 0.42,
    };
    const aggression = aggressionByMode[fallbackMode] ?? (modeIndex >= 0 ? 1 : 1);
    const input = fallbackMode === 'tube'
      ? 1 + Math.pow(this.drive, 1.5) * 1.15 + this.heat * 0.24
      : 1 + Math.pow(this.drive, 1.35) * (4.2 * aggression) + this.heat * 1.4;
    this.preGain.gain.setTargetAtTime(input, now, 0.012);
    this.tone.frequency.setTargetAtTime(Math.max(1200, this.toneHz * (1 - this.heat * (fallbackMode === 'tube' ? 0.07 : 0.18))), now, 0.025);
    this.presence.gain.setTargetAtTime((fallbackMode === 'exciter' ? 5 : fallbackMode === 'tube' ? 0.8 : 2.2) * (this.character - 0.35), now, 0.025);
    this.presence.frequency.setTargetAtTime(fallbackMode === 'transformer' ? 1700 : 3200 + this.character * 2600, now, 0.025);
    this.compressor.threshold.setTargetAtTime(fallbackMode === 'tube' ? -2 - this.dynamics * 4 : -4 - this.dynamics * 12, now, 0.03);
    this.compressor.ratio.setTargetAtTime(fallbackMode === 'tube' ? 1.05 + this.dynamics * 0.65 : 1.2 + this.dynamics * 3.8, now, 0.03);
    this.post.gain.setTargetAtTime(fallbackMode === 'tube' ? 0.98 / Math.pow(input, 0.22) : 1 / Math.pow(input, 0.72), now, 0.02);
    this.shaper.curve = getCurve(fallbackMode, this.drive, this.heat, this.character);
  }

  public override dispose(): void {
    this.tubeStage.dispose();
    for (const node of [
      this.preGain,
      this.hp,
      this.shaper,
      this.genericGain,
      this.tubeGain,
      this.tone,
      this.presence,
      this.compressor,
      this.post,
    ]) node.disconnect();
    super.dispose();
  }
}

let identityCurve: Float32Array<ArrayBuffer> | null = null;
function getIdentityCurve(): Float32Array<ArrayBuffer> {
  if (identityCurve) return identityCurve;
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) curve[index] = (index / (samples - 1)) * 2 - 1;
  identityCurve = curve;
  return curve;
}

function getCurve(mode: EmberMode, drive: number, heat: number, character: number): Float32Array<ArrayBuffer> {
  const key = `${mode}:${Math.round(drive * 64)}:${Math.round(heat * 32)}:${Math.round(character * 32)}`;
  const hit = curveCache.get(key);
  if (hit) return hit;

  const samples = 8192;
  const curve = new Float32Array(samples);
  const asymmetry = mode === 'tube'
    ? 0.035 + 0.055 * character
    : mode === 'transformer'
      ? 0.12 + 0.2 * character
      : mode === 'broken'
        ? 0.32 * character
        : 0.04 * character;
  const amount = mode === 'tube'
    ? 0.95 + drive * 1.55 + heat * 0.55
    : 1.2 + drive * 7 + heat * 3 + (mode === 'furnace' ? 5 : 0);

  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const shaped = Math.tanh((x + Math.max(0, x) * asymmetry) * amount) / Math.tanh(amount);
    let y = mode === 'tube' ? x * 0.80 + shaped * 0.20 : shaped;
    if (mode === 'console') y = 0.72 * y + 0.28 * Math.atan(x * amount * 1.3) / Math.atan(amount * 1.3);
    if (mode === 'transformer') y += Math.sin(x * Math.PI) * 0.035 * heat;
    if (mode === 'exciter') y = 0.82 * y + 0.18 * Math.tanh(x * amount * 2.4);
    if (mode === 'broken') y = Math.tanh((y + Math.sin(x * 17) * 0.06 * character) * 1.15);
    curve[index] = Math.max(-1, Math.min(1, y));
  }

  curveCache.set(key, curve);
  if (curveCache.size > 180) curveCache.delete(curveCache.keys().next().value!);
  return curve;
}
