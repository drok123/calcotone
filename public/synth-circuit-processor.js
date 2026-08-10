/*
 * CALCOTONE topology-derived synth core.
 *
 * The Model D path includes a compact SPICE-style BJT/capacitor solver plus a
 * lossless capture/hybrid path that moves oscillator work into a deterministic
 * float32 bank and shares one calibrated stereo ladder. The remaining oscillator,
 * filter, converter and operator structures follow the signal topology of the
 * named instrument families while bounded nonlinearities, oversampling and
 * explicit state guards keep the audio thread deterministic.
 */

const TAU = Math.PI * 2;
const MAX_VOICES = 10;
const CAPTURE_RENDER_MODES = new Set(['auto', 'circuit', 'capture', 'hybrid']);
const BOLTZMANN_CONSTANT = 1.380649e-23;
const ELECTRON_CHARGE = 1.602176634e-19;
const ROOM_TEMPERATURE_K = 300.15;
const MODEL_D_CAPACITANCE_F = 68e-9;
const MODEL_D_SIGNAL_VOLTAGE = .12;
const OUTPUT_SATURATION_GAIN = 1.08;
const OUTPUT_SATURATION_NORMALIZATION = 1 / Math.tanh(OUTPUT_SATURATION_GAIN);
const TANH_LUT_MIN = -8;
const TANH_LUT_MAX = 8;
const TANH_LUT = new Float32Array(1024);
const TANH_LUT_SCALE = (TANH_LUT.length - 1) / (TANH_LUT_MAX - TANH_LUT_MIN);
for (let index = 0; index < TANH_LUT.length; index += 1) {
  const x = TANH_LUT_MIN + index / TANH_LUT_SCALE;
  TANH_LUT[index] = Math.tanh(x);
}
const FM_RATIOS = [
  [1, 1, 2, 3, 4, 6],
  [1, 2, 3, 1, 5, 7],
  [.5, 1, 1.5, 2, 3, 4],
  [1, 1.01, 2, 2.01, 4, 4.02],
];
const PROFILES = {
  'model-d':  { topology: '4× BJT-C SPICE LADDER', family: 'ladder', solver: 'BJT-C NEWTON', attack: .008, decay: .18, sustain: .58, release: .14, cutoff: 5400, resonance: .67, drive: 2.1, level: .17 },
  'juno-106': { topology: 'IR3109 OTA TPT CASCADE', family: 'ota', attack: .015, decay: .26, sustain: .68, release: .24, cutoff: 7200, resonance: .40, drive: 1.25, level: .15 },
  'sh-101':   { topology: 'OTA TPT MONO + SUB', family: 'ota', attack: .004, decay: .12, sustain: .48, release: .08, cutoff: 4600, resonance: .58, drive: 1.5, level: .16 },
  'prophet-5':{ topology: 'SSM/CEM TPT POLY CASCADE', family: 'ota', attack: .018, decay: .32, sustain: .62, release: .32, cutoff: 6500, resonance: .44, drive: 1.4, level: .145 },
  'dx7':      { topology: '6-OP PHASE MODULATION', family: 'fm', attack: .004, decay: .42, sustain: .34, release: .46, cutoff: 16000, resonance: .05, drive: 1, level: .15 },
  'ms-20':    { topology: 'KORG-35 HP/LP', family: 'korg35', attack: .006, decay: .16, sustain: .52, release: .13, cutoff: 3800, resonance: .76, drive: 2.5, level: .14 },
  'polysix':  { topology: 'SSM2044 TPT + ENSEMBLE', family: 'ota', attack: .025, decay: .30, sustain: .70, release: .38, cutoff: 6900, resonance: .38, drive: 1.28, level: .145 },
  'ob-xa':    { topology: 'CEM3320 TPT 2/4-POLE', family: 'ota', attack: .018, decay: .28, sustain: .72, release: .34, cutoff: 7600, resonance: .32, drive: 1.42, level: .135 },
  'fairlight':{ topology: '8-BIT CMI DAC', family: 'sample', attack: .003, decay: .34, sustain: .42, release: .20, cutoff: 8400, resonance: .14, drive: 1.25, level: .18 },
  'ppg-wave': { topology: 'DIGITAL WAVETABLE + TPT VCF', family: 'wavetable', attack: .012, decay: .30, sustain: .56, release: .34, cutoff: 9800, resonance: .38, drive: 1.35, level: .14 },
  'cz-101':   { topology: 'PHASE DISTORTION + DCA', family: 'phase', attack: .006, decay: .24, sustain: .50, release: .22, cutoff: 11000, resonance: .20, drive: 1.5, level: .15 },
  'calcotone':{ topology: 'MORPH CORE + TPT LADDER', family: 'hybrid', attack: .008, decay: .22, sustain: .54, release: .40, cutoff: 8200, resonance: .52, drive: 2.15, level: .13 },
};

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const midiToFrequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const wrap = (phase) => phase - Math.floor(phase);
const thermalVoltage = (temperatureK) => BOLTZMANN_CONSTANT * temperatureK / ELECTRON_CHARGE;
const componentDrift = (seed, offset) => ((((seed >>> offset) & 255) / 255) * 2 - 1);

function interpolateHermite(y0, y1, y2, y3, mu) {
  const mu2 = mu * mu;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
}

function fastTanh(value) {
  if (value <= TANH_LUT_MIN) return -1;
  if (value >= TANH_LUT_MAX) return 1;
  const position = (value - TANH_LUT_MIN) * TANH_LUT_SCALE;
  const index = Math.floor(position);
  const mu = position - index;
  const last = TANH_LUT.length - 1;
  const i0 = index > 0 ? index - 1 : 0;
  const i2 = index < last ? index + 1 : last;
  const i3 = index + 2 < last ? index + 2 : last;
  return interpolateHermite(TANH_LUT[i0], TANH_LUT[index], TANH_LUT[i2], TANH_LUT[i3], mu);
}

/**
 * Tail-normalized Shockley junction pair. The saturation-current term cancels
 * when the two matched junction currents are normalized by their sum, leaving
 * a bounded differential-pair current suitable for a realtime Newton solve.
 */
function bjtDifferentialPair(normalizedVoltage) {
  return fastTanh(clamp(normalizedVoltage, -12, 12));
}

/**
 * Solve one BJT-driven capacitor with an implicit trapezoidal companion model.
 * Fixed iteration counts and rail bounds make this small MNA-style solve safe
 * for the audio thread while retaining capacitor and junction state.
 */
function solveBjtCapacitorStage(
  previousVoltage,
  previousCurrent,
  driveVoltage,
  tailCurrent,
  inverseTwoJunctionVoltage,
  conductanceScale,
  mismatch,
  railVoltage,
  companionScale,
  iterations,
  result,
) {
  let voltage = previousVoltage;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const normalized = (driveVoltage - voltage) * inverseTwoJunctionVoltage + mismatch;
    const pairTransfer = bjtDifferentialPair(normalized);
    const current = tailCurrent * pairTransfer;
    const conductance = conductanceScale * (1 - pairTransfer * pairTransfer);
    const residual = voltage - previousVoltage - companionScale * (current + previousCurrent);
    voltage -= residual / Math.max(1e-9, 1 + companionScale * conductance);
    voltage = clamp(voltage, -railVoltage, railVoltage);
  }
  const normalized = (driveVoltage - voltage) * inverseTwoJunctionVoltage + mismatch;
  result[0] = voltage;
  result[1] = tailCurrent * bjtDifferentialPair(normalized);
}

function polyBlep(phase, increment) {
  if (phase < increment) {
    const t = phase / increment;
    return t + t - t * t - 1;
  }
  if (phase > 1 - increment) {
    const t = (phase - 1) / increment;
    return t * t + t + t + 1;
  }
  return 0;
}

function saw(phase, increment) {
  return phase * 2 - 1 - polyBlep(phase, increment);
}

function pulse(phase, increment, width) {
  let value = phase < width ? 1 : -1;
  value += polyBlep(phase, increment);
  value -= polyBlep(wrap(phase - width), increment);
  return value;
}

class CalcotoneSynthCircuitProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.machine = 'model-d';
    this.parameters = [.58, .46, .26, .54, .22, .08];
    this.parameterTargets = [...this.parameters];
    this.parameterMorphFrames = 0;
    this.archetype = 'panel';
    this.quality = 2;
    this.renderMode = 'auto';
    this.captureBank = null;
    this.voices = Array.from({ length: MAX_VOICES }, () => this.createVoiceSlot());
    this.activeVoiceIndices = new Uint8Array(MAX_VOICES);
    this.activeVoiceCount = 0;
    this.frameCounter = 0;
    this.telemetryCountdown = sampleRate >> 2;
    this.peak = 0;
    this.clippedSamples = 0;
    this.renderQuantumFrames = 0;
    this.dcL = { input: 0, output: 0 };
    this.dcR = { input: 0, output: 0 };
    this.sequencer = {
      patterns: Array.from({ length: 4 }, () => Array.from({ length: 16 }, () => [])),
      patternIndex: 0,
      chain: [0, 1, 2, 3],
      chainArmed: false,
      chainPosition: 0,
      bpm: 100,
      playing: false,
      step: 0,
      stepFrames: sampleRate * .15,
      nextStepFrame: 0,
    };
    this.sequencerStepMessage = {
      type: 'sequencer-step',
      step: 0,
      patternIndex: 0,
      chainPosition: 0,
      frame: 0,
    };
    this.telemetryMessage = {
      type: 'telemetry',
      activeVoices: 0,
      maxVoices: MAX_VOICES,
      peak: 0,
      oversample: this.quality,
      machine: this.machine,
      topology: PROFILES[this.machine].topology,
      solver: PROFILES[this.machine].solver,
      solverIterations: 1,
      renderMode: 'circuit',
      captureReady: false,
      temperatureC: 27,
      renderQuantumFrames: 0,
      clippedSamples: 0,
    };
    this.hybridBusL = this.createHybridBus(-1);
    this.hybridBusR = this.createHybridBus(1);
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  createVoiceSlot() {
    const parameters = new Float64Array(6);
    const captureSourceOffsets = new Int32Array(4);
    captureSourceOffsets.fill(-1);
    return {
      active: false,
      machine: 'model-d',
      archetype: 'panel',
      profile: PROFILES['model-d'],
      parameters,
      frequency: 440,
      velocity: 0,
      duration: .2,
      age: 0,
      releaseAge: 0,
      releasing: false,
      env: 0,
      phaseA: 0,
      phaseB: 0,
      subPhase: 0,
      opPhases: new Float64Array(6),
      opMemory: new Float64Array(6),
      poles: new Float64Array(6),
      filterOutputs: new Float64Array(4),
      ladderCurrents: new Float64Array(4),
      ladderSolve: new Float64Array(2),
      ladderCapacitances: new Float64Array(4),
      ladderMismatch: new Float64Array(4),
      spiceCompanionScales: new Float64Array(4),
      fmRatios: new Float64Array(6),
      fmLevels: new Float64Array(6),
      temperatureK: ROOM_TEMPERATURE_K,
      thermalVoltage: thermalVoltage(ROOM_TEMPERATURE_K),
      supplySag: 0,
      previous: 0,
      hold: 0,
      holdCounter: 0,
      noise: 1,
      pan: 0,
      panL: Math.SQRT1_2,
      panR: Math.SQRT1_2,
      attackRate: 0,
      attackSeconds: .01,
      decayRate: 0,
      releaseMultiplier: 1,
      phaseIncrementA: 0,
      phaseIncrementB: 0,
      subPhaseIncrement: 0,
      pulseWidth: .5,
      sourceMixA: .5,
      sourceMixB: .5,
      ladderTptAlpha: 0,
      ladderFeedback: 0,
      ladderDrive: 1,
      spiceJunctionVoltage: 0,
      spiceInverseTwoJunctionVoltage: 0,
      spiceTailCurrent: 0,
      spiceConductanceScale: 0,
      spiceFeedback: 0,
      spiceSignalVoltage: MODEL_D_SIGNAL_VOLTAGE,
      spiceDrive: 1,
      spiceSupplyCoefficient: 0,
      otaTptAlpha: 0,
      otaFeedback: 0,
      otaDrive: 1,
      otaStageDrive: 1,
      korgG: 0,
      korgDamp: 1,
      korgDrive: 1,
      korgFeedback: 0,
      korgHighpass: false,
      fmAlgorithm: 0,
      digitalPhaseIncrement: 0,
      digitalHarmonic: 2,
      phaseDistortionHarmonic: 2,
      sampleHarmonic: 2,
      sampleHoldLength: 2,
      captureToneOffset: -1,
      captureSourceOffsets,
      captureLength: 0,
      captureCrossfade: 0,
      capturePosition: 0,
      captureRootMidi: 69,
      capturePitchRate: 0,
      captureIncrement: 0,
    };
  }

  handleMessage(data) {
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'enabled') {
      this.enabled = Boolean(data.value);
      if (!this.enabled) this.deactivateAllVoices();
    } else if (data.type === 'machine' && PROFILES[data.value]) {
      this.machine = data.value;
      if (this.machine === 'model-d') this.refreshHybridBuses(true);
    } else if (data.type === 'archetype' && ['panel', 'bass', 'pad', 'lead'].includes(data.value)) {
      this.archetype = data.value;
    } else if (data.type === 'parameters' && Array.isArray(data.values)) {
      for (let index = 0; index < 6; index += 1) {
        this.parameterTargets[index] = clamp(data.values[index] ?? .5);
      }
      this.parameterMorphFrames = Math.max(0, Math.round(clamp(data.morphSeconds, 0, .5) * sampleRate));
      if (this.parameterMorphFrames === 0) this.applyParameterTargets();
    } else if (data.type === 'quality') {
      const nextQuality = data.factor >= 4 ? 4 : data.factor >= 2 ? 2 : 1;
      if (nextQuality !== this.quality) {
        this.quality = nextQuality;
        for (let active = 0; active < this.activeVoiceCount; active += 1) {
          this.refreshVoiceCoefficients(this.voices[this.activeVoiceIndices[active]]);
        }
        this.refreshHybridBuses();
      }
    } else if (data.type === 'render-mode' && CAPTURE_RENDER_MODES.has(data.value)) {
      this.renderMode = data.value;
      this.refreshHybridBuses(true);
    } else if (data.type === 'capture-bank') {
      this.installCaptureBank(data);
    } else if (data.type === 'sequencer-state') {
      this.setSequencerState(data);
    } else if (data.type === 'note-on' && this.enabled) {
      this.noteOn(data.midi, data.durationSeconds, data.velocity, data.seed);
    } else if (data.type === 'chord-on' && this.enabled && Array.isArray(data.notes)) {
      const limit = Math.min(MAX_VOICES, data.notes.length);
      for (let noteIndex = 0; noteIndex < limit; noteIndex += 1) {
        const midi = data.notes[noteIndex];
        if (!Number.isFinite(midi)) continue;
        let duplicate = false;
        for (let previous = 0; previous < noteIndex; previous += 1) {
          if (data.notes[previous] === midi) { duplicate = true; break; }
        }
        if (!duplicate) this.noteOn(midi, data.durationSeconds, data.velocity, 0);
      }
    } else if (data.type === 'all-notes-off' || data.type === 'dispose') {
      this.releaseAll();
    }
  }

  applyParameterTargets() {
    for (let index = 0; index < 6; index += 1) this.parameters[index] = this.parameterTargets[index];
    this.refreshMorphedVoices();
  }

  advanceParameterMorph(frames) {
    if (this.parameterMorphFrames <= 0) return;
    const advanced = Math.min(frames, this.parameterMorphFrames);
    const fraction = advanced / this.parameterMorphFrames;
    for (let index = 0; index < 6; index += 1) {
      this.parameters[index] += (this.parameterTargets[index] - this.parameters[index]) * fraction;
    }
    this.parameterMorphFrames -= advanced;
    if (this.parameterMorphFrames === 0) {
      for (let index = 0; index < 6; index += 1) this.parameters[index] = this.parameterTargets[index];
    }
    this.refreshMorphedVoices();
  }

  refreshMorphedVoices() {
    for (let active = 0; active < this.activeVoiceCount; active += 1) {
      const voice = this.voices[this.activeVoiceIndices[active]];
      for (let index = 0; index < 6; index += 1) voice.parameters[index] = this.parameters[index];
      this.refreshVoiceCoefficients(voice);
    }
    this.refreshHybridBuses();
  }

  setSequencerState(data) {
    const sequence = this.sequencer;
    const wasPlaying = sequence.playing;
    const previousStepFrames = sequence.stepFrames;
    if (Array.isArray(data.patterns)) {
      sequence.patterns = Array.from({ length: 4 }, (_, patternIndex) => {
        const source = Array.isArray(data.patterns[patternIndex]) ? data.patterns[patternIndex] : [];
        return Array.from({ length: 16 }, (_, step) => {
          const notes = Array.isArray(source[step]) ? source[step] : [];
          const pitches = new Set();
          return notes.slice(0, 12).flatMap((note) => {
            if (!note || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch >= 12) return [];
            if (pitches.has(note.pitch)) return [];
            pitches.add(note.pitch);
            return [{
              pitch: note.pitch,
              length: Math.trunc(clamp(note.length, 1, 16 - step)),
            }];
          });
        });
      });
    }
    sequence.patternIndex = Math.trunc(clamp(data.patternIndex, 0, 3));
    if (Array.isArray(data.chain)) {
      sequence.chain = data.chain
        .slice(0, 8)
        .map((index) => Math.trunc(clamp(index, 0, 3)));
    }
    sequence.chainArmed = Boolean(data.chainArmed);
    sequence.chainPosition = Math.trunc(clamp(
      data.chainPosition,
      0,
      Math.max(0, sequence.chain.length - 1),
    ));
    sequence.bpm = clamp(data.bpm, 30, 180);
    sequence.stepFrames = sampleRate * 15 / sequence.bpm;
    sequence.playing = Boolean(data.playing);
    if (sequence.playing && !wasPlaying) {
      sequence.step = Math.trunc(clamp(data.startStep, 0, 15));
      sequence.nextStepFrame = this.frameCounter;
    } else if (sequence.playing && previousStepFrames !== sequence.stepFrames) {
      const remainingRatio = clamp(
        (sequence.nextStepFrame - this.frameCounter) / Math.max(1, previousStepFrames),
      );
      sequence.nextStepFrame = this.frameCounter + remainingRatio * sequence.stepFrames;
    }
  }

  triggerSequencerStep() {
    const sequence = this.sequencer;
    const pattern = sequence.patterns[sequence.patternIndex] || sequence.patterns[0];
    const notes = pattern?.[sequence.step] || [];
    if (this.enabled) {
      for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
        const note = notes[noteIndex];
        this.noteOn(
          71 - note.pitch,
          sequence.stepFrames / sampleRate * note.length * .92,
          .78,
          0,
        );
      }
    }
    const message = this.sequencerStepMessage;
    message.step = sequence.step;
    message.patternIndex = sequence.patternIndex;
    message.chainPosition = sequence.chainPosition;
    message.frame = this.frameCounter;
    this.port.postMessage(message);
    sequence.step = (sequence.step + 1) & 15;
    if (sequence.step === 0 && sequence.chainArmed && sequence.chain.length > 0) {
      sequence.chainPosition = (sequence.chainPosition + 1) % sequence.chain.length;
      sequence.patternIndex = sequence.chain[sequence.chainPosition];
    }
    sequence.nextStepFrame += sequence.stepFrames;
  }

  findFreeVoiceIndex() {
    for (let index = 0; index < MAX_VOICES; index += 1) {
      if (!this.voices[index].active) return index;
    }
    return 0;
  }

  noteOn(midiValue, durationSeconds, velocityValue = .78, seedValue = 0) {
    const voiceCountForSeed = this.activeVoiceCount;
    let voiceIndex = 0;
    if (this.activeVoiceCount >= MAX_VOICES) {
      let stealPosition = 0;
      for (let active = 1; active < this.activeVoiceCount; active += 1) {
        const candidate = this.voices[this.activeVoiceIndices[active]];
        const selected = this.voices[this.activeVoiceIndices[stealPosition]];
        if (candidate.env < selected.env || (candidate.env === selected.env && candidate.age > selected.age)) {
          stealPosition = active;
        }
      }
      voiceIndex = this.activeVoiceIndices[stealPosition];
    } else {
      voiceIndex = this.findFreeVoiceIndex();
      this.activeVoiceIndices[this.activeVoiceCount++] = voiceIndex;
    }

    const voice = this.voices[voiceIndex];
    const midi = clamp(midiValue, 0, 127);
    const profile = PROFILES[this.machine];
    const requestedSeed = Number.isFinite(seedValue) ? Math.trunc(seedValue) >>> 0 : 0;
    const seed = requestedSeed
      || ((midi * 1103515245 + this.frameCounter + voiceCountForSeed * 7919) >>> 0)
      || 1;
    const temperatureK = ROOM_TEMPERATURE_K + componentDrift(seed, 4) * 4;

    voice.active = true;
    voice.machine = this.machine;
    voice.archetype = this.archetype;
    voice.profile = profile;
    for (let index = 0; index < 6; index += 1) voice.parameters[index] = this.parameters[index];
    voice.frequency = midiToFrequency(midi);
    voice.velocity = clamp(velocityValue ?? .78);
    voice.duration = Math.max(.035, Math.min(12, durationSeconds ?? .2));
    voice.age = 0;
    voice.releaseAge = 0;
    voice.releasing = false;
    voice.env = 0;
    voice.phaseA = (seed & 65535) / 65536;
    voice.phaseB = ((seed >>> 16) & 65535) / 65536;
    voice.subPhase = 0;
    voice.opPhases.fill(0);
    voice.opMemory.fill(0);
    voice.poles.fill(0);
    voice.filterOutputs.fill(0);
    voice.ladderCurrents.fill(0);
    voice.ladderSolve.fill(0);
    voice.spiceCompanionScales.fill(0);
    voice.fmRatios.fill(0);
    voice.fmLevels.fill(0);
    for (let pole = 0; pole < 4; pole += 1) {
      voice.ladderCapacitances[pole] = MODEL_D_CAPACITANCE_F * (1 + componentDrift(seed, pole * 4) * .018);
      voice.ladderMismatch[pole] = componentDrift(seed, 12 + pole * 3) * .009;
    }
    voice.temperatureK = temperatureK;
    voice.thermalVoltage = thermalVoltage(temperatureK);
    voice.supplySag = 0;
    voice.previous = 0;
    voice.hold = 0;
    voice.holdCounter = 0;
    voice.noise = seed;
    voice.pan = ((((seed >>> 8) & 255) / 255) * 2 - 1) * this.parameters[5] * .24;
    voice.panL = Math.sqrt((1 - voice.pan) * .5);
    voice.panR = Math.sqrt((1 + voice.pan) * .5);
    voice.captureToneOffset = -1;
    voice.captureSourceOffsets.fill(-1);
    voice.captureLength = 0;
    voice.captureCrossfade = 0;
    voice.capturePosition = 0;
    voice.captureRootMidi = 69;
    voice.capturePitchRate = 0;
    voice.captureIncrement = 0;
    this.refreshVoiceCoefficients(voice);
    this.assignCaptureVoice(voice, seed);
  }

  refreshVoiceCoefficients(voice) {
    const parameters = voice.parameters;
    const profile = voice.profile;
    const dt = 1 / (sampleRate * this.quality);
    const source = parameters[0];
    const color = parameters[1];
    const resonance = parameters[2];
    const contour = parameters[3];
    const character = parameters[4];
    const motion = parameters[5];

    let attack = Math.max(.002, profile.attack * (.3 + contour * 1.4));
    let decay = Math.max(.012, profile.decay * (.5 + contour));
    let release = Math.max(.018, profile.release * (.45 + contour * 1.8));
    if (voice.archetype === 'bass') {
      attack = Math.min(.012, Math.max(.002, attack * .42));
      decay = Math.min(.24, Math.max(.045, decay * .62));
      release = Math.min(.20, Math.max(.018, release * .52));
    } else if (voice.archetype === 'pad') {
      attack = Math.max(.5, .5 + contour * .9);
      decay = Math.max(.8, .8 + contour * 1.8);
      release = Math.max(1.2, 1.2 + contour * 2.8);
    } else if (voice.archetype === 'lead') {
      attack = Math.min(.09, Math.max(.008, attack * .85));
      decay = Math.min(.62, Math.max(.12, decay));
      release = Math.min(.72, Math.max(.10, release));
    }
    voice.attackRate = Math.min(1, dt * 6 / attack);
    voice.attackSeconds = attack;
    voice.decayRate = Math.min(1, dt * 4 / decay);
    voice.releaseMultiplier = Math.exp(-dt * 7.2 / release);

    const detune = (motion - .5) * .013;
    const secondOscillatorOctaves = voice.machine === 'prophet-5' || voice.machine === 'ob-xa'
      ? detune
      : -1 + detune;
    voice.phaseIncrementA = clamp(voice.frequency * (1 - detune) * dt, 1e-7, .45);
    voice.phaseIncrementB = clamp(voice.frequency * Math.pow(2, secondOscillatorOctaves) * dt, 1e-7, .45);
    voice.subPhaseIncrement = clamp(voice.frequency * .5 * dt, 1e-7, .45);
    voice.pulseWidth = .34 + character * .32;
    voice.sourceMixA = .72 - source * .42;
    voice.sourceMixB = .28 + source * .42;

    const ladderCutoff = clamp(
      profile.cutoff * (.055 + color * color * 1.22) * (.7 + contour * .35),
      45,
      sampleRate * .43,
    );
    const ladderTptG = Math.tan(Math.PI * ladderCutoff * dt);
    voice.ladderTptAlpha = ladderTptG / (1 + ladderTptG);
    voice.ladderFeedback = clamp(profile.resonance * (.22 + resonance * 1.34), 0, .96) * 4.05;
    voice.ladderDrive = profile.drive * (.72 + character * 2.15);

    const spiceCutoff = Math.min(ladderCutoff, sampleRate * .34);
    const ideality = 1.08;
    voice.spiceJunctionVoltage = voice.thermalVoltage * ideality;
    voice.spiceInverseTwoJunctionVoltage = 1 / (2 * voice.spiceJunctionVoltage);
    voice.spiceTailCurrent = 2 * voice.spiceJunctionVoltage * MODEL_D_CAPACITANCE_F * TAU * spiceCutoff;
    voice.spiceConductanceScale = voice.spiceTailCurrent * voice.spiceInverseTwoJunctionVoltage;
    voice.spiceFeedback = clamp(profile.resonance * (.20 + resonance * 1.32), 0, .95) * 3.82;
    voice.spiceSignalVoltage = MODEL_D_SIGNAL_VOLTAGE * (.82 + character * .36);
    voice.spiceDrive = profile.drive * (.68 + character * 1.82);
    voice.spiceSupplyCoefficient = 1 - Math.exp(-dt / (120 * 47e-6));
    for (let pole = 0; pole < 4; pole += 1) {
      voice.spiceCompanionScales[pole] = dt / (2 * voice.ladderCapacitances[pole]);
    }

    const otaCutoff = clamp(profile.cutoff * (.06 + color * color * 1.18), 55, sampleRate * .43);
    const otaTptG = Math.tan(Math.PI * otaCutoff * dt);
    voice.otaTptAlpha = otaTptG / (1 + otaTptG);
    voice.otaFeedback = clamp(profile.resonance * (.20 + resonance * 1.45), 0, .92) * 3.7;
    voice.otaDrive = profile.drive * (.75 + character * 1.45);
    voice.otaStageDrive = 1.02 + character * .18;

    const korgCutoff = clamp(profile.cutoff * (.045 + color * color * 1.18), 45, sampleRate * .40);
    voice.korgG = Math.tan(Math.PI * korgCutoff * dt);
    voice.korgDamp = .58 + (1 - resonance) * 1.15;
    voice.korgDrive = profile.drive * (.72 + character * 2.35);
    voice.korgFeedback = profile.resonance * (.35 + resonance * 1.75) * 2.5;
    voice.korgHighpass = color < .18;

    voice.fmAlgorithm = Math.min(3, Math.floor(source * 4));
    const ratios = FM_RATIOS[voice.fmAlgorithm];
    for (let operator = 0; operator < 6; operator += 1) {
      voice.fmRatios[operator] = voice.frequency * ratios[operator] * dt;
    }
    voice.fmLevels[0] = 1;
    voice.fmLevels[1] = .75 + color;
    voice.fmLevels[2] = .50 + motion;
    voice.fmLevels[3] = .38 + resonance;
    voice.fmLevels[4] = .30 + contour;
    voice.fmLevels[5] = .22 + character;

    voice.digitalPhaseIncrement = clamp(
      voice.frequency * Math.pow(2, (parameters[2] - .5)) * dt,
      1e-7,
      .45,
    );
    voice.digitalHarmonic = 2 + Math.floor(parameters[1] * 7);
    voice.phaseDistortionHarmonic = 2 + Math.floor(parameters[4] * 6);
    voice.sampleHarmonic = 2 + Math.floor(parameters[0] * 8);
    voice.sampleHoldLength = 2 + Math.floor((1 - parameters[4]) * 15);
    if (voice.capturePitchRate) {
      const captureRate = this.captureBank?.sampleRate || sampleRate;
      voice.captureIncrement = voice.capturePitchRate * captureRate / sampleRate / this.quality;
    }
  }

  createHybridBus(mismatchPolarity) {
    const profile = PROFILES['model-d'];
    const parameters = new Float64Array(6);
    for (let index = 0; index < 6; index += 1) parameters[index] = this.parameters[index];
    const ladderCapacitances = new Float64Array(4);
    const ladderMismatch = new Float64Array(4);
    for (let pole = 0; pole < 4; pole += 1) {
      ladderCapacitances[pole] = MODEL_D_CAPACITANCE_F * (1 + mismatchPolarity * (pole + 1) * .0015);
      ladderMismatch[pole] = mismatchPolarity * (pole + 1) * .0007;
    }
    const bus = {
      machine: 'model-d',
      archetype: 'panel',
      profile,
      parameters,
      frequency: 440,
      poles: new Float64Array(6),
      filterOutputs: new Float64Array(4),
      ladderCurrents: new Float64Array(4),
      ladderSolve: new Float64Array(2),
      ladderCapacitances,
      ladderMismatch,
      spiceCompanionScales: new Float64Array(4),
      fmRatios: new Float64Array(6),
      fmLevels: new Float64Array(6),
      temperatureK: ROOM_TEMPERATURE_K + mismatchPolarity * .85,
      thermalVoltage: thermalVoltage(ROOM_TEMPERATURE_K + mismatchPolarity * .85),
      supplySag: 0,
      capturePitchRate: 0,
    };
    this.refreshVoiceCoefficients(bus);
    return bus;
  }

  refreshHybridBuses(reset = false) {
    const buses = [this.hybridBusL, this.hybridBusR];
    for (let busIndex = 0; busIndex < buses.length; busIndex += 1) {
      const bus = buses[busIndex];
      if (!bus) continue;
      for (let index = 0; index < 6; index += 1) bus.parameters[index] = this.parameters[index];
      if (reset) {
        bus.poles.fill(0);
        bus.filterOutputs.fill(0);
        bus.ladderCurrents.fill(0);
        bus.supplySag = 0;
      }
      this.refreshVoiceCoefficients(bus);
    }
  }

  installCaptureBank(data) {
    const manifest = data.manifest;
    if (
      !manifest
      || manifest.machine !== 'model-d'
      || manifest.format !== 'float32-le'
      || !Array.isArray(manifest.entries)
      || !data.samples
      || typeof data.samples.byteLength !== 'number'
    ) {
      this.port.postMessage({ type: 'capture-error', reason: 'INVALID CAPTURE BANK' });
      return;
    }
    let samples;
    try {
      samples = new Float32Array(data.samples);
    } catch {
      this.port.postMessage({ type: 'capture-error', reason: 'INVALID FLOAT32 PCM' });
      return;
    }
    const entries = manifest.entries.flatMap((entry) => {
      const offsetFrames = Math.trunc(entry?.offsetFrames);
      const frameLength = Math.trunc(entry?.frameLength);
      if (
        typeof entry?.tap !== 'string'
        || !Number.isFinite(entry.rootMidi)
        || !Number.isFinite(entry.variant)
        || offsetFrames < 0
        || frameLength < 4
        || offsetFrames + frameLength > samples.length
      ) {
        return [];
      }
      return [{
        tap: entry.tap,
        rootMidi: Math.trunc(entry.rootMidi),
        variant: Math.trunc(entry.variant),
        offsetFrames,
        frameLength,
      }];
    });
    if (entries.length === 0) {
      this.port.postMessage({ type: 'capture-error', reason: 'EMPTY CAPTURE BANK' });
      return;
    }
    this.captureBank = {
      samples,
      entries,
      sampleRate: Math.max(8_000, Number(manifest.sampleRate) || sampleRate),
      variants: Math.max(1, Math.trunc(manifest.variants) || 1),
      crossfadeFrames: Math.max(0, Math.trunc(manifest.crossfadeFrames) || 0),
      profileLevel: clamp(manifest.profileLevel, .01, .5),
      preset: String(manifest.preset || 'capture'),
    };
    this.port.postMessage({
      type: 'capture-ready',
      machine: 'model-d',
      preset: this.captureBank.preset,
      entries: entries.length,
      frames: samples.length,
    });
  }

  findCaptureEntry(tap, midi, variant) {
    if (!this.captureBank) return null;
    let selected = null;
    let selectedDistance = Infinity;
    for (let index = 0; index < this.captureBank.entries.length; index += 1) {
      const entry = this.captureBank.entries[index];
      if (entry.tap !== tap) continue;
      const variantPenalty = entry.variant === variant ? 0 : 1_000;
      const distance = Math.abs(entry.rootMidi - midi) + variantPenalty;
      if (distance < selectedDistance) {
        selected = entry;
        selectedDistance = distance;
      }
    }
    return selected;
  }

  assignCaptureVoice(voice, seed) {
    if (!this.captureBank || voice.machine !== 'model-d') return;
    const variant = Math.abs(seed) % this.captureBank.variants;
    const midi = voice.frequency ? 69 + 12 * Math.log2(voice.frequency / 440) : 69;
    const tone = this.findCaptureEntry('tone', midi, variant);
    const rootMidi = tone?.rootMidi ?? 69;
    const source00 = this.findCaptureEntry('source-00', rootMidi, variant);
    const source10 = this.findCaptureEntry('source-10', rootMidi, variant);
    const source01 = this.findCaptureEntry('source-01', rootMidi, variant);
    const source11 = this.findCaptureEntry('source-11', rootMidi, variant);
    const reference = tone || source00 || source10 || source01 || source11;
    if (!reference || !source00 || !source10 || !source01 || !source11) return;
    voice.captureToneOffset = tone?.offsetFrames ?? -1;
    voice.captureSourceOffsets[0] = source00.offsetFrames;
    voice.captureSourceOffsets[1] = source10.offsetFrames;
    voice.captureSourceOffsets[2] = source01.offsetFrames;
    voice.captureSourceOffsets[3] = source11.offsetFrames;
    voice.captureLength = reference.frameLength;
    voice.captureCrossfade = Math.min(
      Math.max(0, this.captureBank.crossfadeFrames),
      Math.max(0, reference.frameLength >> 2),
    );
    voice.capturePosition = 0;
    voice.captureRootMidi = reference.rootMidi;
    voice.capturePitchRate = Math.pow(2, (midi - reference.rootMidi) / 12);
    voice.captureIncrement = voice.capturePitchRate
      * this.captureBank.sampleRate
      / sampleRate
      / this.quality;
  }

  resolveRenderMode() {
    if (this.machine !== 'model-d' || !this.captureBank) return 'circuit';
    return this.renderMode === 'auto' ? 'hybrid' : this.renderMode;
  }

  deactivateAllVoices() {
    for (let active = 0; active < this.activeVoiceCount; active += 1) {
      this.voices[this.activeVoiceIndices[active]].active = false;
    }
    this.activeVoiceCount = 0;
  }

  releaseAll() {
    for (let active = 0; active < this.activeVoiceCount; active += 1) {
      this.voices[this.activeVoiceIndices[active]].releasing = true;
    }
  }

  envelope(voice, dt) {
    const p = voice.profile;
    voice.age += dt;
    if (!voice.releasing && voice.age >= voice.duration) voice.releasing = true;
    if (voice.releasing) {
      voice.releaseAge += dt;
      voice.env *= voice.releaseMultiplier;
      return voice.env;
    }
    if (voice.age < voice.attackSeconds) {
      voice.env += (1 - voice.env) * voice.attackRate;
    } else {
      voice.env += (p.sustain - voice.env) * voice.decayRate;
    }
    return voice.env;
  }

  analogSource(voice) {
    const incA = voice.phaseIncrementA;
    const incB = voice.phaseIncrementB;
    voice.phaseA = wrap(voice.phaseA + incA);
    voice.phaseB = wrap(voice.phaseB + incB);
    let a = saw(voice.phaseA, incA);
    let b = pulse(voice.phaseB, incB, voice.pulseWidth);
    if (voice.machine === 'ob-xa') b = saw(voice.phaseB, incB);
    if (voice.machine === 'sh-101') {
      voice.subPhase = wrap(voice.subPhase + voice.subPhaseIncrement);
      b = pulse(voice.subPhase, incA * .5, .5) * .85;
    }
    return a * voice.sourceMixA + b * voice.sourceMixB;
  }

  ladder(voice, input, hybrid = false) {
    const outputs = voice.filterOutputs;
    const alpha = voice.ladderTptAlpha;
    let stage = fastTanh(input * voice.ladderDrive - outputs[3] * voice.ladderFeedback);
    for (let pole = 0; pole < 4; pole += 1) {
      const target = fastTanh(stage - outputs[pole] * (hybrid ? .18 : .11));
      const v = (target - voice.poles[pole]) * alpha;
      const lowpass = v + voice.poles[pole];
      voice.poles[pole] = lowpass + v;
      outputs[pole] = lowpass;
      stage = lowpass;
    }
    return fastTanh(outputs[3] * 1.25);
  }

  spiceLadder(voice, input) {
    const character = voice.parameters[4];
    const signalVoltage = voice.spiceSignalVoltage;
    const drivenInput = fastTanh(input * voice.spiceDrive) * signalVoltage;
    const railVoltage = Math.max(.24, .42 - voice.supplySag);
    const iterations = this.quality >= 4 ? 2 : 1;
    let stageVoltage = drivenInput - voice.poles[3] * voice.spiceFeedback;

    for (let pole = 0; pole < 4; pole += 1) {
      solveBjtCapacitorStage(
        voice.poles[pole],
        voice.ladderCurrents[pole],
        stageVoltage,
        voice.spiceTailCurrent,
        voice.spiceInverseTwoJunctionVoltage,
        voice.spiceConductanceScale,
        voice.ladderMismatch[pole],
        railVoltage,
        voice.spiceCompanionScales[pole],
        iterations,
        voice.ladderSolve,
      );
      voice.poles[pole] = voice.ladderSolve[0];
      voice.ladderCurrents[pole] = voice.ladderSolve[1];
      stageVoltage = voice.ladderSolve[0];
    }

    const supplyLoad = clamp(
      (Math.abs(drivenInput) + Math.abs(voice.poles[3])) * (.07 + character * .05),
      0,
      .075,
    );
    voice.supplySag += voice.spiceSupplyCoefficient * (supplyLoad - voice.supplySag);
    return fastTanh(voice.poles[3] / signalVoltage * 1.18);
  }

  ota(voice, input) {
    const outputs = voice.filterOutputs;
    const alpha = voice.otaTptAlpha;
    let stage = fastTanh(input * voice.otaDrive - outputs[3] * voice.otaFeedback);
    for (let pole = 0; pole < 4; pole += 1) {
      const v = (stage - voice.poles[pole]) * alpha;
      const lowpass = v + voice.poles[pole];
      voice.poles[pole] = lowpass + v;
      outputs[pole] = lowpass;
      stage = fastTanh(lowpass * voice.otaStageDrive);
    }
    if (voice.machine === 'ob-xa') return voice.parameters[5] < .5 ? outputs[1] * .75 : outputs[3] * 1.05;
    return outputs[3];
  }

  korg35(voice, input) {
    const g = voice.korgG;
    const x = fastTanh(input * voice.korgDrive - voice.poles[1] * voice.korgFeedback);
    const high = (x - voice.poles[0] * voice.korgDamp - voice.poles[1])
      / (1 + g * (g + voice.korgDamp));
    const band = high * g + voice.poles[0];
    const low = band * g + voice.poles[1];
    voice.poles[0] = high * g + band;
    voice.poles[1] = band * g + low;
    return fastTanh((voice.korgHighpass ? high : low) * 1.45);
  }

  fmSource(voice) {
    const feedback = voice.parameters[2];
    const values = voice.opMemory;
    const algo = voice.fmAlgorithm;
    for (let op = 5; op >= 0; op -= 1) {
      voice.opPhases[op] = wrap(voice.opPhases[op] + voice.fmRatios[op]);
      let modulation = 0;
      if (algo === 0 && op < 5) modulation = values[op + 1] * (1.5 + feedback * 8);
      else if (algo === 1) modulation = op < 3 ? values[op + 3] * (1 + feedback * 6) : 0;
      else if (algo === 2) modulation = op === 0 ? (values[1] + values[2] + values[3]) * (1 + feedback * 3) : op >= 4 ? values[5] * feedback * 5 : 0;
      else modulation = op % 2 === 0 ? values[op + 1] * (1 + feedback * 5) : 0;
      if (op === 5) modulation += values[5] * feedback * 1.35;
      values[op] = Math.sin(TAU * voice.opPhases[op] + modulation) * voice.fmLevels[op];
    }
    if (algo === 0) return values[0];
    if (algo === 1) return (values[0] + values[1] + values[2]) * .42;
    if (algo === 2) return (values[0] + values[4]) * .58;
    return (values[0] + values[2] + values[4]) * .38;
  }

  digitalSource(voice) {
    const parameters = voice.parameters;
    const source = parameters[0];
    const loop = parameters[3];
    const color = parameters[4];
    const character = parameters[5];
    const inc = voice.digitalPhaseIncrement;
    voice.phaseA = wrap(voice.phaseA + inc);
    if (voice.profile.family === 'phase') {
      const phase = voice.phaseA;
      const bend = .08 + source * .84;
      const distorted = phase < bend ? phase * .5 / bend : .5 + (phase - bend) * .5 / (1 - bend);
      const resonant = Math.sin(TAU * distorted)
        + Math.sin(TAU * distorted * voice.phaseDistortionHarmonic) * character * .38;
      return fastTanh(resonant * (1 + loop));
    }
    if (voice.profile.family === 'sample') {
      if (voice.holdCounter-- <= 0) {
        voice.noise = (Math.imul(1664525, voice.noise) + 1013904223) >>> 0;
        const noise = (voice.noise / 2147483648 - 1) * .04 * character;
        const harmonic = Math.sin(TAU * voice.phaseA)
          + Math.sin(TAU * voice.phaseA * voice.sampleHarmonic) * .35;
        voice.hold = Math.round((harmonic + noise) * 63) / 63;
        voice.holdCounter = voice.sampleHoldLength;
      }
      voice.poles[0] += (.10 + color * .55) * (voice.hold - voice.poles[0]);
      return voice.poles[0];
    }
    const tableA = Math.sin(TAU * voice.phaseA);
    const tableB = saw(voice.phaseA, inc);
    const tableC = tableA * Math.sin(TAU * voice.phaseA * voice.digitalHarmonic);
    return tableA * (1 - source) + (tableB * (1 - character) + tableC * character) * source;
  }

  captureSample(offset, position, length, crossfadeFrames) {
    const samples = this.captureBank.samples;
    const index = Math.floor(position);
    const fraction = position - index;
    const nextIndex = index + 1 < length ? index + 1 : 0;
    const current = samples[offset + index];
    let value = current + (samples[offset + nextIndex] - current) * fraction;
    const loopStart = length - crossfadeFrames;
    if (crossfadeFrames > 0 && position >= loopStart) {
      const headPosition = position - loopStart;
      const headIndex = Math.floor(headPosition);
      const headFraction = headPosition - headIndex;
      const headNext = headIndex + 1 < length ? headIndex + 1 : 0;
      const head = samples[offset + headIndex];
      const headValue = head + (samples[offset + headNext] - head) * headFraction;
      value += (headValue - value) * (headPosition / crossfadeFrames);
    }
    return value;
  }

  advanceCaptureVoice(voice) {
    voice.capturePosition += voice.captureIncrement;
    const loopSpan = Math.max(1, voice.captureLength - voice.captureCrossfade);
    while (voice.capturePosition >= voice.captureLength) voice.capturePosition -= loopSpan;
  }

  renderCapturedTone(voice) {
    const value = this.captureSample(
      voice.captureToneOffset,
      voice.capturePosition,
      voice.captureLength,
      voice.captureCrossfade,
    );
    this.advanceCaptureVoice(voice);
    return value;
  }

  renderCapturedSource(voice) {
    const offsets = voice.captureSourceOffsets;
    const position = voice.capturePosition;
    const length = voice.captureLength;
    const crossfade = voice.captureCrossfade;
    const source = this.parameters[0];
    const motion = this.parameters[5];
    const source00 = this.captureSample(offsets[0], position, length, crossfade);
    const source10 = this.captureSample(offsets[1], position, length, crossfade);
    const source01 = this.captureSample(offsets[2], position, length, crossfade);
    const source11 = this.captureSample(offsets[3], position, length, crossfade);
    const lowMotion = source00 + (source10 - source00) * source;
    const highMotion = source01 + (source11 - source01) * source;
    this.advanceCaptureVoice(voice);
    return lowMotion + (highMotion - lowMotion) * motion;
  }

  renderVoice(voice) {
    const family = voice.profile.family;
    if (family === 'fm') return this.fmSource(voice);
    if (family === 'phase' || family === 'sample' || family === 'wavetable') {
      const source = this.digitalSource(voice);
      return family === 'wavetable' ? this.ota(voice, source) : source;
    }
    const source = this.analogSource(voice);
    if (family === 'ladder') return this.spiceLadder(voice, source);
    if (family === 'korg35') return this.korg35(voice, source);
    if (family === 'hybrid') {
      const digital = this.digitalSource(voice);
      return this.ladder(voice, source * .52 + digital * .48, true);
    }
    return this.ota(voice, source);
  }

  dcBlock(value, state) {
    const output = value - state.input + .995 * state.output;
    state.input = value;
    state.output = output;
    return output;
  }

  compactVoices() {
    let write = 0;
    for (let read = 0; read < this.activeVoiceCount; read += 1) {
      const voiceIndex = this.activeVoiceIndices[read];
      const voice = this.voices[voiceIndex];
      if (voice.releasing && voice.env < .00008) {
        voice.active = false;
        continue;
      }
      this.activeVoiceIndices[write++] = voiceIndex;
    }
    this.activeVoiceCount = write;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];
    if (!left) return true;
    this.renderQuantumFrames = left.length;
    this.advanceParameterMorph(left.length);
    const quality = this.quality;
    const dt = 1 / (sampleRate * quality);
    const renderMode = this.resolveRenderMode();
    let normalizationVoiceCount = -1;
    let normalization = quality;
    for (let i = 0; i < left.length; i += 1) {
      if (this.sequencer.playing) {
        let scheduledSteps = 0;
        while (this.frameCounter >= this.sequencer.nextStepFrame && scheduledSteps < 4) {
          this.triggerSequencerStep();
          scheduledSteps += 1;
        }
        if (scheduledSteps === 4 && this.frameCounter >= this.sequencer.nextStepFrame) {
          this.sequencer.nextStepFrame = this.frameCounter + this.sequencer.stepFrames;
        }
      }
      let sumL = 0;
      let sumR = 0;
      let hasFinishedVoice = false;
      if (this.enabled) {
        for (let sub = 0; sub < quality; sub += 1) {
          let subL = 0;
          let subR = 0;
          let hybridL = 0;
          let hybridR = 0;
          for (let active = 0; active < this.activeVoiceCount; active += 1) {
            const voice = this.voices[this.activeVoiceIndices[active]];
            const envelope = this.envelope(voice, dt);
            const captureReady = voice.captureLength > 0 && voice.captureToneOffset >= 0;
            if (renderMode === 'hybrid' && captureReady) {
              const source = this.renderCapturedSource(voice) * envelope * voice.velocity;
              hybridL += source * voice.panL;
              hybridR += source * voice.panR;
            } else {
              const source = renderMode === 'capture' && captureReady
                ? this.renderCapturedTone(voice)
                : this.renderVoice(voice);
              const value = source * envelope * voice.profile.level * voice.velocity;
              subL += value * voice.panL;
              subR += value * voice.panR;
            }
            if (voice.releasing && voice.env < .00008) hasFinishedVoice = true;
          }
          if (renderMode === 'hybrid') {
            const level = this.captureBank?.profileLevel || PROFILES['model-d'].level;
            subL += this.spiceLadder(this.hybridBusL, hybridL) * level;
            subR += this.spiceLadder(this.hybridBusR, hybridR) * level;
          }
          sumL += subL;
          sumR += subR;
        }
      }
      if (hasFinishedVoice) this.compactVoices();
      if (normalizationVoiceCount !== this.activeVoiceCount) {
        normalizationVoiceCount = this.activeVoiceCount;
        normalization = quality * Math.sqrt(Math.max(1, normalizationVoiceCount) * .72);
      }
      let outL = this.dcBlock(sumL / normalization, this.dcL);
      let outR = this.dcBlock(sumR / normalization, this.dcR);
      if (Math.abs(outL) > .98 || Math.abs(outR) > .98) this.clippedSamples += 1;
      outL = fastTanh(outL * OUTPUT_SATURATION_GAIN) * OUTPUT_SATURATION_NORMALIZATION;
      outR = fastTanh(outR * OUTPUT_SATURATION_GAIN) * OUTPUT_SATURATION_NORMALIZATION;
      left[i] = Number.isFinite(outL) ? outL : 0;
      right[i] = Number.isFinite(outR) ? outR : 0;
      this.peak = Math.max(this.peak * .9997, Math.abs(left[i]), Math.abs(right[i]));
      this.frameCounter += 1;
    }
    this.telemetryCountdown -= left.length;
    if (this.telemetryCountdown <= 0) {
      const profile = PROFILES[this.machine];
      const topology = renderMode === 'hybrid'
        ? 'CAPTURED OSC + SHARED BJT-C SPICE'
        : renderMode === 'capture'
          ? 'LOSSLESS FLOAT32 CIRCUIT CAPTURE'
          : profile.topology;
      const message = this.telemetryMessage;
      message.activeVoices = this.activeVoiceCount;
      message.peak = this.peak;
      message.oversample = this.quality;
      message.machine = this.machine;
      message.topology = topology;
      message.solver = renderMode === 'capture' ? 'PCM INTERPOLATOR' : profile.solver || 'TOPOLOGY DSP';
      message.solverIterations = renderMode === 'capture'
        ? 0
        : profile.family === 'ladder'
          ? (this.quality >= 4 ? 2 : 1)
          : 0;
      message.renderMode = renderMode;
      message.captureReady = Boolean(this.captureBank);
      message.temperatureC = profile.family === 'ladder' && this.activeVoiceCount > 0
        ? this.voices[this.activeVoiceIndices[0]].temperatureK - 273.15
        : 27;
      message.renderQuantumFrames = this.renderQuantumFrames;
      message.clippedSamples = this.clippedSamples;
      this.port.postMessage(message);
      this.telemetryCountdown += sampleRate >> 2;
    }
    return true;
  }
}

registerProcessor('calcotone-synth-circuit-processor', CalcotoneSynthCircuitProcessor);
