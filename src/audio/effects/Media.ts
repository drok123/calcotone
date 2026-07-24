import { clampParameter } from '../Parameter';
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

// Existing indices stay fixed so old presets keep their original format.
export const MEDIA_MODE_ORDER: MediaMode[] = [
  'cassette', 'reel', 'vinyl', 'vhs', 'radio', 'wax', 'broken', 'archive', 'tascam424',
  'Neve 1073', 'SSL 4000E', 'API 1608', 'Ampex ATR-102',
];

const MODE = { id: 'mode', label: 'Mode', min: 0, max: MEDIA_MODE_ORDER.length - 1, defaultValue: 0, step: 1 };
const WEAR = { id: 'wear', label: 'Wear', min: 0, max: 1, defaultValue: 0.162, step: 0.01 };
const WOW = { id: 'wow', label: 'Wow', min: 0, max: 1, defaultValue: 0.16, step: 0.01 };
const NOISE = { id: 'noise', label: 'Noise', min: 0, max: 1, defaultValue: 0.1, step: 0.01 };
const TONE = { id: 'tone', label: 'Tone', min: 0, max: 1, defaultValue: 0.62, step: 0.01 };
const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.26, step: 0.01 };

/** Recording-media coloration plus subtle bus/summing identities. */
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

    // Console modes use tiny, normalized opposite-channel leakage to mimic the way a
    // physical summing bus slightly stops channels from feeling mathematically isolated.
    this.splitter.connect(this.crossfeedLtoR, 0);
    this.splitter.connect(this.crossfeedRtoL, 1);
    this.crossfeedLtoR.connect(this.merger, 0, 1);
    this.crossfeedRtoL.connect(this.merger, 0, 0);
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
        this.applyMixRouting();
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
      case 'mix':
        this.artifactMix = clampParameter(value, MIX);
        this.parameterValues.set(parameterId, this.artifactMix);
        this.applyMixRouting();
        break;
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
    this.crossfeedLtoR.disconnect();
    this.crossfeedRtoL.disconnect();
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

  private applyMixRouting(): void {
    if (!isInsertMode(this.mode)) {
      this.setWetDryMix(this.artifactMix);
      return;
    }

    // Hardware inserts/summing buses are highly correlated with dry. Complementary gains
    // preserve level through the Mix control instead of creating a +3 dB-ish parallel sum.
    const now = this.context.currentTime;
    this.dryGain.gain.setTargetAtTime(1 - this.artifactMix, now, 0.025);
    this.wetGain.gain.setTargetAtTime(this.artifactMix, now, 0.025);
  }

  private applyCharacter(): void {
    const now = this.context.currentTime;

    if (this.mode === 'tascam424') {
      const trimDrive = this.wear;
      const channelDrive = this.tone;
      const lowDb = bipolarAroundDefault(this.wow, WOW.defaultValue) * 10;
      const highDb = bipolarAroundDefault(this.noise, NOISE.defaultValue) * 10;
      const inputGain = 0.82 + trimDrive * 2.9;
      const preDrive = 1.05 + trimDrive * 4.4;
      const postDrive = 1 + Math.pow(channelDrive, 1.55) * 7.6;

      this.modelInputGain.gain.setTargetAtTime(inputGain, now, 0.025);
      this.preampStage.curve = makeOpAmpCurve(preDrive, 0.045);
      this.lowShelf.frequency.setTargetAtTime(100, now, 0.04);
      this.lowShelf.gain.setTargetAtTime(lowDb, now, 0.04);
      this.highShelf.frequency.setTargetAtTime(10_000, now, 0.04);
      this.highShelf.gain.setTargetAtTime(highDb, now, 0.04);
      this.modelOutputGain.gain.setTargetAtTime(
        hardwareAutoTrim(inputGain, opAmpSlope(preDrive), opAmpSlope(postDrive)), now, 0.035
      );
      this.highpass.frequency.setTargetAtTime(28, now, 0.04);
      this.lowpass.frequency.setTargetAtTime(19_000, now, 0.04);
      this.saturator.curve = makeOpAmpCurve(postDrive, 0.032 + trimDrive * 0.025);
      this.disableTransport(now);
      this.setCrossfeed(0, now);
      return;
    }

    if (this.mode === 'Neve 1073') {
      const cohesion = this.wear;
      const weight = bipolarAroundDefault(this.wow, WOW.defaultValue);
      const air = bipolarAroundDefault(this.noise, NOISE.defaultValue);
      const iron = this.tone;
      const crossfeed = 0.0015 + cohesion * 0.0045;

      this.configureSummingBus(now, {
        preCompression: 0.008 + cohesion * 0.035,
        postCompression: 0.006 + iron * 0.022,
        asymmetry: 0.004 + cohesion * 0.018,
        lowHz: 110,
        lowDb: weight * 1.5 + cohesion * 0.15,
        highHz: 12_000,
        highDb: air * 1.15 - cohesion * 0.12,
        highpassHz: 20 + Math.max(0, -weight) * 8,
        lowpassHz: 21_500 - cohesion * 450,
        crossfeed,
      });
      return;
    }

    if (this.mode === 'SSL 4000E') {
      const glue = this.wear;
      const weight = bipolarAroundDefault(this.wow, WOW.defaultValue);
      const presence = bipolarAroundDefault(this.noise, NOISE.defaultValue);
      const punch = this.tone;
      const crossfeed = 0.001 + glue * 0.003;

      this.configureSummingBus(now, {
        preCompression: 0.007 + glue * 0.038,
        postCompression: 0.006 + punch * 0.018,
        asymmetry: 0.0015 + glue * 0.005,
        lowHz: 90,
        lowDb: weight * 1.0 - glue * 0.08,
        highHz: 8_500,
        highDb: presence * 1.2 + glue * 0.08,
        highpassHz: 24,
        lowpassHz: 22_000,
        crossfeed,
      });
      return;
    }

    if (this.mode === 'API 1608') {
      const punch = this.wear;
      const weight = bipolarAroundDefault(this.wow, WOW.defaultValue);
      const presence = bipolarAroundDefault(this.noise, NOISE.defaultValue);
      const iron = this.tone;
      const crossfeed = 0.0008 + punch * 0.0025;

      this.configureSummingBus(now, {
        preCompression: 0.006 + punch * 0.028,
        postCompression: 0.005 + iron * 0.018,
        asymmetry: 0.002 + punch * 0.008,
        lowHz: 100,
        lowDb: weight * 1.3 + punch * 0.12,
        highHz: 10_500,
        highDb: presence * 1.1 + punch * 0.1,
        highpassHz: 22,
        lowpassHz: 21_800,
        crossfeed,
      });
      return;
    }

    if (this.mode === 'Ampex ATR-102') {
      const speed = atr102Speed(this.wow);
      const speedProfile = atr102Profile(speed);
      const record = this.wear;
      const bias = (this.tone - 0.5) * 2;
      const inputGain = 0.9 + record * 2.8;
      const preDrive = 1.02 + record * 2.6;
      const postDrive = 1.05 + record * speedProfile.driveScale * 5.4;

      this.modelInputGain.gain.setTargetAtTime(inputGain, now, 0.025);
      this.preampStage.curve = makeTransformerCurve(preDrive, 0.018);
      this.lowShelf.frequency.setTargetAtTime(speedProfile.bumpHz, now, 0.04);
      this.lowShelf.gain.setTargetAtTime(speedProfile.bumpDb + record * 0.65, now, 0.04);
      this.highShelf.frequency.setTargetAtTime(10_500, now, 0.04);
      this.highShelf.gain.setTargetAtTime(bias * 1.8 - record * 0.45, now, 0.04);
      this.modelOutputGain.gain.setTargetAtTime(
        hardwareAutoTrim(inputGain, transformerSlope(preDrive), tapeSlope(postDrive)), now, 0.035
      );
      this.highpass.frequency.setTargetAtTime(speedProfile.highpassHz, now, 0.04);
      this.lowpass.frequency.setTargetAtTime(speedProfile.lowpassHz - Math.max(0, bias) * 650, now, 0.04);
      this.saturator.curve = makeTapeCurve(postDrive, bias);
      this.setCrossfeed(0, now);
      this.wowLfo.frequency.setTargetAtTime(speedProfile.wowHz, now, 0.05);
      this.flutterLfo.frequency.setTargetAtTime(speedProfile.flutterHz, now, 0.05);
      const instability = speedProfile.modDepth * (0.35 + record * 0.65);
      this.leftDelay.delayTime.setTargetAtTime(0.0012, now, 0.03);
      this.rightDelay.delayTime.setTargetAtTime(0.00155, now, 0.03);
      this.leftDepth.gain.setTargetAtTime(instability, now, 0.05);
      this.rightDepth.gain.setTargetAtTime(-instability * 0.68, now, 0.05);
      const hiss = this.noise * this.noise * speedProfile.noiseScale * 0.0085;
      this.cassetteNoiseGain.gain.setTargetAtTime(hiss, now, 0.05);
      this.vinylNoiseGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    this.modelInputGain.gain.setTargetAtTime(1, now, 0.03);
    this.preampStage.curve = makeIdentityCurve();
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

  private configureSummingBus(now: number, profile: {
    preCompression: number;
    postCompression: number;
    asymmetry: number;
    lowHz: number;
    lowDb: number;
    highHz: number;
    highDb: number;
    highpassHz: number;
    lowpassHz: number;
    crossfeed: number;
  }): void {
    // A summing bus should not manufacture gain. Both nonlinear stages have unity slope at
    // zero and only shave progressively larger peaks; EQ stays deliberately sub-2 dB.
    this.modelInputGain.gain.setTargetAtTime(1, now, 0.025);
    this.preampStage.curve = makeSummingCurve(profile.preCompression, profile.asymmetry);
    this.lowShelf.frequency.setTargetAtTime(profile.lowHz, now, 0.04);
    this.lowShelf.gain.setTargetAtTime(profile.lowDb, now, 0.04);
    this.highShelf.frequency.setTargetAtTime(profile.highHz, now, 0.04);
    this.highShelf.gain.setTargetAtTime(profile.highDb, now, 0.04);
    this.modelOutputGain.gain.setTargetAtTime(1 / (1 + profile.crossfeed), now, 0.035);
    this.highpass.frequency.setTargetAtTime(profile.highpassHz, now, 0.04);
    this.lowpass.frequency.setTargetAtTime(profile.lowpassHz, now, 0.04);
    this.saturator.curve = makeSummingCurve(profile.postCompression, profile.asymmetry * 0.55);
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
  return mode === 'tascam424' || mode === 'Neve 1073' || mode === 'SSL 4000E' || mode === 'API 1608' || mode === 'Ampex ATR-102';
}

function bipolarAroundDefault(value: number, center: number): number {
  if (value >= center) return (value - center) / Math.max(1e-6, 1 - center);
  return (value - center) / Math.max(1e-6, center);
}

export function atr102Speed(value: number): 3.75 | 7.5 | 15 | 30 {
  if (value < 0.08) return 3.75;
  if (value < 0.14) return 7.5;
  if (value < 0.62) return 15;
  return 30;
}

function atr102Profile(speed: 3.75 | 7.5 | 15 | 30): { bumpHz: number; bumpDb: number; highpassHz: number; lowpassHz: number; wowHz: number; flutterHz: number; modDepth: number; noiseScale: number; driveScale: number } {
  if (speed === 3.75) return { bumpHz: 48, bumpDb: 3.8, highpassHz: 38, lowpassHz: 11_800, wowHz: 0.16, flutterHz: 2.7, modDepth: 0.0019, noiseScale: 1.7, driveScale: 1.28 };
  if (speed === 7.5) return { bumpHz: 62, bumpDb: 3.0, highpassHz: 31, lowpassHz: 15_200, wowHz: 0.18, flutterHz: 3.1, modDepth: 0.00125, noiseScale: 1.35, driveScale: 1.14 };
  if (speed === 15) return { bumpHz: 82, bumpDb: 2.15, highpassHz: 27, lowpassHz: 18_900, wowHz: 0.21, flutterHz: 3.6, modDepth: 0.00068, noiseScale: 1, driveScale: 1 };
  return { bumpHz: 108, bumpDb: 1.05, highpassHz: 24, lowpassHz: 21_500, wowHz: 0.25, flutterHz: 4.2, modDepth: 0.00034, noiseScale: 0.72, driveScale: 0.82 };
}

function normalizedTanhSlope(drive: number): number {
  const safeDrive = Math.max(1, drive);
  return safeDrive / Math.max(1e-6, Math.tanh(safeDrive));
}
function opAmpSlope(drive: number): number { return normalizedTanhSlope(drive); }
function transformerSlope(drive: number): number { return normalizedTanhSlope(drive) * 0.985; }
function tapeSlope(drive: number): number { return normalizedTanhSlope(drive); }
function hardwareAutoTrim(inputGain: number, ...stageSlopes: number[]): number {
  const transferGain = stageSlopes.reduce((gain, slope) => gain * Math.max(1e-6, slope), Math.max(1e-6, inputGain));
  return 1 / Math.max(1, transferGain);
}

function makeIdentityCurve(): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) curve[index] = (index / (samples - 1)) * 2 - 1;
  return curve;
}

/** Unity-slope bus curve: no small-signal makeup gain, only mild peak cohesion. */
function makeSummingCurve(compression: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const comp = Math.max(0, Math.min(0.12, compression));
  const asym = Math.max(-0.08, Math.min(0.08, asymmetry));
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const even = asym * x * x * (1 - Math.abs(x));
    const y = x - comp * x * x * x + even;
    curve[index] = Math.max(-1, Math.min(1, y));
  }
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

function makeTransformerCurve(drive: number, asymmetry: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const safeDrive = Math.max(1, drive);
  const norm = Math.max(1e-6, Math.tanh(safeDrive));
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const magneticCurvature = x * x * (x >= 0 ? 1 : -0.42);
    const magnetized = x + asymmetry * magneticCurvature;
    const compressed = Math.tanh(magnetized * safeDrive) / norm;
    curve[index] = Math.max(-1, Math.min(1, compressed * 0.985));
  }
  return curve;
}

function makeTapeCurve(drive: number, bias: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const safeDrive = Math.max(1, drive);
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const biased = x + bias * 0.035 + x * x * (0.018 + bias * 0.012);
    const soft = Math.tanh(biased * safeDrive) / Math.max(1e-6, Math.tanh(safeDrive));
    const compression = 1 - Math.min(0.085, Math.abs(x) * 0.045 * safeDrive);
    curve[index] = Math.max(-1, Math.min(1, soft * compression));
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
