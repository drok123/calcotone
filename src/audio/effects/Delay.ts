import { clampParameter, type ParameterDefinition } from '../Parameter';
import { BaseEffect } from './Effect';

export type DelayAlgorithm =
  | 'clean'
  | 'tape'
  | 'bbd'
  | 'pingpong'
  | 'diffuse'
  | 'scatter'
  | 'constellation';

export const DELAY_ALGORITHM_ORDER: DelayAlgorithm[] = [
  'clean',
  'tape',
  'bbd',
  'pingpong',
  'diffuse',
  'scatter',
  'constellation',
];

const ALGORITHM: ParameterDefinition = {
  id: 'algorithm',
  label: 'Algorithm',
  min: 0,
  max: DELAY_ALGORITHM_ORDER.length - 1,
  defaultValue: 1,
  smoothingTime: 0.08,
};
const TIME: ParameterDefinition = {
  id: 'time',
  label: 'Time',
  min: 0.03,
  max: 4,
  defaultValue: 0.36,
  unit: 's',
  taper: 'logarithmic',
  smoothingTime: 0.05,
};
const FEEDBACK: ParameterDefinition = {
  id: 'feedback',
  label: 'Feedback',
  min: 0,
  max: 0.9,
  defaultValue: 0.22,
  smoothingTime: 0.045,
};
const COLOR: ParameterDefinition = {
  id: 'color',
  label: 'Color',
  min: 0,
  max: 1,
  defaultValue: 0.42,
  smoothingTime: 0.06,
};
const CHARACTER: ParameterDefinition = {
  id: 'character',
  label: 'Character',
  min: 0,
  max: 1,
  defaultValue: 0.14,
  smoothingTime: 0.08,
};
const WIDTH: ParameterDefinition = {
  id: 'width',
  label: 'Width',
  min: 0,
  max: 1,
  defaultValue: 0.58,
  smoothingTime: 0.06,
};
const MIX: ParameterDefinition = {
  id: 'mix',
  label: 'Mix',
  min: 0,
  max: 1,
  defaultValue: 0.14,
  smoothingTime: 0.025,
};

interface DelayAlgorithmConfig {
  id: DelayAlgorithm;
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

const CONFIGS: Record<DelayAlgorithm, DelayAlgorithmConfig> = {
  clean: {
    id: 'clean',
    timeRatios: [1, 1.006],
    crossFeedback: 0.08,
    sameFeedback: 0.92,
    highpass: 55,
    lowpassRange: [6500, 19000],
    saturation: 0.08,
    quantization: 0,
    flutterDepth: 0.00012,
    flutterRates: [0.11, 0.137],
    diffusionStages: 0,
    diffusionBase: 880,
    outputTrim: 0.78,
    inputTrim: 0.92,
    scatter: 0,
    pitchScatter: 0,
    reverseChance: 0,
    orbitDepth: 0,
  },
  tape: {
    id: 'tape',
    timeRatios: [1, 1.013],
    crossFeedback: 0.18,
    sameFeedback: 0.82,
    highpass: 75,
    lowpassRange: [1800, 12500],
    saturation: 0.68,
    quantization: 0.02,
    flutterDepth: 0.0028,
    flutterRates: [0.17, 0.223],
    diffusionStages: 1,
    diffusionBase: 720,
    outputTrim: 0.71,
    inputTrim: 0.86,
    scatter: 0.03,
    pitchScatter: 0,
    reverseChance: 0,
    orbitDepth: 0,
  },
  bbd: {
    id: 'bbd',
    timeRatios: [1, 0.987],
    crossFeedback: 0.22,
    sameFeedback: 0.78,
    highpass: 120,
    lowpassRange: [900, 7200],
    saturation: 0.5,
    quantization: 0.32,
    flutterDepth: 0.0011,
    flutterRates: [0.29, 0.347],
    diffusionStages: 1,
    diffusionBase: 1180,
    outputTrim: 0.67,
    inputTrim: 0.84,
    scatter: 0.045,
    pitchScatter: 0,
    reverseChance: 0,
    orbitDepth: 0,
  },
  pingpong: {
    id: 'pingpong',
    timeRatios: [1, 1.5],
    crossFeedback: 0.94,
    sameFeedback: 0.06,
    highpass: 80,
    lowpassRange: [2600, 15500],
    saturation: 0.22,
    quantization: 0,
    flutterDepth: 0.00035,
    flutterRates: [0.13, 0.19],
    diffusionStages: 0,
    diffusionBase: 900,
    outputTrim: 0.69,
    inputTrim: 0.84,
    scatter: 0,
    pitchScatter: 0,
    reverseChance: 0,
    orbitDepth: 0,
  },
  diffuse: {
    id: 'diffuse',
    timeRatios: [1, 1.271],
    crossFeedback: 0.42,
    sameFeedback: 0.58,
    highpass: 130,
    lowpassRange: [1900, 13500],
    saturation: 0.28,
    quantization: 0.01,
    flutterDepth: 0.0014,
    flutterRates: [0.09, 0.151],
    diffusionStages: 4,
    diffusionBase: 510,
    outputTrim: 0.56,
    inputTrim: 0.72,
    scatter: 0.055,
    pitchScatter: 0,
    reverseChance: 0,
    orbitDepth: 0,
  },
  scatter: {
    id: 'scatter',
    timeRatios: [1, 0.754],
    crossFeedback: 0.55,
    sameFeedback: 0.45,
    highpass: 170,
    lowpassRange: [1500, 11800],
    saturation: 0.38,
    quantization: 0.16,
    flutterDepth: 0.0022,
    flutterRates: [0.07, 0.113],
    diffusionStages: 2,
    diffusionBase: 670,
    outputTrim: 0.52,
    inputTrim: 0.68,
    scatter: 0.22,
    pitchScatter: 0,
    reverseChance: 0,
    orbitDepth: 0,
  },
  constellation: {
    id: 'constellation',
    timeRatios: [1, 1.333],
    crossFeedback: 0.68,
    sameFeedback: 0.32,
    highpass: 145,
    lowpassRange: [2100, 16500],
    saturation: 0.24,
    quantization: 0.035,
    flutterDepth: 0.0017,
    flutterRates: [0.071, 0.109],
    diffusionStages: 3,
    diffusionBase: 640,
    outputTrim: 0.48,
    inputTrim: 0.62,
    scatter: 0.12,
    pitchScatter: 0.82,
    reverseChance: 0.28,
    orbitDepth: 0.72,
  },
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

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) globalThis.clearInterval(this.timer);
    this.timer = null;
    [this.input, this.output, ...this.delays, ...this.gains].forEach((node) =>
      node.disconnect()
    );
  }

  private scheduleAhead(): void {
    if (this.disposed) return;
    // Keep a wider scheduling cushion so short main-thread stalls cannot starve
    // the audio timeline.
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
    const startDelay = slope < 0 ? high : low;
    const endDelay = slope < 0 ? low : high;

    delay.cancelScheduledValues(start);
    delay.setValueAtTime(startDelay, start);
    delay.linearRampToValueAtTime(endDelay, start + duration);
    gain.cancelScheduledValues(start);
    gain.setValueCurveAtTime(PITCH_GRAIN_ENVELOPE, start, duration);
  }
}

class DelayNetwork {
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
    this.highpasses = [
      context.createBiquadFilter(),
      context.createBiquadFilter(),
    ];
    this.lowpasses = [
      context.createBiquadFilter(),
      context.createBiquadFilter(),
    ];
    this.colors = [context.createWaveShaper(), context.createWaveShaper()];
    this.sameFeedback = [context.createGain(), context.createGain()];
    this.crossFeedback = [context.createGain(), context.createGain()];
    this.directOutputs = [context.createGain(), context.createGain()];
    this.crossOutputs = [context.createGain(), context.createGain()];
    this.lfos = [context.createOscillator(), context.createOscillator()];
    this.lfoDepths = [context.createGain(), context.createGain()];
    this.pitchShifters = config.pitchScatter > 0
      ? [new DualGrainPitchShifter(context), new DualGrainPitchShifter(context)]
      : [null, null];

    this.input.gain.value = config.inputTrim;
    this.input.connect(this.splitter);

    for (let channel = 0; channel < 2; channel += 1) {
      const hp = this.highpasses[channel];
      const lp = this.lowpasses[channel];
      const color = this.colors[channel];
      hp.type = 'highpass';
      hp.frequency.value = config.highpass;
      hp.Q.value = 0.55;
      lp.type = 'lowpass';
      lp.frequency.value = config.lowpassRange[1];
      lp.Q.value = 0.45;
      color.oversample = '4x';
      color.curve = createCharacterCurve(0, config);

      this.splitter.connect(this.delays[channel], channel);
      this.delays[channel].connect(hp);
      hp.connect(lp);

      let tail: AudioNode = lp;
      for (let stage = 0; stage < config.diffusionStages; stage += 1) {
        const allpass = context.createBiquadFilter();
        allpass.type = 'allpass';
        allpass.frequency.value =
          config.diffusionBase + stage * 430 + channel * 97;
        allpass.Q.value = 0.65;
        tail.connect(allpass);
        tail = allpass;
        this.diffusers[channel].push(allpass);
      }
      const pitchShifter = this.pitchShifters[channel];
      if (pitchShifter) {
        tail.connect(pitchShifter.input);
        pitchShifter.output.connect(color);
      } else {
        tail.connect(color);
      }

      color.connect(this.sameFeedback[channel]);
      color.connect(this.crossFeedback[channel]);
      this.sameFeedback[channel].connect(this.delays[channel]);
      this.crossFeedback[channel].connect(this.delays[1 - channel]);

      color.connect(this.directOutputs[channel]);
      color.connect(this.crossOutputs[channel]);
      this.directOutputs[channel].connect(this.merger, 0, channel);
      this.crossOutputs[channel].connect(this.merger, 0, 1 - channel);

      const lfo = this.lfos[channel];
      lfo.type = channel === 0 ? 'sine' : 'triangle';
      lfo.frequency.value = config.flutterRates[channel];
      this.lfoDepths[channel].gain.value = 0;
      lfo.connect(this.lfoDepths[channel]);
      this.lfoDepths[channel].connect(this.delays[channel].delayTime);
      lfo.start(context.currentTime + channel * 0.19);
    }

    this.merger.connect(this.output);
    if (config.scatter > 0) this.startScatterClock();
  }

  public update(
    time: number,
    feedback: number,
    color: number,
    character: number,
    width: number
  ): void {
    if (this.disposed) return;
    this.time = time;
    this.character = character;
    this.width = width;
    const now = this.context.currentTime;
    const cutoff =
      this.config.lowpassRange[0] *
      Math.pow(
        this.config.lowpassRange[1] / this.config.lowpassRange[0],
        color
      );
    const normalizedFeedback = Math.min(1, Math.max(0, feedback / FEEDBACK.max));
    const algorithmCeiling =
      this.config.id === 'clean'
        ? 0.86
        : this.config.id === 'pingpong'
          ? 0.82
          : this.config.id === 'constellation'
            ? 0.68
            : 0.79;
    const loop = algorithmCeiling * Math.pow(normalizedFeedback, 1.45);
    const directWidth = 0.52 + width * 0.46;
    const crossWidth = (1 - width) * 0.34;
    // Waveshaper curves are immutable snapshots. Only swap the curve when the
    // quantized character bucket actually changes; assigning it every knob/UI
    // update needlessly churns native DSP state on both channels.
    const characterCurve = getCharacterCurve(character, this.config);
    const curveChanged = characterCurve !== this.lastCharacterCurve;
    this.lastCharacterCurve = characterCurve;

    for (let channel = 0; channel < 2; channel += 1) {
      const ratio = this.config.timeRatios[channel];
      this.delays[channel].delayTime.setTargetAtTime(
        Math.min(6.35, time * ratio),
        now,
        0.05
      );
      this.highpasses[channel].frequency.setTargetAtTime(
        this.config.highpass + (1 - color) * 95,
        now,
        0.06
      );
      this.lowpasses[channel].frequency.setTargetAtTime(
        cutoff * (channel === 0 ? 1 : 0.94),
        now,
        0.065
      );
      this.sameFeedback[channel].gain.setTargetAtTime(
        loop * this.config.sameFeedback,
        now,
        0.05
      );
      this.crossFeedback[channel].gain.setTargetAtTime(
        loop * this.config.crossFeedback,
        now,
        0.05
      );
      this.directOutputs[channel].gain.setTargetAtTime(
        directWidth * this.config.outputTrim,
        now,
        0.05
      );
      this.crossOutputs[channel].gain.setTargetAtTime(
        crossWidth * this.config.outputTrim,
        now,
        0.05
      );
      this.lfoDepths[channel].gain.setTargetAtTime(
        this.config.flutterDepth *
          Math.pow(character, 1.55) *
          (channel ? -0.82 : 1),
        now,
        0.09
      );
      if (curveChanged) this.colors[channel].curve = characterCurve;
      this.pitchShifters[channel]?.setPitch(
        channel === 0 ? 7 : -5,
        this.config.pitchScatter * Math.pow(character, 1.35)
      );
      this.diffusers[channel].forEach((node, index) => {
        node.Q.setTargetAtTime(
          0.45 + character * (0.8 + index * 0.13),
          now,
          0.07
        );
        node.frequency.setTargetAtTime(
          this.config.diffusionBase +
            index * 390 +
            character * 1450 +
            channel * 83,
          now,
          0.07
        );
      });
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scatterTimer !== null) {
      globalThis.clearInterval(this.scatterTimer);
      this.scatterTimer = null;
    }
    this.pitchShifters.forEach((shifter) => shifter?.dispose());
    this.lfos.forEach((lfo) => {
      try {
        lfo.stop();
      } catch {
        // Oscillator may already be stopped.
      }
      lfo.disconnect();
    });
    [
      this.input,
      this.output,
      this.splitter,
      this.merger,
      ...this.delays,
      ...this.highpasses,
      ...this.lowpasses,
      ...this.colors,
      ...this.sameFeedback,
      ...this.crossFeedback,
      ...this.directOutputs,
      ...this.crossOutputs,
      ...this.diffusers.flat(),
      ...this.lfoDepths,
    ].forEach((node) => node.disconnect());
  }

  private startScatterClock(): void {
    this.scatterTimer = globalThis.setInterval(() => {
      if (this.disposed || this.character < 0.02) return;
      const now = this.context.currentTime;
      const amount = this.config.scatter * this.character;
      this.delays.forEach((delay, channel) => {
        const jitter =
          1 + (seededNoise(now * 2.7 + channel * 31.7) - 0.5) * amount;
        const dropout = seededNoise(now * 0.91 + channel * 17.3);
        delay.delayTime.setTargetAtTime(
          Math.min(
            6.35,
            Math.max(
              0.015,
              this.time * this.config.timeRatios[channel] * jitter
            )
          ),
          now,
          0.12
        );
        const fragmentDrop =
          dropout < amount * (0.16 + this.config.reverseChance * 0.22)
            ? 0.16
            : 1;
        const orbit =
          this.config.orbitDepth *
          this.character *
          Math.sin(now * 0.73 + channel * Math.PI);
        this.directOutputs[channel].gain.setTargetAtTime(
          this.config.outputTrim *
            (0.52 + this.width * 0.46) *
            fragmentDrop *
            (1 - Math.max(0, orbit) * 0.36),
          now,
          0.08
        );
        this.crossOutputs[channel].gain.setTargetAtTime(
          this.config.outputTrim *
            ((1 - this.width) * 0.34 + Math.max(0, orbit) * 0.31),
          now,
          0.1
        );

        const pitchChoice = chooseConstellationPitch(
          seededNoise(now * 1.37 + channel * 43.1),
          this.character
        );
        this.pitchShifters[channel]?.setPitch(
          channel === 0 ? pitchChoice : -pitchChoice * 0.72,
          this.config.pitchScatter * Math.pow(this.character, 1.28)
        );
      });
    }, 420);
  }
}

const MAX_RETIRED_DELAY_NETWORKS = 2;
const HALO_CROSSFADE_SECONDS = 0.52;

interface ActiveDelayNetwork {
  algorithm: DelayAlgorithm;
  network: DelayNetwork;
  gain: GainNode;
  disposeTimer: number | null;
}

/**
 * Halo v3: seven distinct stereo delay structures with tail-preserving switching.
 * Defaults are intentionally restrained, feedback is bounded, and degradation
 * happens progressively inside the repeat loop rather than across the dry signal.
 */
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
    this.initializeParameters([
      ALGORITHM,
      TIME,
      FEEDBACK,
      COLOR,
      CHARACTER,
      WIDTH,
      MIX,
    ]);
    this.setParameter('algorithm', ALGORITHM.defaultValue);
    this.setParameter('time', TIME.defaultValue);
    this.setParameter('feedback', FEEDBACK.defaultValue);
    this.setParameter('color', COLOR.defaultValue);
    this.setParameter('character', CHARACTER.defaultValue);
    this.setParameter('width', WIDTH.defaultValue);
    this.setParameter('mix', MIX.defaultValue);
  }

  public setAlgorithm(algorithm: DelayAlgorithm): void {
    const index = DELAY_ALGORITHM_ORDER.indexOf(algorithm);
    if (index >= 0) this.setParameter('algorithm', index);
  }

  public getAlgorithm(): DelayAlgorithm {
    return this.algorithm;
  }

  public setParameter(parameterId: string, value: number): void {
    switch (parameterId) {
      case 'algorithm': {
        const index = Math.round(clampParameter(value, ALGORITHM));
        this.parameterValues.set(parameterId, index);
        this.switchAlgorithm(DELAY_ALGORITHM_ORDER[index]);
        break;
      }
      case 'time':
        this.time = clampParameter(value, TIME);
        this.parameterValues.set(parameterId, this.time);
        this.updateNetworks();
        break;
      case 'feedback':
        this.feedback = clampParameter(value, FEEDBACK);
        this.parameterValues.set(parameterId, this.feedback);
        this.updateNetworks();
        break;
      case 'color':
        this.color = clampParameter(value, COLOR);
        this.parameterValues.set(parameterId, this.color);
        this.updateNetworks();
        break;
      case 'character':
      case 'texture':
        this.character = clampParameter(value, CHARACTER);
        this.parameterValues.set('character', this.character);
        this.updateNetworks();
        break;
      case 'width':
        this.width = clampParameter(value, WIDTH);
        this.parameterValues.set(parameterId, this.width);
        this.updateNetworks();
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

  private createNetwork(
    algorithm: DelayAlgorithm,
    initialGain: number
  ): ActiveDelayNetwork {
    const network = new DelayNetwork(this.context, CONFIGS[algorithm]);
    const gain = this.context.createGain();
    gain.gain.value = initialGain;
    this.input.connect(network.input);
    network.output.connect(gain);
    gain.connect(this.wetGain);
    network.update(
      this.time,
      this.feedback,
      this.color,
      this.character,
      this.width
    );
    return { algorithm, network, gain, disposeTimer: null };
  }

  private switchAlgorithm(algorithm: DelayAlgorithm): void {
    if (algorithm === this.algorithm) return;
    const now = this.context.currentTime;
    const previous = this.active;
    // Retiring networks keep their existing repeats but stop accepting fresh input.
    try {
      this.input.disconnect(previous.network.input);
    } catch {
      // The route may already be disconnected during teardown.
    }
    const next = this.createNetwork(algorithm, 0);
    this.active = next;
    this.algorithm = algorithm;

    next.gain.gain.cancelScheduledValues(now);
    previous.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(0, now);
    previous.gain.gain.setValueAtTime(1, now);
    // Equal-power curves avoid the small level dip of two opposing linear ramps.
    next.gain.gain.setValueCurveAtTime(EQUAL_POWER_FADE_IN, now, HALO_CROSSFADE_SECONDS);
    previous.gain.gain.setValueCurveAtTime(EQUAL_POWER_FADE_OUT, now, HALO_CROSSFADE_SECONDS);

    this.retiring.add(previous);
    this.trimRetiringNetworks();
    previous.disposeTimer = globalThis.setTimeout(() => {
      previous.disposeTimer = null;
      this.disposeRetiringNetwork(previous);
    }, Math.ceil((HALO_CROSSFADE_SECONDS + 0.18) * 1000));
  }

  private updateNetworks(): void {
    // Retiring networks intentionally keep the settings that created their tail.
    // Updating them doubles/triples automation work during a switch and can bend
    // the old repeats while they are fading, which sounds less natural.
    this.active.network.update(
      this.time,
      this.feedback,
      this.color,
      this.character,
      this.width
    );
  }

  private trimRetiringNetworks(): void {
    while (this.retiring.size > MAX_RETIRED_DELAY_NETWORKS) {
      const oldest = this.retiring.values().next().value as ActiveDelayNetwork | undefined;
      if (!oldest) break;
      this.disposeRetiringNetwork(oldest);
    }
  }

  private disposeRetiringNetwork(entry: ActiveDelayNetwork): void {
    if (!this.retiring.delete(entry)) return;
    if (entry.disposeTimer !== null) {
      globalThis.clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.gain.disconnect();
    entry.network.dispose();
  }

  public override dispose(): void {
    this.active.gain.disconnect();
    this.active.network.dispose();
    this.retiring.forEach((entry) => {
      if (entry.disposeTimer !== null)
        globalThis.clearTimeout(entry.disposeTimer);
      entry.gain.disconnect();
      entry.network.dispose();
    });
    this.retiring.clear();
    super.dispose();
  }
}

const EQUAL_POWER_FADE_IN = createEqualPowerFade(true);
const EQUAL_POWER_FADE_OUT = createEqualPowerFade(false);

function createEqualPowerFade(fadeIn: boolean): Float32Array {
  const points = 64;
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    curve[i] = fadeIn ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5);
  }
  return curve;
}

const CHARACTER_CURVE_CACHE = new Map<string, Float32Array>();

function getCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array {
  const quantized = Math.round(character * 96) / 96;
  const key = `${config.id}:${quantized}`;
  const cached = CHARACTER_CURVE_CACHE.get(key);
  if (cached) return cached;
  const curve = createCharacterCurve(quantized, config);
  CHARACTER_CURVE_CACHE.set(key, curve);
  return curve;
}

function createCharacterCurve(
  character: number,
  config: DelayAlgorithmConfig
): Float32Array {
  const length = 8192;
  const curve = new Float32Array(length);
  const drive = 1 + character * config.saturation * 2.2;
  const quantizationMix = character * config.quantization;
  const levels = Math.max(
    48,
    Math.round(65536 / (1 + character * character * 240))
  );
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    const saturated = Math.tanh(x * drive) / drive;
    const quantized = Math.round(saturated * levels) / levels;
    curve[index] =
      saturated * (1 - quantizationMix) + quantized * quantizationMix;
  }
  return curve;
}


function chooseConstellationPitch(random: number, character: number): number {
  if (character < 0.12) return 0;
  const spread = Math.pow(character, 1.4);
  if (random < 0.24 + (1 - spread) * 0.36) return 0;
  if (random < 0.49) return 7;
  if (random < 0.69) return 12;
  if (random < 0.84) return -5;
  return -12;
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
