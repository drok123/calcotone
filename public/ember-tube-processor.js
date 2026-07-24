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
    this.tables = TUBE_PROFILES.map((profile) => buildTriodeTable(profile));
    this.port.onmessage = (event) => {
      if (event.data?.type === 'quality') {
        this.quality = Math.max(1, Math.min(4, event.data.factor | 0));
      }
    };
  }

  lookup(table, value) {
    const x = Math.max(-1, Math.min(1, value));
    const position = (x * 0.5 + 0.5) * (table.length - 1);
    const base = Math.floor(position);
    const fraction = position - base;
    const next = Math.min(table.length - 1, base + 1);
    return table[base] + (table[next] - table[base]) * fraction;
  }

  processChannel(input, modelIndex, drive, heat, character, dynamics, channel) {
    if (modelIndex <= 0) return input;
    const profile = TUBE_PROFILES[modelIndex - 1];
    const table = this.tables[modelIndex - 1];
    const isLeft = channel === 0;
    let previousInput = isLeft ? this.previousInputL : this.previousInputR;
    let biasMemory = isLeft ? this.biasMemoryL : this.biasMemoryR;
    let outputMemory = isLeft ? this.outputMemoryL : this.outputMemoryR;

    const inputGain = 0.50 + Math.pow(drive, 1.28) * (2.45 + profile.gain * 0.65);
    const biasAmount = (0.018 + profile.biasMemory * 0.032) * (0.30 + heat * 0.70) * (0.45 + dynamics * 0.75);
    const attack = 0.010 + heat * 0.012;
    const release = 0.00045 + (1 - dynamics) * 0.00115 + profile.recovery * 0.00035;
    const dynamicCompression = 0.035 + dynamics * 0.15 + profile.sag * 0.07;
    const characterShift = (character - 0.5) * profile.characterRange;
    let accumulated = 0;

    for (let step = 1; step <= this.quality; step += 1) {
      const sub = step / this.quality;
      const interpolated = previousInput + (input - previousInput) * sub;
      const absolute = Math.abs(interpolated);
      const coefficient = absolute > biasMemory ? attack : release;
      biasMemory += (absolute - biasMemory) * coefficient;

      const dynamicBias = biasMemory * biasAmount;
      const normalized = interpolated * inputGain + characterShift - dynamicBias;
      let shaped = this.lookup(table, normalized);

      const compression = 1 / (1 + biasMemory * dynamicCompression * (1 + drive * 1.6));
      shaped *= compression;

      // Slow plate/cathode memory keeps the stage from behaving like a memoryless waveshaper.
      const plateFollow = 0.70 + profile.plateMemory * 0.18;
      outputMemory += (shaped - outputMemory) * plateFollow;
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

// All five small-signal models share the ECC83/12AX7 triode family core. The differences
// below are conservative operating-profile deltas, not claims of measurement-matched NOS units.
// They are deliberately kept close until real specimen captures can calibrate them.
const TUBE_PROFILES = [
  { // Genalex Gold Lion B759 / ECC83
    mu: 100, supply: 300, plateLoad: 100000, bias: -1.50, currentScale: 0.0070, exponent: 1.50,
    gain: 1.04, asymmetry: 0.040, biasMemory: 0.62, recovery: 0.76, sag: 0.58, plateMemory: 0.58, characterRange: 0.055,
  },
  { // Mullard ECC83
    mu: 100, supply: 295, plateLoad: 100000, bias: -1.55, currentScale: 0.0072, exponent: 1.49,
    gain: 1.02, asymmetry: 0.060, biasMemory: 0.74, recovery: 0.64, sag: 0.72, plateMemory: 0.66, characterRange: 0.065,
  },
  { // Telefunken ECC83 smooth plate
    mu: 100, supply: 305, plateLoad: 100000, bias: -1.48, currentScale: 0.0068, exponent: 1.52,
    gain: 1.00, asymmetry: 0.030, biasMemory: 0.50, recovery: 0.86, sag: 0.46, plateMemory: 0.48, characterRange: 0.045,
  },
  { // Amperex Bugle Boy ECC83
    mu: 100, supply: 300, plateLoad: 100000, bias: -1.52, currentScale: 0.0071, exponent: 1.50,
    gain: 1.03, asymmetry: 0.050, biasMemory: 0.64, recovery: 0.72, sag: 0.62, plateMemory: 0.56, characterRange: 0.060,
  },
  { // RCA 12AX7 black plate
    mu: 100, supply: 290, plateLoad: 100000, bias: -1.58, currentScale: 0.0073, exponent: 1.48,
    gain: 1.06, asymmetry: 0.072, biasMemory: 0.80, recovery: 0.58, sag: 0.80, plateMemory: 0.72, characterRange: 0.070,
  },
];

function buildTriodeTable(profile) {
  const size = 4096;
  const table = new Float32Array(size);
  const centerPlate = solvePlateVoltage(profile, profile.bias);
  const lowPlate = solvePlateVoltage(profile, profile.bias - 1.8);
  const highPlate = solvePlateVoltage(profile, profile.bias + 1.2);
  const negativeSwing = Math.max(1, lowPlate - centerPlate);
  const positiveSwing = Math.max(1, centerPlate - highPlate);

  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    const gridSwing = x < 0 ? x * 1.8 : x * 1.2;
    const plate = solvePlateVoltage(profile, profile.bias + gridSwing);
    let y = plate >= centerPlate
      ? -(plate - centerPlate) / negativeSwing
      : (centerPlate - plate) / positiveSwing;

    // Mild grid-conduction softening and profile asymmetry near positive grid excursion.
    if (x > 0) y *= 1 - Math.pow(x, 2.2) * (0.08 + profile.asymmetry);
    y += Math.max(0, y) * profile.asymmetry * 0.14;
    table[i] = Math.max(-1, Math.min(1, y));
  }

  // DC-center each transfer so a changing model cannot inject a step into the graph.
  const midpoint = table[(size - 1) >> 1];
  for (let i = 0; i < size; i += 1) table[i] = Math.max(-1, Math.min(1, table[i] - midpoint));
  return table;
}

function solvePlateVoltage(profile, gridVoltage) {
  let plate = profile.supply * 0.60;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const effective = Math.max(0, gridVoltage + plate / profile.mu);
    const current = profile.currentScale * Math.pow(effective, profile.exponent);
    const targetPlate = Math.max(35, Math.min(profile.supply, profile.supply - current * profile.plateLoad));
    plate += (targetPlate - plate) * 0.46;
  }
  return plate;
}

registerProcessor('calcotone-ember-tube-processor', CalcotoneEmberTubeProcessor);
