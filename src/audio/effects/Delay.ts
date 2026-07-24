import { clampParameter, type ParameterDefinition } from '../Parameter';
import { BaseEffect } from './Effect';

export type DelayAlgorithm =
  | 'clean'
  | 'tape'
  | 'bbd'
  | 'pingpong'
  | 'diffuse'
  | 'scatter'
  | 'constellation'
  | 're201';

// Existing indices stay fixed so saved presets keep their original sound.
export const DELAY_ALGORITHM_ORDER: DelayAlgorithm[] = [
  'clean','tape','bbd','pingpong','diffuse','scatter','constellation','re201',
];

const ALGORITHM: ParameterDefinition = { id: 'algorithm', label: 'Algorithm', min: 0, max: DELAY_ALGORITHM_ORDER.length - 1, defaultValue: 1, smoothingTime: 0.08 };
const TIME: ParameterDefinition = { id: 'time', label: 'Time', min: 0.03, max: 4, defaultValue: 0.36, unit: 's', taper: 'logarithmic', smoothingTime: 0.05 };
const FEEDBACK: ParameterDefinition = { id: 'feedback', label: 'Feedback', min: 0, max: 0.9, defaultValue: 0.22, smoothingTime: 0.045 };
const COLOR: ParameterDefinition = { id: 'color', label: 'Color', min: 0, max: 1, defaultValue: 0.42, smoothingTime: 0.06 };
const CHARACTER: ParameterDefinition = { id: 'character', label: 'Character', min: 0, max: 1, defaultValue: 0.14, smoothingTime: 0.08 };
const WIDTH: ParameterDefinition = { id: 'width', label: 'Width', min: 0, max: 1, defaultValue: 0.58, smoothingTime: 0.06 };
const MIX: ParameterDefinition = { id: 'mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.14, smoothingTime: 0.025 };

interface DelayNetworkLike {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(time: number, feedback: number, color: number, character: number, width: number): void;
  dispose(): void;
}

interface DelayAlgorithmConfig {
  id: Exclude<DelayAlgorithm, 're201'>;
  timeRatios: [number, number];
  crossFeedback: number;
  sameFeedback: number;
  highpass: number;
  lowpassRange: [number, number];
  saturation: number;
  quantization: number;
  flutterDepth: number;
  flutterRates: [number, number];
  diffusionStages: number;
  diffusionBase: number;
  outputTrim: number;
  inputTrim: number;
  scatter: number;
  pitchScatter: number;
  reverseChance: number;
  orbitDepth: number;
}

const CONFIGS: Record<Exclude<DelayAlgorithm, 're201'>, DelayAlgorithmConfig> = {
  clean: { id:'clean', timeRatios:[1,1.006], crossFeedback:0.08, sameFeedback:0.92, highpass:55, lowpassRange:[6500,19000], saturation:0.08, quantization:0, flutterDepth:0.00012, flutterRates:[0.11,0.137], diffusionStages:0, diffusionBase:880, outputTrim:0.78, inputTrim:0.92, scatter:0, pitchScatter:0, reverseChance:0, orbitDepth:0 },
  tape: { id:'tape', timeRatios:[1,1.013], crossFeedback:0.18, sameFeedback:0.82, highpass:75, lowpassRange:[1800,12500], saturation:0.68, quantization:0.02, flutterDepth:0.0028, flutterRates:[0.17,0.223], diffusionStages:1, diffusionBase:720, outputTrim:0.71, inputTrim:0.86, scatter:0.03, pitchScatter:0, reverseChance:0, orbitDepth:0 },
  bbd: { id:'bbd', timeRatios:[1,0.987], crossFeedback:0.22, sameFeedback:0.78, highpass:120, lowpassRange:[900,7200], saturation:0.5, quantization:0.32, flutterDepth:0.0011, flutterRates:[0.29,0.347], diffusionStages:1, diffusionBase:1180, outputTrim:0.67, inputTrim:0.84, scatter:0.045, pitchScatter:0, reverseChance:0, orbitDepth:0 },
  pingpong: { id:'pingpong', timeRatios:[1,1.5], crossFeedback:0.94, sameFeedback:0.06, highpass:80, lowpassRange:[2600,15500], saturation:0.22, quantization:0, flutterDepth:0.00035, flutterRates:[0.13,0.19], diffusionStages:0, diffusionBase:900, outputTrim:0.69, inputTrim:0.84, scatter:0, pitchScatter:0, reverseChance:0, orbitDepth:0 },
  diffuse: { id:'diffuse', timeRatios:[1,1.271], crossFeedback:0.42, sameFeedback:0.58, highpass:130, lowpassRange:[1900,13500], saturation:0.28, quantization:0.01, flutterDepth:0.0014, flutterRates:[0.09,0.151], diffusionStages:4, diffusionBase:510, outputTrim:0.56, inputTrim:0.72, scatter:0.055, pitchScatter:0, reverseChance:0, orbitDepth:0 },
  scatter: { id:'scatter', timeRatios:[1,0.754], crossFeedback:0.55, sameFeedback:0.45, highpass:170, lowpassRange:[1500,11800], saturation:0.38, quantization:0.16, flutterDepth:0.0022, flutterRates:[0.07,0.113], diffusionStages:2, diffusionBase:670, outputTrim:0.52, inputTrim:0.68, scatter:0.22, pitchScatter:0, reverseChance:0, orbitDepth:0 },
  constellation: { id:'constellation', timeRatios:[1,1.333], crossFeedback:0.68, sameFeedback:0.32, highpass:145, lowpassRange:[2100,16500], saturation:0.24, quantization:0.035, flutterDepth:0.0017, flutterRates:[0.071,0.109], diffusionStages:3, diffusionBase:640, outputTrim:0.48, inputTrim:0.62, scatter:0.12, pitchScatter:0.82, reverseChance:0.28, orbitDepth:0.72 },
};

const PITCH_GRAIN_ENVELOPE = new Float32Array([0, 0.18, 0.72, 1, 0.72, 0.18, 0]);

class DualGrainPitchShifter {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly context: AudioContext;
  private readonly delays: [DelayNode, DelayNode];
  private readonly gains: [GainNode, GainNode];
  private timer: number | null = null;
  private nextGrainTime = 0;
  private voice = 0;
  private semitones = 0;
  private amount = 0;
  private disposed = false;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.delays = [context.createDelay(0.22), context.createDelay(0.22)];
    this.gains = [context.createGain(), context.createGain()];
    this.gains[0].gain.value = 0;
    this.gains[1].gain.value = 0;
    for (let index = 0; index < 2; index += 1) {
      this.input.connect(this.delays[index]);
      this.delays[index].connect(this.gains[index]);
      this.gains[index].connect(this.output);
    }
    this.nextGrainTime = context.currentTime + 0.02;
    this.timer = globalThis.setInterval(() => this.scheduleAhead(), 48);
  }

  public setPitch(semitones: number, amount: number): void {
    this.semitones = Math.max(-12, Math.min(12, semitones));
    this.amount = Math.max(0, Math.min(1, amount));
  }

  private scheduleAhead(): void {
    if (this.disposed) return;
    const horizon = this.context.currentTime + 0.38;
    while (this.nextGrainTime < horizon) {
      this.scheduleGrain(this.nextGrainTime, this.voice);
      this.voice = 1 - this.voice;
      this.nextGrainTime += 0.055;
    }
  }

  private scheduleGrain(start: number, voice: number): void {
    const duration = 0.11;
    const ratio = Math.pow(2, (this.semitones * this.amount) / 12);
    const slope = 1 - ratio;
    const travel = Math.min(0.085, Math.max(0.008, Math.abs(slope) * duration));
    const low = 0.006;
    const high = low + travel;
    const delay = this.delays[voice].delayTime;
    const gain = this.gains[voice].gain;
    delay.cancelScheduledValues(start);
    delay.setValueAtTime(slope < 0 ? high : low, start);
    delay.linearRampToValueAtTime(slope < 0 ? low : high, start + duration);
    gain.cancelScheduledValues(start);
    gain.setValueCurveAtTime(PITCH_GRAIN_ENVELOPE, start, duration);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) globalThis.clearInterval(this.timer);
    this.timer = null;
    [this.input, this.output, ...this.delays, ...this.gains].forEach((node) => node.disconnect());
  }
}

class DelayNetwork implements DelayNetworkLike {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly context: AudioContext;
  private readonly config: DelayAlgorithmConfig;
  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly delays: [DelayNode, DelayNode];
  private readonly highpasses: [BiquadFilterNode, BiquadFilterNode];
  private readonly lowpasses: [BiquadFilterNode, BiquadFilterNode];
  private readonly colors: [WaveShaperNode, WaveShaperNode];
  private readonly sameFeedback: [GainNode, GainNode];
  private readonly crossFeedback: [GainNode, GainNode];
  private readonly directOutputs: [GainNode, GainNode];
  private readonly crossOutputs: [GainNode, GainNode];
  private readonly diffusers: BiquadFilterNode[][] = [[], []];
  private readonly lfos: [OscillatorNode, OscillatorNode];
  private readonly lfoDepths: [GainNode, GainNode];
  private readonly pitchShifters: [DualGrainPitchShifter | null, DualGrainPitchShifter | null];
  private scatterTimer: number | null = null;
  private time = TIME.defaultValue;
  private character = CHARACTER.defaultValue;
  private width = WIDTH.defaultValue;
  private lastCharacterCurve: Float32Array | null = null;
  private disposed = false;

  public constructor(context: AudioContext, config: DelayAlgorithmConfig) {
    this.context = context;
    this.config = config;
    this.input = context.createGain();
    this.output = context.createGain();
    this.splitter = context.createChannelSplitter(2);
    this.merger = context.createChannelMerger(2);
    this.delays = [context.createDelay(6.5), context.createDelay(6.5)];
    this.highpasses = [context.createBiquadFilter(), context.createBiquadFilter()];
    this.lowpasses = [context.createBiquadFilter(), context.createBiquadFilter()];
    this.colors = [context.createWaveShaper(), context.createWaveShaper()];
    this.sameFeedback = [context.createGain(), context.createGain()];
    this.crossFeedback = [context.createGain(), context.createGain()];
    this.directOutputs = [context.createGain(), context.createGain()];
    this.crossOutputs = [context.createGain(), context.createGain()];
    this.lfos = [context.createOscillator(), context.createOscillator()];
    this.lfoDepths = [context.createGain(), context.createGain()];
    this.pitchShifters = config.pitchScatter > 0 ? [new DualGrainPitchShifter(context), new DualGrainPitchShifter(context)] : [null, null];

    this.input.gain.value = config.inputTrim;
    this.input.connect(this.splitter);
    for (let channel = 0; channel < 2; channel += 1) {
      const hp = this.highpasses[channel];
      const lp = this.lowpasses[channel];
      const color = this.colors[channel];
      hp.type = 'highpass'; hp.frequency.value = config.highpass; hp.Q.value = 0.55;
      lp.type = 'lowpass'; lp.frequency.value = config.lowpassRange[1]; lp.Q.value = 0.45;
      color.oversample = '4x'; color.curve = createCharacterCurve(0, config);
      this.splitter.connect(this.delays[channel], channel);
      this.delays[channel].connect(hp); hp.connect(lp);
      let tail: AudioNode = lp;
      for (let stage = 0; stage < config.diffusionStages; stage += 1) {
        const allpass = context.createBiquadFilter();
        allpass.type = 'allpass'; allpass.frequency.value = config.diffusionBase + stage * 430 + channel * 97; allpass.Q.value = 0.65;
        tail.connect(allpass); tail = allpass; this.diffusers[channel].push(allpass);
      }
      const pitchShifter = this.pitchShifters[channel];
      if (pitchShifter) { tail.connect(pitchShifter.input); pitchShifter.output.connect(color); } else tail.connect(color);
      color.connect(this.sameFeedback[channel]); color.connect(this.crossFeedback[channel]);
      this.sameFeedback[channel].connect(this.delays[channel]); this.crossFeedback[channel].connect(this.delays[1 - channel]);
      color.connect(this.directOutputs[channel]); color.connect(this.crossOutputs[channel]);
      this.directOutputs[channel].connect(this.merger, 0, channel); this.crossOutputs[channel].connect(this.merger, 0, 1 - channel);
      const lfo = this.lfos[channel];
      lfo.type = channel === 0 ? 'sine' : 'triangle'; lfo.frequency.value = config.flutterRates[channel];
      this.lfoDepths[channel].gain.value = 0; lfo.connect(this.lfoDepths[channel]); this.lfoDepths[channel].connect(this.delays[channel].delayTime); lfo.start(context.currentTime + channel * 0.19);
    }
    this.merger.connect(this.output);
    if (config.scatter > 0) this.startScatterClock();
  }

  public update(time: number, feedback: number, color: number, character: number, width: number): void {
    if (this.disposed) return;
    this.time = time; this.character = character; this.width = width;
    const now = this.context.currentTime;
    const cutoff = this.config.lowpassRange[0] * Math.pow(this.config.lowpassRange[1] / this.config.lowpassRange[0], color);
    const normalizedFeedback = Math.min(1, Math.max(0, feedback / FEEDBACK.max));
    const algorithmCeiling = this.config.id === 'clean' ? 0.86 : this.config.id === 'pingpong' ? 0.82 : this.config.id === 'constellation' ? 0.68 : 0.79;
    const loop = algorithmCeiling * Math.pow(normalizedFeedback, 1.45);
    const directWidth = 0.52 + width * 0.46;
    const crossWidth = (1 - width) * 0.34;
    const characterCurve = getCharacterCurve(character, this.config);
    const curveChanged = characterCurve !== this.lastCharacterCurve;
    this.lastCharacterCurve = characterCurve;

    for (let channel = 0; channel < 2; channel += 1) {
      const ratio = this.config.timeRatios[channel];
      this.delays[channel].delayTime.setTargetAtTime(Math.min(6.35, time * ratio), now, 0.05);
      this.highpasses[channel].frequency.setTargetAtTime(this.config.highpass + (1 - color) * 95, now, 0.06);
      this.lowpasses[channel].frequency.setTargetAtTime(cutoff * (channel === 0 ? 1 : 0.94), now, 0.065);
      this.sameFeedback[channel].gain.setTargetAtTime(loop * this.config.sameFeedback, now, 0.05);
      this.crossFeedback[channel].gain.setTargetAtTime(loop * this.config.crossFeedback, now, 0.05);
      this.directOutputs[channel].gain.setTargetAtTime(directWidth * this.config.outputTrim, now, 0.05);
      this.crossOutputs[channel].gain.setTargetAtTime(crossWidth * this.config.outputTrim, now, 0.05);
      this.lfoDepths[channel].gain.setTargetAtTime(this.config.flutterDepth * Math.pow(character, 1.55) * (channel ? -0.82 : 1), now, 0.09);
      if (curveChanged) this.colors[channel].curve = characterCurve;
      this.pitchShifters[channel]?.setPitch(channel === 0 ? 7 : -5, this.config.pitchScatter * Math.pow(character, 1.35));
      this.diffusers[channel].forEach((node, index) => {
        node.Q.setTargetAtTime(0.45 + character * (0.8 + index * 0.13), now, 0.07);
        node.frequency.setTargetAtTime(this.config.diffusionBase + index * 390 + character * 1450 + channel * 83, now, 0.07);
      });
    }
  }

  private startScatterClock(): void {
    this.scatterTimer = globalThis.setInterval(() => {
      if (this.disposed || this.character < 0.02) return;
      const now = this.context.currentTime;
      const amount = this.config.scatter * this.character;
      this.delays.forEach((delay, channel) => {
        const jitter = 1 + (seededNoise(now * 2.7 + channel * 31.7) - 0.5) * amount;
        const dropout = seededNoise(now * 0.91 + channel * 17.3);
        delay.delayTime.setTargetAtTime(Math.min(6.35, Math.max(0.015, this.time * this.config.timeRatios[channel] * jitter)), now, 0.12);
        const fragmentDrop = dropout < amount * (0.16 + this.config.reverseChance * 0.22) ? 0.16 : 1;
        const orbit = this.config.orbitDepth * this.character * Math.sin(now * 0.73 + channel * Math.PI);
        this.directOutputs[channel].gain.setTargetAtTime(this.config.outputTrim * (0.52 + this.width * 0.46) * fragmentDrop * (1 - Math.max(0, orbit) * 0.36), now, 0.08);
        this.crossOutputs[channel].gain.setTargetAtTime(this.config.outputTrim * ((1 - this.width) * 0.34 + Math.max(0, orbit) * 0.31), now, 0.1);
        const pitchChoice = chooseConstellationPitch(seededNoise(now * 1.37 + channel * 43.1), this.character);
        this.pitchShifters[channel]?.setPitch(channel === 0 ? pitchChoice : -pitchChoice * 0.72, this.config.pitchScatter * Math.pow(this.character, 1.28));
      });
    }, 420);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scatterTimer !== null) globalThis.clearInterval(this.scatterTimer);
    this.pitchShifters.forEach((shifter) => shifter?.dispose());
    this.lfos.forEach((lfo) => { try { lfo.stop(); } catch { /* already stopped */ } lfo.disconnect(); });
    [this.input,this.output,this.splitter,this.merger,...this.delays,...this.highpasses,...this.lowpasses,...this.colors,...this.sameFeedback,...this.crossFeedback,...this.directOutputs,...this.crossOutputs,...this.diffusers.flat(),...this.lfoDepths].forEach((node) => node.disconnect());
  }
}

class SpaceEchoNetwork implements DelayNetworkLike {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly context: AudioContext;
  private readonly preamp: WaveShaperNode;
  private readonly inputLowpass: BiquadFilterNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly monoBus: GainNode;
  private readonly monoInputs: [GainNode, GainNode];
  private readonly recordBus: GainNode;
  private readonly heads: DelayNode[] = [];
  private readonly headHighpasses: BiquadFilterNode[] = [];
  private readonly headLowpasses: BiquadFilterNode[] = [];
  private readonly headSaturators: WaveShaperNode[] = [];
  private readonly headGains: GainNode[] = [];
  private readonly headPans: StereoPannerNode[] = [];
  private readonly feedbackTaps: GainNode[] = [];
  private readonly feedbackBus: GainNode;
  private readonly feedbackHighpass: BiquadFilterNode;
  private readonly feedbackLowpass: BiquadFilterNode;
  private readonly feedbackSaturator: WaveShaperNode;
  private readonly feedbackGain: GainNode;
  private readonly wowLfo: OscillatorNode;
  private readonly flutterLfo: OscillatorNode;
  private readonly wowDepths: GainNode[] = [];
  private readonly flutterDepths: GainNode[] = [];
  private lastCurve: Float32Array | null = null;
  private disposed = false;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.preamp = context.createWaveShaper();
    this.preamp.oversample = '4x';
    this.preamp.curve = getSpaceEchoCurve(0);
    this.inputLowpass = context.createBiquadFilter();
    this.inputLowpass.type = 'lowpass'; this.inputLowpass.frequency.value = 14_000; this.inputLowpass.Q.value = 0.45;
    this.splitter = context.createChannelSplitter(2);
    this.monoBus = context.createGain(); this.monoBus.gain.value = 1;
    this.monoInputs = [context.createGain(), context.createGain()]; this.monoInputs[0].gain.value = 0.5; this.monoInputs[1].gain.value = 0.5;
    this.recordBus = context.createGain();
    this.feedbackBus = context.createGain();
    this.feedbackHighpass = context.createBiquadFilter(); this.feedbackHighpass.type = 'highpass'; this.feedbackHighpass.frequency.value = 85; this.feedbackHighpass.Q.value = 0.5;
    this.feedbackLowpass = context.createBiquadFilter(); this.feedbackLowpass.type = 'lowpass'; this.feedbackLowpass.frequency.value = 7500; this.feedbackLowpass.Q.value = 0.5;
    this.feedbackSaturator = context.createWaveShaper(); this.feedbackSaturator.oversample = '4x'; this.feedbackSaturator.curve = getSpaceEchoCurve(0.2);
    this.feedbackGain = context.createGain(); this.feedbackGain.gain.value = 0.2;
    this.wowLfo = context.createOscillator(); this.wowLfo.type = 'sine'; this.wowLfo.frequency.value = 0.34;
    this.flutterLfo = context.createOscillator(); this.flutterLfo.type = 'triangle'; this.flutterLfo.frequency.value = 5.1;

    this.input.connect(this.preamp); this.preamp.connect(this.inputLowpass); this.inputLowpass.connect(this.splitter);
    this.splitter.connect(this.monoInputs[0], 0); this.splitter.connect(this.monoInputs[1], 1);
    this.monoInputs[0].connect(this.monoBus); this.monoInputs[1].connect(this.monoBus); this.monoBus.connect(this.recordBus);
    this.feedbackBus.connect(this.feedbackHighpass); this.feedbackHighpass.connect(this.feedbackLowpass); this.feedbackLowpass.connect(this.feedbackSaturator); this.feedbackSaturator.connect(this.feedbackGain); this.feedbackGain.connect(this.recordBus);

    for (let i = 0; i < 3; i += 1) {
      const delay = context.createDelay(0.7);
      const hp = context.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 72; hp.Q.value = 0.5;
      const lp = context.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7600 - i * 450; lp.Q.value = 0.48;
      const saturator = context.createWaveShaper(); saturator.oversample = '4x'; saturator.curve = getSpaceEchoCurve(0.2);
      const gain = context.createGain(); gain.gain.value = [0.72,0.56,0.44][i];
      const pan = context.createStereoPanner(); pan.pan.value = 0;
      const feedbackTap = context.createGain(); feedbackTap.gain.value = [0.34,0.33,0.33][i];
      const wowDepth = context.createGain(); wowDepth.gain.value = 0;
      const flutterDepth = context.createGain(); flutterDepth.gain.value = 0;
      this.recordBus.connect(delay); delay.connect(hp); hp.connect(lp); lp.connect(saturator); saturator.connect(gain); gain.connect(pan); pan.connect(this.output);
      saturator.connect(feedbackTap); feedbackTap.connect(this.feedbackBus);
      this.wowLfo.connect(wowDepth); this.flutterLfo.connect(flutterDepth); wowDepth.connect(delay.delayTime); flutterDepth.connect(delay.delayTime);
      this.heads.push(delay); this.headHighpasses.push(hp); this.headLowpasses.push(lp); this.headSaturators.push(saturator); this.headGains.push(gain); this.headPans.push(pan); this.feedbackTaps.push(feedbackTap); this.wowDepths.push(wowDepth); this.flutterDepths.push(flutterDepth);
    }
    this.wowLfo.start(); this.flutterLfo.start(context.currentTime + 0.043);
  }

  public update(time: number, feedback: number, color: number, character: number, width: number): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    const timeNorm = clamp01(Math.log(Math.max(TIME.min, time) / TIME.min) / Math.log(TIME.max / TIME.min));
    const head1 = 0.069 + timeNorm * (0.177 - 0.069);
    const ratios = [1, 1.90, 2.76];
    const tone = 2600 * Math.pow(4.5, color);
    const age = character;
    const curve = getSpaceEchoCurve(age);
    if (curve !== this.lastCurve) {
      this.lastCurve = curve;
      this.preamp.curve = curve;
      this.feedbackSaturator.curve = curve;
      this.headSaturators.forEach((node) => { node.curve = curve; });
    }
    this.inputLowpass.frequency.setTargetAtTime(10_500 + color * 5_500 - age * 2_400, now, 0.06);
    this.feedbackHighpass.frequency.setTargetAtTime(65 + (1 - color) * 105, now, 0.06);
    this.feedbackLowpass.frequency.setTargetAtTime(Math.max(1800, tone * (1 - age * 0.22)), now, 0.06);
    const feedbackNorm = clamp01(feedback / FEEDBACK.max);
    this.feedbackGain.gain.setTargetAtTime(Math.min(0.93, Math.pow(feedbackNorm, 1.14) * (0.76 + age * 0.16)), now, 0.05);
    this.wowLfo.frequency.setTargetAtTime(0.22 + age * 0.30, now, 0.1);
    this.flutterLfo.frequency.setTargetAtTime(4.2 + age * 3.8, now, 0.1);

    const headBase = [0.74 - width * 0.16, 0.44 + width * 0.22, 0.28 + width * 0.42];
    const panSpread = width * 0.72;
    this.heads.forEach((head, i) => {
      head.delayTime.setTargetAtTime(head1 * ratios[i], now, 0.065);
      this.headHighpasses[i].frequency.setTargetAtTime(62 + age * 45 + i * 8, now, 0.06);
      this.headLowpasses[i].frequency.setTargetAtTime(Math.max(1800, tone * (1 - i * 0.055) * (1 - age * 0.12)), now, 0.06);
      this.headGains[i].gain.setTargetAtTime(headBase[i] * 0.72, now, 0.06);
      this.headPans[i].pan.setTargetAtTime(i === 0 ? -panSpread : i === 2 ? panSpread : 0, now, 0.07);
      this.feedbackTaps[i].gain.setTargetAtTime([0.38,0.34,0.28][i] * (0.78 + width * 0.22), now, 0.06);
      const wowDepth = (0.00008 + age * age * 0.0019) * (1 + i * 0.17);
      const flutterDepth = (0.000025 + age * age * 0.00042) * (1 + i * 0.12);
      this.wowDepths[i].gain.setTargetAtTime(wowDepth, now, 0.08);
      this.flutterDepths[i].gain.setTargetAtTime(i % 2 ? -flutterDepth : flutterDepth, now, 0.08);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.wowLfo.stop(); } catch { /* already stopped */ }
    try { this.flutterLfo.stop(); } catch { /* already stopped */ }
    [this.input,this.output,this.preamp,this.inputLowpass,this.splitter,this.monoBus,...this.monoInputs,this.recordBus,this.feedbackBus,this.feedbackHighpass,this.feedbackLowpass,this.feedbackSaturator,this.feedbackGain,this.wowLfo,this.flutterLfo,...this.heads,...this.headHighpasses,...this.headLowpasses,...this.headSaturators,...this.headGains,...this.headPans,...this.feedbackTaps,...this.wowDepths,...this.flutterDepths].forEach((node) => node.disconnect());
  }
}

const MAX_RETIRED_DELAY_NETWORKS = 2;
const HALO_CROSSFADE_SECONDS = 0.52;
interface ActiveDelayNetwork { algorithm: DelayAlgorithm; network: DelayNetworkLike; gain: GainNode; disposeTimer: number | null; }

export class DelayEffect extends BaseEffect {
  public readonly id = 'delay';
  public readonly name = 'Halo';
  private active: ActiveDelayNetwork;
  private readonly retiring = new Set<ActiveDelayNetwork>();
  private algorithm: DelayAlgorithm = 'tape';
  private time = TIME.defaultValue;
  private feedback = FEEDBACK.defaultValue;
  private color = COLOR.defaultValue;
  private character = CHARACTER.defaultValue;
  private width = WIDTH.defaultValue;

  public constructor(context: AudioContext) {
    super(context);
    this.active = this.createNetwork(this.algorithm, 1);
    this.initializeParameters([ALGORITHM,TIME,FEEDBACK,COLOR,CHARACTER,WIDTH,MIX]);
    this.setParameter('algorithm', ALGORITHM.defaultValue);
    this.setParameter('time', TIME.defaultValue);
    this.setParameter('feedback', FEEDBACK.defaultValue);
    this.setParameter('color', COLOR.defaultValue);
    this.setParameter('character', CHARACTER.defaultValue);
    this.setParameter('width', WIDTH.defaultValue);
    this.setParameter('mix', MIX.defaultValue);
  }

  public setAlgorithm(algorithm: DelayAlgorithm): void { const index = DELAY_ALGORITHM_ORDER.indexOf(algorithm); if (index >= 0) this.setParameter('algorithm', index); }
  public getAlgorithm(): DelayAlgorithm { return this.algorithm; }

  public setParameter(parameterId: string, value: number): void {
    switch (parameterId) {
      case 'algorithm': { const index = Math.round(clampParameter(value, ALGORITHM)); this.parameterValues.set(parameterId, index); this.switchAlgorithm(DELAY_ALGORITHM_ORDER[index]); break; }
      case 'time': this.time = clampParameter(value, TIME); this.parameterValues.set(parameterId, this.time); this.updateNetworks(); break;
      case 'feedback': this.feedback = clampParameter(value, FEEDBACK); this.parameterValues.set(parameterId, this.feedback); this.updateNetworks(); break;
      case 'color': this.color = clampParameter(value, COLOR); this.parameterValues.set(parameterId, this.color); this.updateNetworks(); break;
      case 'character':
      case 'texture': this.character = clampParameter(value, CHARACTER); this.parameterValues.set('character', this.character); this.updateNetworks(); break;
      case 'width': this.width = clampParameter(value, WIDTH); this.parameterValues.set(parameterId, this.width); this.updateNetworks(); break;
      case 'mix': { const next = clampParameter(value, MIX); this.parameterValues.set(parameterId, next); this.setWetDryMix(next); break; }
      default: console.warn(`Unknown parameter "${parameterId}" for ${this.name}.`);
    }
  }

  private createNetwork(algorithm: DelayAlgorithm, initialGain: number): ActiveDelayNetwork {
    const network: DelayNetworkLike = algorithm === 're201' ? new SpaceEchoNetwork(this.context) : new DelayNetwork(this.context, CONFIGS[algorithm]);
    const gain = this.context.createGain(); gain.gain.value = initialGain;
    this.input.connect(network.input); network.output.connect(gain); gain.connect(this.wetGain);
    network.update(this.time, this.feedback, this.color, this.character, this.width);
    return { algorithm, network, gain, disposeTimer: null };
  }

  private switchAlgorithm(algorithm: DelayAlgorithm): void {
    if (algorithm === this.algorithm) return;
    const now = this.context.currentTime;
    const previous = this.active;
    try { this.input.disconnect(previous.network.input); } catch { /* already disconnected */ }
    const next = this.createNetwork(algorithm, 0);
    this.active = next; this.algorithm = algorithm;
    next.gain.gain.cancelScheduledValues(now); previous.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(0, now); previous.gain.gain.setValueAtTime(1, now);
    next.gain.gain.setValueCurveAtTime(EQUAL_POWER_FADE_IN, now, HALO_CROSSFADE_SECONDS);
    previous.gain.gain.setValueCurveAtTime(EQUAL_POWER_FADE_OUT, now, HALO_CROSSFADE_SECONDS);
    this.retiring.add(previous); this.trimRetiringNetworks();
    previous.disposeTimer = globalThis.setTimeout(() => { previous.disposeTimer = null; this.disposeRetiringNetwork(previous); }, Math.ceil((HALO_CROSSFADE_SECONDS + 0.18) * 1000));
  }

  private updateNetworks(): void { this.active.network.update(this.time, this.feedback, this.color, this.character, this.width); }
  private trimRetiringNetworks(): void { while (this.retiring.size > MAX_RETIRED_DELAY_NETWORKS) { const oldest = this.retiring.values().next().value as ActiveDelayNetwork | undefined; if (!oldest) break; this.disposeRetiringNetwork(oldest); } }
  private disposeRetiringNetwork(entry: ActiveDelayNetwork): void { if (!this.retiring.delete(entry)) return; if (entry.disposeTimer !== null) globalThis.clearTimeout(entry.disposeTimer); entry.gain.disconnect(); entry.network.dispose(); }
  public override dispose(): void { this.active.gain.disconnect(); this.active.network.dispose(); this.retiring.forEach((entry) => { if (entry.disposeTimer !== null) globalThis.clearTimeout(entry.disposeTimer); entry.gain.disconnect(); entry.network.dispose(); }); this.retiring.clear(); super.dispose(); }
}

const EQUAL_POWER_FADE_IN = createEqualPowerFade(true);
const EQUAL_POWER_FADE_OUT = createEqualPowerFade(false);
function createEqualPowerFade(fadeIn: boolean): Float32Array { const curve = new Float32Array(64); for (let i = 0; i < curve.length; i += 1) { const t = i / (curve.length - 1); curve[i] = fadeIn ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5); } return curve; }
const CHARACTER_CURVE_CACHE = new Map<string, Float32Array>();
function getCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array { const quantized = Math.round(character * 96) / 96; const key = `${config.id}:${quantized}`; const cached = CHARACTER_CURVE_CACHE.get(key); if (cached) return cached; const curve = createCharacterCurve(quantized, config); CHARACTER_CURVE_CACHE.set(key, curve); return curve; }
function createCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array { const length = 8192; const curve = new Float32Array(length); const drive = 1 + character * config.saturation * 2.2; const quantizationMix = character * config.quantization; const levels = Math.max(48, Math.round(65536 / (1 + character * character * 240))); for (let index = 0; index < length; index += 1) { const x = (index / (length - 1)) * 2 - 1; const saturated = Math.tanh(x * drive) / drive; const quantized = Math.round(saturated * levels) / levels; curve[index] = saturated * (1 - quantizationMix) + quantized * quantizationMix; } return curve; }
const SPACE_ECHO_CURVE_CACHE = new Map<number, Float32Array>();
function getSpaceEchoCurve(age: number): Float32Array { const bucket = Math.round(clamp01(age) * 64); const cached = SPACE_ECHO_CURVE_CACHE.get(bucket); if (cached) return cached; const normalized = bucket / 64; const length = 8192; const curve = new Float32Array(length); const drive = 1.08 + normalized * 3.1; for (let i = 0; i < length; i += 1) { const x = (i / (length - 1)) * 2 - 1; const asymmetric = x + Math.max(0, x) * (0.025 + normalized * 0.055); const compressed = Math.tanh(asymmetric * drive) / Math.tanh(drive); curve[i] = compressed * (0.99 - normalized * 0.035); } SPACE_ECHO_CURVE_CACHE.set(bucket, curve); return curve; }
function chooseConstellationPitch(random: number, character: number): number { if (character < 0.12) return 0; const spread = Math.pow(character, 1.4); if (random < 0.24 + (1 - spread) * 0.36) return 0; if (random < 0.49) return 7; if (random < 0.69) return 12; if (random < 0.84) return -5; return -12; }
function seededNoise(seed: number): number { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
