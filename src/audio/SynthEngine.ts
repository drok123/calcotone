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
}

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
};

/**
 * Main-thread controller for the topology-derived synth AudioWorklet. Keeping
 * synthesis inside one processor gives every machine sample-aligned envelopes,
 * deterministic voice stealing, shared oversampling and click-free teardown.
 */
export class SynthEngine {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private readonly processor: AudioWorkletNode;
  private enabled = false;
  private telemetry: SynthTelemetryStats = { ...EMPTY_TELEMETRY };

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
      if (!isSynthTelemetry(data)) return;
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
      };
    };
    this.processor.connect(this.output);
    this.output.connect(destination);
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

  public triggerNote(midi: number, durationSeconds: number, velocity = .78): void {
    if (!this.enabled || this.context.state !== 'running') return;
    this.processor.port.postMessage({
      type: 'note-on',
      midi: Math.min(127, Math.max(0, midi)),
      durationSeconds: Math.max(.035, Math.min(4, durationSeconds)),
      velocity: clamp01(velocity),
    });
  }

  public getTelemetry(): SynthTelemetryStats {
    return { ...this.telemetry };
  }

  public dispose(): void {
    this.processor.port.postMessage({ type: 'dispose' });
    this.processor.port.close();
    this.processor.disconnect();
    this.output.disconnect();
  }
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
    && typeof data.clippedSamples === 'number';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : .5));
}
