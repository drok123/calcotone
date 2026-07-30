import { clampParameter } from '../Parameter';
import {
  atr102OperatingPoint,
  atr102Speed as calibratedAtr102Speed,
  atrTapeTransfer,
  opAmpTransfer,
  summingBusOperatingPoint,
  summingBusTransfer,
  tascam424OperatingPoint,
  transformerTransfer,
} from '../models/HardwareCalibration';
import { BaseEffect } from './Effect';

export type MediaMode =
  | 'cassette'
  | 'reel'
  | 'vinyl'
  | 'vhs'
  | 'radio'
  | 'wax'
  | 'broken'
  | 'archive'
  | 'tascam424'
  | 'Neve 1073'
  | 'SSL 4000E'
  | 'API 1608'
  | 'Ampex ATR-102';

export const ARTIFACT_CONSOLE_MODES = [
  'tascam424','Neve 1073','SSL 4000E','API 1608',
] as const satisfies readonly MediaMode[];

// Existing indices stay fixed so v1 Artifact presets retain their machine.
export const MEDIA_MODE_ORDER: MediaMode[] = [
  'cassette','reel','vinyl','vhs','radio','wax','broken','archive',
  'tascam424','Neve 1073','SSL 4000E','API 1608','Ampex ATR-102',
];

export const MEDIA_MODE_GROUPS = [
  { label: 'MEDIA', modes: ['cassette','reel','vinyl','vhs','wax','archive','broken'] },
  { label: 'TRANSMISSION', modes: ['radio'] },
  { label: 'CONSOLE PATHS', modes: ARTIFACT_CONSOLE_MODES },
  { label: 'TAPE MACHINES', modes: ['Ampex ATR-102'] },
] as const satisfies ReadonlyArray<{ label: string; modes: readonly MediaMode[] }>;

const MODE = { id: 'mode', label: 'Mode', min: 0, max: MEDIA_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const WEAR = { id: 'wear', label: 'Wear', min: 0, max: 1, defaultValue: 0.162, step: 0.01 };
const WOW = { id: 'wow', label: 'Wow', min: 0, max: 1, defaultValue: 0.16, step: 0.01 };
const NOISE = { id: 'noise', label: 'Noise', min: 0, max: 1, defaultValue: 0.1, step: 0.01 };
const TONE = { id: 'tone', label: 'Tone', min: 0, max: 1, defaultValue: 0.62, step: 0.01 };
const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.26, step: 0.01 };

const MAX_CURVE_CACHE = 384;
const IDENTITY_CURVE = createIdentityCurve();
const summingCurveCache = new Map<string, Float32Array<ArrayBuffer>>();
const opAmpCurveCache = new Map<string, Float32Array<ArrayBuffer>>();
const transformerCurveCache = new Map<string, Float32Array<ArrayBuffer>>();
const tapeCurveCache = new Map<string, Float32Array<ArrayBuffer>>();
const saturationCurveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** Capture, reproduction, transmission, and console-path coloration. */
export class MediaEffect extends BaseEffect {
  public readonly id = 'media';
  public readonly name = 'Media';

  private readonly modelInputGain: GainNode;
  private readonly preampStage: WaveShaperNode;
  private readonly lowShelf: BiquadFilterNode;
  private readonly highShelf: BiquadFilterNode;
  private readonly modelOutputGain: GainNode;
  private readonly highpass: BiquadFilterNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly saturator: WaveShaperNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly leftDelay: DelayNode;
  private readonly rightDelay: DelayNode;
  private readonly crossfeedLtoR: GainNode;
  private readonly crossfeedRtoL: GainNode;
  private readonly merger: ChannelMergerNode;
  private readonly mediaGain: GainNode;
  private readonly wowLfo: OscillatorNode;
  private readonly flutterLfo: OscillatorNode;
  private readonly leftDepth: GainNode;
  private readonly rightDepth: GainNode;
  private readonly cassetteNoise: AudioBufferSourceNode;
  private readonly vinylNoise: AudioBufferSourceNode;
  private readonly cassetteNoiseGain: GainNode;
  private readonly vinylNoiseGain: GainNode;

  private mode: MediaMode = 'cassette';
  private wear = WEAR.defaultValue;
  private wow = WOW.defaultValue;
  private noise = NOISE.defaultValue;
  private tone = TONE.defaultValue;
  private artifactMix = MIX.defaultValue;
  private currentPreampCurve: Float32Array<ArrayBuffer> | null = null;
  private currentSaturatorCurve: Float32Array<ArrayBuffer> | null = null;

  public constructor(context: AudioContext) {
    super(context);
    this.modelInputGain = context.createGain();
    this.preampStage = context.createWaveShaper();
    this.lowShelf = context.createBiquadFilter();
    this.highShelf = context.createBiquadFilter();
    this.modelOutputGain = context.createGain();
    this.highpass = context.createBiquadFilter();
    this.lowpass = context.createBiquadFilter();
    this.saturator = context.createWaveShaper();
    this.splitter = context.createChannelSplitter(2);
    this.leftDelay = context.createDelay(0.55);
    this.rightDelay = context.createDelay(0.55);
    this.crossfeedLtoR = context.createGain();
    this.crossfeedRtoL = context.createGain();
    this.merger = context.createChannelMerger(2);
    this.mediaGain = context.createGain();
    this.wowLfo = context.createOscillator();
    this.flutterLfo = context.createOscillator();
    this.leftDepth = context.createGain();
    this.rightDepth = context.createGain();
    this.cassetteNoiseGain = context.createGain();
    this.vinylNoiseGain = context.createGain();
    this.cassetteNoise = this.createNoiseSource('cassette');
    this.vinylNoise = this.createNoiseSource('vinyl');

    this.preampStage.oversample = '2x';
    this.saturator.oversample = '2x';
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 100;
    this.highShelf.type = 'highshelf';
    this.highShelf.frequency.value = 10_000;
    this.highpass.type = 'highpass';
    this.lowpass.type = 'lowpass';
    this.highpass.Q.value = 0.55;
    this.lowpass.Q.value = 0.55;
    this.leftDelay.delayTime.value = 0.008;
    this.rightDelay.delayTime.value = 0.0093;
    this.crossfeedLtoR.gain.value = 0;
    this.crossfeedRtoL.gain.value = 0;
    this.mediaGain.gain.value = 1;
    this.wowLfo.type = 'sine';
    this.flutterLfo.type = 'triangle';

    this.input.connect(this.modelInputGain);
    this.modelInputGain.connect(this.preampStage);
    this.preampStage.connect(this.lowShelf);
    this.lowShelf.connect(this.highShelf);
    this.highShelf.connect(this.modelOutputGain);
    this.modelOutputGain.connect(this.highpass);
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.saturator);
    this.saturator.connect(this.splitter);
    this.splitter.connect(this.leftDelay, 0);
    this.splitter.connect(this.rightDelay, 1);
    this.leftDelay.connect(this.merger, 0, 0);
    this.rightDelay.connect(this.merger, 0, 1);
    this.splitter.connect(this.crossfeedLtoR, 0);
    this.splitter.connect(this.crossfeedRtoL, 1);
    this.crossfeedLtoR.connect(this.merger, 0, 1);
    this.crossfeedRtoL.connect(this.merger, 0, 0);
    this.merger.connect(this.mediaGain);
    this.mediaGain.connect(this.wetGain);

    this.wowLfo.connect(this.leftDepth);
    this.flutterLfo.connect(this.rightDepth);
    this.leftDepth.connect(this.leftDelay.delayTime);
    this.rightDepth.connect(this.rightDelay.delayTime);
    this.cassetteNoise.connect(this.cassetteNoiseGain);
    this.vinylNoise.connect(this.vinylNoiseGain);
    this.cassetteNoiseGain.connect(this.mediaGain);
    this.vinylNoiseGain.connect(this.mediaGain);

    this.wowLfo.start();
    this.flutterLfo.start(context.currentTime + 0.07);
    this.cassetteNoise.start();
    this.vinylNoise.start();

    this.initializeParameters([MODE, WEAR, WOW, NOISE, TONE, MIX]);
    // Internal fields already contain the same defaults. Build the initial machine once
    // instead of running the entire character graph once per default control.
    this.applyMixRouting();
    this.applyCharacter();
  }

  public setParameter(parameterId: string, value: number): void {
    switch (parameterId) {
      case 'mode': {
        const next = clampParameter(value, MODE);
        const nextMode = MEDIA_MODE_ORDER[Math.round(next)] ?? 'cassette';
        if (this.parameterValues.get(parameterId) === next && this.mode === nextMode) return;
        this.parameterValues.set(parameterId, next);
        this.mode = nextMode;
        this.applyMixRouting();
        this.applyCharacter();
        return;
      }
      case 'wear': {
        const next = clampParameter(value, WEAR);
        if (this.parameterValues.get(parameterId) === next) return;
        this.wear = next;
        this.parameterValues.set(parameterId, next);
        this.applyCharacter();
        return;
      }
      case 'wow': {
        const next = clampParameter(value, WOW);
        if (this.parameterValues.get(parameterId) === next) return;
        this.wow = next;
        this.parameterValues.set(parameterId, next);
        this.applyCharacter();
        return;
      }
      case 'noise': {
        const next = clampParameter(value, NOISE);
        if (this.parameterValues.get(parameterId) === next) return;
        this.noise = next;
        this.parameterValues.set(parameterId, next);
        this.applyCharacter();
        return;
      }
      case 'tone': {
        const next = clampParameter(value, TONE);
        if (this.parameterValues.get(parameterId) === next) return;
        this.tone = next;
        this.parameterValues.set(parameterId, next);
        this.applyCharacter();
        return;
      }
      case 'mix': {
        const next = clampParameter(value, MIX);
        if (this.parameterValues.get(parameterId) === next) return;
        this.artifactMix = next;
        this.parameterValues.set(parameterId, next);
        this.applyMixRouting();
        return;
      }
      default:
        console.warn(`Unknown parameter "${parameterId}" for ${this.name}.`);
    }
  }

  public override dispose(): void {
    try { this.wowLfo.stop(); } catch { /* already stopped */ }
    try { this.flutterLfo.stop(); } catch { /* already stopped */ }
    try { this.cassetteNoise.stop(); } catch { /* already stopped */ }
    try { this.vinylNoise.stop(); } catch { /* already stopped */ }
    [
      this.modelInputGain, this.preampStage, this.lowShelf, this.highShelf, this.modelOutputGain,
      this.highpass, this.lowpass, this.saturator, this.splitter, this.leftDelay, this.rightDelay,
      this.crossfeedLtoR, this.crossfeedRtoL, this.merger, this.wowLfo, this.flutterLfo,
      this.leftDepth, this.rightDepth, this.cassetteNoise, this.vinylNoise,
      this.cassetteNoiseGain, this.vinylNoiseGain, this.mediaGain,
    ].forEach((node) => node.disconnect());
    super.dispose();
  }

  private setPreampCurve(curve: Float32Array<ArrayBuffer>): void {
    if (curve === this.currentPreampCurve) return;
    this.preampStage.curve = curve;
    this.currentPreampCurve = curve;
  }

  private setSaturatorCurve(curve: Float32Array<ArrayBuffer>): void {
    if (curve === this.currentSaturatorCurve) return;
    this.saturator.curve = curve;
    this.currentSaturatorCurve = curve;
  }

  private applyMixRouting(): void {
    if (!isInsertMode(this.mode)) {
      this.setWetDryMix(this.artifactMix);
      return;
    }
    const now = this.context.currentTime;
    // Insert/summing modes are strongly correlated with dry, so complementary gains avoid
    // a parallel +3 dB bump while keeping Mix continuous and useful.
    this.dryGain.gain.setTargetAtTime(1 - this.artifactMix, now, 0.025);
    this.wetGain.gain.setTargetAtTime(this.artifactMix, now, 0.025);
  }

  private applyCharacter(): void {
    const now = this.context.currentTime;
    this.mediaGain.gain.setTargetAtTime(1, now, 0.025);

    if (this.mode === 'tascam424') {
      const point = tascam424OperatingPoint(this.wear, this.wow, this.noise, this.tone);
      this.modelInputGain.gain.setTargetAtTime(point.inputGain, now, 0.025);
      this.setPreampCurve(getOpAmpCurve(point.preDrive, point.preAsymmetry));
      this.lowShelf.frequency.setTargetAtTime(point.lowShelfHz, now, 0.04);
      this.lowShelf.gain.setTargetAtTime(point.lowShelfDb, now, 0.04);
      this.highShelf.frequency.setTargetAtTime(point.highShelfHz, now, 0.04);
      this.highShelf.gain.setTargetAtTime(point.highShelfDb, now, 0.04);
      this.modelOutputGain.gain.setTargetAtTime(point.outputGain, now, 0.035);
      this.highpass.frequency.setTargetAtTime(point.highpassHz, now, 0.04);
      this.lowpass.frequency.setTargetAtTime(point.lowpassHz, now, 0.04);
      this.setSaturatorCurve(getOpAmpCurve(point.postDrive, point.postAsymmetry));
      this.disableTransport(now);
      this.setCrossfeed(0, now);
      return;
    }

    if (this.mode === 'Neve 1073' || this.mode === 'SSL 4000E' || this.mode === 'API 1608') {
      this.configureSummingBus(
        now,
        summingBusOperatingPoint(this.mode, this.wear, this.wow, this.noise, this.tone),
      );
      return;
    }

    if (this.mode === 'Ampex ATR-102') {
      const point = atr102OperatingPoint(this.wear, this.wow, this.noise, this.tone);
      this.modelInputGain.gain.setTargetAtTime(point.inputGain, now, 0.025);
      this.setPreampCurve(getTransformerCurve(point.preDrive, point.preAsymmetry));
      this.lowShelf.frequency.setTargetAtTime(point.bumpHz, now, 0.04);
      this.lowShelf.gain.setTargetAtTime(point.bumpDb + this.wear * 0.65, now, 0.04);
      this.highShelf.frequency.setTargetAtTime(point.highShelfHz, now, 0.04);
      this.highShelf.gain.setTargetAtTime(point.highShelfDb, now, 0.04);
      this.modelOutputGain.gain.setTargetAtTime(point.outputGain, now, 0.035);
      this.highpass.frequency.setTargetAtTime(point.highpassHz, now, 0.04);
      this.lowpass.frequency.setTargetAtTime(point.finalLowpassHz, now, 0.04);
      this.setSaturatorCurve(getTapeCurve(point.postDrive, point.bias));
      this.setCrossfeed(0, now);
      this.wowLfo.frequency.setTargetAtTime(point.wowHz, now, 0.05);
      this.flutterLfo.frequency.setTargetAtTime(point.flutterHz, now, 0.05);
      this.leftDelay.delayTime.setTargetAtTime(0.0012, now, 0.03);
      this.rightDelay.delayTime.setTargetAtTime(0.00155, now, 0.03);
      this.leftDepth.gain.setTargetAtTime(point.instabilitySeconds, now, 0.05);
      this.rightDepth.gain.setTargetAtTime(-point.instabilitySeconds * 0.68, now, 0.05);
      this.cassetteNoiseGain.gain.setTargetAtTime(point.hissGain, now, 0.05);
      this.vinylNoiseGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    this.modelInputGain.gain.setTargetAtTime(1, now, 0.03);
    this.setPreampCurve(IDENTITY_CURVE);
    this.lowShelf.frequency.setTargetAtTime(100, now, 0.03);
    this.lowShelf.gain.setTargetAtTime(0, now, 0.03);
    this.highShelf.frequency.setTargetAtTime(10_000, now, 0.03);
    this.highShelf.gain.setTargetAtTime(0, now, 0.03);
    this.modelOutputGain.gain.setTargetAtTime(1, now, 0.03);
    this.setCrossfeed(0, now);
    this.leftDelay.delayTime.setTargetAtTime(0.008, now, 0.03);
    this.rightDelay.delayTime.setTargetAtTime(0.0093, now, 0.03);

    const cassette = this.mode === 'cassette' || this.mode === 'reel' || this.mode === 'vhs';
    const vinyl = this.mode === 'vinyl' || this.mode === 'wax';
    const narrow = this.mode === 'radio' || this.mode === 'archive';
    const broken = this.mode === 'broken';
    const topMax = narrow ? 6200 : cassette ? (this.mode === 'reel' ? 16000 : 14000) : 18000;
    const top = 2200 + this.tone * (topMax - 2200);
    this.highpass.frequency.setTargetAtTime(narrow ? 140 : cassette ? 48 : 28, now, 0.04);
    this.lowpass.frequency.setTargetAtTime(top, now, 0.04);
    this.setSaturatorCurve(getSaturationCurve(1.2 + this.wear * (broken ? 12 : narrow ? 7 : cassette ? 8 : 4)));
    this.wowLfo.frequency.setTargetAtTime(this.mode === 'reel' ? 0.18 : this.mode === 'vhs' ? 0.72 : broken ? 0.91 : cassette ? 0.32 : 0.55, now, 0.04);
    this.flutterLfo.frequency.setTargetAtTime(this.mode === 'reel' ? 3.2 : this.mode === 'vhs' ? 7.4 : broken ? 9.1 : cassette ? 4.8 : 2.1, now, 0.04);
    const depth = 0.0001 + this.wow * (broken ? 0.0042 : this.mode === 'vhs' ? 0.0034 : this.mode === 'reel' ? 0.0015 : cassette ? 0.0026 : 0.0012);
    this.leftDepth.gain.setTargetAtTime(depth, now, 0.04);
    this.rightDepth.gain.setTargetAtTime(-depth * 0.72, now, 0.04);
    const baseNoise = this.noise * this.noise * 0.012;
    this.cassetteNoiseGain.gain.setTargetAtTime(cassette || narrow || broken ? baseNoise * (broken ? 1.7 : 1) : 0, now, 0.05);
    this.vinylNoiseGain.gain.setTargetAtTime(vinyl ? baseNoise * (this.mode === 'wax' ? 1.7 : 1.25) : 0, now, 0.05);
  }

  private configureSummingBus(now: number, profile: {
    preCompression: number; postCompression: number; asymmetry: number;
    lowHz: number; lowDb: number; highHz: number; highDb: number;
    highpassHz: number; lowpassHz: number; crossfeed: number;
  }): void {
    this.modelInputGain.gain.setTargetAtTime(1, now, 0.025);
    this.setPreampCurve(getSummingCurve(profile.preCompression, profile.asymmetry));
    this.lowShelf.frequency.setTargetAtTime(profile.lowHz, now, 0.04);
    this.lowShelf.gain.setTargetAtTime(profile.lowDb, now, 0.04);
    this.highShelf.frequency.setTargetAtTime(profile.highHz, now, 0.04);
    this.highShelf.gain.setTargetAtTime(profile.highDb, now, 0.04);
    this.modelOutputGain.gain.setTargetAtTime(1 / (1 + profile.crossfeed), now, 0.035);
    this.highpass.frequency.setTargetAtTime(profile.highpassHz, now, 0.04);
    this.lowpass.frequency.setTargetAtTime(profile.lowpassHz, now, 0.04);
    this.setSaturatorCurve(getSummingCurve(profile.postCompression, profile.asymmetry * 0.55));
    this.disableTransport(now);
    this.setCrossfeed(profile.crossfeed, now);
  }

  private disableTransport(now: number): void {
    this.leftDepth.gain.setTargetAtTime(0, now, 0.03);
    this.rightDepth.gain.setTargetAtTime(0, now, 0.03);
    this.leftDelay.delayTime.setTargetAtTime(0, now, 0.03);
    this.rightDelay.delayTime.setTargetAtTime(0, now, 0.03);
    this.cassetteNoiseGain.gain.setTargetAtTime(0, now, 0.03);
    this.vinylNoiseGain.gain.setTargetAtTime(0, now, 0.03);
  }

  private setCrossfeed(amount: number, now: number): void {
    const safe = Math.max(0, Math.min(0.02, amount));
    this.crossfeedLtoR.gain.setTargetAtTime(safe, now, 0.04);
    this.crossfeedRtoL.gain.setTargetAtTime(safe, now, 0.04);
  }

  private createNoiseSource(kind: MediaMode): AudioBufferSourceNode {
    const seconds = 4;
    const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
    const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let brown = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        brown = brown * 0.985 + white * 0.015;
        const impulse = kind === 'vinyl' && Math.random() < 0.00035
          ? (Math.random() * 2 - 1) * (0.35 + Math.random() * 0.65)
          : 0;
        data[index] = kind === 'cassette' ? white * 0.23 + brown * 0.7 : brown * 0.38 + impulse;
      }
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }
}

function isInsertMode(mode: MediaMode): boolean {
  return mode === 'Ampex ATR-102' || ARTIFACT_CONSOLE_MODES.some((candidate) => candidate === mode);
}

export const atr102Speed = calibratedAtr102Speed;

function quantize(value: number, steps: number): number {
  return Math.round(value * steps) / steps;
}

function cacheCurve(
  cache: Map<string, Float32Array<ArrayBuffer>>,
  key: string,
  factory: () => Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> {
  const cached = cache.get(key);
  if (cached) return cached;
  const curve = factory();
  if (cache.size >= MAX_CURVE_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, curve);
  return curve;
}

function createIdentityCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) curve[index] = (index / (curve.length - 1)) * 2 - 1;
  return curve;
}

function getSummingCurve(compression: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const comp = Math.max(0, Math.min(0.12, quantize(compression, 512)));
  const asym = Math.max(-0.08, Math.min(0.08, quantize(asymmetry, 512)));
  return cacheCurve(summingCurveCache, `${comp}:${asym}`, () => {
    const curve = new Float32Array(4096);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = summingBusTransfer(x, comp, asym);
    }
    return curve;
  });
}

function getOpAmpCurve(drive: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const safeDrive = Math.max(1, quantize(drive, 128));
  const asym = quantize(asymmetry, 512);
  return cacheCurve(opAmpCurveCache, `${safeDrive}:${asym}`, () => {
    const curve = new Float32Array(4096);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = opAmpTransfer(x, safeDrive, asym);
    }
    return curve;
  });
}

function getTransformerCurve(drive: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const safeDrive = Math.max(1, quantize(drive, 128));
  const asym = quantize(asymmetry, 512);
  return cacheCurve(transformerCurveCache, `${safeDrive}:${asym}`, () => {
    const curve = new Float32Array(4096);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = transformerTransfer(x, safeDrive, asym);
    }
    return curve;
  });
}

function getTapeCurve(drive: number, bias: number): Float32Array<ArrayBuffer> {
  const safeDrive = Math.max(1, quantize(drive, 128));
  const quantizedBias = quantize(bias, 256);
  return cacheCurve(tapeCurveCache, `${safeDrive}:${quantizedBias}`, () => {
    const curve = new Float32Array(4096);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = atrTapeTransfer(x, safeDrive, quantizedBias);
    }
    return curve;
  });
}

function getSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const quantizedAmount = Math.max(0.001, quantize(amount, 128));
  return cacheCurve(saturationCurveCache, `${quantizedAmount}`, () => {
    const curve = new Float32Array(2048);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(x * quantizedAmount) / quantizedAmount;
    }
    return curve;
  });
}
