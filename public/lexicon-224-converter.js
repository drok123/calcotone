class CalcotoneLexicon224Converter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const role = options?.processorOptions?.role;
    this.role = role === 'output' ? 'output' : 'input';
    this.phase = 0;
    this.heldL = 0;
    this.heldR = 0;
    this.inputFilterL = [0, 0];
    this.inputFilterR = [0, 0];
    this.outputFilterL = [0, 0];
    this.outputFilterR = [0, 0];
    this.gainRangeL = 1;
    this.gainRangeR = 1;
    this.rangeHoldL = 0;
    this.rangeHoldR = 0;
    this.result = [0, 0];
  }

  lowpass(value, cutoff, state, stage) {
    const safeCutoff = Math.max(80, Math.min(sampleRate * 0.44, cutoff));
    const coefficient = 1 - Math.exp(-2 * Math.PI * safeCutoff / sampleRate);
    state[stage] += (value - state[stage]) * coefficient;
    return state[stage];
  }

  transformer(value) {
    // Very restrained transformer/input-amplifier rounding. The 224 identity should
    // come from the converter/algorithm, not from obvious saturation.
    const biased = value + Math.max(0, value) * 0.006;
    return Math.tanh(biased * 1.035) / Math.tanh(1.035);
  }

  selectGainRange(value, channel) {
    const current = channel === 0 ? this.gainRangeL : this.gainRangeR;
    const hold = channel === 0 ? this.rangeHoldL : this.rangeHoldR;
    const magnitude = Math.abs(value);
    let wanted = magnitude < 0.055 ? 8 : magnitude < 0.12 ? 4 : magnitude < 0.24 ? 2 : 1;
    if (hold > 0 && wanted < current) wanted = current;
    const nextHold = wanted !== current ? 20 : Math.max(0, hold - 1);
    if (channel === 0) {
      this.gainRangeL = wanted;
      this.rangeHoldL = nextHold;
    } else {
      this.gainRangeR = wanted;
      this.rangeHoldR = nextHold;
    }
    return wanted;
  }

  quantizeGainStepped(value, channel) {
    const range = this.selectGainRange(value, channel);
    const levels = 2047;
    const scaled = Math.max(-1, Math.min(1, value * range));
    return Math.round(scaled * levels) / levels / range;
  }

  processInput(left, right) {
    // The original machine's conversion/processing clock is part of the audible
    // bandwidth and alias character. We approximate the 20 kHz domain with a
    // band-limited sample/hold before the host-rate reverb network.
    left = this.transformer(left);
    right = this.transformer(right);
    left = this.lowpass(this.lowpass(left, 8200, this.inputFilterL, 0), 8200, this.inputFilterL, 1);
    right = this.lowpass(this.lowpass(right, 8200, this.inputFilterR, 0), 8200, this.inputFilterR, 1);

    this.phase += 20000 / sampleRate;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.heldL = this.quantizeGainStepped(left, 0);
      this.heldR = this.quantizeGainStepped(right, 1);
    }
    this.result[0] = this.heldL;
    this.result[1] = this.heldR;
    return this.result;
  }

  processOutput(left, right) {
    // D/A side: another gain-stepped conversion followed by the restricted
    // reconstruction bandwidth. Do not downsample twice; the internal network has
    // already been excited by the 20 kHz-domain input stream.
    left = this.quantizeGainStepped(left, 0);
    right = this.quantizeGainStepped(right, 1);
    left = this.lowpass(this.lowpass(left, 8800, this.outputFilterL, 0), 8800, this.outputFilterL, 1);
    right = this.lowpass(this.lowpass(right, 8800, this.outputFilterR, 0), 8800, this.outputFilterR, 1);
    this.result[0] = left;
    this.result[1] = right;
    return this.result;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];

    for (let index = 0; index < outL.length; index += 1) {
      const left = Number.isFinite(inL?.[index]) ? inL[index] : 0;
      const right = Number.isFinite(inR?.[index]) ? inR[index] : left;
      const processed = this.role === 'input'
        ? this.processInput(left, right)
        : this.processOutput(left, right);
      outL[index] = Math.max(-1.1, Math.min(1.1, processed[0]));
      outR[index] = Math.max(-1.1, Math.min(1.1, processed[1]));
    }
    return true;
  }
}

registerProcessor('calcotone-lexicon224-converter', CalcotoneLexicon224Converter);
