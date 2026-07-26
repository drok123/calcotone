class CalcotoneDriftClassicProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'model', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'rate', defaultValue: 0.28, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.275, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shape', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'spread', defaultValue: 0.62, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'motion', defaultValue: 0.32, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.resetState();
    this.port.onmessage = (event) => {
      if (event.data?.type === 'reset') this.resetState();
    };
  }

  resetState() {
    this.phase = 0;
    this.phaseB = Math.PI * 0.5;
    this.phaseStateL = Array.from({ length: 12 }, () => ({ x1: 0, y1: 0 }));
    this.phaseStateR = Array.from({ length: 12 }, () => ({ x1: 0, y1: 0 }));
    this.phaseFeedbackL = 0;
    this.phaseFeedbackR = 0;
    this.phaseCoefficientsL = new Float64Array(12);
    this.phaseCoefficientsR = new Float64Array(12);
    this.coefficientCountdown = 0;
    this.coefficientModel = -1;
    this.vibeTargetL = 0.5;
    this.vibeTargetR = 0.5;
    this.result = [0, 0];
    this.lamp = 0.5;
    this.lampR = 0.5;
    this.rotorHornSpeed = 0;
    this.rotorDrumSpeed = 0;
    this.rotorHornPhase = 0;
    this.rotorDrumPhase = Math.PI * 0.37;
    this.rotorLowL = 0;
    this.rotorLowR = 0;
    this.delayL = new Float32Array(2048);
    this.delayR = new Float32Array(2048);
    this.delayIndex = 0;
  }

  coefficient(frequency) {
    const safe = Math.max(35, Math.min(sampleRate * 0.42, frequency));
    const k = Math.tan(Math.PI * safe / sampleRate);
    return (1 - k) / (1 + k);
  }

  allpassWithCoefficient(input, coefficient, state) {
    const output = -coefficient * input + state.x1 + coefficient * state.y1;
    state.x1 = input;
    state.y1 = output;
    return output;
  }

  updateCascadeCoefficients(center, count, offset, spread, destination) {
    const base = 1.44 + spread * 0.16;
    const midpoint = (count - 1) * 0.5;
    for (let i = 0; i < count; i += 1) {
      const ratio = Math.pow(base, i - midpoint);
      destination[offset + i] = this.coefficient(center * ratio);
    }
  }

  cascadeWithCoefficients(input, count, states, offset, coefficients) {
    let value = input;
    for (let i = 0; i < count; i += 1) {
      value = this.allpassWithCoefficient(value, coefficients[offset + i], states[offset + i]);
    }
    return value;
  }

  shouldRefreshCoefficients(model) {
    if (this.coefficientModel !== model || this.coefficientCountdown <= 0) {
      this.coefficientModel = model;
      this.coefficientCountdown = 7;
      return true;
    }
    this.coefficientCountdown -= 1;
    return false;
  }

  processBiPhase(left, right, rate, depth, shape, spread, motion) {
    const speed = 0.045 + rate * 1.95;
    this.phase += 2 * Math.PI * speed / sampleRate;
    this.phaseB += 2 * Math.PI * speed * (0.61 + motion * 0.52) / sampleRate;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    if (this.phaseB > Math.PI * 2) this.phaseB -= Math.PI * 2;

    if (this.shouldRefreshCoefficients(1)) {
      const sweepA = 0.5 + 0.5 * Math.sin(this.phase);
      const sweepB = 0.5 + 0.5 * Math.sin(this.phaseB + spread * Math.PI);
      const centerA = 170 + Math.pow(sweepA, 1.25) * (1050 + depth * 1800);
      const centerB = 230 + Math.pow(sweepB, 1.15) * (1250 + depth * 2200);
      this.updateCascadeCoefficients(centerA, 6, 0, spread, this.phaseCoefficientsL);
      this.updateCascadeCoefficients(centerA * 1.012, 6, 0, spread, this.phaseCoefficientsR);
      this.updateCascadeCoefficients(centerB, 6, 6, 1 - spread, this.phaseCoefficientsL);
      this.updateCascadeCoefficients(centerB * 0.988, 6, 6, 1 - spread, this.phaseCoefficientsR);
    }

    const feedback = 0.08 + shape * 0.56;
    const inputL = left + this.phaseFeedbackL * feedback;
    const inputR = right + this.phaseFeedbackR * feedback;
    const aL = this.cascadeWithCoefficients(inputL, 6, this.phaseStateL, 0, this.phaseCoefficientsL);
    const aR = this.cascadeWithCoefficients(inputR, 6, this.phaseStateR, 0, this.phaseCoefficientsR);
    const bL = this.cascadeWithCoefficients(aL, 6, this.phaseStateL, 6, this.phaseCoefficientsL);
    const bR = this.cascadeWithCoefficients(aR, 6, this.phaseStateR, 6, this.phaseCoefficientsR);
    this.phaseFeedbackL = bL;
    this.phaseFeedbackR = bR;
    this.result[0] = bL;
    this.result[1] = bR;
    return this.result;
  }

  processSmallStone(left, right, rate, depth, shape, spread, motion) {
    const speed = 0.035 + rate * 1.55;
    this.phase += 2 * Math.PI * speed / sampleRate;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    if (this.shouldRefreshCoefficients(2)) {
      const sweepL = 0.5 + 0.5 * Math.sin(this.phase);
      const sweepR = 0.5 + 0.5 * Math.sin(this.phase + spread * 0.65);
      const centerL = 150 + Math.pow(sweepL, 1.45) * (900 + depth * 2100);
      const centerR = 150 + Math.pow(sweepR, 1.45) * (900 + depth * 2100);
      this.updateCascadeCoefficients(centerL, 4, 0, motion, this.phaseCoefficientsL);
      this.updateCascadeCoefficients(centerR, 4, 0, motion, this.phaseCoefficientsR);
    }
    const feedback = 0.05 + shape * 0.67;
    const xL = left + this.phaseFeedbackL * feedback;
    const xR = right + this.phaseFeedbackR * feedback;
    const pL = this.cascadeWithCoefficients(xL, 4, this.phaseStateL, 0, this.phaseCoefficientsL);
    const pR = this.cascadeWithCoefficients(xR, 4, this.phaseStateR, 0, this.phaseCoefficientsR);
    this.phaseFeedbackL = pL;
    this.phaseFeedbackR = pR;
    this.result[0] = pL;
    this.result[1] = pR;
    return this.result;
  }

  processUniVibe(left, right, rate, depth, shape, spread, motion) {
    const speed = 0.08 + rate * 2.25;
    this.phase += 2 * Math.PI * speed / sampleRate;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    if (this.shouldRefreshCoefficients(3)) {
      this.vibeTargetL = 0.5 + 0.5 * Math.sin(this.phase);
      this.vibeTargetR = 0.5 + 0.5 * Math.sin(this.phase + spread * 0.38);
    }
    const rise = 0.0012 + motion * 0.0038;
    const fall = 0.00038 + (1 - motion) * 0.0011;
    this.lamp += (this.vibeTargetL - this.lamp) * (this.vibeTargetL > this.lamp ? rise : fall);
    this.lampR += (this.vibeTargetR - this.lampR) * (this.vibeTargetR > this.lampR ? rise : fall);
    if (this.coefficientCountdown === 7) {
      const centerL = 180 + Math.pow(this.lamp, 1.7) * (1200 + depth * 2200);
      const centerR = 180 + Math.pow(this.lampR, 1.7) * (1200 + depth * 2200);
      this.updateCascadeCoefficients(centerL, 4, 0, shape, this.phaseCoefficientsL);
      this.updateCascadeCoefficients(centerR, 4, 0, shape, this.phaseCoefficientsR);
    }
    const vibeL = this.cascadeWithCoefficients(left, 4, this.phaseStateL, 0, this.phaseCoefficientsL);
    const vibeR = this.cascadeWithCoefficients(right, 4, this.phaseStateR, 0, this.phaseCoefficientsR);
    const tremL = 0.86 + this.lamp * (0.08 + shape * 0.09);
    const tremR = 0.86 + this.lampR * (0.08 + shape * 0.09);
    this.result[0] = vibeL * tremL;
    this.result[1] = vibeR * tremR;
    return this.result;
  }

  readDelay(buffer, delaySamples) {
    let position = this.delayIndex - delaySamples;
    while (position < 0) position += buffer.length;
    const floor = Math.floor(position);
    const base = floor % buffer.length;
    const next = (base + 1) % buffer.length;
    const frac = position - floor;
    return buffer[base] + (buffer[next] - buffer[base]) * frac;
  }

  processLeslie(left, right, rate, depth, shape, spread, motion) {
    this.delayL[this.delayIndex] = left;
    this.delayR[this.delayIndex] = right;
    const fast = rate > 0.52;
    const hornTarget = fast ? 5.7 + rate * 1.3 : 0.55 + rate * 1.1;
    const drumTarget = fast ? 4.2 + rate * 0.8 : 0.42 + rate * 0.75;
    const hornAccel = hornTarget > this.rotorHornSpeed ? 0.000075 + motion * 0.00012 : 0.000022 + motion * 0.000035;
    const drumAccel = drumTarget > this.rotorDrumSpeed ? 0.000028 + motion * 0.00005 : 0.000010 + motion * 0.000018;
    this.rotorHornSpeed += (hornTarget - this.rotorHornSpeed) * hornAccel;
    this.rotorDrumSpeed += (drumTarget - this.rotorDrumSpeed) * drumAccel;
    this.rotorHornPhase += 2 * Math.PI * this.rotorHornSpeed / sampleRate;
    this.rotorDrumPhase += 2 * Math.PI * this.rotorDrumSpeed / sampleRate;
    if (this.rotorHornPhase > Math.PI * 2) this.rotorHornPhase -= Math.PI * 2;
    if (this.rotorDrumPhase > Math.PI * 2) this.rotorDrumPhase -= Math.PI * 2;

    const crossover = 1 - Math.exp(-2 * Math.PI * (650 + shape * 500) / sampleRate);
    this.rotorLowL += (left - this.rotorLowL) * crossover;
    this.rotorLowR += (right - this.rotorLowR) * crossover;
    const lowL = this.rotorLowL;
    const lowR = this.rotorLowR;
    const highL = left - lowL;
    const highR = right - lowR;
    const hornDelay = (0.00015 + depth * 0.00055) * sampleRate;
    const drumDelay = (0.00008 + depth * 0.00024) * sampleRate;
    const hModL = (0.5 + 0.5 * Math.sin(this.rotorHornPhase)) * hornDelay;
    const hModR = (0.5 + 0.5 * Math.sin(this.rotorHornPhase + Math.PI * (0.65 + spread * 0.32))) * hornDelay;
    const dModL = (0.5 + 0.5 * Math.sin(this.rotorDrumPhase)) * drumDelay;
    const dModR = (0.5 + 0.5 * Math.sin(this.rotorDrumPhase + Math.PI * (0.55 + spread * 0.22))) * drumDelay;
    const delayedHL = this.readDelay(this.delayL, hModL);
    const delayedHR = this.readDelay(this.delayR, hModR);
    const delayedDL = this.readDelay(this.delayL, dModL);
    const delayedDR = this.readDelay(this.delayR, dModR);
    const hornAmpL = 0.70 + 0.30 * Math.sin(this.rotorHornPhase);
    const hornAmpR = 0.70 + 0.30 * Math.sin(this.rotorHornPhase + Math.PI * (0.72 + spread * 0.25));
    const drumAmpL = 0.82 + 0.18 * Math.sin(this.rotorDrumPhase);
    const drumAmpR = 0.82 + 0.18 * Math.sin(this.rotorDrumPhase + Math.PI * (0.58 + spread * 0.20));
    const hornMix = 0.46 + shape * 0.22;
    this.result[0] = lowL * (1 - hornMix) * drumAmpL + delayedDL * 0.12 + highL * hornMix * hornAmpL + delayedHL * 0.18;
    this.result[1] = lowR * (1 - hornMix) * drumAmpR + delayedDR * 0.12 + highR * hornMix * hornAmpR + delayedHR * 0.18;
    this.delayIndex = (this.delayIndex + 1) % this.delayL.length;
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
    const model = Math.max(0, Math.min(4, Math.round(parameters.model[0])));
    const rate = Math.max(0, Math.min(1, parameters.rate[0]));
    const depth = Math.max(0, Math.min(1, parameters.depth[0]));
    const shape = Math.max(0, Math.min(1, parameters.shape[0]));
    const spread = Math.max(0, Math.min(1, parameters.spread[0]));
    const motion = Math.max(0, Math.min(1, parameters.motion[0]));

    for (let i = 0; i < outL.length; i += 1) {
      const left = Number.isFinite(inL?.[i]) ? inL[i] : 0;
      const right = Number.isFinite(inR?.[i]) ? inR[i] : left;
      let processed;
      if (model === 1) processed = this.processBiPhase(left, right, rate, depth, shape, spread, motion);
      else if (model === 2) processed = this.processSmallStone(left, right, rate, depth, shape, spread, motion);
      else if (model === 3) processed = this.processUniVibe(left, right, rate, depth, shape, spread, motion);
      else if (model === 4) processed = this.processLeslie(left, right, rate, depth, shape, spread, motion);
      else {
        this.result[0] = left;
        this.result[1] = right;
        processed = this.result;
      }
      outL[i] = Math.max(-1.2, Math.min(1.2, processed[0]));
      outR[i] = Math.max(-1.2, Math.min(1.2, processed[1]));
    }
    return true;
  }
}

registerProcessor('calcotone-drift-classic-processor', CalcotoneDriftClassicProcessor);
