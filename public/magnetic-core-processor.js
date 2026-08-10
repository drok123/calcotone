const MAGNETIC_TANH_MIN = -8;
const MAGNETIC_TANH_MAX = 8;
const MAGNETIC_TANH_LUT = new Float32Array(4096);
const MAGNETIC_TANH_SCALE = (MAGNETIC_TANH_LUT.length - 1) / (MAGNETIC_TANH_MAX - MAGNETIC_TANH_MIN);
for (let index = 0; index < MAGNETIC_TANH_LUT.length; index += 1) {
  const x = MAGNETIC_TANH_MIN + index / MAGNETIC_TANH_SCALE;
  MAGNETIC_TANH_LUT[index] = Math.tanh(x);
}

function magneticHermite(y0, y1, y2, y3, mu) {
  const mu2 = mu * mu;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
}

function magneticTanh(value) {
  if (value <= MAGNETIC_TANH_MIN) return -1;
  if (value >= MAGNETIC_TANH_MAX) return 1;
  const position = (value - MAGNETIC_TANH_MIN) * MAGNETIC_TANH_SCALE;
  const index = Math.floor(position);
  const mu = position - index;
  const last = MAGNETIC_TANH_LUT.length - 1;
  const i0 = index > 0 ? index - 1 : 0;
  const i2 = index < last ? index + 1 : last;
  const i3 = index + 2 < last ? index + 2 : last;
  return magneticHermite(MAGNETIC_TANH_LUT[i0], MAGNETIC_TANH_LUT[index], MAGNETIC_TANH_LUT[i2], MAGNETIC_TANH_LUT[i3], mu);
}

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
    this.dcFluxL = 0;
    this.dcFluxR = 0;
    this.saturationMemoryL = 0;
    this.saturationMemoryR = 0;
    this.lossMemory = 0;
    this.thermalState = 0;
  }

  updateSharedState(left, right, drive, heat) {
    const power = 0.5 * (left * left + right * right);
    const lossTarget = Math.min(1.5, power * (0.68 + drive * 0.86));
    this.lossMemory += (lossTarget - this.lossMemory) * (lossTarget > this.lossMemory ? 0.000018 : 0.0000045);

    const thermalTarget = Math.min(1.5, power * (0.55 + drive * 0.72) + this.lossMemory * 0.24 + heat * 0.08);
    this.thermalState += (thermalTarget - this.thermalState) * (thermalTarget > this.thermalState ? 0.000012 : 0.0000035);
  }

  processChannel(input, drive, heat, character, dynamics, channel) {
    const left = channel === 0;
    let previous = left ? this.previousInputL : this.previousInputR;
    let flux = left ? this.fluxL : this.fluxR;
    let remanence = left ? this.remanenceL : this.remanenceR;
    let eddy = left ? this.eddyL : this.eddyR;
    let dcFlux = left ? this.dcFluxL : this.dcFluxR;
    let saturationMemory = left ? this.saturationMemoryL : this.saturationMemoryR;
    let accumulated = 0;

    const mismatch = left ? 1.0018 : 0.9987;
    const permeability = Math.max(0.84, 1 - this.thermalState * (0.025 + heat * 0.025));
    const excitation = (0.88 + drive * 2.4 + heat * 0.45) * mismatch * permeability;
    const baseCoercivity = 0.035 + character * 0.085;
    const saturation = (1.05 + (1 - dynamics) * 0.55) * (1 - Math.min(0.12, saturationMemory * 0.08));
    const fluxRate = (0.10 + dynamics * 0.07) * (0.96 + permeability * 0.04);
    const remanenceRate = (0.00042 + heat * 0.00034) * (1 - Math.min(0.2, this.thermalState * 0.06));
    const eddyRate = 0.15 + character * 0.18;
    const eddyAmount = (0.018 + heat * 0.030 + character * 0.012) * (1 + this.thermalState * 0.08);

    for (let step = 1; step <= this.quality; step += 1) {
      const sub = step / this.quality;
      const interpolated = previous + (input - previous) * sub;
      const field = interpolated * excitation;

      dcFlux += (field - dcFlux) * (0.000018 + heat * 0.000024);
      const direction = field >= flux ? 1 : -1;
      const minorLoop = Math.min(1, Math.abs(field - flux) / Math.max(0.08, saturation));
      const dynamicCoercivity = baseCoercivity * (0.72 + minorLoop * 0.28) * (1 + saturationMemory * 0.08);
      const biasedField = field + remanence * dynamicCoercivity * direction + dcFlux * (0.012 + character * 0.02);
      const targetFlux = magneticTanh(biasedField / Math.max(0.35, saturation)) * saturation;
      flux += (targetFlux - flux) * fluxRate;

      const saturationStress = Math.max(0, Math.abs(flux) / Math.max(0.2, saturation) - 0.62);
      saturationMemory += (saturationStress - saturationMemory) * (saturationStress > saturationMemory ? 0.0025 : 0.00008 + dynamics * 0.00005);

      const remanentTarget = magneticTanh((flux + dcFlux * 0.035) * 1.7) * (0.045 + character * 0.055);
      remanence += (remanentTarget - remanence) * remanenceRate;

      const derivative = field - previous * excitation;
      eddy += (derivative - eddy) * eddyRate;
      const eddyLoss = eddy * eddyAmount;
      const hysteresisLoss = Math.sign(flux || 1) * Math.abs(flux - targetFlux) * (0.006 + character * 0.008);

      const core = magneticTanh((flux - eddyLoss - hysteresisLoss) * (1.02 + heat * 0.22));
      const residual = core - interpolated;
      const wet = 0.10 + drive * 0.16 + heat * 0.05;
      const thermalTrim = 1 - Math.min(0.025, this.thermalState * (0.006 + heat * 0.006));
      accumulated += interpolated + residual * Math.min(0.34, wet) * thermalTrim;
    }

    if (left) {
      this.previousInputL = input;
      this.fluxL = flux;
      this.remanenceL = remanence;
      this.eddyL = eddy;
      this.dcFluxL = dcFlux;
      this.saturationMemoryL = saturationMemory;
    } else {
      this.previousInputR = input;
      this.fluxR = flux;
      this.remanenceR = remanence;
      this.eddyR = eddy;
      this.dcFluxR = dcFlux;
      this.saturationMemoryR = saturationMemory;
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

      this.updateSharedState(left, right, drive, heat);
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
