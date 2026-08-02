/* CALCOTONE STACK — circuit-informed amp/cab processor.
 * CPU-local feedback and nonlinear stages stay inside one AudioWorklet quantum.
 * Transfer curves use a Hermite-interpolated LUT; topology and cabinet
 * coefficients glide so model changes do not hard-snap the signal. */

const LUT_SIZE = 2048;
const SHAPER_LUT = new Float32Array(LUT_SIZE);
for (let index = 0; index < LUT_SIZE; index += 1) {
  const x = (index / (LUT_SIZE - 1)) * 8 - 4;
  SHAPER_LUT[index] = Math.tanh(x);
}

const AMP_MODELS = [
  // gain, brightness, bias, sag, feedback, transformer, makeup
  [3.15, 0.68,  0.018, 0.24, 0.12, 0.22, 0.92], // Blackface
  [3.75, 0.78, -0.012, 0.36, 0.08, 0.32, 0.88], // AC30
  [4.85, 0.61,  0.028, 0.48, 0.16, 0.44, 0.82], // Plexi
  [3.55, 0.39, -0.018, 0.40, 0.22, 0.38, 0.91], // SVT
  [5.35, 0.31,  0.036, 0.64, 0.26, 0.56, 0.76], // Model T
  [4.30, 0.55, -0.008, 0.46, 0.18, 0.48, 0.84], // CALCOTONE splice
];

const CABINETS = [
  // high-pass, low-pass, body frequency, body amount, makeup
  [78,  7200, 118, 0.16, 1.03], // 1×12
  [70,  6500, 104, 0.20, 1.04], // 2×12
  [66,  5600,  92, 0.26, 1.08], // 4×12
  [42,  4800,  68, 0.24, 1.08], // 8×10
  [24, 18000,  85, 0.00, 0.94], // direct
];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function hermite(y0, y1, y2, y3, amount) {
  const amount2 = amount * amount;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return a0 * amount * amount2 + a1 * amount2 + a2 * amount + y1;
}

function shape(value) {
  const position = clamp((value + 4) * 0.125, 0, 1) * (LUT_SIZE - 1);
  const index = Math.floor(position);
  const amount = position - index;
  const i0 = Math.max(0, index - 1);
  const i1 = Math.max(0, Math.min(LUT_SIZE - 1, index));
  const i2 = Math.max(0, Math.min(LUT_SIZE - 1, index + 1));
  const i3 = Math.max(0, Math.min(LUT_SIZE - 1, index + 2));
  return hermite(SHAPER_LUT[i0], SHAPER_LUT[i1], SHAPER_LUT[i2], SHAPER_LUT[i3], amount);
}

function tptLowpass(input, state, key, coefficient) {
  const value = (input - state[key]) * coefficient;
  const low = value + state[key];
  state[key] = low + value;
  return low;
}

function makeChannelState() {
  return {
    previousInput: 0,
    inputLow: 0,
    toneLow: 0,
    toneHigh: 0,
    feedbackLow: 0,
    transformerMemory: 0,
    sagEnvelope: 0,
    cabHighpassLow: 0,
    cabLowOne: 0,
    cabLowTwo: 0,
    cabBodyLow: 0,
    outputDcInput: 0,
    outputDcValue: 0,
  };
}

class StackAmpProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'model', defaultValue: 5, minValue: 0, maxValue: 5, automationRate: 'k-rate' },
      { name: 'cabinet', defaultValue: 2, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'tone', defaultValue: 0.52, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sag', defaultValue: 0.34, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.channels = [makeChannelState(), makeChannelState()];
    this.quality = 1;
    this.coefficients = [...AMP_MODELS[5], ...CABINETS[2]];
    this.port.onmessage = (event) => {
      if (event.data?.type === 'quality') this.quality = [1, 2, 4].includes(event.data.quality) ? event.data.quality : 1;
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;
    const modelIndex = Math.round(clamp(parameters.model[0], 0, AMP_MODELS.length - 1));
    const cabinetIndex = Math.round(clamp(parameters.cabinet[0], 0, CABINETS.length - 1));
    const model = AMP_MODELS[modelIndex];
    const cabinet = CABINETS[cabinetIndex];
    const drive = clamp(parameters.drive[0], 0, 1);
    const tone = clamp(parameters.tone[0], 0, 1);
    const sagControl = clamp(parameters.sag[0], 0, 1);
    const coefficientGlide = 1 - Math.exp(-output[0].length / (sampleRate * 0.035));
    for (let index = 0; index < model.length; index += 1) {
      this.coefficients[index] += (model[index] - this.coefficients[index]) * coefficientGlide;
    }
    for (let index = 0; index < cabinet.length; index += 1) {
      const coefficientIndex = model.length + index;
      this.coefficients[coefficientIndex] += (cabinet[index] - this.coefficients[coefficientIndex]) * coefficientGlide;
    }

    const [modelGain, brightness, bias, modelSag, feedback, transformer, modelMakeup,
      cabHp, cabLp, bodyHz, bodyAmount, cabMakeup] = this.coefficients;
    const substeps = this.quality;
    const internalRate = sampleRate * substeps;
    const inputHpCoefficient = Math.tan(Math.PI * 28 / internalRate) / (1 + Math.tan(Math.PI * 28 / internalRate));
    const toneLowCoefficient = Math.tan(Math.PI * 360 / internalRate) / (1 + Math.tan(Math.PI * 360 / internalRate));
    const toneHighHz = 1800 + brightness * 3100 + tone * 2600;
    const toneHighCoefficient = Math.tan(Math.PI * toneHighHz / internalRate) / (1 + Math.tan(Math.PI * toneHighHz / internalRate));
    const feedbackCoefficient = Math.tan(Math.PI * 1250 / internalRate) / (1 + Math.tan(Math.PI * 1250 / internalRate));
    const cabHpCoefficient = Math.tan(Math.PI * cabHp / internalRate) / (1 + Math.tan(Math.PI * cabHp / internalRate));
    const cabLpCoefficient = Math.tan(Math.PI * cabLp / internalRate) / (1 + Math.tan(Math.PI * cabLp / internalRate));
    const bodyCoefficient = Math.tan(Math.PI * bodyHz / internalRate) / (1 + Math.tan(Math.PI * bodyHz / internalRate));
    const sagAttack = 1 - Math.exp(-1 / (internalRate * 0.004));
    const sagRelease = 1 - Math.exp(-1 / (internalRate * 0.11));
    const inputGain = 1 + Math.pow(drive, 1.38) * modelGain;
    const driveMakeup = 1 / (1 + drive * 0.85);
    const sagDepth = sagControl * modelSag * 0.52;
    const biasZero = shape(bias * inputGain);

    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] || input[0];
      const destination = output[channel];
      const state = this.channels[channel] || (this.channels[channel] = makeChannelState());
      for (let frame = 0; frame < destination.length; frame += 1) {
        const sample = source?.[frame] ?? 0;
        let accumulated = 0;
        for (let step = 1; step <= substeps; step += 1) {
          const interpolated = state.previousInput + (sample - state.previousInput) * (step / substeps);
          const inputLow = tptLowpass(interpolated, state, 'inputLow', inputHpCoefficient);
          const highpassed = interpolated - inputLow;
          const feedbackSignal = tptLowpass(state.transformerMemory, state, 'feedbackLow', feedbackCoefficient);
          const preampInput = (highpassed - feedbackSignal * feedback) * inputGain + bias;
          let preamp = (shape(preampInput) - biasZero) * (0.88 + drive * 0.32);

          const low = tptLowpass(preamp, state, 'toneLow', toneLowCoefficient);
          const highLow = tptLowpass(preamp, state, 'toneHigh', toneHighCoefficient);
          const high = preamp - highLow;
          const mid = highLow - low;
          preamp = low * (1.18 - tone * 0.44)
            + mid * (0.86 + (0.5 - Math.abs(tone - 0.5)) * 0.24)
            + high * (0.56 + tone * (0.74 + brightness * 0.28));

          const envelopeInput = Math.abs(preamp);
          const envelopeRate = envelopeInput > state.sagEnvelope ? sagAttack : sagRelease;
          state.sagEnvelope += (envelopeInput - state.sagEnvelope) * envelopeRate;
          const supply = 1 / (1 + state.sagEnvelope * sagDepth);
          const power = shape(preamp * supply * (1.15 + drive * 1.05));
          state.transformerMemory += (power - state.transformerMemory) * (0.06 + transformer * 0.11);
          let transformed = power * (1 - transformer * 0.18)
            + shape((power + state.transformerMemory * 0.22) * (1 + transformer)) * transformer * 0.34;

          const hpLow = tptLowpass(transformed, state, 'cabHighpassLow', cabHpCoefficient);
          transformed -= hpLow;
          const cabOne = tptLowpass(transformed, state, 'cabLowOne', cabLpCoefficient);
          const cabTwo = tptLowpass(cabOne, state, 'cabLowTwo', cabLpCoefficient);
          const body = tptLowpass(transformed, state, 'cabBodyLow', bodyCoefficient);
          let cabinetOutput = cabTwo + body * bodyAmount;
          cabinetOutput *= modelMakeup * cabMakeup * driveMakeup;
          accumulated += shape(cabinetOutput * 1.08) * 1.04;
        }
        state.previousInput = sample;
        let result = accumulated / substeps;
        const dc = result - state.outputDcInput + 0.995 * state.outputDcValue;
        state.outputDcInput = result;
        state.outputDcValue = dc;
        result = Math.max(-1.15, Math.min(1.15, dc));
        destination[frame] = Number.isFinite(result) ? result : 0;
      }
    }
    return true;
  }
}

registerProcessor('calcotone-stack-amp-processor', StackAmpProcessor);
