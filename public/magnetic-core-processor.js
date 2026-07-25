class CalcotoneMagneticCoreProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0.14, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'heat', defaultValue: 0.18, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'character', defaultValue: 0.22, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'dynamics', defaultValue: 0.38, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.quality = 2;
    this.resetState();
    this.port.onmessage = (event) => {
      if (event.data?.type === 'quality') {
        this.quality = Math.max(1, Math.min(4, event.data.factor | 0));
      } else if (event.data?.type === 'reset') {
        this.resetState();
      }
    };
  }

  resetState() {
    this.previousInputL = 0;
    this.previousInputR = 0;
    this.fluxL = 0;
    this.fluxR = 0;
    this.remanenceL = 0;
    this.remanenceR = 0;
    this.eddyL = 0;
    this.eddyR = 0;
    this.lossMemory = 0;
  }

  processChannel(input, drive, heat, character, dynamics, channel) {
    const left = channel === 0;
    let previous = left ? this.previousInputL : this.previousInputR;
    let flux = left ? this.fluxL : this.fluxR;
    let remanence = left ? this.remanenceL : this.remanenceR;
    let eddy = left ? this.eddyL : this.eddyR;
    let accumulated = 0;

    const mismatch = left ? 1.0018 : 0.9987;
    const excitation = (0.88 + drive * 2.4 + heat * 0.45) * mismatch;
    const coercivity = 0.035 + character * 0.085;
    const saturation = 1.05 + (1 - dynamics) * 0.55;
    const fluxRate = 0.10 + dynamics * 0.07;
    const remanenceRate = 0.00042 + heat * 0.00034;
    const eddyRate = 0.15 + character * 0.18;
    const eddyAmount = 0.018 + heat * 0.030 + character * 0.012;

    for (let step = 1; step <= this.quality; step += 1) {
      const sub = step / this.quality;
      const interpolated = previous + (input - previous) * sub;
      const field = interpolated * excitation;
      const direction = field >= flux ? 1 : -1;
      const biasedField = field + remanence * coercivity * direction;
      const targetFlux = Math.tanh(biasedField / saturation) * saturation;
      flux += (targetFlux - flux) * fluxRate;

      const remanentTarget = Math.tanh(flux * 1.7) * (0.045 + character * 0.055);
      remanence += (remanentTarget - remanence) * remanenceRate;

      const derivative = field - previous * excitation;
      eddy += (derivative - eddy) * eddyRate;
      const eddyLoss = eddy * eddyAmount;

      const core = Math.tanh((flux - eddyLoss) * (1.02 + heat * 0.22));
      const residual = core - interpolated;
      const wet = 0.10 + drive * 0.16 + heat * 0.05;
      accumulated += interpolated + residual * Math.min(0.34, wet);
    }

    if (left) {
      this.previousInputL = input;
      this.fluxL = flux;
      this.remanenceL = remanence;
      this.eddyL = eddy;
    } else {
      this.previousInputR = input;
      this.fluxR = flux;
      this.remanenceR = remanence;
      this.eddyR = eddy;
    }

    return accumulated / this.quality;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];
    const drive = Math.max(0, Math.min(1, parameters.drive[0]));
    const heat = Math.max(0, Math.min(1, parameters.heat[0]));
    const character = Math.max(0, Math.min(1, parameters.character[0]));
    const dynamics = Math.max(0, Math.min(1, parameters.dynamics[0]));

    for (let i = 0; i < outL.length; i += 1) {
      let left = inL ? inL[i] : 0;
      let right = inR ? inR[i] : left;
      if (!Number.isFinite(left) || Math.abs(left) < 1e-20) left = 0;
      if (!Number.isFinite(right) || Math.abs(right) < 1e-20) right = 0;

      const power = 0.5 * (left * left + right * right);
      const lossTarget = Math.min(1, power * (0.7 + drive * 0.8));
      this.lossMemory += (lossTarget - this.lossMemory) * (lossTarget > this.lossMemory ? 0.000018 : 0.0000045);
      const lossScale = 1 - this.lossMemory * (0.002 + heat * 0.006);

      left = this.processChannel(left * lossScale, drive, heat, character, dynamics, 0);
      right = this.processChannel(right * lossScale, drive, heat, character, dynamics, 1);
      outL[i] = Math.max(-1.2, Math.min(1.2, left));
      outR[i] = Math.max(-1.2, Math.min(1.2, right));
    }
    return true;
  }
}

registerProcessor('calcotone-magnetic-core-processor', CalcotoneMagneticCoreProcessor);
