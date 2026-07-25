class CalcotoneEmberTubeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'model', defaultValue: 0, minValue: 0, maxValue: 5, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 0.14, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'heat', defaultValue: 0.18, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'character', defaultValue: 0.22, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'dynamics', defaultValue: 0.38, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.quality = 2;
    this.previousInputL = 0;
    this.previousInputR = 0;
    this.biasMemoryL = 0;
    this.biasMemoryR = 0;
    this.cathodeMemoryL = 0;
    this.cathodeMemoryR = 0;
    this.blockingMemoryL = 0;
    this.blockingMemoryR = 0;
    this.outputMemoryL = 0;
    this.outputMemoryR = 0;

    // Supply and temperature are shared physical states. Stereo channels in a real
    // device do not live on separate power supplies, so a transient on one side can
    // very slightly alter the operating point seen by the other side.
    this.supplyDemand = 0;
    this.supplySag = 0;
    this.thermalState = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'quality') {
        this.quality = Math.max(1, Math.min(4, event.data.factor | 0));
      }
    };
  }

  updateSharedState(left, right, profile, drive, heat, dynamics) {
    const peak = Math.max(Math.abs(left), Math.abs(right));
    const power = 0.5 * (left * left + right * right);

    // Reservoir/rail demand: fast discharge, slower recovery. This is intentionally
    // conservative because these are preamp-color studies, not cranked power amps.
    const demandTarget = Math.min(1.5, peak * (0.55 + drive * 0.45));
    const demandCoefficient = demandTarget > this.supplyDemand ? 0.0024 : 0.00016;
    this.supplyDemand += (demandTarget - this.supplyDemand) * demandCoefficient;
    const sagTarget = this.supplyDemand * (0.006 + profile.sag * 0.010) * (0.35 + dynamics * 0.65);
    this.supplySag += (sagTarget - this.supplySag) * (sagTarget > this.supplySag ? 0.0011 : 0.00010);

    // Very slow thermal/operating-point memory. This does not model literal tube
    // temperature in degrees; it is a normalized proxy for slow bias/transconductance
    // drift after sustained excitation.
    const thermalTarget = Math.min(1, power * (0.45 + drive * 0.75) + heat * 0.12);
    this.thermalState += (thermalTarget - this.thermalState) * (thermalTarget > this.thermalState ? 0.000010 : 0.0000032);
  }

  processChannel(input, modelIndex, drive, heat, character, dynamics, channel) {
    if (modelIndex <= 0) return input;

    const profile = TUBE_PROFILES[modelIndex - 1];
    const isLeft = channel === 0;
    let previousInput = isLeft ? this.previousInputL : this.previousInputR;
    let biasMemory = isLeft ? this.biasMemoryL : this.biasMemoryR;
    let cathodeMemory = isLeft ? this.cathodeMemoryL : this.cathodeMemoryR;
    let blockingMemory = isLeft ? this.blockingMemoryL : this.blockingMemoryR;
    let outputMemory = isLeft ? this.outputMemoryL : this.outputMemoryR;

    const channelTrim = isLeft ? 1 + profile.mismatch : 1 - profile.mismatch * 0.73;
    const thermalSoftening = 1 - this.thermalState * (0.004 + profile.thermal * 0.008);
    const railScale = Math.max(0.94, 1 - this.supplySag);

    // Small-signal preamp philosophy: Drive changes excitation and operating point,
    // while the tube contributes a nonlinear residual rather than replacing the wave.
    const inputGain = (0.92 + Math.pow(drive, 1.55) * (0.48 + profile.gain * 0.18))
      * channelTrim * railScale * thermalSoftening;
    const colorMix = Math.min(
      0.32,
      0.055 + Math.pow(drive, 1.25) * 0.18 + heat * 0.045 + character * 0.035,
    );
    const biasAmount = (0.0025 + profile.biasMemory * 0.0065)
      * (0.30 + heat * 0.70)
      * (0.40 + dynamics * 0.60);
    const attack = 0.006 + heat * 0.006;
    const release = 0.00035 + (1 - dynamics) * 0.00085 + profile.recovery * 0.00022;
    const sagAmount = 0.006 + dynamics * 0.022 + profile.sag * 0.012;
    const characterBias = (character - 0.5) * profile.characterRange * 0.18;
    const curve = profile.softness + heat * 0.08 + drive * 0.12;
    let accumulated = 0;

    for (let step = 1; step <= this.quality; step += 1) {
      const sub = step / this.quality;
      const interpolated = previousInput + (input - previousInput) * sub;
      const absolute = Math.abs(interpolated);
      const coefficient = absolute > biasMemory ? attack : release;
      biasMemory += (absolute - biasMemory) * coefficient;

      // Cathode-bias memory follows average conduction more slowly than the ordinary
      // envelope. Increased recent current shifts the effective bias and produces a
      // small amount of level/harmonic "squish" before recovering.
      const cathodeTarget = Math.min(1, absolute * absolute * (0.65 + drive * 0.55));
      const cathodeCoefficient = cathodeTarget > cathodeMemory
        ? 0.0011 + heat * 0.0007
        : 0.00010 + profile.recovery * 0.00005;
      cathodeMemory += (cathodeTarget - cathodeMemory) * cathodeCoefficient;

      const dynamicBias = biasMemory * biasAmount;
      const cathodeShift = cathodeMemory * profile.cathode * (0.003 + dynamics * 0.006);
      const bias = characterBias - dynamicBias - cathodeShift;
      const stageInput = interpolated * inputGain;

      // AC-coupling/grid-recovery proxy. Only strong excursions charge this state;
      // normal small-signal use is effectively untouched. The stored bias then
      // decays over tens of milliseconds instead of creating hard digital clipping.
      const overdrive = Math.max(0, Math.abs(stageInput) - (0.86 + profile.gridHeadroom * 0.10));
      blockingMemory += (overdrive - blockingMemory) * (overdrive > blockingMemory ? 0.018 : 0.00042 + profile.recovery * 0.00018);
      const recoveryBias = Math.min(0.018, blockingMemory * profile.blocking * (0.012 + drive * 0.010));

      const effectiveBias = bias - recoveryBias;
      const zero = Math.tanh(effectiveBias * curve);
      const localSlope = Math.max(0.42, inputGain * curve * (1 - zero * zero));
      let shaped = (Math.tanh((stageInput + effectiveBias) * curve) - zero) / localSlope;

      // Bias memory, cathode squish and shared rail sag round strong transients without
      // turning the stage into a broadband compressor.
      const localSag = Math.min(0.10, biasMemory * sagAmount + cathodeMemory * profile.cathode * 0.010 + this.supplySag * 0.8);
      shaped *= 1 - localSag;

      // Blend only the nonlinear residual back onto the original signal.
      const colored = interpolated + (shaped - interpolated) * colorMix;

      const plateFollow = 0.82 + profile.plateMemory * 0.10;
      outputMemory += (colored - outputMemory) * plateFollow;
      accumulated += outputMemory;
    }

    if (isLeft) {
      this.previousInputL = input;
      this.biasMemoryL = biasMemory;
      this.cathodeMemoryL = cathodeMemory;
      this.blockingMemoryL = blockingMemory;
      this.outputMemoryL = outputMemory;
    } else {
      this.previousInputR = input;
      this.biasMemoryR = biasMemory;
      this.cathodeMemoryR = cathodeMemory;
      this.blockingMemoryR = blockingMemory;
      this.outputMemoryR = outputMemory;
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
    const modelIndex = Math.max(0, Math.min(5, Math.round(parameters.model[0])));
    const drive = Math.max(0, Math.min(1, parameters.drive[0]));
    const heat = Math.max(0, Math.min(1, parameters.heat[0]));
    const character = Math.max(0, Math.min(1, parameters.character[0]));
    const dynamics = Math.max(0, Math.min(1, parameters.dynamics[0]));
    const profile = modelIndex > 0 ? TUBE_PROFILES[modelIndex - 1] : null;

    for (let i = 0; i < outL.length; i += 1) {
      let left = inL ? inL[i] : 0;
      let right = inR ? inR[i] : left;
      if (!Number.isFinite(left) || Math.abs(left) < 1e-20) left = 0;
      if (!Number.isFinite(right) || Math.abs(right) < 1e-20) right = 0;

      if (modelIndex > 0 && profile) {
        this.updateSharedState(left, right, profile, drive, heat, dynamics);
        left = this.processChannel(left, modelIndex, drive, heat, character, dynamics, 0);
        right = this.processChannel(right, modelIndex, drive, heat, character, dynamics, 1);
      } else {
        this.previousInputL = left;
        this.previousInputR = right;
        this.biasMemoryL *= 0.995;
        this.biasMemoryR *= 0.995;
        this.cathodeMemoryL *= 0.998;
        this.cathodeMemoryR *= 0.998;
        this.blockingMemoryL *= 0.994;
        this.blockingMemoryR *= 0.994;
        this.outputMemoryL = left;
        this.outputMemoryR = right;
        this.supplyDemand *= 0.999;
        this.supplySag *= 0.9995;
        this.thermalState *= 0.999995;
      }

      outL[i] = Math.max(-1.2, Math.min(1.2, left));
      outR[i] = Math.max(-1.2, Math.min(1.2, right));
    }
    return true;
  }
}

// These profile deltas are intentionally conservative theory-crafted operating studies,
// not claims that every specimen of a named ECC83/12AX7 measures this way. The metadata
// gives the simulation stable physical axes that can later be replaced by bench data.
const TUBE_PROFILES = [
  { // Genalex Gold Lion B759 / ECC83
    mu: 100, supply: 300, plateLoad: 100000, bias: -1.50,
    gain: 1.04, softness: 1.08, biasMemory: 0.62, recovery: 0.76, sag: 0.58, plateMemory: 0.58, characterRange: 0.055,
    cathode: 0.55, blocking: 0.48, gridHeadroom: 0.72, thermal: 0.52, mismatch: 0.0020,
  },
  { // Mullard ECC83
    mu: 100, supply: 295, plateLoad: 100000, bias: -1.55,
    gain: 1.02, softness: 1.12, biasMemory: 0.74, recovery: 0.64, sag: 0.72, plateMemory: 0.66, characterRange: 0.065,
    cathode: 0.70, blocking: 0.62, gridHeadroom: 0.58, thermal: 0.68, mismatch: 0.0028,
  },
  { // Telefunken ECC83 smooth plate
    mu: 100, supply: 305, plateLoad: 100000, bias: -1.48,
    gain: 1.00, softness: 1.04, biasMemory: 0.50, recovery: 0.86, sag: 0.46, plateMemory: 0.48, characterRange: 0.045,
    cathode: 0.44, blocking: 0.36, gridHeadroom: 0.84, thermal: 0.42, mismatch: 0.0012,
  },
  { // Amperex Bugle Boy ECC83
    mu: 100, supply: 300, plateLoad: 100000, bias: -1.52,
    gain: 1.03, softness: 1.10, biasMemory: 0.64, recovery: 0.72, sag: 0.62, plateMemory: 0.56, characterRange: 0.060,
    cathode: 0.61, blocking: 0.54, gridHeadroom: 0.68, thermal: 0.57, mismatch: 0.0022,
  },
  { // RCA 12AX7 black plate
    mu: 100, supply: 290, plateLoad: 100000, bias: -1.58,
    gain: 1.06, softness: 1.15, biasMemory: 0.80, recovery: 0.58, sag: 0.80, plateMemory: 0.72, characterRange: 0.070,
    cathode: 0.78, blocking: 0.70, gridHeadroom: 0.50, thermal: 0.76, mismatch: 0.0034,
  },
];

registerProcessor('calcotone-ember-tube-processor', CalcotoneEmberTubeProcessor);
