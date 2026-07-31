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

export type SynthQualityMode = 'live' | 'balanced' | 'studio';
export type SynthRenderMode = 'auto' | 'circuit' | 'capture' | 'hybrid';

export interface SynthSequencerNote {
  pitch: number;
  length: number;
}

export interface SynthSequencerState {
  patterns: readonly (readonly (readonly SynthSequencerNote[])[])[];
  patternIndex: number;
  chain: readonly number[];
  chainArmed: boolean;
  chainPosition: number;
  bpm: number;
  playing: boolean;
  startStep: number;
}

export interface SynthSequencerStep {
  step: number;
  patternIndex: number;
  chainPosition: number;
}

export interface SynthTelemetryStats {
  activeVoices: number;
  maxVoices: number;
  peak: number;
  oversample: number;
  machine: SynthMachine;
  topology: string;
  solver: string;
  solverIterations: number;
  temperatureC: number;
  renderQuantumFrames: number;
  clippedSamples: number;
  renderMode: Exclude<SynthRenderMode, 'auto'>;
  captureReady: boolean;
}

export const MAX_SYNTH_CHORD_NOTES = 8;

const EMPTY_TELEMETRY: SynthTelemetryStats = {
  activeVoices: 0,
  maxVoices: 10,
  peak: 0,
  oversample: 2,
  machine: 'model-d',
  topology: '4× BJT-C SPICE LADDER',
  solver: 'BJT-C NEWTON',
  solverIterations: 1,
  temperatureC: 27,
  renderQuantumFrames: 0,
  clippedSamples: 0,
  renderMode: 'circuit',
  captureReady: false,
};

/**
 * Produces a stable chord payload for both the UI sequencer and worklet.
 * Notes are deduplicated, ordered low-to-high, capped to the practical voice
 * budget and retain independent lengths rather than collapsing to one gate.
 */
export function normalizeSynthChord(
  notes: readonly SynthSequencerNote[],
  step: number,
): SynthSequencerNote[] {
  const byPitch = new Map<number, SynthSequencerNote>();
  for (const note of notes) {
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 11) continue;
    const pitch = clampInteger(note.pitch, 0, 11);
    const length = clampInteger(note.length, 1, 16 - clampInteger(step, 0, 15));
    const previous = byPitch.get(pitch);
    if (!previous || length > previous.length) byPitch.set(pitch, { pitch, length });
  }
  return [...byPitch.values()]
    .sort((left, right) => left.pitch - right.pitch)
    .slice(0, MAX_SYNTH_CHORD_NOTES);
}

/** Main-thread controller for the circuit/capture hybrid synth AudioWorklet. */
export class SynthEngine {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private readonly processor: AudioWorkletNode;
  private readonly captureAbortController = new AbortController();
  private enabled = false;
  private disposed = false;
  private telemetry: SynthTelemetryStats = { ...EMPTY_TELEMETRY };
  private sequencerStepListener: ((position: SynthSequencerStep) => void) | null = null;

  public constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.processor = new AudioWorkletNode(context, 'calcotone-synth-circuit-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.processor.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (isSynthTelemetry(data)) {
        this.telemetry = {
          activeVoices: data.activeVoices,
          maxVoices: data.maxVoices,
          peak: data.peak,
          oversample: data.oversample,
          machine: data.machine,
          topology: data.topology,
          solver: data.solver,
          solverIterations: data.solverIterations,
          temperatureC: data.temperatureC,
          renderQuantumFrames: data.renderQuantumFrames,
          clippedSamples: data.clippedSamples,
          renderMode: data.renderMode,
          captureReady: data.captureReady,
        };
      } else if (isSynthSequencerStep(data)) {
        this.sequencerStepListener?.({
          step: data.step,
          patternIndex: data.patternIndex,
          chainPosition: data.chainPosition,
        });
      }
    };
    this.processor.connect(this.output);
    this.output.connect(destination);
    void this.loadCaptureBank();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(enabled ? 1 : 0, now, enabled ? .008 : .018);
    this.processor.port.postMessage({ type: 'enabled', value: enabled });
  }

  public setMachine(machine: SynthMachine): void {
    this.processor.port.postMessage({ type: 'machine', value: machine });
  }

  public setParameters(values: readonly number[]): void {
    this.processor.port.postMessage({
      type: 'parameters',
      values: Array.from({ length: 6 }, (_, index) => clamp01(values[index] ?? .5)),
    });
  }

  public setQualityMode(mode: SynthQualityMode): void {
    const factor = mode === 'studio' ? 4 : mode === 'balanced' ? 2 : 1;
    this.processor.port.postMessage({ type: 'quality', factor });
  }

  public setRenderMode(mode: SynthRenderMode): void {
    this.processor.port.postMessage({ type: 'render-mode', value: mode });
  }

  public triggerNote(midi: number, durationSeconds: number, velocity = .78): void {
    if (!this.enabled || this.context.state !== 'running') return;
    this.processor.port.postMessage({
      type: 'note-on',
      midi: Math.min(127, Math.max(0, midi)),
      durationSeconds: Math.max(.035, Math.min(12, durationSeconds)),
      velocity: clamp01(velocity),
    });
  }

  public triggerChord(
    midiNotes: readonly number[],
    durationSeconds: number,
    velocity = .74,
  ): void {
    if (!this.enabled || this.context.state !== 'running') return;
    const notes = [...new Set(midiNotes
      .filter(Number.isFinite)
      .map((midi) => clampInteger(midi, 0, 127)))]
      .sort((left, right) => left - right)
      .slice(0, MAX_SYNTH_CHORD_NOTES);
    if (notes.length === 0) return;
    this.processor.port.postMessage({
      type: 'chord-on',
      notes,
      durationSeconds: Math.max(.035, Math.min(12, durationSeconds)),
      velocity: clamp01(velocity),
    });
  }

  public setSequencerState(state: SynthSequencerState): void {
    this.processor.port.postMessage({
      type: 'sequencer-state',
      patterns: state.patterns.slice(0, 4).map((pattern) =>
        pattern.slice(0, 16).map((notes, step) => normalizeSynthChord(notes, step))
      ),
      patternIndex: clampInteger(state.patternIndex, 0, 3),
      chain: state.chain.slice(0, 8).map((index) => clampInteger(index, 0, 3)),
      chainArmed: state.chainArmed,
      chainPosition: clampInteger(state.chainPosition, 0, Math.max(0, state.chain.length - 1)),
      bpm: Math.min(180, Math.max(30, Number.isFinite(state.bpm) ? state.bpm : 100)),
      playing: state.playing,
      startStep: clampInteger(state.startStep, 0, 15),
    });
  }

  public setSequencerStepListener(listener: ((position: SynthSequencerStep) => void) | null): void {
    this.sequencerStepListener = listener;
  }

  public getTelemetry(): SynthTelemetryStats {
    return { ...this.telemetry };
  }

  public dispose(): void {
    this.disposed = true;
    this.captureAbortController.abort();
    this.sequencerStepListener = null;
    this.processor.port.postMessage({ type: 'dispose' });
    this.processor.port.close();
    this.processor.disconnect();
    this.output.disconnect();
  }

  private async loadCaptureBank(): Promise<void> {
    const baseUrl = import.meta.env.BASE_URL;
    const manifestUrl = new URL(`${baseUrl}synth-captures/model-d-panel-init.json`, window.location.origin);
    const samplesUrl = new URL(`${baseUrl}synth-captures/model-d-panel-init.f32`, window.location.origin);
    try {
      const [manifestResponse, samplesResponse] = await Promise.all([
        fetch(manifestUrl, { signal: this.captureAbortController.signal }),
        fetch(samplesUrl, { signal: this.captureAbortController.signal }),
      ]);
      if (!manifestResponse.ok || !samplesResponse.ok) return;
      const [manifest, samples] = await Promise.all([
        manifestResponse.json() as Promise<unknown>,
        samplesResponse.arrayBuffer(),
      ]);
      if (
        this.disposed
        || !isCaptureManifest(manifest)
        || manifest.byteLength !== samples.byteLength
        || !await captureDigestMatches(samples, manifest.sha256)
      ) return;
      this.processor.port.postMessage({
        type: 'capture-bank',
        manifest,
        samples,
      }, [samples]);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
}

function isSynthSequencerStep(value: unknown): value is SynthSequencerStep & { type: 'sequencer-step' } {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SynthSequencerStep> & { type?: unknown };
  return data.type === 'sequencer-step'
    && typeof data.step === 'number'
    && typeof data.patternIndex === 'number'
    && typeof data.chainPosition === 'number';
}

function isSynthTelemetry(value: unknown): value is SynthTelemetryStats & { type: 'telemetry' } {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SynthTelemetryStats> & { type?: unknown };
  return data.type === 'telemetry'
    && typeof data.activeVoices === 'number'
    && typeof data.maxVoices === 'number'
    && typeof data.peak === 'number'
    && typeof data.oversample === 'number'
    && typeof data.machine === 'string'
    && typeof data.topology === 'string'
    && typeof data.solver === 'string'
    && typeof data.solverIterations === 'number'
    && typeof data.temperatureC === 'number'
    && typeof data.renderQuantumFrames === 'number'
    && typeof data.clippedSamples === 'number'
    && (data.renderMode === 'circuit' || data.renderMode === 'capture' || data.renderMode === 'hybrid')
    && typeof data.captureReady === 'boolean';
}

function isCaptureManifest(value: unknown): value is {
  machine: 'model-d';
  format: 'float32-le';
  byteLength: number;
  sha256: string;
  entries: readonly unknown[];
} {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as {
    machine?: unknown;
    format?: unknown;
    byteLength?: unknown;
    sha256?: unknown;
    entries?: unknown;
  };
  return manifest.machine === 'model-d'
    && manifest.format === 'float32-le'
    && typeof manifest.byteLength === 'number'
    && typeof manifest.sha256 === 'string'
    && Array.isArray(manifest.entries);
}

async function captureDigestMatches(samples: ArrayBuffer, expected: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', samples);
  const actual = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return actual === expected;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : .5));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}
