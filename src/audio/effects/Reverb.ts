import { clampParameter, type ParameterDefinition } from '../Parameter';
import { BaseEffect } from './Effect';

export type ReverbAlgorithm =
  | 'room'
  | 'plate'
  | 'hall'
  | 'cinema'
  | 'cloud'
  | 'freeze'
  | 'celestial'
  | 'aurora'
  | 'nebula'
  | 'abyss';

const ALGORITHM_ORDER: ReverbAlgorithm[] = [
  'room',
  'plate',
  'hall',
  'cinema',
  'cloud',
  'freeze',
  'celestial',
  'aurora',
  'nebula',
  'abyss',
];

const ALGORITHM: ParameterDefinition = {
  id: 'algorithm',
  label: 'Algorithm',
  min: 0,
  max: ALGORITHM_ORDER.length - 1,
  defaultValue: 2,
  smoothingTime: 0.08,
};
const DECAY: ParameterDefinition = {
  id: 'decay',
  label: 'Decay',
  min: 0.35,
  max: 16,
  defaultValue: 2.4,
  unit: 's',
  taper: 'logarithmic',
  smoothingTime: 0.06,
};
const SIZE: ParameterDefinition = {
  id: 'size',
  label: 'Size',
  min: 0,
  max: 1,
  defaultValue: 0.52,
  smoothingTime: 0.06,
};
const COLOR: ParameterDefinition = {
  id: 'color',
  label: 'Color',
  min: 0,
  max: 1,
  defaultValue: 0.42,
  smoothingTime: 0.05,
};
const DIFFUSION: ParameterDefinition = {
  id: 'diffusion',
  label: 'Diffuse',
  min: 0,
  max: 1,
  defaultValue: 0.74,
  smoothingTime: 0.05,
};
const MOTION: ParameterDefinition = {
  id: 'motion',
  label: 'Motion',
  min: 0,
  max: 1,
  defaultValue: 0.18,
  smoothingTime: 0.08,
};
const MIX: ParameterDefinition = {
  id: 'mix',
  label: 'Mix',
  min: 0,
  max: 1,
  defaultValue: 0.13,
  smoothingTime: 0.025,
};

interface AlgorithmConfig {
  id: ReverbAlgorithm;
  lineTimes: number[];
  predelay: [number, number];
  sizeRange: [number, number];
  decayBias: number;
  dampingBias: number;
  diffusionBias: number;
  modulationDepth: number;
  modulationRates: number[];
  crossAmount: number;
  outputTrim: number;
  inputTrim: number;
  highpass: number;
}

const CONFIGS: Record<ReverbAlgorithm, AlgorithmConfig> = {
  room: {
    id: 'room',
    lineTimes: [0.0137, 0.0173, 0.0199, 0.0239, 0.0293, 0.0317],
    predelay: [0.004, 0.006],
    sizeRange: [0.58, 1.42],
    decayBias: 0.72,
    dampingBias: 1.08,
    diffusionBias: 0.72,
    modulationDepth: 0.00022,
    modulationRates: [0.19, 0.27, 0.31, 0.37, 0.43, 0.53],
    crossAmount: 0.035,
    outputTrim: 0.42,
    inputTrim: 0.82,
    highpass: 150,
  },
  plate: {
    id: 'plate',
    lineTimes: [0.0211, 0.0263, 0.0307, 0.0349, 0.0397, 0.0451, 0.0511, 0.0577],
    predelay: [0.008, 0.011],
    sizeRange: [0.72, 1.72],
    decayBias: 0.94,
    dampingBias: 1.28,
    diffusionBias: 1.16,
    modulationDepth: 0.00052,
    modulationRates: [0.23, 0.29, 0.41, 0.47, 0.59, 0.67, 0.73, 0.83],
    crossAmount: 0.062,
    outputTrim: 0.31,
    inputTrim: 0.74,
    highpass: 190,
  },
  hall: {
    id: 'hall',
    lineTimes: [0.0311, 0.0379, 0.0437, 0.0499, 0.0571, 0.0643, 0.0719, 0.0817],
    predelay: [0.014, 0.019],
    sizeRange: [0.74, 2.12],
    decayBias: 1,
    dampingBias: 0.94,
    diffusionBias: 0.98,
    modulationDepth: 0.00072,
    modulationRates: [0.13, 0.17, 0.23, 0.29, 0.37, 0.43, 0.53, 0.61],
    crossAmount: 0.075,
    outputTrim: 0.28,
    inputTrim: 0.7,
    highpass: 130,
  },
  cinema: {
    id: 'cinema',
    lineTimes: [0.0413, 0.0491, 0.0577, 0.0671, 0.0787, 0.0911, 0.1049, 0.1193, 0.1349, 0.1511],
    predelay: [0.024, 0.033],
    sizeRange: [0.82, 2.48],
    decayBias: 1.22,
    dampingBias: 0.72,
    diffusionBias: 1.05,
    modulationDepth: 0.00105,
    modulationRates: [0.07, 0.11, 0.13, 0.17, 0.19, 0.23, 0.29, 0.31, 0.37, 0.41],
    crossAmount: 0.094,
    outputTrim: 0.23,
    inputTrim: 0.62,
    highpass: 105,
  },
  cloud: {
    id: 'cloud',
    lineTimes: [0.0271, 0.0331, 0.0391, 0.0461, 0.0541, 0.0631, 0.0731, 0.0841, 0.0961, 0.1091, 0.1231, 0.1381],
    predelay: [0.018, 0.027],
    sizeRange: [0.68, 2.28],
    decayBias: 1.38,
    dampingBias: 0.84,
    diffusionBias: 1.28,
    modulationDepth: 0.0018,
    modulationRates: [0.09, 0.12, 0.16, 0.21, 0.26, 0.32, 0.39, 0.47, 0.56, 0.66, 0.77, 0.89],
    crossAmount: 0.11,
    outputTrim: 0.2,
    inputTrim: 0.56,
    highpass: 170,
  },

  celestial: {
    id: 'celestial',
    lineTimes: [0.0239, 0.0311, 0.0401, 0.0503, 0.0629, 0.0779, 0.0953, 0.1151, 0.1373, 0.1613, 0.1871, 0.2141],
    predelay: [0.028, 0.041], sizeRange: [0.82, 2.62], decayBias: 1.72,
    dampingBias: 1.42, diffusionBias: 1.48, modulationDepth: 0.0026,
    modulationRates: [0.047,0.061,0.079,0.101,0.127,0.157,0.193,0.233,0.277,0.331,0.389,0.457],
    crossAmount: 0.14, outputTrim: 0.17, inputTrim: 0.48, highpass: 240,
  },
  aurora: {
    id: 'aurora',
    lineTimes: [0.0197,0.0277,0.0367,0.0479,0.0613,0.0773,0.0961,0.1177,0.1423,0.1699],
    predelay: [0.016,0.029], sizeRange: [0.7,2.45], decayBias: 1.46,
    dampingBias: 1.12, diffusionBias: 1.34, modulationDepth: 0.0038,
    modulationRates: [0.071,0.097,0.131,0.173,0.223,0.281,0.347,0.421,0.503,0.593],
    crossAmount: 0.16, outputTrim: 0.18, inputTrim: 0.5, highpass: 185,
  },
  nebula: {
    id: 'nebula',
    lineTimes: [0.0353,0.0449,0.0563,0.0697,0.0851,0.1027,0.1223,0.1441,0.1681,0.1943,0.2227,0.2531],
    predelay: [0.036,0.052], sizeRange: [0.95,2.85], decayBias: 2.15,
    dampingBias: 0.76, diffusionBias: 1.58, modulationDepth: 0.0044,
    modulationRates: [0.031,0.043,0.059,0.077,0.101,0.131,0.167,0.211,0.263,0.323,0.391,0.467],
    crossAmount: 0.18, outputTrim: 0.145, inputTrim: 0.42, highpass: 155,
  },
  abyss: {
    id: 'abyss',
    lineTimes: [0.0481,0.0593,0.0727,0.0883,0.1061,0.1261,0.1483,0.1727,0.1993,0.2281],
    predelay: [0.019,0.031], sizeRange: [1.0,3.0], decayBias: 1.9,
    dampingBias: 0.38, diffusionBias: 1.18, modulationDepth: 0.0015,
    modulationRates: [0.029,0.037,0.047,0.061,0.079,0.101,0.127,0.157,0.193,0.233],
    crossAmount: 0.17, outputTrim: 0.15, inputTrim: 0.44, highpass: 58,
  },
  freeze: {
    id: 'freeze',
    lineTimes: [0.0431, 0.0523, 0.0629, 0.0749, 0.0883, 0.1031, 0.1193, 0.1373],
    predelay: [0.012, 0.017],
    sizeRange: [0.9, 2.15],
    decayBias: 4.5,
    dampingBias: 0.52,
    diffusionBias: 1.35,
    modulationDepth: 0.0009,
    modulationRates: [0.05, 0.07, 0.09, 0.11, 0.13, 0.17, 0.19, 0.23],
    crossAmount: 0.13,
    outputTrim: 0.22,
    inputTrim: 0.18,
    highpass: 210,
  },
};

class ReverbNetwork {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly config: AlgorithmConfig;
  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly predelays: [DelayNode, DelayNode];
  private readonly inputFilters: BiquadFilterNode[] = [];
  private readonly diffusers: BiquadFilterNode[] = [];
  private readonly delays: DelayNode[] = [];
  private readonly damping: BiquadFilterNode[] = [];
  private readonly loopHighpasses: BiquadFilterNode[] = [];
  private readonly loopSaturators: WaveShaperNode[] = [];
  private readonly feedback: GainNode[] = [];
  private readonly outputGains: GainNode[] = [];
  private readonly crossGains: GainNode[] = [];
  private readonly lfos: OscillatorNode[] = [];
  private readonly lfoDepths: GainNode[] = [];
  private disposed = false;

  public constructor(context: AudioContext, config: AlgorithmConfig) {
    this.context = context;
    this.config = config;
    this.input = context.createGain();
    this.output = context.createGain();
    this.splitter = context.createChannelSplitter(2);
    this.merger = context.createChannelMerger(2);
    this.predelays = [context.createDelay(0.3), context.createDelay(0.3)];

    this.input.gain.value = config.inputTrim;
    this.input.connect(this.splitter);

    for (let channel = 0; channel < 2; channel += 1) {
      const hp = context.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = config.highpass;
      hp.Q.value = 0.55;
      const lp = context.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 16_000;
      lp.Q.value = 0.4;
      this.splitter.connect(hp, channel);
      hp.connect(lp);
      lp.connect(this.predelays[channel]);
      this.inputFilters.push(hp, lp);
    }

    this.predelays[0].delayTime.value = config.predelay[0];
    this.predelays[1].delayTime.value = config.predelay[1];

    config.lineTimes.forEach((time, index) => {
      const diffuser = context.createBiquadFilter();
      diffuser.type = 'allpass';
      diffuser.frequency.value = 640 + index * 121;
      diffuser.Q.value = 0.75;

      const delay = context.createDelay(1.25);
      delay.delayTime.value = time;

      const damping = context.createBiquadFilter();
      damping.type = 'lowpass';
      damping.frequency.value = 7200;
      damping.Q.value = 0.45;

      const loopHighpass = context.createBiquadFilter();
      loopHighpass.type = 'highpass';
      loopHighpass.frequency.value = config.highpass * 0.72 + 28;
      loopHighpass.Q.value = 0.45;

      const loopSaturator = context.createWaveShaper();
      loopSaturator.curve = ATMOS_LOOP_CURVE;
      loopSaturator.oversample = '2x';

      const feedback = context.createGain();
      feedback.gain.value = 0.72;

      const outputGain = context.createGain();
      outputGain.gain.value =
        reverbOutputPolarity(index) *
        config.outputTrim /
        Math.sqrt(Math.max(1, config.lineTimes.length / 2));

      const source = this.predelays[index % 2];
      source.connect(diffuser);
      diffuser.connect(delay);
      delay.connect(damping);
      damping.connect(loopHighpass);
      loopHighpass.connect(loopSaturator);
      loopSaturator.connect(feedback);
      feedback.connect(delay);
      delay.connect(outputGain);
      outputGain.connect(this.merger, 0, index % 2);

      const lfo = context.createOscillator();
      lfo.type = index % 3 === 0 ? 'sine' : 'triangle';
      lfo.frequency.value = config.modulationRates[index % config.modulationRates.length];
      const depth = context.createGain();
      depth.gain.value = 0;
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      lfo.start();

      this.diffusers.push(diffuser);
      this.delays.push(delay);
      this.damping.push(damping);
      this.loopHighpasses.push(loopHighpass);
      this.loopSaturators.push(loopSaturator);
      this.feedback.push(feedback);
      this.outputGains.push(outputGain);
      this.lfos.push(lfo);
      this.lfoDepths.push(depth);
    });

    for (let i = 0; i < this.delays.length; i += 1) {
      const cross = context.createGain();
      const polarity = i % 4 < 2 ? 1 : -1;
      cross.gain.value = 0;
      this.delays[i].connect(cross);
      cross.connect(this.delays[(i + Math.max(3, Math.floor(this.delays.length / 2))) % this.delays.length]);
      this.crossGains.push(cross);
    }

    this.merger.connect(this.output);
  }

  public update(decay: number, size: number, color: number, diffusion: number, motion: number): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    const sizeScale = this.config.sizeRange[0] + size * (this.config.sizeRange[1] - this.config.sizeRange[0]);
    const effectiveDecay = Math.max(0.25, decay * this.config.decayBias);
    const colorCutoff = 1700 * Math.pow(10.2, color) * this.config.dampingBias;
    const freeze = this.config.id === 'freeze';
    const loopBudget = freeze ? 0.965 : 0.9;
    const crossMagnitude = Math.min(freeze ? 0.018 : 0.045, this.config.crossAmount * (0.2 + diffusion * 0.28));

    this.delays.forEach((node, index) => {
      const lineTime = this.config.lineTimes[index] * sizeScale;
      node.delayTime.setTargetAtTime(lineTime, now, 0.08);
      const lineDecay = Math.pow(0.001, lineTime / effectiveDecay);
      const spread = 0.992 - index * 0.0017;
      const safeSelfFeedback = Math.min(loopBudget - crossMagnitude - 0.035, Math.max(0.2, lineDecay * spread));
      this.feedback[index].gain.setTargetAtTime(safeSelfFeedback, now, 0.065);
      const polarity = index % 4 < 2 ? 1 : -1;
      this.crossGains[index]?.gain.setTargetAtTime(crossMagnitude * polarity, now, 0.075);
      this.damping[index].frequency.setTargetAtTime(
        Math.min(19_000, Math.max(1100, colorCutoff * (1 - index * 0.012))),
        now,
        0.055
      );
      // A dedicated loop high-pass keeps long tails from accumulating inaudible
      // DC/sub-bass energy. The corner moves only slightly with size so the room
      // can stay large without turning cloudy.
      this.loopHighpasses[index].frequency.setTargetAtTime(
        Math.min(310, Math.max(34, this.config.highpass * (0.42 + (1 - size) * 0.32) + index * 1.7)),
        now,
        0.08
      );
      const requestedMod = this.config.modulationDepth * motion * (0.62 + index * 0.045);
      const modAmount = Math.min(requestedMod, Math.max(0.000025, lineTime * 0.018));
      this.lfoDepths[index].gain.setTargetAtTime(modAmount, now, 0.09);
      const baseRate = this.config.modulationRates[index % this.config.modulationRates.length];
      const rateScale = (0.88 + size * 0.22) * (1 + motion * (0.035 + (index % 5) * 0.009));
      this.lfos[index].frequency.setTargetAtTime(baseRate * rateScale, now, 0.16);

      // Loudness-aware tail trim: very long/diffuse spaces retain depth without
      // simply becoming louder than short rooms. This is deliberately subtle.
      const baseOutput = this.config.outputTrim / Math.sqrt(Math.max(1, this.config.lineTimes.length / 2));
      const decayNorm = Math.min(1, Math.log2(1 + effectiveDecay) / Math.log2(17));
      const energyTrim = 1 / Math.sqrt(1 + decayNorm * 0.34 + diffusion * 0.16);
      this.outputGains[index].gain.setTargetAtTime(
        reverbOutputPolarity(index) * baseOutput * energyTrim,
        now,
        0.09
      );
    });

    this.diffusers.forEach((node, index) => {
      const amount = Math.min(1.6, diffusion * this.config.diffusionBias);
      node.Q.setTargetAtTime(0.28 + amount * (1.18 + index * 0.035), now, 0.06);
      node.frequency.setTargetAtTime(440 + amount * 1700 + index * 87, now, 0.06);
    });

    this.predelays[0].delayTime.setTargetAtTime(
      this.config.predelay[0] + size * this.config.predelay[0] * 1.65,
      now,
      0.07
    );
    this.predelays[1].delayTime.setTargetAtTime(
      this.config.predelay[1] + size * this.config.predelay[1] * 1.65,
      now,
      0.07
    );
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lfos.forEach((lfo) => {
      try {
        lfo.stop();
      } catch {
        // Oscillator may already be stopped during teardown.
      }
      lfo.disconnect();
    });
    [
      this.input,
      this.output,
      this.splitter,
      this.merger,
      ...this.predelays,
      ...this.inputFilters,
      ...this.diffusers,
      ...this.delays,
      ...this.damping,
      ...this.loopHighpasses,
      ...this.loopSaturators,
      ...this.feedback,
      ...this.outputGains,
      ...this.crossGains,
      ...this.lfoDepths,
    ].forEach((node) => node.disconnect());
  }
}

const MAX_RETIRED_REVERB_NETWORKS = 2;
const ATMOS_CROSSFADE_SECONDS = 0.82;
const ATMOS_FADE_IN = createAtmosFade(true);
const ATMOS_FADE_OUT = createAtmosFade(false);
const ATMOS_LOOP_CURVE = createAtmosLoopCurve();

function reverbOutputPolarity(index: number): number {
  // Small Hadamard-like sign pattern decorrelates the summed line outputs without
  // changing per-line energy. It makes dense tails feel wider and less metallic.
  return index % 4 === 1 || index % 4 === 2 ? -1 : 1;
}

function createAtmosFade(fadeIn: boolean): Float32Array {
  const curve = new Float32Array(64);
  for (let i = 0; i < curve.length; i += 1) {
    const t = i / (curve.length - 1);
    curve[i] = fadeIn ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5);
  }
  return curve;
}

function createAtmosLoopCurve(): Float32Array {
  const curve = new Float32Array(4096);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    // Unity slope around zero preserves the intended RT60. Only energetic peaks
    // are rounded, so feedback remains stable without audibly pumping the tail.
    curve[i] = x - 0.035 * x * x * x;
  }
  return curve;
}

interface ActiveNetwork {
  algorithm: ReverbAlgorithm;
  network: ReverbNetwork;
  gain: GainNode;
  disposeTimer: ReturnType<typeof globalThis.setTimeout> | null;
}

/**
 * Atmos v1: six genuinely different stereo algorithmic spaces with
 * tail-preserving crossfades between networks. Parameter changes are smoothed,
 * feedback is bounded, and every algorithm is gain-trimmed for subtle defaults.
 */
export class ReverbEffect extends BaseEffect {
  public readonly id = 'reverb';
  public readonly name = 'Atmos';

  private active: ActiveNetwork;
  private retiring = new Set<ActiveNetwork>();
  private algorithm: ReverbAlgorithm = 'hall';
  private decay = DECAY.defaultValue;
  private size = SIZE.defaultValue;
  private color = COLOR.defaultValue;
  private diffusion = DIFFUSION.defaultValue;
  private motion = MOTION.defaultValue;

  public constructor(context: AudioContext) {
    super(context);
    this.active = this.createNetwork(this.algorithm, 1);
    this.initializeParameters([ALGORITHM, DECAY, SIZE, COLOR, DIFFUSION, MOTION, MIX]);
    this.setParameter('algorithm', ALGORITHM.defaultValue);
    this.setParameter('decay', DECAY.defaultValue);
    this.setParameter('size', SIZE.defaultValue);
    this.setParameter('color', COLOR.defaultValue);
    this.setParameter('diffusion', DIFFUSION.defaultValue);
    this.setParameter('motion', MOTION.defaultValue);
    this.setParameter('mix', MIX.defaultValue);
  }

  public setAlgorithm(algorithm: ReverbAlgorithm): void {
    const index = ALGORITHM_ORDER.indexOf(algorithm);
    if (index >= 0) this.setParameter('algorithm', index);
  }

  public getAlgorithm(): ReverbAlgorithm {
    return this.algorithm;
  }

  public setParameter(parameterId: string, value: number): void {
    switch (parameterId) {
      case 'algorithm': {
        const nextIndex = Math.round(clampParameter(value, ALGORITHM));
        this.parameterValues.set(parameterId, nextIndex);
        this.switchAlgorithm(ALGORITHM_ORDER[nextIndex]);
        break;
      }
      case 'decay':
        this.decay = clampParameter(value, DECAY);
        this.parameterValues.set(parameterId, this.decay);
        this.updateNetworks();
        break;
      case 'size':
        this.size = clampParameter(value, SIZE);
        this.parameterValues.set(parameterId, this.size);
        this.updateNetworks();
        break;
      case 'color':
        this.color = clampParameter(value, COLOR);
        this.parameterValues.set(parameterId, this.color);
        this.updateNetworks();
        break;
      case 'diffusion':
        this.diffusion = clampParameter(value, DIFFUSION);
        this.parameterValues.set(parameterId, this.diffusion);
        this.updateNetworks();
        break;
      case 'motion':
        this.motion = clampParameter(value, MOTION);
        this.parameterValues.set(parameterId, this.motion);
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

  private createNetwork(algorithm: ReverbAlgorithm, initialGain: number): ActiveNetwork {
    const network = new ReverbNetwork(this.context, CONFIGS[algorithm]);
    const gain = this.context.createGain();
    gain.gain.value = initialGain;
    this.input.connect(network.input);
    network.output.connect(gain);
    gain.connect(this.wetGain);
    network.update(this.decay, this.size, this.color, this.diffusion, this.motion);
    return { algorithm, network, gain, disposeTimer: null };
  }

  private switchAlgorithm(algorithm: ReverbAlgorithm): void {
    if (algorithm === this.algorithm) return;
    const now = this.context.currentTime;
    const previous = this.active;
    // Stop feeding new audio into the retiring network while preserving its tail.
    try {
      this.input.disconnect(previous.network.input);
    } catch {
      // It may already be disconnected during rapid switching or teardown.
    }
    const next = this.createNetwork(algorithm, 0);
    this.active = next;
    this.algorithm = algorithm;

    next.gain.gain.cancelScheduledValues(now);
    previous.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(0, now);
    previous.gain.gain.setValueAtTime(1, now);
    next.gain.gain.setValueCurveAtTime(ATMOS_FADE_IN, now, ATMOS_CROSSFADE_SECONDS);
    previous.gain.gain.setValueCurveAtTime(ATMOS_FADE_OUT, now, ATMOS_CROSSFADE_SECONDS);

    this.retiring.add(previous);
    this.trimRetiringNetworks();
    previous.disposeTimer = globalThis.setTimeout(() => {
      previous.disposeTimer = null;
      this.disposeRetiringNetwork(previous);
    }, Math.ceil((ATMOS_CROSSFADE_SECONDS + 0.22) * 1000));
  }

  private updateNetworks(): void {
    // Let a retiring space decay with the exact geometry/tone that produced it.
    // This both sounds more natural and avoids scheduling a second full bank of
    // delay/filter automation while the crossfade is underway.
    this.active.network.update(this.decay, this.size, this.color, this.diffusion, this.motion);
  }

  private trimRetiringNetworks(): void {
    while (this.retiring.size > MAX_RETIRED_REVERB_NETWORKS) {
      const oldest = this.retiring.values().next().value as ActiveNetwork | undefined;
      if (!oldest) break;
      this.disposeRetiringNetwork(oldest);
    }
  }

  private disposeRetiringNetwork(entry: ActiveNetwork): void {
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
      if (entry.disposeTimer !== null) {
        globalThis.clearTimeout(entry.disposeTimer);
        entry.disposeTimer = null;
      }
      entry.gain.disconnect();
      entry.network.dispose();
    });
    this.retiring.clear();
    super.dispose();
  }
}
