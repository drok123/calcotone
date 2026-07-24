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
    this.outputMemoryL = 0;
    this.outputMemoryR = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'quality') {
        this.quality = Math.max(1, Math.min(4, event.data.factor | 0));
      }
    };
  }

  processChannel(input, modelIndex, drive, heat, character, dynamics, channel) {
    if (modelIndex <= 0) return input;

    const profile = TUBE_PROFILES[modelIndex - 1];
    const isLeft = channel === 0;
    let previousInput = isLeft ? this.previousInputL : this.previousInputR;
    let biasMemory = isLeft ? this.biasMemoryL : this.biasMemoryR;
    let outputMemory = isLeft ? this.outputMemoryL : this.outputMemoryR;

    // Small-signal preamp philosophy: Drive changes how hard the virtual triode is
    // biased and excited, but the tube contributes a nonlinear residual instead of
    // replacing the entire waveform with a waveshaped one.
    const inputGain = 0.92 + Math.pow(drive, 1.55) * (0.48 + profile.gain * 0.18);
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

      const dynamicBias = biasMemory * biasAmount;
      const bias = characterBias - dynamicBias;
      const stageInput = interpolated * inputGain;
      const zero = Math.tanh(bias * curve);
      const localSlope = Math.max(0.42, inputGain * curve * (1 - zero * zero));
      let shaped = (Math.tanh((stageInput + bias) * curve) - zero) / localSlope;

      // Bias memory and cathode/plate sag should round transients a little, not pump.
      shaped *= 1 - Math.min(0.085, biasMemory * sagAmount);

      // Blend only the nonlinear residual back onto the original signal. This keeps
      // the named tubes in rack-preamp territory instead of distortion-pedal territory.
      const colored = interpolated + (shaped - interpolated) * colorMix;

      const plateFollow = 0.82 + profile.plateMemory * 0.10;
      outputMemory += (colored - outputMemory) * plateFollow;
      accumulated += outputMemory;
    }

    if (isLeft) {
      this.previousInputL = input;
      this.biasMemoryL = biasMemory;
      this.outputMemoryL = outputMemory;
    } else {
      this.previousInputR = input;
      this.biasMemoryR = biasMemory;
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

    for (let i = 0; i < outL.length; i += 1) {
      let left = inL ? inL[i] : 0;
      let right = inR ? inR[i] : left;
      if (!Number.isFinite(left) || Math.abs(left) < 1e-20) left = 0;
      if (!Number.isFinite(right) || Math.abs(right) < 1e-20) right = 0;

      if (modelIndex > 0) {
        left = this.processChannel(left, modelIndex, drive, heat, character, dynamics, 0);
        right = this.processChannel(right, modelIndex, drive, heat, character, dynamics, 1);
      } else {
        this.previousInputL = left;
        this.previousInputR = right;
        this.biasMemoryL *= 0.995;
        this.biasMemoryR *= 0.995;
        this.outputMemoryL = left;
        this.outputMemoryR = right;
      }

      outL[i] = Math.max(-1.2, Math.min(1.2, left));
      outR[i] = Math.max(-1.2, Math.min(1.2, right));
    }
    return true;
  }
}

// The model deltas are intentionally conservative. These are operating-profile studies
// within the ECC83 / 12AX7 family, not claims that every NOS specimen of a named tube is
// identical. Supply/load metadata is retained because future hardware recreations can use
// the same component model inside a larger preamp circuit instead of inventing new tube DSP.
const TUBE_PROFILES = [
  { // Genalex Gold Lion B759 / ECC83
    mu: 100, supply: 300, plateLoad: 100000, bias: -1.50,
    gain: 1.04, softness: 1.08, biasMemory: 0.62, recovery: 0.76, sag: 0.58, plateMemory: 0.58, characterRange: 0.055,
  },
  { // Mullard ECC83
    mu: 100, supply: 295, plateLoad: 100000, bias: -1.55,
    gain: 1.02, softness: 1.12, biasMemory: 0.74, recovery: 0.64, sag: 0.72, plateMemory: 0.66, characterRange: 0.065,
  },
  { // Telefunken ECC83 smooth plate
    mu: 100, supply: 305, plateLoad: 100000, bias: -1.48,
    gain: 1.00, softness: 1.04, biasMemory: 0.50, recovery: 0.86, sag: 0.46, plateMemory: 0.48, characterRange: 0.045,
  },
  { // Amperex Bugle Boy ECC83
    mu: 100, supply: 300, plateLoad: 100000, bias: -1.52,
    gain: 1.03, softness: 1.10, biasMemory: 0.64, recovery: 0.72, sag: 0.62, plateMemory: 0.56, characterRange: 0.060,
  },
  { // RCA 12AX7 black plate
    mu: 100, supply: 290, plateLoad: 100000, bias: -1.58,
    gain: 1.06, softness: 1.15, biasMemory: 0.80, recovery: 0.58, sag: 0.80, plateMemory: 0.72, characterRange: 0.070,
  },
];

registerProcessor('calcotone-ember-tube-processor', CalcotoneEmberTubeProcessor);
