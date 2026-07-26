import { clampParameter } from '../Parameter';
import { MagneticCoreStage } from '../models/MagneticCoreStage';
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

export const EMBER_MODE_ORDER: EmberMode[] = [
  'velvet','tube','console','transformer','furnace','exciter','broken',
  'goldlion','mullard','telefunken','bugleboy','rcablack',
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
  goldlion: 'goldlion', mullard: 'mullard', telefunken: 'telefunken', bugleboy: 'bugleboy', rcablack: 'rcablack',
};

interface TubePostProfile {
  toneScale: number;
  toneHeat: number;
  presenceHz: number;
  presenceSpan: number;
  presenceBase: number;
  presenceCharacter: number;
  thresholdBase: number;
  thresholdDynamics: number;
  ratioBase: number;
  ratioDynamics: number;
  postBase: number;
  postDrive: number;
}

const TUBE_POST: Record<Exclude<TubeColorModel, 'bypass'>, TubePostProfile> = {
  goldlion: {
    toneScale: 1.06, toneHeat: 0.035, presenceHz: 3600, presenceSpan: 1900,
    presenceBase: 0.25, presenceCharacter: 1.35, thresholdBase: -0.8, thresholdDynamics: 1.8,
    ratioBase: 1.01, ratioDynamics: 0.24, postBase: 1.00, postDrive: 0.015,
  },
  mullard: {
    toneScale: 0.88, toneHeat: 0.095, presenceHz: 2100, presenceSpan: 900,
    presenceBase: -0.45, presenceCharacter: 0.75, thresholdBase: -1.9, thresholdDynamics: 4.8,
    ratioBase: 1.05, ratioDynamics: 0.82, postBase: 0.985, postDrive: 0.040,
  },
  telefunken: {
    toneScale: 1.12, toneHeat: 0.025, presenceHz: 4100, presenceSpan: 2200,
    presenceBase: 0.10, presenceCharacter: 0.85, thresholdBase: -0.55, thresholdDynamics: 1.35,
    ratioBase: 1.005, ratioDynamics: 0.18, postBase: 1.005, postDrive: 0.010,
  },
  bugleboy: {
    toneScale: 1.00, toneHeat: 0.055, presenceHz: 2850, presenceSpan: 1250,
    presenceBase: 0.55, presenceCharacter: 1.70, thresholdBase: -1.25, thresholdDynamics: 2.9,
    ratioBase: 1.025, ratioDynamics: 0.48, postBase: 0.995, postDrive: 0.026,
  },
  rcablack: {
    toneScale: 0.78, toneHeat: 0.13, presenceHz: 1450, presenceSpan: 650,
    presenceBase: 0.10, presenceCharacter: 0.55, thresholdBase: -2.6, thresholdDynamics: 5.8,
    ratioBase: 1.08, ratioDynamics: 1.05, postBase: 0.97, postDrive: 0.052,
  },
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
  private readonly magneticStage: MagneticCoreStage;
  private readonly magneticGain: GainNode;
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
    this.preGain = context.createGain(); this.hp = context.createBiquadFilter(); this.shaper = context.createWaveShaper();
    this.genericGain = context.createGain(); this.tubeStage = new TubeColorStage(context); this.tubeGain = context.createGain();
    this.magneticStage = new MagneticCoreStage(context); this.magneticGain = context.createGain(); this.tone = context.createBiquadFilter();
    this.presence = context.createBiquadFilter(); this.compressor = context.createDynamicsCompressor(); this.post = context.createGain();
    this.hp.type = 'highpass'; this.hp.frequency.value = 22; this.hp.Q.value = 0.5;
    this.tone.type = 'lowpass'; this.presence.type = 'peaking'; this.presence.frequency.value = 3200; this.presence.Q.value = 0.65;
    this.shaper.oversample = '4x'; this.compressor.attack.value = 0.004; this.compressor.release.value = 0.09; this.compressor.knee.value = 12;
    this.genericGain.gain.value = 1; this.tubeGain.gain.value = 0; this.magneticGain.gain.value = 0;
    this.input.connect(this.preGain); this.preGain.connect(this.hp);
    this.hp.connect(this.shaper); this.shaper.connect(this.genericGain); this.genericGain.connect(this.tone);
    this.hp.connect(this.tubeStage.input); this.tubeStage.connect(this.tubeGain); this.tubeGain.connect(this.tone);
    this.hp.connect(this.magneticStage.input); this.magneticStage.connect(this.magneticGain); this.magneticGain.connect(this.tone);
    this.tone.connect(this.presence); this.presence.connect(this.compressor); this.compressor.connect(this.post); this.post.connect(this.wetGain);
    this.initializeParameters([MODE, DRIVE, TONE, HEAT, CHARACTER, DYNAMICS, MIX]);
    for (const parameter of [MODE, DRIVE, TONE, HEAT, CHARACTER, DYNAMICS, MIX]) this.setParameter(parameter.id, parameter.defaultValue);
  }

  public setOversampling(value: OverSampleType): void {
    this.shaper.oversample = value === 'none' ? '2x' : value;
    const factor = value === '4x' ? 4 : 2;
    this.tubeStage.setQuality(factor); this.magneticStage.setQuality(factor);
  }

  public setParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    if (id === 'mode') { const next = clampParameter(value, MODE); this.parameterValues.set(id, next); this.mode = EMBER_MODE_ORDER[Math.round(next)] ?? 'velvet'; this.apply(now); return; }
    if (id === 'drive') this.drive = clampParameter(value, DRIVE);
    else if (id === 'tone') this.toneHz = clampParameter(value, TONE);
    else if (id === 'heat') this.heat = clampParameter(value, HEAT);
    else if (id === 'character') this.character = clampParameter(value, CHARACTER);
    else if (id === 'dynamics') this.dynamics = clampParameter(value, DYNAMICS);
    else if (id === 'mix') { const next = clampParameter(value, MIX); this.parameterValues.set(id, next); this.setWetDryMix(next); return; }
    else { console.warn(`Unknown parameter "${id}" for ${this.name}.`); return; }
    this.parameterValues.set(id, id === 'drive' ? this.drive : id === 'tone' ? this.toneHz : id === 'heat' ? this.heat : id === 'character' ? this.character : this.dynamics);
    this.apply(now);
  }

  private apply(now = this.context.currentTime): void {
    const tubeModel = NAMED_TUBE_MODEL[this.mode] ?? 'bypass';
    const namedTube = tubeModel !== 'bypass';
    const magnetic = this.mode === 'transformer';
    this.tubeStage.setModel(tubeModel); this.tubeStage.setParameters(this.drive, this.heat, this.character, this.dynamics);
    this.magneticStage.setEnabled(magnetic); this.magneticStage.setParameters(this.drive, this.heat, this.character, this.dynamics);

    if (namedTube) {
      const profile = TUBE_POST[tubeModel];
      this.preGain.gain.setTargetAtTime(1, now, 0.012);
      this.genericGain.gain.setTargetAtTime(0, now, 0.018); this.tubeGain.gain.setTargetAtTime(1, now, 0.018); this.magneticGain.gain.setTargetAtTime(0, now, 0.018);
      this.shaper.curve = getIdentityCurve();
      const tubeTone = Math.max(1800, Math.min(18000, this.toneHz * profile.toneScale * (1 - this.heat * profile.toneHeat)));
      this.tone.frequency.setTargetAtTime(tubeTone, now, 0.025);
      this.presence.frequency.setTargetAtTime(profile.presenceHz + this.character * profile.presenceSpan, now, 0.025);
      this.presence.gain.setTargetAtTime(profile.presenceBase + (this.character - 0.5) * profile.presenceCharacter, now, 0.025);
      this.compressor.threshold.setTargetAtTime(profile.thresholdBase - this.dynamics * profile.thresholdDynamics, now, 0.03);
      this.compressor.ratio.setTargetAtTime(profile.ratioBase + this.dynamics * profile.ratioDynamics, now, 0.03);
      this.post.gain.setTargetAtTime(profile.postBase - this.drive * profile.postDrive, now, 0.02);
      return;
    }

    if (magnetic) {
      this.preGain.gain.setTargetAtTime(1, now, 0.012); this.genericGain.gain.setTargetAtTime(0, now, 0.018); this.tubeGain.gain.setTargetAtTime(0, now, 0.018); this.magneticGain.gain.setTargetAtTime(1, now, 0.018);
      this.shaper.curve = getIdentityCurve(); this.tone.frequency.setTargetAtTime(Math.max(2600, this.toneHz * (1 - this.heat * 0.09)), now, 0.025);
      this.presence.frequency.setTargetAtTime(1450 + this.character * 900, now, 0.025); this.presence.gain.setTargetAtTime(0.25 + (this.character - 0.5) * 1.25, now, 0.025);
      this.compressor.threshold.setTargetAtTime(-1.5 - this.dynamics * 2.5, now, 0.03); this.compressor.ratio.setTargetAtTime(1.02 + this.dynamics * 0.36, now, 0.03);
      this.post.gain.setTargetAtTime(0.99 - this.drive * 0.035, now, 0.02); return;
    }

    this.genericGain.gain.setTargetAtTime(1, now, 0.018); this.tubeGain.gain.setTargetAtTime(0, now, 0.018); this.magneticGain.gain.setTargetAtTime(0, now, 0.018);
    const fallbackMode = this.mode; const modeIndex = EMBER_MODE_ORDER.indexOf(fallbackMode);
    const aggressionByMode: Record<EmberMode, number> = { velvet:0.7,tube:0.42,console:1.15,transformer:1.0,furnace:2.2,exciter:1.05,broken:2.8,goldlion:0.42,mullard:0.42,telefunken:0.42,bugleboy:0.42,rcablack:0.42 };
    const aggression = aggressionByMode[fallbackMode] ?? (modeIndex >= 0 ? 1 : 1);
    const input = fallbackMode === 'tube' ? 1 + Math.pow(this.drive, 1.5) * 1.15 + this.heat * 0.24 : 1 + Math.pow(this.drive, 1.35) * (4.2 * aggression) + this.heat * 1.4;
    this.preGain.gain.setTargetAtTime(input, now, 0.012);
    this.tone.frequency.setTargetAtTime(Math.max(1200, this.toneHz * (1 - this.heat * (fallbackMode === 'tube' ? 0.07 : 0.18))), now, 0.025);
    this.presence.gain.setTargetAtTime((fallbackMode === 'exciter' ? 5 : fallbackMode === 'tube' ? 0.8 : 2.2) * (this.character - 0.35), now, 0.025);
    this.presence.frequency.setTargetAtTime(3200 + this.character * 2600, now, 0.025);
    this.compressor.threshold.setTargetAtTime(fallbackMode === 'tube' ? -2 - this.dynamics * 4 : -4 - this.dynamics * 12, now, 0.03);
    this.compressor.ratio.setTargetAtTime(fallbackMode === 'tube' ? 1.05 + this.dynamics * 0.65 : 1.2 + this.dynamics * 3.8, now, 0.03);
    this.post.gain.setTargetAtTime(fallbackMode === 'tube' ? 0.98 / Math.pow(input, 0.22) : 1 / Math.pow(input, 0.72), now, 0.02);
    this.shaper.curve = getCurve(fallbackMode, this.drive, this.heat, this.character);
  }

  public override dispose(): void {
    this.tubeStage.dispose(); this.magneticStage.dispose();
    for (const node of [this.preGain,this.hp,this.shaper,this.genericGain,this.tubeGain,this.magneticGain,this.tone,this.presence,this.compressor,this.post]) node.disconnect();
    super.dispose();
  }
}

function getIdentityCurve(): Float32Array<ArrayBuffer> { return getCurve('tube', 0, 0, 0); }
function getCurve(mode: EmberMode, drive: number, heat: number, character: number): Float32Array<ArrayBuffer> {
  const key = `${mode}:${Math.round(drive*96)}:${Math.round(heat*64)}:${Math.round(character*64)}`;
  const cached = curveCache.get(key); if (cached) return cached;
  const size = 4096; const curve = new Float32Array(size); const gain = 1 + drive * 7 + heat * 3;
  for (let i=0;i<size;i+=1) { const x=(i/(size-1))*2-1; if (drive <= 0.0001 && heat <= 0.0001) curve[i]=x; else { const bias=(character-0.5)*0.06; const zero=Math.tanh(bias*gain); curve[i]=(Math.tanh((x+bias)*gain)-zero)/Math.max(1,gain*0.55); } }
  curveCache.set(key, curve); return curve;
}