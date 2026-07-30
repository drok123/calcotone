class CalcotoneEmberDigitalCaptureProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 5, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'clock', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'character', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'filter', defaultValue: 0.62, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.result = [0, 0];
    this.port.onmessage = (event) => {
      if (event.data?.type === 'reset') this.resetState();
    };
    this.resetState();
  }

  resetState() {
    this.phase = 0;
    this.heldL = 0;
    this.heldR = 0;
    this.envelope = 0;
    this.filterL = [0, 0, 0, 0];
    this.filterR = [0, 0, 0, 0];
    this.previousMode = -1;
    this.clockMemory = 0;
    this.apertureL = 0;
    this.apertureR = 0;
    this.sampleCounter = 0;
  }

  quantize(value, bits) {
    const levels = Math.pow(2, bits - 1);
    return Math.round(Math.max(-1, Math.min(1, value)) * levels) / levels;
  }

  quantizeNonlinear12(value) {
    const sign = value < 0 ? -1 : 1;
    const magnitude = Math.min(1, Math.abs(value));
    const mu = 7.5;
    const encoded = Math.log1p(mu * magnitude) / Math.log1p(mu);
    const quantized = Math.round(encoded * 2047) / 2047;
    return sign * Math.expm1(quantized * Math.log1p(mu)) / mu;
  }

  quantizeCompanded8(value, strength) {
    const sign = value < 0 ? -1 : 1;
    const magnitude = Math.min(1, Math.abs(value));
    const mu = 15 + strength * 24;
    const encoded = Math.log1p(mu * magnitude) / Math.log1p(mu);
    const quantized = Math.round(encoded * 127) / 127;
    return sign * Math.expm1(quantized * Math.log1p(mu)) / mu;
  }

  onePole(value, cutoff, state, index) {
    const safeCutoff = Math.max(60, Math.min(sampleRate * 0.46, cutoff));
    const coefficient = 1 - Math.exp(-2 * Math.PI * safeCutoff / sampleRate);
    state[index] += (value - state[index]) * coefficient;
    return state[index];
  }

  fourPole(value, cutoff, resonance, state) {
    const feedback = state[3] * Math.max(0, Math.min(0.88, resonance));
    let out = value - feedback;
    for (let stage = 0; stage < 4; stage += 1) {
      out = this.onePole(out, cutoff, state, stage);
    }
    return out;
  }

  resetMode(mode) {
    if (this.previousMode === mode) return;
    this.previousMode = mode;
    this.phase = 0;
    this.heldL = 0;
    this.heldR = 0;
    this.envelope = 0;
    this.clockMemory = 0;
    this.apertureL = 0;
    this.apertureR = 0;
    this.filterL.fill(0);
    this.filterR.fill(0);
  }

  processModel(dryL, dryR, mode, drive, clock, character, filter) {
    this.resetMode(mode);
    const inputPeak = Math.max(Math.abs(dryL), Math.abs(dryR));
    this.envelope += (inputPeak - this.envelope) * (inputPeak > this.envelope ? 0.018 : 0.0018);

    let targetRate = 26040;
    let bitDepth = 12;
    let inputDrive = 0.9 + drive * 1.2;
    if (mode === 1) {
      targetRate = 40000;
      inputDrive = 0.88 + drive * 0.52;
    } else if (mode === 2) {
      targetRate = clock <= 0.005 ? 32000 : 10000 + clock * 23000;
      bitDepth = 8;
      inputDrive = 0.8 + drive * 1.45;
    } else if (mode === 3) {
      targetRate = 7500 + clock * 40500;
      inputDrive = 0.84 + drive * 0.82;
    } else if (mode === 4) {
      targetRate = 27000;
      bitDepth = 8;
      inputDrive = 0.86 + drive * 0.74;
    } else if (mode === 5) {
      targetRate = 24000 + clock * 8000;
      bitDepth = 8;
      inputDrive = 0.82 + drive * 0.66;
    }

    this.clockMemory += (targetRate - this.clockMemory) * 0.00035;
    const effectiveRate = Math.max(6000, this.clockMemory || targetRate);
    this.phase += effectiveRate / sampleRate;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      const headroom = mode === 1 ? 0.98 - drive * 0.12 : 1;
      const shapedL = Math.tanh((dryL / headroom) * inputDrive) / Math.max(1, inputDrive * 0.72);
      const shapedR = Math.tanh((dryR / headroom) * inputDrive) / Math.max(1, inputDrive * 0.72);
      this.apertureL += (shapedL - this.apertureL) * (0.82 - character * 0.12);
      this.apertureR += (shapedR - this.apertureR) * (0.82 - character * 0.12);
      if (mode === 1) {
        this.heldL = this.quantizeNonlinear12(this.apertureL);
        this.heldR = this.quantizeNonlinear12(this.apertureR);
      } else if (mode === 4 || mode === 5) {
        this.heldL = this.quantizeCompanded8(this.apertureL, mode === 4 ? 0.7 : 0.35);
        this.heldR = this.quantizeCompanded8(this.apertureR, mode === 4 ? 0.7 : 0.35);
      } else {
        this.heldL = this.quantize(this.apertureL, bitDepth);
        this.heldR = this.quantize(this.apertureR, bitDepth);
      }
    }

    let outL = this.heldL;
    let outR = this.heldR;
    if (mode === 0) {
      const pair = Math.max(0, Math.min(3, Math.floor(clock * 4)));
      if (pair === 0) {
        const cutoff = 3600 + filter * 5600 + this.envelope * (1800 + character * 3200);
        outL = this.fourPole(outL, cutoff, 0.08 + character * 0.30, this.filterL);
        outR = this.fourPole(outR, cutoff * 0.985, 0.08 + character * 0.30, this.filterR);
      } else if (pair === 1) {
        const cutoff = 7200 + filter * 2200;
        outL = this.onePole(this.onePole(outL, cutoff, this.filterL, 0), cutoff, this.filterL, 1);
        outR = this.onePole(this.onePole(outR, cutoff, this.filterR, 0), cutoff, this.filterR, 1);
      } else if (pair === 2) {
        const cutoff = 9800 + filter * 2300;
        outL = this.onePole(outL, cutoff, this.filterL, 0);
        outR = this.onePole(outR, cutoff, this.filterR, 0);
      }
      const imaging = Math.sin(this.sampleCounter * (26040 / sampleRate) * Math.PI * 2) * (0.0015 + character * 0.0035);
      outL += imaging;
      outR -= imaging * 0.82;
    } else if (mode === 1) {
      const cutoff = 15500 + filter * 2600;
      outL = this.onePole(this.onePole(outL, cutoff, this.filterL, 0), cutoff, this.filterL, 1);
      outR = this.onePole(this.onePole(outR, cutoff, this.filterR, 0), cutoff, this.filterR, 1);
      const converterTexture = (character - 0.5) * 0.006;
      outL = Math.tanh(outL * (1 + converterTexture));
      outR = Math.tanh(outR * (1 + converterTexture));
    } else if (mode === 2) {
      const cutoff = 700 + filter * 13500;
      const resonance = 0.05 + character * 0.72;
      outL = this.fourPole(outL, cutoff, resonance, this.filterL);
      outR = this.fourPole(outR, cutoff * 0.992, resonance, this.filterR);
    } else if (mode === 3) {
      const bandwidth = Math.min(19200, effectiveRate * 0.40);
      const cutoff = Math.max(1600, bandwidth * (0.74 + filter * 0.24));
      outL = this.onePole(this.onePole(outL, cutoff, this.filterL, 0), cutoff, this.filterL, 1);
      outR = this.onePole(this.onePole(outR, cutoff * 0.994, this.filterR, 0), cutoff * 0.994, this.filterR, 1);
    } else if (mode === 4) {
      const cutoff = 1800 + filter * 10600 + this.envelope * 900;
      const resonance = 0.10 + character * 0.56;
      outL = this.fourPole(outL, cutoff, resonance, this.filterL);
      outR = this.fourPole(outR, cutoff * 0.987, resonance, this.filterR);
    } else {
      const cutoff = 3900 + filter * 8200;
      outL = this.onePole(this.onePole(outL, cutoff, this.filterL, 0), cutoff * 0.86, this.filterL, 1);
      outR = this.onePole(this.onePole(outR, cutoff * 0.991, this.filterR, 0), cutoff * 0.85, this.filterR, 1);
      const edge = (outL - outR) * character * 0.018;
      outL += edge;
      outR -= edge;
    }

    this.result[0] = Math.max(-1.15, Math.min(1.15, outL));
    this.result[1] = Math.max(-1.15, Math.min(1.15, outR));
    this.sampleCounter += 1;
    return this.result;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];
    const mode = Math.max(0, Math.min(5, Math.round(parameters.mode[0])));
    const drive = Math.max(0, Math.min(1, parameters.drive[0]));
    const clock = Math.max(0, Math.min(1, parameters.clock[0]));
    const character = Math.max(0, Math.min(1, parameters.character[0]));
    const filter = Math.max(0, Math.min(1, parameters.filter[0]));
    for (let sample = 0; sample < outL.length; sample += 1) {
      const inputL = inL ? inL[sample] : 0;
      const inputR = inR ? inR[sample] : inputL;
      const dryL = Number.isFinite(inputL) && Math.abs(inputL) >= 1e-20 ? inputL : 0;
      const dryR = Number.isFinite(inputR) && Math.abs(inputR) >= 1e-20 ? inputR : 0;
      const processed = this.processModel(dryL, dryR, mode, drive, clock, character, filter);
      outL[sample] = processed[0];
      outR[sample] = processed[1];
    }
    return true;
  }
}

registerProcessor('calcotone-ember-digital-capture-processor', CalcotoneEmberDigitalCaptureProcessor);
