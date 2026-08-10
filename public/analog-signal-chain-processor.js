const ADAA_DOMAIN = 24;
const ADAA_TABLE_SIZE = 4097;
const TANH_DOMAIN = 8;
const TANH_TABLE_SIZE = 2049;

class CalcotoneAnalogSignalChainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'inputGain', defaultValue: 1, minValue: 0, maxValue: 8, automationRate: 'a-rate' },
      { name: 'drive', defaultValue: 1, minValue: 1, maxValue: 12, automationRate: 'a-rate' },
      { name: 'asymmetry', defaultValue: 0, minValue: -0.25, maxValue: 0.25, automationRate: 'a-rate' },
      { name: 'shapeMode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cutoff', defaultValue: 18000, minValue: 10, maxValue: 24000, automationRate: 'a-rate' },
      { name: 'dcCutoff', defaultValue: 12, minValue: 2, maxValue: 80, automationRate: 'k-rate' },
      { name: 'outputGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate' },
    ];
  }

  constructor() {
    super();
    this.states = [this.makeState(), this.makeState()];
    this.lut = this.makeLut(1024);
    this.adaaAntiderivativeLut = this.makeAntiderivativeLut(ADAA_TABLE_SIZE);
    this.adaaTanhLut = this.makeTanhLut(TANH_TABLE_SIZE);
    this.port.onmessage = (event) => {
      if (event.data?.type === 'reset') this.resetStates();
      if (event.data?.type === 'lut' && event.data.values instanceof Float32Array && event.data.values.length >= 16) {
        this.lut = event.data.values;
      }
    };
  }

  makeState() {
    return {
      previousAdaInput: 0,
      previousDcInput: 0,
      previousDcOutput: 0,
      tptState: 0,
      cutoffHz: -1,
      cutoffG: 0,
    };
  }

  resetStates() {
    for (let i = 0; i < this.states.length; i += 1) {
      const state = this.states[i];
      state.previousAdaInput = 0;
      state.previousDcInput = 0;
      state.previousDcOutput = 0;
      state.tptState = 0;
      state.cutoffHz = -1;
      state.cutoffG = 0;
    }
  }

  makeLut(length) {
    const table = new Float32Array(length);
    const normalization = Math.tanh(3.2);
    for (let i = 0; i < length; i += 1) {
      const x = i / (length - 1) * 2 - 1;
      table[i] = Math.tanh(x * 3.2) / normalization;
    }
    return table;
  }

  makeAntiderivativeLut(length) {
    const table = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
      const magnitude = i / (length - 1) * ADAA_DOMAIN;
      table[i] = magnitude + Math.log1p(Math.exp(-2 * magnitude)) - Math.LN2;
    }
    return table;
  }

  makeTanhLut(length) {
    const table = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const x = i / (length - 1) * TANH_DOMAIN * 2 - TANH_DOMAIN;
      table[i] = Math.tanh(x);
    }
    return table;
  }

  value(values, index) {
    return values.length === 1 ? values[0] : values[index];
  }

  antiderivative(x) {
    const magnitude = Math.abs(Math.max(-ADAA_DOMAIN, Math.min(ADAA_DOMAIN, x)));
    const table = this.adaaAntiderivativeLut;
    const position = magnitude / ADAA_DOMAIN * (table.length - 1);
    const index = Math.floor(position);
    const next = index < table.length - 1 ? index + 1 : index;
    const fraction = position - index;
    return table[index] + (table[next] - table[index]) * fraction;
  }

  fastTanh(x) {
    if (x <= -TANH_DOMAIN) return -1;
    if (x >= TANH_DOMAIN) return 1;
    const table = this.adaaTanhLut;
    const position = (x + TANH_DOMAIN) / (TANH_DOMAIN * 2) * (table.length - 1);
    const index = Math.floor(position);
    const next = index < table.length - 1 ? index + 1 : index;
    const fraction = position - index;
    return table[index] + (table[next] - table[index]) * fraction;
  }

  adaTanh(x, state) {
    const previous = state.previousAdaInput;
    const delta = x - previous;
    const output = Math.abs(delta) > 1e-6
      ? (this.antiderivative(x) - this.antiderivative(previous)) / delta
      : this.fastTanh((x + previous) * 0.5);
    state.previousAdaInput = x;
    return output;
  }

  hermite(y0, y1, y2, y3, mu) {
    const mu2 = mu * mu;
    const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const a2 = -0.5 * y0 + 0.5 * y2;
    return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
  }

  readLut(x) {
    const table = this.lut;
    const last = table.length - 1;
    const position = Math.max(0, Math.min(1, x * 0.5 + 0.5)) * last;
    const index = Math.floor(position);
    const mu = position - index;
    const i0 = index > 0 ? index - 1 : 0;
    const i1 = index;
    const i2 = index < last ? index + 1 : last;
    const i3 = index + 2 < last ? index + 2 : last;
    return this.hermite(table[i0], table[i1], table[i2], table[i3], mu);
  }

  lowpassCoefficient(cutoffValue, state) {
    const cutoff = Math.max(10, Math.min(sampleRate * 0.475, cutoffValue));
    if (cutoff !== state.cutoffHz) {
      const g = Math.tan(Math.PI * cutoff / sampleRate);
      state.cutoffHz = cutoff;
      state.cutoffG = g;
    }
    return state.cutoffG;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output) return true;
    const shapeMode = Math.round(parameters.shapeMode[0] || 0);
    const dcR = Math.exp(-2 * Math.PI * Math.max(2, parameters.dcCutoff[0] || 12) / sampleRate);

    for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
      const outputChannel = output[channelIndex];
      const inputChannel = input?.[Math.min(channelIndex, Math.max(0, input.length - 1))];
      const state = this.states[channelIndex] || this.states[0];

      for (let i = 0; i < outputChannel.length; i += 1) {
        const sample = inputChannel ? inputChannel[i] : 0;
        const raw = Number.isFinite(sample) ? sample : 0;
        const inputGain = this.value(parameters.inputGain, i);
        const drive = this.value(parameters.drive, i);
        const asymmetry = this.value(parameters.asymmetry, i);
        const sideDrive = Math.max(1, drive * (raw >= 0 ? 1 + asymmetry : 1 - asymmetry * 0.62));
        const driven = Math.abs(raw) < 1e-20 ? 0 : raw * inputGain * sideDrive;
        const shaped = shapeMode === 1 ? this.readLut(driven) : this.adaTanh(driven, state);

        const dcOut = shaped - state.previousDcInput + dcR * state.previousDcOutput;
        state.previousDcInput = shaped;
        state.previousDcOutput = Math.abs(dcOut) < 1e-20 ? 0 : dcOut;

        const g = this.lowpassCoefficient(this.value(parameters.cutoff, i), state);
        const v = (state.previousDcOutput - state.tptState) * g / (1 + g);
        const lowpass = v + state.tptState;
        state.tptState = lowpass + v;

        const result = lowpass * this.value(parameters.outputGain, i);
        outputChannel[i] = Number.isFinite(result) ? Math.max(-1.5, Math.min(1.5, result)) : 0;
      }
    }
    return true;
  }
}

registerProcessor('calcotone-analog-signal-chain-processor', CalcotoneAnalogSignalChainProcessor);
