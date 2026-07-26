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
    this.biasMemoryL = 0;
    this.biasMemoryR = 0;
    this.cathodeMemoryL = 0;
    this.cathodeMemoryR = 0;
    this.blockingMemoryL = 0;
    this.blockingMemoryR = 0;
    this.outputMemoryL = 0;
    this.outputMemoryR = 0;
    this.plateChargeL = 0;
    this.plateChargeR = 0;
    this.supplyDemand = 0;
    this.supplySag = 0;
    this.thermalState = 0;
  }

  updateSharedState(left, right, profile, drive, heat, dynamics) {
    const peak = Math.max(Math.abs(left), Math.abs(right));
    const power = 0.5 * (left * left + right * right);
    const voltageScale = profile.supply / 300;
    const loadScale = 100000 / profile.plateLoad;
    const demandTarget = Math.min(1.7, peak * (0.48 + drive * 0.72) * loadScale);
    const demandCoefficient = demandTarget > this.supplyDemand
      ? 0.0018 + profile.supplyStiffness * 0.0016
      : 0.00008 + profile.recovery * 0.00008;
    this.supplyDemand += (demandTarget - this.supplyDemand) * demandCoefficient;
    const sagTarget = this.supplyDemand
      * (0.0035 + profile.sag * 0.022)
      * (0.30 + dynamics * 0.70)
      / Math.max(0.72, voltageScale);
    this.supplySag += (sagTarget - this.supplySag)
      * (sagTarget > this.supplySag ? 0.00075 + profile.sagAttack * 0.0010 : 0.000055 + profile.recovery * 0.00009);
    const thermalTarget = Math.min(1.2, power * (0.34 + drive * 1.05) * loadScale + heat * (0.08 + profile.thermal * 0.10));
    this.thermalState += (thermalTarget - this.thermalState)
      * (thermalTarget > this.thermalState ? 0.000007 + profile.thermal * 0.000008 : 0.0000022 + profile.recovery * 0.0000018);
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
    let plateCharge = isLeft ? this.plateChargeL : this.plateChargeR;

    const voltageScale = profile.supply / 300;
    const loadScale = 100000 / profile.plateLoad;
    const muScale = profile.mu / 100;
    const biasScale = Math.max(0.65, Math.min(1.35, Math.abs(profile.bias) / 1.5));
    const channelTrim = isLeft ? 1 + profile.mismatch : 1 - profile.mismatch * 0.73;
    const railScale = Math.max(0.88, 1 - this.supplySag * (0.72 + profile.sag * 0.58));
    const thermalSoftening = 1 - this.thermalState * (0.003 + profile.thermal * 0.014);
    const inputGain = (0.82 + Math.pow(drive, 1.42) * (0.52 + profile.gain * 0.38))
      * channelTrim * railScale * thermalSoftening * muScale * (0.90 + voltageScale * 0.10);
    const modelColor = profile.colorBase + drive * profile.colorDrive + heat * profile.colorHeat + character * profile.colorCharacter;
    const colorMix = Math.min(profile.colorCeiling, Math.max(0.04, modelColor));
    const biasAmount = (0.002 + profile.biasMemory * 0.010)
      * (0.24 + heat * 0.76)
      * (0.34 + dynamics * 0.66)
      * biasScale;
    const attack = profile.biasAttack + heat * profile.biasAttackHeat;
    const release = profile.biasRelease + (1 - dynamics) * profile.biasReleaseDynamics + profile.recovery * profile.biasReleaseRecovery;
    const characterBias = (character - 0.5) * profile.characterRange * 0.34 + profile.staticBias;
    const curve = profile.softness + heat * profile.heatCurve + drive * profile.driveCurve;
    let accumulated = 0;

    for (let step = 1; step <= this.quality; step += 1) {
      const sub = step / this.quality;
      const interpolated = previousInput + (input - previousInput) * sub;
      const absolute = Math.abs(interpolated);
      const coefficient = absolute > biasMemory ? attack : release;
      biasMemory += (absolute - biasMemory) * coefficient;

      const cathodeTarget = Math.min(1.25, absolute * absolute * (profile.cathodeDrive + drive * profile.cathodeDriveMod));
      const cathodeCoefficient = cathodeTarget > cathodeMemory
        ? profile.cathodeAttack + heat * profile.cathodeHeatAttack
        : profile.cathodeRelease + profile.recovery * profile.cathodeRecovery;
      cathodeMemory += (cathodeTarget - cathodeMemory) * cathodeCoefficient;

      const dynamicBias = biasMemory * biasAmount;
      const cathodeShift = cathodeMemory * profile.cathode * (profile.cathodeBiasBase + dynamics * profile.cathodeBiasDynamics);
      const stageInput = interpolated * inputGain;
      const gridThreshold = profile.gridHeadroom * (0.72 + voltageScale * 0.18 + biasScale * 0.10);
      const overdrive = Math.max(0, Math.abs(stageInput) - gridThreshold);
      blockingMemory += (overdrive - blockingMemory)
        * (overdrive > blockingMemory ? profile.blockingAttack : profile.blockingRelease + profile.recovery * profile.blockingRecovery);
      const recoveryBias = Math.min(profile.blockingCeiling, blockingMemory * profile.blocking * profile.blockingBias);

      const effectiveBias = characterBias - dynamicBias - cathodeShift - recoveryBias;
      const zero = Math.tanh(effectiveBias * curve);
      const localSlope = Math.max(0.34, inputGain * curve * (1 - zero * zero));
      let shaped = (Math.tanh((stageInput + effectiveBias) * curve) - zero) / localSlope;

      const plateCurrent = Math.max(0, Math.abs(stageInput) * profile.plateCurrentScale + cathodeMemory * profile.plateCathodeCoupling);
      const plateTarget = Math.min(1.2, plateCurrent * loadScale / Math.max(0.75, voltageScale));
      plateCharge += (plateTarget - plateCharge)
        * (plateTarget > plateCharge ? profile.plateAttack : profile.plateRelease);
      const plateCompression = 1 - Math.min(profile.plateCompressionCeiling, plateCharge * profile.plateCompression);
      shaped *= plateCompression;

      const localSag = Math.min(profile.localSagCeiling,
        biasMemory * (profile.localSagBase + dynamics * profile.localSagDynamics)
        + cathodeMemory * profile.cathode * profile.localSagCathode
        + this.supplySag * profile.localSagSupply);
      shaped *= 1 - localSag;

      const harmonicTilt = Math.tanh(shaped * (1 + profile.harmonicDrive * (0.4 + drive)))
        + profile.evenHarmonic * shaped * shaped * Math.sign(shaped);
      const harmonicNorm = 1 + profile.evenHarmonic * 0.28;
      shaped = harmonicTilt / harmonicNorm;

      const colored = interpolated + (shaped - interpolated) * colorMix;
      const plateFollow = profile.plateFollowBase + profile.plateMemory * profile.plateFollowMemory;
      outputMemory += (colored - outputMemory) * Math.min(0.97, plateFollow);
      accumulated += outputMemory;
    }

    if (isLeft) {
      this.previousInputL = input;
      this.biasMemoryL = biasMemory;
      this.cathodeMemoryL = cathodeMemory;
      this.blockingMemoryL = blockingMemory;
      this.outputMemoryL = outputMemory;
      this.plateChargeL = plateCharge;
    } else {
      this.previousInputR = input;
      this.biasMemoryR = biasMemory;
      this.cathodeMemoryR = cathodeMemory;
      this.blockingMemoryR = blockingMemory;
      this.outputMemoryR = outputMemory;
      this.plateChargeR = plateCharge;
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
        this.plateChargeL *= 0.998;
        this.plateChargeR *= 0.998;
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

// Theory-crafted operating studies. These are intentionally differentiated by electrical
// behavior, not merely EQ. Exact coefficients are musical approximations rather than lab data.
const TUBE_PROFILES = [
  // Gold Lion: firm supply, high headroom, quick recovery, articulate upper harmonics.
  {
    mu: 102, supply: 315, plateLoad: 92000, bias: -1.42,
    gain: 1.12, softness: 1.02, biasMemory: 0.50, recovery: 0.90, sag: 0.30, plateMemory: 0.40, characterRange: 0.050,
    cathode: 0.42, blocking: 0.30, gridHeadroom: 0.98, thermal: 0.32, mismatch: 0.0012,
    supplyStiffness: 0.90, sagAttack: 0.42, colorBase: 0.10, colorDrive: 0.28, colorHeat: 0.05, colorCharacter: 0.08, colorCeiling: 0.52,
    biasAttack: 0.0052, biasAttackHeat: 0.0035, biasRelease: 0.00055, biasReleaseDynamics: 0.00062, biasReleaseRecovery: 0.00034,
    staticBias: 0.001, heatCurve: 0.05, driveCurve: 0.10,
    cathodeDrive: 0.50, cathodeDriveMod: 0.40, cathodeAttack: 0.00082, cathodeHeatAttack: 0.00042, cathodeRelease: 0.00013, cathodeRecovery: 0.00007,
    cathodeBiasBase: 0.0024, cathodeBiasDynamics: 0.0045, blockingAttack: 0.012, blockingRelease: 0.00052, blockingRecovery: 0.00022, blockingCeiling: 0.012, blockingBias: 0.015,
    plateCurrentScale: 0.52, plateCathodeCoupling: 0.20, plateAttack: 0.0014, plateRelease: 0.00016, plateCompression: 0.022, plateCompressionCeiling: 0.065,
    localSagBase: 0.004, localSagDynamics: 0.014, localSagCathode: 0.006, localSagSupply: 0.50, localSagCeiling: 0.075,
    harmonicDrive: 0.10, evenHarmonic: 0.020, plateFollowBase: 0.88, plateFollowMemory: 0.07,
  },
  // Mullard: earlier compression, softer knee, stronger cathode movement and slower bloom/recovery.
  {
    mu: 96, supply: 285, plateLoad: 112000, bias: -1.62,
    gain: 1.02, softness: 1.26, biasMemory: 0.92, recovery: 0.46, sag: 1.00, plateMemory: 0.82, characterRange: 0.095,
    cathode: 0.92, blocking: 0.84, gridHeadroom: 0.63, thermal: 0.92, mismatch: 0.0036,
    supplyStiffness: 0.28, sagAttack: 0.88, colorBase: 0.14, colorDrive: 0.38, colorHeat: 0.11, colorCharacter: 0.10, colorCeiling: 0.70,
    biasAttack: 0.0075, biasAttackHeat: 0.0058, biasRelease: 0.00024, biasReleaseDynamics: 0.00115, biasReleaseRecovery: 0.00014,
    staticBias: -0.006, heatCurve: 0.13, driveCurve: 0.20,
    cathodeDrive: 0.78, cathodeDriveMod: 0.76, cathodeAttack: 0.00145, cathodeHeatAttack: 0.0010, cathodeRelease: 0.000055, cathodeRecovery: 0.000035,
    cathodeBiasBase: 0.0048, cathodeBiasDynamics: 0.0090, blockingAttack: 0.026, blockingRelease: 0.00026, blockingRecovery: 0.00010, blockingCeiling: 0.026, blockingBias: 0.026,
    plateCurrentScale: 0.76, plateCathodeCoupling: 0.46, plateAttack: 0.0021, plateRelease: 0.00008, plateCompression: 0.050, plateCompressionCeiling: 0.14,
    localSagBase: 0.008, localSagDynamics: 0.032, localSagCathode: 0.014, localSagSupply: 0.92, localSagCeiling: 0.14,
    harmonicDrive: 0.18, evenHarmonic: 0.075, plateFollowBase: 0.74, plateFollowMemory: 0.14,
  },
  // Telefunken: most linear/fast model, high headroom, minimal asymmetry and supply movement.
  {
    mu: 104, supply: 325, plateLoad: 88000, bias: -1.36,
    gain: 1.05, softness: 0.94, biasMemory: 0.34, recovery: 1.00, sag: 0.20, plateMemory: 0.26, characterRange: 0.032,
    cathode: 0.30, blocking: 0.20, gridHeadroom: 1.08, thermal: 0.24, mismatch: 0.0007,
    supplyStiffness: 1.00, sagAttack: 0.24, colorBase: 0.075, colorDrive: 0.22, colorHeat: 0.035, colorCharacter: 0.055, colorCeiling: 0.42,
    biasAttack: 0.0045, biasAttackHeat: 0.0024, biasRelease: 0.00072, biasReleaseDynamics: 0.00048, biasReleaseRecovery: 0.00042,
    staticBias: 0.0005, heatCurve: 0.035, driveCurve: 0.075,
    cathodeDrive: 0.40, cathodeDriveMod: 0.30, cathodeAttack: 0.00062, cathodeHeatAttack: 0.00030, cathodeRelease: 0.00017, cathodeRecovery: 0.00009,
    cathodeBiasBase: 0.0018, cathodeBiasDynamics: 0.0034, blockingAttack: 0.009, blockingRelease: 0.00065, blockingRecovery: 0.00028, blockingCeiling: 0.008, blockingBias: 0.011,
    plateCurrentScale: 0.42, plateCathodeCoupling: 0.14, plateAttack: 0.0010, plateRelease: 0.00022, plateCompression: 0.014, plateCompressionCeiling: 0.045,
    localSagBase: 0.003, localSagDynamics: 0.010, localSagCathode: 0.004, localSagSupply: 0.38, localSagCeiling: 0.055,
    harmonicDrive: 0.07, evenHarmonic: 0.010, plateFollowBase: 0.91, plateFollowMemory: 0.05,
  },
  // Bugle Boy: animated midrange, moderate asymmetry and dynamic harmonic lift.
  {
    mu: 101, supply: 300, plateLoad: 101000, bias: -1.50,
    gain: 1.10, softness: 1.12, biasMemory: 0.68, recovery: 0.70, sag: 0.60, plateMemory: 0.58, characterRange: 0.082,
    cathode: 0.66, blocking: 0.56, gridHeadroom: 0.78, thermal: 0.60, mismatch: 0.0026,
    supplyStiffness: 0.56, sagAttack: 0.61, colorBase: 0.12, colorDrive: 0.34, colorHeat: 0.075, colorCharacter: 0.13, colorCeiling: 0.62,
    biasAttack: 0.0064, biasAttackHeat: 0.0044, biasRelease: 0.00038, biasReleaseDynamics: 0.00086, biasReleaseRecovery: 0.00023,
    staticBias: 0.004, heatCurve: 0.09, driveCurve: 0.15,
    cathodeDrive: 0.62, cathodeDriveMod: 0.58, cathodeAttack: 0.00105, cathodeHeatAttack: 0.00066, cathodeRelease: 0.00009, cathodeRecovery: 0.000055,
    cathodeBiasBase: 0.0035, cathodeBiasDynamics: 0.0065, blockingAttack: 0.018, blockingRelease: 0.00039, blockingRecovery: 0.00016, blockingCeiling: 0.018, blockingBias: 0.020,
    plateCurrentScale: 0.62, plateCathodeCoupling: 0.32, plateAttack: 0.0017, plateRelease: 0.00012, plateCompression: 0.034, plateCompressionCeiling: 0.095,
    localSagBase: 0.006, localSagDynamics: 0.022, localSagCathode: 0.010, localSagSupply: 0.68, localSagCeiling: 0.105,
    harmonicDrive: 0.16, evenHarmonic: 0.050, plateFollowBase: 0.82, plateFollowMemory: 0.10,
  },
  // RCA black plate: low-headroom, thick bias movement, strong sag and the slowest recovery.
  {
    mu: 92, supply: 270, plateLoad: 120000, bias: -1.72,
    gain: 1.16, softness: 1.34, biasMemory: 1.00, recovery: 0.34, sag: 1.14, plateMemory: 0.94, characterRange: 0.110,
    cathode: 1.00, blocking: 1.00, gridHeadroom: 0.54, thermal: 1.00, mismatch: 0.0044,
    supplyStiffness: 0.18, sagAttack: 1.00, colorBase: 0.16, colorDrive: 0.44, colorHeat: 0.13, colorCharacter: 0.10, colorCeiling: 0.76,
    biasAttack: 0.0085, biasAttackHeat: 0.0065, biasRelease: 0.00018, biasReleaseDynamics: 0.00135, biasReleaseRecovery: 0.00008,
    staticBias: -0.010, heatCurve: 0.15, driveCurve: 0.24,
    cathodeDrive: 0.88, cathodeDriveMod: 0.88, cathodeAttack: 0.0018, cathodeHeatAttack: 0.00125, cathodeRelease: 0.000040, cathodeRecovery: 0.000025,
    cathodeBiasBase: 0.0058, cathodeBiasDynamics: 0.0105, blockingAttack: 0.032, blockingRelease: 0.00020, blockingRecovery: 0.00007, blockingCeiling: 0.032, blockingBias: 0.030,
    plateCurrentScale: 0.84, plateCathodeCoupling: 0.55, plateAttack: 0.0025, plateRelease: 0.000065, plateCompression: 0.060, plateCompressionCeiling: 0.17,
    localSagBase: 0.010, localSagDynamics: 0.038, localSagCathode: 0.017, localSagSupply: 1.00, localSagCeiling: 0.16,
    harmonicDrive: 0.22, evenHarmonic: 0.095, plateFollowBase: 0.70, plateFollowMemory: 0.17,
  },
];

registerProcessor('calcotone-ember-tube-processor', CalcotoneEmberTubeProcessor);