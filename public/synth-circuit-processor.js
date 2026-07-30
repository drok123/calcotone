/*
 * CALCOTONE topology-derived synth core.
 *
 * This is intentionally a realtime circuit model, not a SPICE netlist. The
 * oscillator, filter, converter and operator structures follow the signal
 * topology of the named instrument families while bounded nonlinearities,
 * oversampling and explicit state guards keep the audio thread deterministic.
 */

const TAU = Math.PI * 2;
const MAX_VOICES = 10;
const PROFILES = {
  'model-d':  { topology: 'TRANSISTOR LADDER', family: 'ladder', attack: .008, decay: .18, sustain: .58, release: .14, cutoff: 5400, resonance: .67, drive: 2.1, level: .17 },
  'juno-106': { topology: 'IR3109 OTA CASCADE', family: 'ota', attack: .015, decay: .26, sustain: .68, release: .24, cutoff: 7200, resonance: .40, drive: 1.25, level: .15 },
  'sh-101':   { topology: 'OTA MONO + SUB', family: 'ota', attack: .004, decay: .12, sustain: .48, release: .08, cutoff: 4600, resonance: .58, drive: 1.5, level: .16 },
  'prophet-5':{ topology: 'SSM/CEM POLY CASCADE', family: 'ota', attack: .018, decay: .32, sustain: .62, release: .32, cutoff: 6500, resonance: .44, drive: 1.4, level: .145 },
  'dx7':      { topology: '6-OP PHASE MODULATION', family: 'fm', attack: .004, decay: .42, sustain: .34, release: .46, cutoff: 16000, resonance: .05, drive: 1, level: .15 },
  'ms-20':    { topology: 'KORG-35 HP/LP', family: 'korg35', attack: .006, decay: .16, sustain: .52, release: .13, cutoff: 3800, resonance: .76, drive: 2.5, level: .14 },
  'polysix':  { topology: 'SSM2044 + ENSEMBLE', family: 'ota', attack: .025, decay: .30, sustain: .70, release: .38, cutoff: 6900, resonance: .38, drive: 1.28, level: .145 },
  'ob-xa':    { topology: 'CEM3320 2/4-POLE', family: 'ota', attack: .018, decay: .28, sustain: .72, release: .34, cutoff: 7600, resonance: .32, drive: 1.42, level: .135 },
  'fairlight':{ topology: '8-BIT CMI DAC', family: 'sample', attack: .003, decay: .34, sustain: .42, release: .20, cutoff: 8400, resonance: .14, drive: 1.25, level: .18 },
  'ppg-wave': { topology: 'DIGITAL WAVETABLE + VCF', family: 'wavetable', attack: .012, decay: .30, sustain: .56, release: .34, cutoff: 9800, resonance: .38, drive: 1.35, level: .14 },
  'cz-101':   { topology: 'PHASE DISTORTION + DCA', family: 'phase', attack: .006, decay: .24, sustain: .50, release: .22, cutoff: 11000, resonance: .20, drive: 1.5, level: .15 },
  'calcotone':{ topology: 'MORPH CORE + LADDER', family: 'hybrid', attack: .008, decay: .22, sustain: .54, release: .40, cutoff: 8200, resonance: .52, drive: 2.15, level: .13 },
};

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const midiToFrequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const wrap = (phase) => phase - Math.floor(phase);

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
    this.quality = 2;
    this.voices = [];
    this.frameCounter = 0;
    this.telemetryCountdown = sampleRate >> 2;
    this.peak = 0;
    this.clippedSamples = 0;
    this.dcL = { input: 0, output: 0 };
    this.dcR = { input: 0, output: 0 };
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(data) {
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'enabled') {
      this.enabled = Boolean(data.value);
      if (!this.enabled) this.releaseAll();
    } else if (data.type === 'machine' && PROFILES[data.value]) {
      this.machine = data.value;
    } else if (data.type === 'parameters' && Array.isArray(data.values)) {
      this.parameters = Array.from({ length: 6 }, (_, i) => clamp(data.values[i] ?? .5));
    } else if (data.type === 'quality') {
      this.quality = data.factor >= 4 ? 4 : data.factor >= 2 ? 2 : 1;
    } else if (data.type === 'note-on' && this.enabled) {
      this.noteOn(data);
    } else if (data.type === 'all-notes-off' || data.type === 'dispose') {
      this.releaseAll();
    }
  }

  noteOn(data) {
    if (this.voices.length >= MAX_VOICES) {
      this.voices.sort((a, b) => a.env - b.env || b.age - a.age);
      this.voices.shift();
    }
    const midi = clamp(data.midi, 0, 127);
    const profile = PROFILES[this.machine];
    const seed = ((midi * 1103515245 + this.frameCounter + this.voices.length * 7919) >>> 0) || 1;
    this.voices.push({
      machine: this.machine,
      profile,
      parameters: [...this.parameters],
      frequency: midiToFrequency(midi),
      velocity: clamp(data.velocity ?? .78),
      duration: Math.max(.035, Math.min(4, data.durationSeconds ?? .2)),
      age: 0,
      releaseAge: 0,
      releasing: false,
      env: 0,
      phaseA: (seed & 65535) / 65536,
      phaseB: ((seed >>> 16) & 65535) / 65536,
      subPhase: 0,
      opPhases: new Float64Array(6),
      opMemory: new Float64Array(6),
      poles: new Float64Array(6),
      previous: 0,
      hold: 0,
      holdCounter: 0,
      noise: seed,
      pan: ((((seed >>> 8) & 255) / 255) * 2 - 1) * this.parameters[5] * .24,
    });
  }

  releaseAll() {
    for (const voice of this.voices) voice.releasing = true;
  }

  envelope(voice, dt) {
    const p = voice.profile;
    const contour = voice.parameters[3];
    const attack = Math.max(.002, p.attack * (.3 + contour * 1.4));
    const decay = Math.max(.012, p.decay * (.5 + contour));
    const release = Math.max(.018, p.release * (.45 + contour * 1.8));
    voice.age += dt;
    if (!voice.releasing && voice.age >= voice.duration) voice.releasing = true;
    if (voice.releasing) {
      voice.releaseAge += dt;
      voice.env *= Math.exp(-dt * 7.2 / release);
      return voice.env;
    }
    if (voice.age < attack) {
      voice.env += (1 - voice.env) * Math.min(1, dt * 6 / attack);
    } else {
      const sustain = p.sustain;
      voice.env += (sustain - voice.env) * Math.min(1, dt * 4 / decay);
    }
    return voice.env;
  }

  advance(voice, key, frequency, dt) {
    const increment = clamp(frequency * dt, 1e-7, .45);
    voice[key] = wrap(voice[key] + increment);
    return increment;
  }

  analogSource(voice, dt) {
    const [source, , , , character, motion] = voice.parameters;
    const frequency = voice.frequency;
    const detune = (motion - .5) * .013;
    const incA = this.advance(voice, 'phaseA', frequency * (1 - detune), dt);
    const incB = this.advance(voice, 'phaseB', frequency * Math.pow(2, voice.machine === 'prophet-5' || voice.machine === 'ob-xa' ? detune : -1 + detune), dt);
    let a = saw(voice.phaseA, incA);
    let b = pulse(voice.phaseB, incB, .34 + character * .32);
    if (voice.machine === 'ob-xa') b = saw(voice.phaseB, incB);
    if (voice.machine === 'sh-101') {
      this.advance(voice, 'subPhase', frequency * .5, dt);
      b = pulse(voice.subPhase, incA * .5, .5) * .85;
    }
    return a * (.72 - source * .42) + b * (.28 + source * .42);
  }

  ladder(voice, input, dt, hybrid = false) {
    const [, color, resonance, contour, character] = voice.parameters;
    const profile = voice.profile;
    const cutoff = clamp(profile.cutoff * (.055 + color * color * 1.22) * (.7 + contour * .35), 45, sampleRate * .43);
    const g = 1 - Math.exp(-TAU * cutoff * dt);
    const feedback = clamp(profile.resonance * (.22 + resonance * 1.34), 0, .96) * 4.05;
    let stage = Math.tanh(input * profile.drive * (.72 + character * 2.15) - voice.poles[3] * feedback);
    for (let pole = 0; pole < 4; pole += 1) {
      const target = Math.tanh(stage - voice.poles[pole] * (hybrid ? .18 : .11));
      voice.poles[pole] += g * (target - Math.tanh(voice.poles[pole]));
      stage = voice.poles[pole];
    }
    return Math.tanh(voice.poles[3] * 1.25);
  }

  ota(voice, input, dt) {
    const [, color, resonance, , character, motion] = voice.parameters;
    const p = voice.profile;
    const cutoff = clamp(p.cutoff * (.06 + color * color * 1.18), 55, sampleRate * .43);
    const g = 1 - Math.exp(-TAU * cutoff * dt);
    const feedback = clamp(p.resonance * (.20 + resonance * 1.45), 0, .92) * 3.7;
    let stage = Math.tanh(input * p.drive * (.75 + character * 1.45) - voice.poles[3] * feedback);
    for (let pole = 0; pole < 4; pole += 1) {
      voice.poles[pole] += g * (stage - voice.poles[pole]);
      stage = Math.tanh(voice.poles[pole] * (1.02 + character * .18));
    }
    if (voice.machine === 'ob-xa') return motion < .5 ? voice.poles[1] * .75 : voice.poles[3] * 1.05;
    return voice.poles[3];
  }

  korg35(voice, input, dt) {
    const [, color, resonance, , character] = voice.parameters;
    const p = voice.profile;
    const cutoff = clamp(p.cutoff * (.045 + color * color * 1.18), 45, sampleRate * .40);
    const g = Math.tan(Math.PI * cutoff * dt);
    const damp = .58 + (1 - resonance) * 1.15;
    const drive = p.drive * (.72 + character * 2.35);
    const x = Math.tanh(input * drive - voice.poles[1] * p.resonance * (.35 + resonance * 1.75) * 2.5);
    const high = (x - voice.poles[0] * damp - voice.poles[1]) / (1 + g * (g + damp));
    const band = high * g + voice.poles[0];
    const low = band * g + voice.poles[1];
    voice.poles[0] = high * g + band;
    voice.poles[1] = band * g + low;
    return Math.tanh((color < .18 ? high : low) * 1.45);
  }

  fmSource(voice, dt) {
    const [algorithm, ratio, feedback, envelope, touch, brightness] = voice.parameters;
    const ratios = [
      [1, 1, 2, 3, 4, 6], [1, 2, 3, 1, 5, 7],
      [.5, 1, 1.5, 2, 3, 4], [1, 1.01, 2, 2.01, 4, 4.02],
    ][Math.min(3, Math.floor(algorithm * 4))];
    const levels = [1, .75 + ratio, .50 + brightness, .38 + feedback, .30 + envelope, .22 + touch];
    const values = voice.opMemory;
    const algo = Math.min(3, Math.floor(algorithm * 4));
    for (let op = 5; op >= 0; op -= 1) {
      const inc = voice.frequency * ratios[op] * dt;
      voice.opPhases[op] = wrap(voice.opPhases[op] + inc);
      let modulation = 0;
      if (algo === 0 && op < 5) modulation = values[op + 1] * (1.5 + feedback * 8);
      else if (algo === 1) modulation = op < 3 ? values[op + 3] * (1 + feedback * 6) : 0;
      else if (algo === 2) modulation = op === 0 ? (values[1] + values[2] + values[3]) * (1 + feedback * 3) : op >= 4 ? values[5] * feedback * 5 : 0;
      else modulation = op % 2 === 0 ? values[op + 1] * (1 + feedback * 5) : 0;
      if (op === 5) modulation += values[5] * feedback * 1.35;
      values[op] = Math.sin(TAU * voice.opPhases[op] + modulation) * levels[op];
    }
    if (algo === 0) return values[0];
    if (algo === 1) return (values[0] + values[1] + values[2]) * .42;
    if (algo === 2) return (values[0] + values[4]) * .58;
    return (values[0] + values[2] + values[4]) * .38;
  }

  digitalSource(voice, dt) {
    const [source, start, tune, loop, color, character] = voice.parameters;
    const frequency = voice.frequency * Math.pow(2, (tune - .5));
    const inc = this.advance(voice, 'phaseA', frequency, dt);
    if (voice.profile.family === 'phase') {
      const phase = voice.phaseA;
      const bend = .08 + source * .84;
      const distorted = phase < bend ? phase * .5 / bend : .5 + (phase - bend) * .5 / (1 - bend);
      const resonant = Math.sin(TAU * distorted) + Math.sin(TAU * distorted * (2 + Math.floor(color * 6))) * character * .38;
      return Math.tanh(resonant * (1 + loop));
    }
    if (voice.profile.family === 'sample') {
      const holdLength = 2 + Math.floor((1 - color) * 15);
      if (voice.holdCounter-- <= 0) {
        voice.noise = (Math.imul(1664525, voice.noise) + 1013904223) >>> 0;
        const noise = (voice.noise / 2147483648 - 1) * .04 * character;
        const harmonic = Math.sin(TAU * voice.phaseA) + Math.sin(TAU * voice.phaseA * (2 + Math.floor(source * 8))) * .35;
        voice.hold = Math.round((harmonic + noise) * 63) / 63;
        voice.holdCounter = holdLength;
      }
      voice.poles[0] += (.10 + color * .55) * (voice.hold - voice.poles[0]);
      return voice.poles[0];
    }
    const tableA = Math.sin(TAU * voice.phaseA);
    const tableB = saw(voice.phaseA, inc);
    const tableC = Math.sin(TAU * voice.phaseA) * Math.sin(TAU * voice.phaseA * (2 + Math.floor(start * 7)));
    return tableA * (1 - source) + (tableB * (1 - character) + tableC * character) * source;
  }

  renderVoice(voice, dt) {
    const family = voice.profile.family;
    if (family === 'fm') return this.fmSource(voice, dt);
    if (family === 'phase' || family === 'sample' || family === 'wavetable') {
      const source = this.digitalSource(voice, dt);
      return family === 'wavetable' ? this.ota(voice, source, dt) : source;
    }
    const source = this.analogSource(voice, dt);
    if (family === 'ladder') return this.ladder(voice, source, dt);
    if (family === 'korg35') return this.korg35(voice, source, dt);
    if (family === 'hybrid') {
      const digital = this.digitalSource(voice, dt);
      return this.ladder(voice, source * .52 + digital * .48, dt, true);
    }
    return this.ota(voice, source, dt);
  }

  dcBlock(value, state) {
    const output = value - state.input + .995 * state.output;
    state.input = value;
    state.output = output;
    return output;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];
    if (!left) return true;
    const quality = this.quality;
    const dt = 1 / (sampleRate * quality);
    for (let i = 0; i < left.length; i += 1) {
      let sumL = 0;
      let sumR = 0;
      if (this.enabled) {
        for (let sub = 0; sub < quality; sub += 1) {
          let subL = 0;
          let subR = 0;
          for (const voice of this.voices) {
            const envelope = this.envelope(voice, dt);
            const value = this.renderVoice(voice, dt) * envelope * voice.profile.level * voice.velocity;
            const panL = Math.sqrt((1 - voice.pan) * .5);
            const panR = Math.sqrt((1 + voice.pan) * .5);
            subL += value * panL;
            subR += value * panR;
          }
          sumL += subL;
          sumR += subR;
        }
      }
      this.voices = this.voices.filter((voice) => !(voice.releasing && voice.env < .00008));
      const normalization = quality * Math.sqrt(Math.max(1, this.voices.length) * .72);
      let outL = this.dcBlock(sumL / normalization, this.dcL);
      let outR = this.dcBlock(sumR / normalization, this.dcR);
      if (Math.abs(outL) > .98 || Math.abs(outR) > .98) this.clippedSamples += 1;
      outL = Math.tanh(outL * 1.08) / Math.tanh(1.08);
      outR = Math.tanh(outR * 1.08) / Math.tanh(1.08);
      left[i] = Number.isFinite(outL) ? outL : 0;
      right[i] = Number.isFinite(outR) ? outR : 0;
      this.peak = Math.max(this.peak * .9997, Math.abs(left[i]), Math.abs(right[i]));
      this.frameCounter += 1;
      this.telemetryCountdown -= 1;
      if (this.telemetryCountdown <= 0) {
        const profile = PROFILES[this.machine];
        this.port.postMessage({
          type: 'telemetry',
          activeVoices: this.voices.length,
          maxVoices: MAX_VOICES,
          peak: this.peak,
          oversample: this.quality,
          machine: this.machine,
          topology: profile.topology,
          clippedSamples: this.clippedSamples,
        });
        this.telemetryCountdown = sampleRate >> 2;
      }
    }
    return true;
  }
}

registerProcessor('calcotone-synth-circuit-processor', CalcotoneSynthCircuitProcessor);
