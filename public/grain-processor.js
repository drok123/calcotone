const GRAIN_TANH_MIN = -8;
const GRAIN_TANH_MAX = 8;
const GRAIN_TANH_LUT = new Float32Array(4096);
const GRAIN_TANH_SCALE = (GRAIN_TANH_LUT.length - 1) / (GRAIN_TANH_MAX - GRAIN_TANH_MIN);
for (let index = 0; index < GRAIN_TANH_LUT.length; index += 1) {
  const x = GRAIN_TANH_MIN + index / GRAIN_TANH_SCALE;
  GRAIN_TANH_LUT[index] = Math.tanh(x);
}
const GRAIN_OUTPUT_TANH_NORM = 1 / Math.tanh(1.02);

function grainHermite(y0, y1, y2, y3, mu) {
  const mu2 = mu * mu;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
}

function grainTanh(value) {
  if (value <= GRAIN_TANH_MIN) return -1;
  if (value >= GRAIN_TANH_MAX) return 1;
  const position = (value - GRAIN_TANH_MIN) * GRAIN_TANH_SCALE;
  const index = Math.floor(position);
  const mu = position - index;
  const last = GRAIN_TANH_LUT.length - 1;
  const i0 = index > 0 ? index - 1 : 0;
  const i2 = index < last ? index + 1 : last;
  const i3 = index + 2 < last ? index + 2 : last;
  return grainHermite(GRAIN_TANH_LUT[i0], GRAIN_TANH_LUT[index], GRAIN_TANH_LUT[i2], GRAIN_TANH_LUT[i3], mu);
}

const GRAIN_DRY_ANCHORS = [0.38, 0.24, 0.16, 0.28, 0.18, 0.10, 0.14, 0.18, 0.22, 0.16, 0.20, 0.18];
const GRAIN_WET_GAINS = [1.18, 1.30, 1.32, 1.20, 1, 1, 1.18, 1.12, 1.17, 1.16, 1.22, 1.18];
const SLICE_INTERVALS = [0, 0, 2, -2, 5, -5, 7, -7, 12, -12];
const PRISM_INTERVAL_SETS = [
  [0, 0, 7, -5],
  [0, 4, 7, -12],
  [0, 3, 7, 12],
  [0, 5, 7, 12, -12],
  [0, 7, 12, 19, -12],
];
const BEADS_CLOCK_STEPS = [3, 4, 6, 8, 10, 12, 14, 16];
const MORPHAGENE_INTERVALS = [0, 0, 7, -5, 12, -12, 19, -19];
const MICROCOSM_DIVISIONS = [32, 24, 16, 12, 8, 6, 4, 2];
const MICROCOSM_PATTERN = [0, 1, 3, 2, 5, 3, 7, 4];
const MICROCOSM_INTERVAL_SETS = [[0], [0, 7], [0, 7, 12], [0, 5, 7, 12], [0, 7, 12, 19]];

class CalcotoneGrainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 2, minValue: 0, maxValue: 11, automationRate: 'k-rate' },
      // "bits" is the compatibility id for the old faceplate control. It now
      // controls the analysis/window scale and never quantizes the signal.
      { name: 'bits', defaultValue: 13, minValue: 4, maxValue: 16, automationRate: 'k-rate' },
      { name: 'density', defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 0.38, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'chaos', defaultValue: 0.16, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bloom', defaultValue: 0.36, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(32768, 1 << Math.ceil(Math.log2(sampleRate * 4)));
    this.mask = this.bufferSize - 1;
    this.left = new Float32Array(this.bufferSize);
    this.right = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.writtenSamples = 0;

    this.maxVoices = 6;
    this.effectiveVoiceLimit = 6;
    this.voices = Array.from({ length: 8 }, () => ({
      active: false,
      phase: 0,
      length: 0,
      read: 0,
      step: 1,
      gain: 0,
      pan: 0,
      panDrift: 0,
      tone: 0,
      lastL: 0,
      lastR: 0,
    }));
    this.spawnCounter = 0;
    this.spawnSequence = 0;
    this.randomState = 0x6d2b79f5;

    this.smoothedDensity = 0.42;
    this.smoothedPitch = 0.38;
    this.smoothedMotion = 0.16;
    this.smoothedMemory = 0.36;
    this.outputL = 0;
    this.outputR = 0;
    this.smearL = 0;
    this.smearR = 0;
    this.hardwareL = 0;
    this.hardwareR = 0;
    this.hardwareAuxL = 0;
    this.hardwareAuxR = 0;
    this.hardwareResult = [0, 0];
    this.inputEnvelope = 0;
    this.previousEnvelope = 0;
    this.inputEnergy = 1e-5;
    this.wetEnergy = 1e-5;
    this.makeupGain = 1;

    this.previousMode = -1;
    this.sliceStart = 0;
    this.sliceLength = 2048;
    this.slicePhase = 0;
    this.sliceStep = 1;
    this.sliceRefreshCounter = 0;
    this.sliceReady = false;
    this.freezeStart = 0;
    this.freezeLength = 8192;
    this.freezePhase = 0;
    this.freezeStep = 1;
    this.freezeRefreshCounter = 0;
    this.freezeReady = false;
    this.specialResult = [0, 0];
    this.voiceResult = [0, 0, 0];

    this.profileBlocks = 0;
    this.profileTotalMs = 0;
    this.profileTotalSquaredMs = 0;
    this.profileWorstMs = 0;
    this.profileOverruns = 0;
    this.profileDroppedSpawns = 0;
    this.guardStressBlocks = 0;
    this.guardRecoveryBlocks = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'quality') {
        this.maxVoices = Math.max(1, Math.min(8, data.maxVoices | 0));
        this.effectiveVoiceLimit = Math.min(this.effectiveVoiceLimit, this.maxVoices);
        if (this.effectiveVoiceLimit < 2) this.effectiveVoiceLimit = Math.min(2, this.maxVoices);
      }
    };
  }

  random() {
    let x = this.randomState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x | 0;
    return (x >>> 0) / 4294967296;
  }

  interpolate(buffer, position) {
    const base = Math.floor(position);
    const fraction = position - base;
    const xm1 = buffer[(base - 1) & this.mask];
    const x0 = buffer[base & this.mask];
    const x1 = buffer[(base + 1) & this.mask];
    const x2 = buffer[(base + 2) & this.mask];
    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * fraction + c2) * fraction + c1) * fraction + c0;
  }

  wrap(position) {
    while (position < 0) position += this.bufferSize;
    while (position >= this.bufferSize) position -= this.bufferSize;
    return position;
  }

  semitoneStep(semitones) {
    return Math.pow(2, semitones / 12);
  }

  resetModeState(mode, window, density, pitch, motion) {
    if (this.previousMode === mode) return;
    this.previousMode = mode;
    this.spawnCounter = 0;
    this.hardwareL = 0;
    this.hardwareR = 0;
    this.hardwareAuxL = 0;
    this.hardwareAuxR = 0;
    for (let index = 0; index < this.voices.length; index += 1) {
      this.voices[index].active = false;
    }
    if (mode === 4) {
      this.sliceReady = false;
      this.sliceReady = this.captureSlice(window, density, pitch, motion);
    }
    if (mode === 5) {
      this.freezeReady = false;
      this.freezeReady = this.captureFreeze(window, density, pitch);
    }
  }

  captureSlice(window, density, pitch, motion) {
    const milliseconds = 24 + window * 210 + (1 - density) * 72;
    const desiredLength = Math.max(128, Math.floor(sampleRate * milliseconds / 1000));
    const available = Math.min(this.writtenSamples, this.bufferSize - 1);
    if (available < 256) return false;
    const desiredHistory = Math.floor(sampleRate * (0.025 + motion * 0.24));
    const history = Math.min(desiredHistory, Math.max(0, available - 128));
    this.sliceLength = Math.max(128, Math.min(desiredLength, available - history));
    this.sliceStart = (this.writeIndex - history - this.sliceLength + this.bufferSize) & this.mask;
    const range = Math.max(2, Math.min(SLICE_INTERVALS.length, 2 + Math.floor(pitch * (SLICE_INTERVALS.length - 2))));
    const semitones = SLICE_INTERVALS[this.spawnSequence % range];
    this.sliceStep = this.semitoneStep(semitones);
    this.slicePhase = 0;
    this.sliceRefreshCounter = 0;
    this.spawnSequence += 1;
    return true;
  }

  processSlice(window, density, pitch, motion, memory) {
    const repeats = 2 + Math.floor(memory * 14);
    const refreshAt = this.sliceLength * repeats;
    if (this.sliceRefreshCounter >= refreshAt) this.sliceReady = this.captureSlice(window, density, pitch, motion);
    const phase = this.slicePhase % this.sliceLength;
    const tightness = 0.48 + (1 - density) * 0.86;
    const edge = Math.max(16, Math.min(this.sliceLength * 0.16 * tightness, sampleRate * 0.008 * tightness));
    const fadeIn = Math.min(1, phase / edge);
    const fadeOut = Math.min(1, (this.sliceLength - phase) / edge);
    const envelope = Math.sin(Math.min(fadeIn, fadeOut) * Math.PI * 0.5);
    const read = this.wrap(this.sliceStart + phase);
    this.specialResult[0] = this.interpolate(this.left, read) * envelope;
    this.specialResult[1] = this.interpolate(this.right, read) * envelope;
    this.slicePhase += this.sliceStep;
    if (this.slicePhase >= this.sliceLength) this.slicePhase -= this.sliceLength;
    this.sliceRefreshCounter += 1;
    return this.specialResult;
  }

  captureFreeze(window, density, pitch) {
    const milliseconds = 120 + window * 640 + (1 - density) * 240;
    const desiredLength = Math.max(512, Math.floor(sampleRate * milliseconds / 1000));
    const available = Math.min(this.writtenSamples, this.bufferSize - 1);
    // Freeze waits until its full requested window exists. Capturing a tiny
    // startup fragment would make Capture/Texture appear inert for the entire
    // first hold cycle.
    if (available < desiredLength + 96) return false;
    this.freezeLength = desiredLength;
    this.freezeStart = (this.writeIndex - this.freezeLength - 96 + this.bufferSize) & this.mask;
    const semitones = pitch <= 0.005 ? 0 : (this.spawnSequence % 2 === 0 ? 1 : -1) * Math.round(pitch * 12);
    this.freezeStep = this.semitoneStep(semitones);
    this.freezePhase = 0;
    this.freezeRefreshCounter = 0;
    this.spawnSequence += 1;
    return true;
  }

  processFreeze(window, density, pitch, motion, memory, transient) {
    const holdSeconds = 1.4 + memory * 10;
    const refreshSamples = Math.floor(sampleRate * holdSeconds);
    const mayRefresh = this.freezeRefreshCounter >= refreshSamples
      && (transient > 0.004 + (1 - motion) * 0.012 || this.freezeRefreshCounter > refreshSamples * 2.5);
    if (mayRefresh) this.freezeReady = this.captureFreeze(window, density, pitch);

    const phase = this.freezePhase % this.freezeLength;
    const crossfade = Math.max(64, Math.min(this.freezeLength * (0.10 + density * 0.15), sampleRate * (0.018 + density * 0.018)));
    // Refresh also adds a tiny pre-refresh scan so the control has an audible,
    // subtle response before the next transient is eligible to replace the hold.
    const textureOffset = Math.sin(phase * (0.002 + density * 0.009)) * density * 3.5
      + Math.sin(phase * (0.0007 + motion * 0.0012)) * motion * 1.1;
    const readA = this.wrap(this.freezeStart + phase + textureOffset);
    let left = this.interpolate(this.left, readA);
    let right = this.interpolate(this.right, readA);
    if (phase > this.freezeLength - crossfade) {
      const amount = (phase - (this.freezeLength - crossfade)) / crossfade;
      const readB = this.wrap(this.freezeStart + phase - this.freezeLength);
      const curve = amount * amount * (3 - 2 * amount);
      left += (this.interpolate(this.left, readB) - left) * curve;
      right += (this.interpolate(this.right, readB) - right) * curve;
    }
    this.freezePhase += this.freezeStep;
    if (this.freezePhase >= this.freezeLength) this.freezePhase -= this.freezeLength;
    this.freezeRefreshCounter += 1;
    this.specialResult[0] = left;
    this.specialResult[1] = right;
    return this.specialResult;
  }

  spawnGranularVoice(mode, window, density, pitch, motion, memory) {
    let voice = null;
    for (let index = 0; index < this.effectiveVoiceLimit; index += 1) {
      if (!this.voices[index].active) {
        voice = this.voices[index];
        break;
      }
    }
    if (!voice) return false;

    let grainMs = 42 + window * 120;
    let historySeconds = 0.035 + this.random() * (0.14 + motion * 0.28);
    let semitones = 0;
    let reverseChance = motion * 0.08;
    let pan = (this.random() * 2 - 1) * (0.24 + density * 0.42);
    let panDrift = (this.random() * 2 - 1) * motion * 0.14;
    let gain = 0.48 + density * 0.18;
    let tone = 0.34 + this.random() * 0.44;

    if (mode === 0) {
      // Mosaic: medium fragments are pulled from quantized memory cells so the
      // source remains recognizable while its chronology is rebuilt.
      grainMs = 36 + window * 150 + this.random() * 34;
      const cellSeconds = 0.045 + window * 0.08;
      const cell = 1 + Math.floor(this.random() * (3 + density * 12));
      historySeconds = cellSeconds * cell * (0.52 + memory * 1.1);
      const range = Math.round(pitch * 7);
      semitones = range > 0 ? Math.round((this.random() * 2 - 1) * range) : 0;
      reverseChance = motion * 0.22;
      gain = 0.52 + density * 0.16;
    } else if (mode === 1) {
      // Scatter: short transient fragments leave wide, sparse trajectories.
      grainMs = 18 + window * 66 + this.random() * 22;
      historySeconds = 0.018 + this.random() * (0.06 + memory * 0.52 + motion * 0.22);
      semitones = (this.random() * 2 - 1) * pitch * 9;
      reverseChance = 0.08 + motion * 0.38;
      pan = (this.random() * 2 - 1) * (0.72 + density * 0.26);
      panDrift = (this.random() * 2 - 1) * (0.12 + motion * 0.32);
      gain = 0.58 + density * 0.18;
      tone = 0.42 + this.random() * 0.48;
    } else if (mode === 2) {
      // Smear: long, highly overlapped grains retain stable pitch and feed a
      // continuous memory body instead of turning into random glitch events.
      grainMs = 150 + window * 520 + this.random() * 90;
      historySeconds = 0.10 + this.random() * (0.34 + memory * 1.28 + motion * 0.55);
      semitones = (this.random() * 2 - 1) * pitch * 1.8;
      reverseChance = 0;
      pan *= 0.46;
      panDrift *= 0.55;
      gain = 0.34 + density * 0.12;
      tone = 0.14 + this.random() * 0.24;
    } else if (mode === 3) {
      // Prism: deterministic harmonic voices, not arbitrary pitch scatter.
      grainMs = 58 + window * 120 + memory * 110 + this.random() * 24;
      historySeconds = 0.032 + this.random() * (0.08 + memory * 0.20 + motion * 0.12);
      const set = PRISM_INTERVAL_SETS[Math.min(PRISM_INTERVAL_SETS.length - 1, Math.floor(pitch * PRISM_INTERVAL_SETS.length))];
      semitones = set[this.spawnSequence % set.length] + (this.random() * 2 - 1) * motion * 0.12;
      reverseChance = 0;
      pan = Math.sin(this.spawnSequence * 2.399) * (0.58 + density * 0.36);
      panDrift = 0;
      gain = 0.46 + density * 0.14;
      tone = 0.46 + this.random() * 0.40;
    } else if (mode === 6) {
      // Clouds study: overlapping delayed grains dissolve into a softly
      // diffused stereo body. Position and texture stay continuous.
      grainMs = 32 + window * 760 + this.random() * 110;
      historySeconds = 0.04 + motion * 1.65 + this.random() * (0.10 + motion * 0.72);
      semitones = (this.random() * 2 - 1) * pitch * 24;
      reverseChance = motion * 0.16;
      pan = (this.random() * 2 - 1) * (0.34 + density * 0.52);
      panDrift = (this.random() * 2 - 1) * motion * 0.12;
      gain = 0.30 + density * 0.14;
      tone = 0.16 + (1 - memory) * 0.42 + this.random() * 0.16;
    } else if (mode === 7) {
      // Beads study: a high-fidelity stereo stream with independent random
      // offsets and a density-dependent periodic/random clock.
      grainMs = 30 + window * 1180 + this.random() * motion * 180;
      const clockCell = 0.025 + window * 0.12;
      const clockStep = Math.max(1, Math.floor(this.spawnSequence % (2 + Math.floor(density * 7))));
      historySeconds = clockCell * clockStep + this.random() * motion * 0.48;
      semitones = (this.random() * 2 - 1) * pitch * 24;
      reverseChance = Math.max(0, (window - 0.72) * 1.6) + motion * 0.08;
      pan = Math.sin(this.spawnSequence * 2.399) * (0.62 + density * 0.32);
      panDrift = (this.random() * 2 - 1) * motion * 0.08;
      gain = 0.34 + density * 0.14;
      tone = 0.68 + this.random() * 0.28;
    } else if (mode === 8) {
      // Morphagene study: the recent reel is divided into splices, then Gene
      // Size, Slide, Morph, Vari-Speed and Organize rebuild its chronology.
      grainMs = 40 + window * 940;
      const spliceSeconds = 0.10 + window * 0.34;
      const spliceCount = 2 + Math.floor(memory * 10);
      const organizedSplice = (this.spawnSequence * 5 + Math.floor(motion * 7)) % spliceCount;
      historySeconds = spliceSeconds * (1 + organizedSplice) + (this.random() * 2 - 1) * motion * spliceSeconds;
      const reelRange = Math.max(2, Math.min(MORPHAGENE_INTERVALS.length, 2 + Math.floor(pitch * (MORPHAGENE_INTERVALS.length - 2))));
      semitones = MORPHAGENE_INTERVALS[this.spawnSequence % reelRange];
      reverseChance = motion * 0.34;
      pan = Math.sin(this.spawnSequence * 1.618) * (0.30 + density * 0.46);
      panDrift = (this.random() * 2 - 1) * density * 0.10;
      gain = 0.38 + density * 0.13;
      tone = 0.36 + this.random() * 0.34;
    } else if (mode === 9) {
      // Arbhar study: six circular capture strata are scanned in sequence;
      // Spray moves around each layer and onsets can seed new grain clusters.
      grainMs = 20 + window * 1420 + this.random() * 95;
      const layer = this.spawnSequence % 6;
      const layerSpan = 0.24 + memory * 0.34;
      const layerOffset = layer * layerSpan;
      historySeconds = 0.05 + layerOffset + (this.random() * 2 - 1) * motion * layerSpan;
      semitones = (this.random() * 2 - 1) * pitch * 12;
      reverseChance = 0.05 + motion * 0.45;
      pan = (layer / 5) * 1.8 - 0.9;
      panDrift = (this.random() * 2 - 1) * motion * 0.20;
      gain = 0.31 + density * 0.15;
      tone = 0.42 + this.random() * 0.42;
    } else if (mode === 10) {
      // Particle 2 study: a granular delay line with 15–250 ms chops,
      // bidirectional playback, pitch scatter and feedback-colored repeats.
      grainMs = 15 + window * 235;
      const delaySeconds = 0.055 + window * 0.82;
      historySeconds = delaySeconds + (this.random() * 2 - 1) * motion * delaySeconds * 0.72;
      semitones = (this.random() * 2 - 1) * pitch * 12;
      reverseChance = 0.06 + motion * 0.72;
      pan = (this.random() * 2 - 1) * (0.48 + motion * 0.46);
      panDrift = (this.random() * 2 - 1) * motion * 0.28;
      gain = 0.46 + density * 0.18;
      tone = 0.28 + (1 - memory) * 0.48;
    } else if (mode === 11) {
      // Microcosm study: deterministic subdivision patterns address a bank of
      // micro-loops, creating repeatable cascades instead of random glitch.
      const division = MICROCOSM_DIVISIONS[Math.min(MICROCOSM_DIVISIONS.length - 1, Math.floor(window * MICROCOSM_DIVISIONS.length))];
      const pulseSeconds = 2 / division;
      historySeconds = pulseSeconds * (1 + MICROCOSM_PATTERN[this.spawnSequence % MICROCOSM_PATTERN.length]) * (1 + memory * 0.65);
      grainMs = Math.max(28, pulseSeconds * 1000 * (0.46 + density * 0.78));
      const set = MICROCOSM_INTERVAL_SETS[Math.min(MICROCOSM_INTERVAL_SETS.length - 1, Math.floor(pitch * MICROCOSM_INTERVAL_SETS.length))];
      semitones = set[this.spawnSequence % set.length] * (this.spawnSequence % 6 === 5 ? -1 : 1);
      reverseChance = motion * 0.26;
      pan = Math.sin(this.spawnSequence * Math.PI * 0.5) * (0.38 + density * 0.42);
      panDrift = 0;
      gain = 0.39 + density * 0.14;
      tone = 0.40 + this.random() * 0.38;
    }

    historySeconds = Math.max(0.012, Math.min(3.75, historySeconds));
    const length = Math.max(72, Math.min(this.bufferSize - 256, Math.floor(sampleRate * grainMs / 1000)));
    let step = this.semitoneStep(semitones);
    if (this.random() < reverseChance) step *= -1;
    voice.active = true;
    voice.phase = 0;
    voice.length = length;
    voice.read = (this.writeIndex - Math.floor(sampleRate * historySeconds) + this.bufferSize) & this.mask;
    voice.step = step;
    voice.gain = gain;
    voice.pan = pan;
    voice.panDrift = panDrift;
    voice.tone = tone;
    voice.lastL = 0;
    voice.lastR = 0;
    this.spawnSequence += 1;
    return true;
  }

  renderGranularVoices(mode) {
    let wetL = 0;
    let wetR = 0;
    let active = 0;
    for (let index = 0; index < this.effectiveVoiceLimit; index += 1) {
      const voice = this.voices[index];
      if (!voice.active) continue;
      const normalized = voice.phase / voice.length;
      if (normalized >= 1) {
        voice.active = false;
        continue;
      }
      const sine = Math.sin(normalized * Math.PI);
      const envelope = mode === 2 || mode === 6
        ? Math.sqrt(sine) * sine
        : mode === 8
          ? Math.min(1, sine * 2.4) * Math.sqrt(sine)
          : mode === 9
            ? sine
            : sine * sine;
      let sampleL = this.interpolate(this.left, voice.read);
      let sampleR = this.interpolate(this.right, voice.read);
      const toneCoefficient = mode === 2 || mode === 6
        ? 0.08 + voice.tone * 0.26
        : mode === 8
          ? 0.16 + voice.tone * 0.38
          : mode === 10
            ? 0.12 + voice.tone * 0.42
            : 0.24 + voice.tone * 0.62;
      voice.lastL += (sampleL - voice.lastL) * toneCoefficient;
      voice.lastR += (sampleR - voice.lastR) * toneCoefficient;
      sampleL = voice.lastL;
      sampleR = voice.lastR;
      const movingPan = Math.max(-1, Math.min(1, voice.pan + Math.sin(normalized * Math.PI * 2) * voice.panDrift));
      const leftGain = Math.sqrt((1 - movingPan) * 0.5);
      const rightGain = Math.sqrt((1 + movingPan) * 0.5);
      const gain = envelope * voice.gain;
      wetL += (sampleL * 0.90 + sampleR * 0.10) * gain * leftGain;
      wetR += (sampleR * 0.90 + sampleL * 0.10) * gain * rightGain;
      voice.read = this.wrap(voice.read + voice.step);
      voice.phase += 1;
      active += 1;
    }
    this.voiceResult[0] = wetL;
    this.voiceResult[1] = wetR;
    this.voiceResult[2] = active;
    return this.voiceResult;
  }

  spawnRateForMode(mode, density, window) {
    switch (mode) {
      case 0: return 18 + density * 62;
      case 1: return 6 + density * 48;
      case 2: return 10 + density * 36;
      case 3: return 16 + density * 54;
      case 6: return 4 + density * 14;
      case 7: return BEADS_CLOCK_STEPS[Math.min(BEADS_CLOCK_STEPS.length - 1, Math.floor(density * BEADS_CLOCK_STEPS.length))];
      case 8: return 3 + density * 12;
      case 9: return 4 + density * 15;
      case 10: return 5 + density * 24;
      case 11: return 3 + density * 15 + (1 - window) * 4;
      default: return 12;
    }
  }

  feedbackForMode(mode, memory) {
    switch (mode) {
      case 2: return memory * 0.24;
      case 6: return memory * 0.30;
      case 7: return memory * 0.12;
      case 8: return memory * 0.18;
      case 9: return memory * 0.20;
      case 10: return memory * 0.48;
      case 11: return memory * 0.34;
      default: return 0;
    }
  }

  transientAllowsSpawn(mode, transient, density, motion) {
    if (mode === 1) {
      return transient > 0.0018 + (1 - density) * 0.004 || this.random() < 0.05 + motion * 0.10;
    }
    if (mode === 9) {
      return transient > 0.0012 + (1 - density) * 0.003 || this.random() < 0.10 + motion * 0.18;
    }
    return true;
  }

  applyHardwareCharacter(mode, left, right, window, density, motion, memory) {
    let outputL = left;
    let outputR = right;
    if (mode === 6) {
      // Clouds: soft diffusion and cross-channel accumulation after the grain cloud.
      const coefficient = 0.018 + (1 - window) * 0.065;
      this.hardwareL += (left - this.hardwareL) * coefficient;
      this.hardwareR += (right - this.hardwareR) * coefficient;
      this.hardwareAuxL += (this.hardwareR - this.hardwareAuxL) * (0.012 + memory * 0.024);
      this.hardwareAuxR += (this.hardwareL - this.hardwareAuxR) * (0.012 + memory * 0.024);
      outputL = this.hardwareL * 0.84 + this.hardwareAuxL * (0.10 + memory * 0.18);
      outputR = this.hardwareR * 0.84 + this.hardwareAuxR * (0.10 + memory * 0.18);
    } else if (mode === 7) {
      // Beads: preserve the direct detail and add a small decorrelated stereo edge.
      const coefficient = 0.42 + (1 - window) * 0.34;
      this.hardwareL += (left - this.hardwareL) * coefficient;
      this.hardwareR += (right - this.hardwareR) * coefficient;
      const detailL = left - this.hardwareL;
      const detailR = right - this.hardwareR;
      outputL = left * 0.94 + detailL * (0.10 + motion * 0.12) + detailR * density * 0.04;
      outputR = right * 0.94 + detailR * (0.10 + motion * 0.12) + detailL * density * 0.04;
    } else if (mode === 8) {
      // Morphagene: modest reel bandwidth and compaction accumulate with Organize.
      const coefficient = 0.18 + (1 - window) * 0.28;
      this.hardwareL += (left - this.hardwareL) * coefficient;
      this.hardwareR += (right - this.hardwareR) * coefficient;
      const reelDrive = 1.02 + memory * 0.34;
      const reelNormalization = 1 / Math.max(1e-6, grainTanh(reelDrive));
      outputL = grainTanh(this.hardwareL * reelDrive) * reelNormalization;
      outputR = grainTanh(this.hardwareR * reelDrive) * reelNormalization;
    } else if (mode === 9) {
      // Arbhar: six strata read as a wide bed with a restrained feedback-delay halo.
      this.hardwareL += (left - this.hardwareL) * (0.20 + density * 0.16);
      this.hardwareR += (right - this.hardwareR) * (0.20 + density * 0.16);
      this.hardwareAuxL += (this.hardwareR - this.hardwareAuxL) * (0.026 + memory * 0.032);
      this.hardwareAuxR += (this.hardwareL - this.hardwareAuxR) * (0.026 + memory * 0.032);
      outputL = this.hardwareL * 0.88 + this.hardwareAuxL * (0.08 + motion * 0.12);
      outputR = this.hardwareR * 0.88 + this.hardwareAuxR * (0.08 + motion * 0.12);
    } else if (mode === 10) {
      // Particle 2: darken successive granular-delay repeats as feedback rises.
      const coefficient = 0.14 + (1 - memory) * 0.46;
      this.hardwareL += (left - this.hardwareL) * coefficient;
      this.hardwareR += (right - this.hardwareR) * coefficient;
      outputL = left * 0.38 + this.hardwareL * 0.72;
      outputR = right * 0.38 + this.hardwareR * 0.72;
    } else if (mode === 11) {
      // Microcosm: two gentle integration stages bind the subdivision taps
      // into a repeating micro-loop cascade.
      const first = 0.24 + (1 - window) * 0.20;
      const second = 0.08 + (1 - memory) * 0.14;
      this.hardwareL += (left - this.hardwareL) * first;
      this.hardwareR += (right - this.hardwareR) * first;
      this.hardwareAuxL += (this.hardwareL - this.hardwareAuxL) * second;
      this.hardwareAuxR += (this.hardwareR - this.hardwareAuxR) * second;
      outputL = left * 0.28 + this.hardwareL * 0.46 + this.hardwareAuxL * (0.34 + memory * 0.12);
      outputR = right * 0.28 + this.hardwareR * 0.46 + this.hardwareAuxR * (0.34 + memory * 0.12);
    }
    this.hardwareResult[0] = outputL;
    this.hardwareResult[1] = outputR;
    return this.hardwareResult;
  }

  updateEmergencyGuard(callbackMs, callbackBudgetMs) {
    const load = callbackBudgetMs > 0 ? callbackMs / callbackBudgetMs : 0;
    const stressed = load > 0.72;
    const relaxed = load < 0.34;
    this.guardStressBlocks = stressed ? this.guardStressBlocks + 1 : 0;
    this.guardRecoveryBlocks = relaxed ? this.guardRecoveryBlocks + 1 : 0;
    if (this.guardStressBlocks >= 2 && this.effectiveVoiceLimit > 2) {
      this.effectiveVoiceLimit -= 1;
      this.guardStressBlocks = 0;
      this.guardRecoveryBlocks = 0;
    } else if (this.guardRecoveryBlocks >= 220 && this.effectiveVoiceLimit < this.maxVoices) {
      this.effectiveVoiceLimit += 1;
      this.guardRecoveryBlocks = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];
    const mode = Math.max(0, Math.min(11, Math.round(parameters.mode[0])));
    const window = Math.max(0, Math.min(1, (parameters.bits[0] - 4) / 12));
    const targetDensity = Math.max(0, Math.min(1, parameters.density[0]));
    const targetPitch = Math.max(0, Math.min(1, parameters.pitch[0]));
    const targetMotion = Math.max(0, Math.min(1, parameters.chaos[0]));
    const targetMemory = Math.max(0, Math.min(1, parameters.bloom[0]));
    this.smoothedDensity += (targetDensity - this.smoothedDensity) * 0.08;
    this.smoothedPitch += (targetPitch - this.smoothedPitch) * 0.06;
    this.smoothedMotion += (targetMotion - this.smoothedMotion) * 0.06;
    this.smoothedMemory += (targetMemory - this.smoothedMemory) * 0.06;
    const density = this.smoothedDensity;
    const pitch = this.smoothedPitch;
    const motion = this.smoothedMotion;
    const memory = this.smoothedMemory;
    this.resetModeState(mode, window, density, pitch, motion);

    const spawnRate = this.spawnRateForMode(mode, density, window);
    const spawnInterval = Math.max(24, Math.floor(sampleRate / spawnRate));

    for (let sample = 0; sample < outL.length; sample += 1) {
      let dryL = inL ? inL[sample] : 0;
      let dryR = inR ? inR[sample] : dryL;
      if (!Number.isFinite(dryL) || Math.abs(dryL) < 1e-20) dryL = 0;
      if (!Number.isFinite(dryR) || Math.abs(dryR) < 1e-20) dryR = 0;

      const peak = Math.max(Math.abs(dryL), Math.abs(dryR));
      this.previousEnvelope = this.inputEnvelope;
      this.inputEnvelope += (peak - this.inputEnvelope) * (peak > this.inputEnvelope ? 0.075 : 0.0018);
      const transient = Math.max(0, this.inputEnvelope - this.previousEnvelope);
      const feedback = this.feedbackForMode(mode, memory);
      this.left[this.writeIndex] = Math.max(-1.2, Math.min(1.2, dryL + this.outputL * feedback));
      this.right[this.writeIndex] = Math.max(-1.2, Math.min(1.2, dryR + this.outputR * feedback));
      this.writtenSamples = Math.min(this.bufferSize - 1, this.writtenSamples + 1);

      let processedL = 0;
      let processedR = 0;
      if (mode === 4) {
        if (!this.sliceReady) this.sliceReady = this.captureSlice(window, density, pitch, motion);
        if (this.sliceReady) {
          const slice = this.processSlice(window, density, pitch, motion, memory);
          const anchor = 0.18 + (1 - memory) * 0.14;
          processedL = dryL * anchor + slice[0] * 1.02;
          processedR = dryR * anchor + slice[1] * 1.02;
        } else {
          processedL = dryL;
          processedR = dryR;
        }
      } else if (mode === 5) {
        if (!this.freezeReady) this.freezeReady = this.captureFreeze(window, density, pitch);
        if (this.freezeReady) {
          const freeze = this.processFreeze(window, density, pitch, motion, memory, transient);
          const anchor = 0.10 + (1 - memory) * 0.18;
          processedL = dryL * anchor + freeze[0] * (0.90 + memory * 0.18);
          processedR = dryR * anchor + freeze[1] * (0.90 + memory * 0.18);
        } else {
          processedL = dryL;
          processedR = dryR;
        }
      } else {
        this.spawnCounter -= 1;
        if (this.spawnCounter <= 0) {
          const transientReady = this.transientAllowsSpawn(mode, transient, density, motion);
          const spawned = transientReady && this.spawnGranularVoice(mode, window, density, pitch, motion, memory);
          const intervalVariation = mode === 11
            ? (this.spawnSequence % 4 === 0 ? -0.28 : this.spawnSequence % 4 === 3 ? 0.22 : 0)
            : (this.random() - 0.5) * motion;
          this.spawnCounter = spawned
            ? Math.max(16, spawnInterval + ((intervalVariation * spawnInterval) | 0))
            : Math.max(24, Math.floor(spawnInterval * 0.35));
          if (transientReady && !spawned) this.profileDroppedSpawns += 1;
        }
        const rendered = this.renderGranularVoices(mode);
        const active = rendered[2];
        const normalization = active > 1 ? 1 / Math.sqrt(0.72 + active * 0.38) : 1;
        const cohesion = mode === 0 ? memory : 0;
        const body = mode === 3 ? memory : 0;
        processedL = dryL * Math.max(0.12, GRAIN_DRY_ANCHORS[mode] - cohesion * 0.10)
          + rendered[0] * normalization * (GRAIN_WET_GAINS[mode] + cohesion * 0.12 + body * 0.10);
        processedR = dryR * Math.max(0.12, GRAIN_DRY_ANCHORS[mode] - cohesion * 0.10)
          + rendered[1] * normalization * (GRAIN_WET_GAINS[mode] + cohesion * 0.12 + body * 0.10);
        if (mode === 2) {
          const coefficient = 0.035 + (1 - window) * 0.08;
          this.smearL += (processedL - this.smearL) * coefficient;
          this.smearR += (processedR - this.smearR) * coefficient;
          const mid = (this.smearL + this.smearR) * 0.5;
          processedL = this.smearL * 0.84 + mid * 0.16;
          processedR = this.smearR * 0.84 + mid * 0.16;
        } else if (mode >= 6) {
          const hardware = this.applyHardwareCharacter(mode, processedL, processedR, window, density, motion, memory);
          processedL = hardware[0];
          processedR = hardware[1];
        }
      }

      let safeL = grainTanh(processedL * 1.02) * GRAIN_OUTPUT_TANH_NORM;
      let safeR = grainTanh(processedR * 1.02) * GRAIN_OUTPUT_TANH_NORM;
      const inputPower = (dryL * dryL + dryR * dryR) * 0.5;
      const wetPower = (safeL * safeL + safeR * safeR) * 0.5;
      this.inputEnergy += (inputPower - this.inputEnergy) * 0.0016;
      this.wetEnergy += (wetPower - this.wetEnergy) * 0.0016;
      const targetMakeup = Math.max(0.88, Math.min(1.48, Math.sqrt((this.inputEnergy + 1e-6) / (this.wetEnergy + 1e-6))));
      this.makeupGain += (targetMakeup - this.makeupGain) * 0.001;
      safeL *= this.makeupGain;
      safeR *= this.makeupGain;
      const smoothing = mode === 4 ? 0.92 : mode === 5 ? 0.86 : mode >= 6 ? 0.88 : 0.82;
      this.outputL += (safeL - this.outputL) * smoothing;
      this.outputR += (safeR - this.outputR) * smoothing;
      if (Math.abs(this.outputL) < 1e-20) this.outputL = 0;
      if (Math.abs(this.outputR) < 1e-20) this.outputR = 0;
      outL[sample] = this.outputL;
      outR[sample] = this.outputR;
      this.writeIndex = (this.writeIndex + 1) & this.mask;
    }

    const callbackBudgetMs = outL.length / sampleRate * 1000;
    const callbackMs = 0;
    this.updateEmergencyGuard(callbackMs, callbackBudgetMs);
    this.profileBlocks += 1;
    this.profileTotalMs += callbackMs;
    this.profileTotalSquaredMs += callbackMs * callbackMs;
    this.profileWorstMs = Math.max(this.profileWorstMs, callbackMs);
    if (callbackMs > callbackBudgetMs) this.profileOverruns += 1;
    if (this.profileBlocks >= 160) {
      let activeVoices = 0;
      for (let index = 0; index < this.effectiveVoiceLimit; index += 1) {
        if (this.voices[index].active) activeVoices += 1;
      }
      const averageCallbackMs = this.profileTotalMs / this.profileBlocks;
      const variance = Math.max(0, this.profileTotalSquaredMs / this.profileBlocks - averageCallbackMs * averageCallbackMs);
      this.port.postMessage({
        type: 'profile',
        averageCallbackMs,
        worstCallbackMs: this.profileWorstMs,
        callbackBudgetMs,
        cpuLoad: callbackBudgetMs > 0 ? averageCallbackMs / callbackBudgetMs : 0,
        callbackJitterMs: Math.sqrt(variance),
        activeVoices,
        maxVoices: this.maxVoices,
        effectiveVoiceLimit: this.effectiveVoiceLimit,
        overruns: this.profileOverruns,
        droppedSpawns: this.profileDroppedSpawns,
      });
      this.profileBlocks = 0;
      this.profileTotalMs = 0;
      this.profileTotalSquaredMs = 0;
      this.profileWorstMs = 0;
    }
    return true;
  }
}

registerProcessor('calcotone-grain-processor', CalcotoneGrainProcessor);
