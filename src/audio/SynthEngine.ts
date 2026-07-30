export type SynthMachine =
  | 'model-d'
  | 'juno-106'
  | 'sh-101'
  | 'prophet-5'
  | 'dx7'
  | 'ms-20'
  | 'polysix'
  | 'ob-xa'
  | 'fairlight'
  | 'ppg-wave'
  | 'cz-101'
  | 'calcotone';

type VoiceFamily = 'analog' | 'fm' | 'sample' | 'wavetable' | 'phase';

type MachineProfile = {
  family: VoiceFamily;
  oscillatorA: OscillatorType;
  oscillatorB: OscillatorType;
  transposeB: number;
  detune: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  drive: number;
  level: number;
};

type ActiveVoice = {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  stopAt: number;
};

const MACHINE_PROFILES: Record<SynthMachine, MachineProfile> = {
  'model-d': { family: 'analog', oscillatorA: 'sawtooth', oscillatorB: 'square', transposeB: -12, detune: 3, attack: .008, decay: .18, sustain: .58, release: .14, cutoff: 5400, resonance: 5, drive: 1.9, level: .17 },
  'juno-106': { family: 'analog', oscillatorA: 'sawtooth', oscillatorB: 'square', transposeB: -12, detune: 8, attack: .015, decay: .26, sustain: .68, release: .24, cutoff: 7200, resonance: 3.4, drive: 1.15, level: .15 },
  'sh-101': { family: 'analog', oscillatorA: 'square', oscillatorB: 'sawtooth', transposeB: -12, detune: 1, attack: .004, decay: .12, sustain: .48, release: .08, cutoff: 4600, resonance: 8, drive: 1.35, level: .16 },
  'prophet-5': { family: 'analog', oscillatorA: 'sawtooth', oscillatorB: 'triangle', transposeB: 0, detune: 11, attack: .018, decay: .32, sustain: .62, release: .32, cutoff: 6500, resonance: 4.5, drive: 1.25, level: .145 },
  'dx7': { family: 'fm', oscillatorA: 'sine', oscillatorB: 'sine', transposeB: 12, detune: 0, attack: .004, decay: .42, sustain: .34, release: .46, cutoff: 14000, resonance: .7, drive: 1, level: .15 },
  'ms-20': { family: 'analog', oscillatorA: 'sawtooth', oscillatorB: 'square', transposeB: -12, detune: 5, attack: .006, decay: .16, sustain: .52, release: .13, cutoff: 3800, resonance: 13, drive: 2.25, level: .14 },
  'polysix': { family: 'analog', oscillatorA: 'sawtooth', oscillatorB: 'square', transposeB: -12, detune: 9, attack: .025, decay: .3, sustain: .7, release: .38, cutoff: 6900, resonance: 3.8, drive: 1.18, level: .145 },
  'ob-xa': { family: 'analog', oscillatorA: 'sawtooth', oscillatorB: 'sawtooth', transposeB: 0, detune: 16, attack: .018, decay: .28, sustain: .72, release: .34, cutoff: 7600, resonance: 3, drive: 1.3, level: .135 },
  'fairlight': { family: 'sample', oscillatorA: 'sine', oscillatorB: 'triangle', transposeB: 12, detune: 0, attack: .003, decay: .34, sustain: .42, release: .2, cutoff: 8400, resonance: 1.8, drive: 1.4, level: .18 },
  'ppg-wave': { family: 'wavetable', oscillatorA: 'sawtooth', oscillatorB: 'triangle', transposeB: 12, detune: 7, attack: .012, decay: .3, sustain: .56, release: .34, cutoff: 9800, resonance: 4, drive: 1.25, level: .14 },
  'cz-101': { family: 'phase', oscillatorA: 'square', oscillatorB: 'sine', transposeB: 12, detune: 2, attack: .006, decay: .24, sustain: .5, release: .22, cutoff: 11000, resonance: 2.2, drive: 1.55, level: .15 },
  'calcotone': { family: 'wavetable', oscillatorA: 'sawtooth', oscillatorB: 'square', transposeB: -12, detune: 13, attack: .008, decay: .22, sustain: .54, release: .4, cutoff: 8200, resonance: 6.5, drive: 2.1, level: .13 },
};

const MAX_VOICES = 10;

export class SynthEngine {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private machine: SynthMachine = 'model-d';
  private parameters = [.58, .46, .26, .54, .22, .08];
  private enabled = false;
  private voices: ActiveVoice[] = [];
  private lastMidi = 60;
  private sampleWave: AudioBuffer | null = null;

  public constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(enabled ? 1 : 0, now, enabled ? .008 : .018);
    if (!enabled) this.releaseAll(now);
  }

  public setMachine(machine: SynthMachine): void {
    this.machine = machine;
  }

  public setParameters(values: readonly number[]): void {
    this.parameters = Array.from({ length: 6 }, (_, index) => clamp01(values[index] ?? .5));
  }

  public triggerNote(midi: number, durationSeconds: number, velocity = .78): void {
    if (!this.enabled || this.context.state !== 'running') return;
    this.pruneVoices();
    if (this.voices.length >= MAX_VOICES) this.stopVoice(this.voices.shift());

    const profile = MACHINE_PROFILES[this.machine];
    const now = this.context.currentTime + .006;
    const duration = Math.max(.035, Math.min(2, durationSeconds));
    const voice = profile.family === 'fm'
      ? this.createFmVoice(midi, now, duration, velocity, profile)
      : profile.family === 'sample'
        ? this.createSampleVoice(midi, now, duration, velocity, profile)
        : this.createSubtractiveVoice(midi, now, duration, velocity, profile);
    this.voices.push(voice);
    this.lastMidi = midi;
  }

  public dispose(): void {
    this.releaseAll(this.context.currentTime);
    this.output.disconnect();
    this.sampleWave = null;
  }

  private createSubtractiveVoice(
    midi: number,
    now: number,
    duration: number,
    velocity: number,
    profile: MachineProfile
  ): ActiveVoice {
    const [source, color, resonance, contour, character, motion] = this.parameters;
    const oscillatorA = this.context.createOscillator();
    const oscillatorB = this.context.createOscillator();
    const mixA = this.context.createGain();
    const mixB = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const shaper = this.context.createWaveShaper();
    const amp = this.context.createGain();
    const pan = this.context.createStereoPanner();
    const baseFrequency = midiToFrequency(midi);
    const glide = this.machine === 'model-d' || this.machine === 'sh-101'
      ? motion * motion * .18
      : 0;

    oscillatorA.type = profile.oscillatorA;
    oscillatorB.type = profile.oscillatorB;
    oscillatorA.frequency.setValueAtTime(glide > 0 ? midiToFrequency(this.lastMidi) : baseFrequency, now);
    oscillatorB.frequency.setValueAtTime(
      (glide > 0 ? midiToFrequency(this.lastMidi) : baseFrequency) * Math.pow(2, profile.transposeB / 12),
      now
    );
    if (glide > 0) {
      oscillatorA.frequency.exponentialRampToValueAtTime(baseFrequency, now + glide);
      oscillatorB.frequency.exponentialRampToValueAtTime(baseFrequency * Math.pow(2, profile.transposeB / 12), now + glide);
    }
    oscillatorA.detune.value = -profile.detune * (.35 + motion);
    oscillatorB.detune.value = profile.detune * (.35 + motion);
    mixA.gain.value = .25 + (1 - source) * .55;
    mixB.gain.value = .18 + source * .62;

    filter.type = this.machine === 'ms-20' && color < .2 ? 'highpass' : 'lowpass';
    const cutoff = Math.max(90, profile.cutoff * (.08 + color * color * 1.15));
    filter.frequency.setValueAtTime(Math.max(70, cutoff * (.35 + contour * .35)), now);
    filter.frequency.exponentialRampToValueAtTime(cutoff, now + .015 + contour * .09);
    filter.frequency.exponentialRampToValueAtTime(Math.max(75, cutoff * (.24 + contour * .5)), now + duration + profile.decay);
    filter.Q.value = Math.min(24, profile.resonance * (.25 + resonance * 1.55));
    shaper.curve = makeDriveCurve(profile.drive * (.7 + character * 2.6), profile.family === 'phase' ? 24 : 0);
    shaper.oversample = '2x';
    pan.pan.value = (Math.random() * 2 - 1) * motion * .22;

    oscillatorA.connect(mixA);
    oscillatorB.connect(mixB);
    mixA.connect(filter);
    mixB.connect(filter);
    filter.connect(shaper);
    shaper.connect(amp);
    amp.connect(pan);
    pan.connect(this.output);

    const release = profile.release * (.45 + contour * 1.8);
    scheduleEnvelope(amp.gain, now, duration, profile.attack * (.3 + contour * 1.4), profile.decay, profile.sustain, release, profile.level * clamp01(velocity));
    oscillatorA.start(now);
    oscillatorB.start(now);
    const stopAt = now + duration + release + .08;
    oscillatorA.stop(stopAt);
    oscillatorB.stop(stopAt);
    return this.trackVoice([oscillatorA, oscillatorB], [oscillatorA, oscillatorB, mixA, mixB, filter, shaper, amp, pan], stopAt);
  }

  private createFmVoice(
    midi: number,
    now: number,
    duration: number,
    velocity: number,
    profile: MachineProfile
  ): ActiveVoice {
    const [algorithm, ratio, feedback, envelope, touch, brightness] = this.parameters;
    const carrier = this.context.createOscillator();
    const modulator = this.context.createOscillator();
    const modDepth = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const amp = this.context.createGain();
    const frequency = midiToFrequency(midi);
    const ratios = [.5, 1, 1.5, 2, 3, 4, 6, 8];
    const selectedRatio = ratios[Math.min(ratios.length - 1, Math.floor(ratio * ratios.length))];

    carrier.type = algorithm > .72 ? 'triangle' : 'sine';
    carrier.frequency.value = frequency;
    modulator.type = feedback > .7 ? 'sawtooth' : 'sine';
    modulator.frequency.value = frequency * selectedRatio;
    modDepth.gain.setValueAtTime(frequency * (.2 + feedback * 7.5), now);
    modDepth.gain.exponentialRampToValueAtTime(Math.max(1, frequency * (.08 + brightness * 1.4)), now + duration + .22);
    filter.type = 'lowpass';
    filter.frequency.value = 2800 + brightness * 15000;
    filter.Q.value = 1 + algorithm * 3;

    modulator.connect(modDepth);
    modDepth.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(amp);
    amp.connect(this.output);

    const release = profile.release * (.35 + envelope * 1.8);
    scheduleEnvelope(amp.gain, now, duration, profile.attack * (.25 + envelope), profile.decay * (.5 + envelope), profile.sustain, release, profile.level * (.55 + touch * .65) * clamp01(velocity));
    carrier.start(now);
    modulator.start(now);
    const stopAt = now + duration + release + .08;
    carrier.stop(stopAt);
    modulator.stop(stopAt);
    return this.trackVoice([carrier, modulator], [carrier, modulator, modDepth, filter, amp], stopAt);
  }

  private createSampleVoice(
    midi: number,
    now: number,
    duration: number,
    velocity: number,
    profile: MachineProfile
  ): ActiveVoice {
    const [sample, start, tune, loop, color, character] = this.parameters;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const shaper = this.context.createWaveShaper();
    const amp = this.context.createGain();
    source.buffer = this.getSampleWave();
    source.loop = loop > .48;
    source.loopStart = .035 + start * .08;
    source.loopEnd = .18 + loop * .32;
    source.playbackRate.value = Math.pow(2, (midi - 60 + (tune - .5) * 12) / 12);
    filter.type = 'lowpass';
    filter.frequency.value = 900 + color * 11200;
    filter.Q.value = .7 + character * 5;
    shaper.curve = makeDriveCurve(profile.drive * (.7 + character * 2), Math.round(sample * 18));
    shaper.oversample = 'none';
    source.connect(filter);
    filter.connect(shaper);
    shaper.connect(amp);
    amp.connect(this.output);
    const release = profile.release * (.7 + loop);
    scheduleEnvelope(amp.gain, now, duration, profile.attack, profile.decay, profile.sustain, release, profile.level * clamp01(velocity));
    source.start(now, start * .12);
    const stopAt = now + duration + release + .08;
    source.stop(stopAt);
    return this.trackVoice([source], [source, filter, shaper, amp], stopAt);
  }

  private getSampleWave(): AudioBuffer {
    if (this.sampleWave) return this.sampleWave;
    const length = Math.floor(this.context.sampleRate * .6);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let held = 0;
    for (let index = 0; index < length; index += 1) {
      const phase = index / this.context.sampleRate;
      if (index % 7 === 0) {
        held = Math.sin(phase * Math.PI * 2 * 261.63)
          + Math.sin(phase * Math.PI * 2 * 523.26) * .34
          + (Math.random() * 2 - 1) * .055;
      }
      data[index] = held * Math.exp(-phase * 1.2) * .62;
    }
    this.sampleWave = buffer;
    return buffer;
  }

  private trackVoice(
    sources: AudioScheduledSourceNode[],
    nodes: AudioNode[],
    stopAt: number
  ): ActiveVoice {
    const voice = { sources, nodes, stopAt };
    const cleanup = () => {
      if (!this.voices.includes(voice)) return;
      this.voices = this.voices.filter((candidate) => candidate !== voice);
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    };
    sources[0].addEventListener('ended', cleanup, { once: true });
    return voice;
  }

  private pruneVoices(): void {
    const now = this.context.currentTime;
    const expired = this.voices.filter((voice) => voice.stopAt <= now);
    this.voices = this.voices.filter((voice) => voice.stopAt > now);
    for (const voice of expired) {
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    }
  }

  private releaseAll(now: number): void {
    for (const voice of this.voices) {
      for (const source of voice.sources) {
        try { source.stop(now + .025); } catch { /* already stopped */ }
      }
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    }
    this.voices = [];
  }

  private stopVoice(voice: ActiveVoice | undefined): void {
    if (!voice) return;
    for (const source of voice.sources) {
      try { source.stop(this.context.currentTime + .008); } catch { /* already stopped */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
  }
}

function scheduleEnvelope(
  gain: AudioParam,
  start: number,
  duration: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  peak: number
): void {
  const attackEnd = start + Math.max(.002, attack);
  const releaseStart = start + duration;
  const decayEnd = Math.min(
    releaseStart - .002,
    attackEnd + Math.max(.012, decay)
  );
  gain.setValueAtTime(.0001, start);
  gain.exponentialRampToValueAtTime(Math.max(.0002, peak), attackEnd);
  if (decayEnd > attackEnd) {
    gain.exponentialRampToValueAtTime(Math.max(.0002, peak * sustain), decayEnd);
  }
  gain.setValueAtTime(Math.max(.0002, peak * sustain), releaseStart);
  gain.exponentialRampToValueAtTime(.0001, releaseStart + Math.max(.018, release));
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function makeDriveCurve(amount: number, quantizeSteps: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  const drive = Math.max(.1, amount);
  for (let index = 0; index < curve.length; index += 1) {
    const input = index / (curve.length - 1) * 2 - 1;
    let output = Math.tanh(input * drive) / Math.tanh(drive);
    if (quantizeSteps > 1) output = Math.round(output * quantizeSteps) / quantizeSteps;
    curve[index] = output;
  }
  return curve;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : .5));
}
