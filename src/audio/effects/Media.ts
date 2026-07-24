import { clampParameter } from '../Parameter';
import { BaseEffect } from './Effect';

export type MediaMode = 'cassette' | 'reel' | 'vinyl' | 'vhs' | 'radio' | 'wax' | 'broken' | 'archive' | 'tascam424';
export const MEDIA_MODE_ORDER: MediaMode[] = ['cassette','reel','vinyl','vhs','radio','wax','broken','archive','tascam424'];

const MODE = { id: 'mode', label: 'Mode', min: 0, max: MEDIA_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const WEAR = { id: 'wear', label: 'Wear', min: 0, max: 1, defaultValue: 0.162, step: 0.01 };
const WOW = { id: 'wow', label: 'Wow', min: 0, max: 1, defaultValue: 0.16, step: 0.01 };
const NOISE = { id: 'noise', label: 'Noise', min: 0, max: 1, defaultValue: 0.1, step: 0.01 };
const TONE = { id: 'tone', label: 'Tone', min: 0, max: 1, defaultValue: 0.62, step: 0.01 };
const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.26, step: 0.01 };

/** Recording-media coloration plus selected topology-informed vintage hardware models. */
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
  private readonly merger: ChannelMergerNode;
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
    this.leftDelay = context.createDelay(0.05);
    this.rightDelay = context.createDelay(0.05);
    this.merger = context.createChannelMerger(2);
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
    this.merger.connect(this.wetGain);

    this.wowLfo.connect(this.leftDepth);
    this.flutterLfo.connect(this.rightDepth);
    this.leftDepth.connect(this.leftDelay.delayTime);
    this.rightDepth.connect(this.rightDelay.delayTime);

    this.cassetteNoise.connect(this.cassetteNoiseGain);
    this.vinylNoise.connect(this.vinylNoiseGain);
    this.cassetteNoiseGain.connect(this.wetGain);
    this.vinylNoiseGain.connect(this.wetGain);

    this.wowLfo.start();
    this.flutterLfo.start(context.currentTime + 0.07);
    this.cassetteNoise.start();
    this.vinylNoise.start();

    this.initializeParameters([MODE, WEAR, WOW, NOISE, TONE, MIX]);
    this.setParameter('mode', MODE.defaultValue);
    this.setParameter('wear', WEAR.defaultValue);
    this.setParameter('wow', WOW.defaultValue);
    this.setParameter('noise', NOISE.defaultValue);
    this.setParameter('tone', TONE.defaultValue);
    this.setParameter('mix', MIX.defaultValue);
  }

  public setParameter(parameterId: string, value: number): void {
    switch (parameterId) {
      case 'mode': {
        const next = clampParameter(value, MODE);
        this.parameterValues.set(parameterId, next);
        this.mode = MEDIA_MODE_ORDER[Math.round(next)] ?? 'cassette';
        this.applyCharacter();
        break;
      }
      case 'wear':
        this.wear = clampParameter(value, WEAR);
        this.parameterValues.set(parameterId, this.wear);
        this.applyCharacter();
        break;
      case 'wow':
        this.wow = clampParameter(value, WOW);
        this.parameterValues.set(parameterId, this.wow);
        this.applyCharacter();
        break;
      case 'noise':
        this.noise = clampParameter(value, NOISE);
        this.parameterValues.set(parameterId, this.noise);
        this.applyCharacter();
        break;
      case 'tone':
        this.tone = clampParameter(value, TONE);
        this.parameterValues.set(parameterId, this.tone);
        this.applyCharacter();
        break;
      case 'mix': {
        const next = clampParameter(value, MIX);
        this.parameterValues.set(parameterId, next);
        this.setWetDryMix(next);
        break;
      }
      default:
        console.warn(`Unknown parameter "${parameterId}" for ${this.name}.`);
    }
  }

  public override dispose(): void {
    this.wowLfo.stop();
    this.flutterLfo.stop();
    this.cassetteNoise.stop();
    this.vinylNoise.stop();
    this.modelInputGain.disconnect();
    this.preampStage.disconnect();
    this.lowShelf.disconnect();
    this.highShelf.disconnect();
    this.modelOutputGain.disconnect();
    this.highpass.disconnect();
    this.lowpass.disconnect();
    this.saturator.disconnect();
    this.splitter.disconnect();
    this.leftDelay.disconnect();
    this.rightDelay.disconnect();
    this.merger.disconnect();
    this.wowLfo.disconnect();
    this.flutterLfo.disconnect();
    this.leftDepth.disconnect();
    this.rightDepth.disconnect();
    this.cassetteNoise.disconnect();
    this.vinylNoise.disconnect();
    this.cassetteNoiseGain.disconnect();
    this.vinylNoiseGain.disconnect();
    super.dispose();
  }

  private applyCharacter(): void {
    const now = this.context.currentTime;

    if (this.mode === 'tascam424') {
      // Circuit-informed 424 MkI dry-channel model. The exact calibration is intentionally
      // kept separate from the generic cassette path so later measurements can refine it.
      const trimDrive = this.wear;
      const channelDrive = this.tone;
      const lowDb = bipolarAroundDefault(this.wow, WOW.defaultValue) * 10;
      const highDb = bipolarAroundDefault(this.noise, NOISE.defaultValue) * 10;

      this.modelInputGain.gain.setTargetAtTime(0.82 + trimDrive * 2.9, now, 0.025);
      this.preampStage.curve = makeOpAmpCurve(1.05 + trimDrive * 4.4, 0.045);
      this.lowShelf.gain.setTargetAtTime(lowDb, now, 0.04);
      this.highShelf.gain.setTargetAtTime(highDb, now, 0.04);
      this.modelOutputGain.gain.setTargetAtTime(1 / (0.92 + trimDrive * 0.36 + channelDrive * 0.46), now, 0.035);

      this.highpass.frequency.setTargetAtTime(28, now, 0.04);
      this.lowpass.frequency.setTargetAtTime(19_000, now, 0.04);
      this.saturator.curve = makeOpAmpCurve(1 + Math.pow(channelDrive, 1.55) * 7.6, 0.032 + trimDrive * 0.025);

      // This mode is the dry 424 preamp path: transport modulation and media noise are off.
      this.leftDepth.gain.setTargetAtTime(0, now, 0.03);
      this.rightDepth.gain.setTargetAtTime(0, now, 0.03);
      this.leftDelay.delayTime.setTargetAtTime(0, now, 0.03);
      this.rightDelay.delayTime.setTargetAtTime(0, now, 0.03);
      this.cassetteNoiseGain.gain.setTargetAtTime(0, now, 0.03);
      this.vinylNoiseGain.gain.setTargetAtTime(0, now, 0.03);
      return;
    }

    this.modelInputGain.gain.setTargetAtTime(1, now, 0.03);
    this.preampStage.curve = makeIdentityCurve();
    this.lowShelf.gain.setTargetAtTime(0, now, 0.03);
    this.highShelf.gain.setTargetAtTime(0, now, 0.03);
    this.modelOutputGain.gain.setTargetAtTime(1, now, 0.03);
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
    this.saturator.curve = makeSaturationCurve(1.2 + this.wear * (broken ? 12 : narrow ? 7 : cassette ? 8 : 4));

    this.wowLfo.frequency.setTargetAtTime(this.mode === 'reel' ? 0.18 : this.mode === 'vhs' ? 0.72 : broken ? 0.91 : cassette ? 0.32 : 0.55, now, 0.04);
    this.flutterLfo.frequency.setTargetAtTime(this.mode === 'reel' ? 3.2 : this.mode === 'vhs' ? 7.4 : broken ? 9.1 : cassette ? 4.8 : 2.1, now, 0.04);
    const depth = 0.0001 + this.wow * (broken ? 0.0042 : this.mode === 'vhs' ? 0.0034 : this.mode === 'reel' ? 0.0015 : cassette ? 0.0026 : 0.0012);
    this.leftDepth.gain.setTargetAtTime(depth, now, 0.04);
    this.rightDepth.gain.setTargetAtTime(-depth * 0.72, now, 0.04);

    const baseNoise = this.noise * this.noise * 0.012;
    this.cassetteNoiseGain.gain.setTargetAtTime(cassette || narrow || broken ? baseNoise * (broken ? 1.7 : 1) : 0, now, 0.05);
    this.vinylNoiseGain.gain.setTargetAtTime(vinyl ? baseNoise * (this.mode === 'wax' ? 1.7 : 1.25) : 0, now, 0.05);
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

function bipolarAroundDefault(value: number, center: number): number {
  if (value >= center) return (value - center) / Math.max(1e-6, 1 - center);
  return (value - center) / Math.max(1e-6, center);
}

function makeIdentityCurve(): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) curve[index] = (index / (samples - 1)) * 2 - 1;
  return curve;
}

function makeOpAmpCurve(drive: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const safeDrive = Math.max(1, drive);
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const sideDrive = safeDrive * (x >= 0 ? 1 + asymmetry : 1 - asymmetry * 0.62);
    const normal = Math.max(1e-6, Math.tanh(sideDrive));
    curve[index] = Math.tanh(x * sideDrive) / normal;
  }
  return curve;
}

function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * amount) / amount;
  }
  return curve;
}
