import { masterStereo, measurePeak, type RecorderMasterMode } from './recorder/mastering';
import { encodePcm24Wave, flattenChunks } from './recorder/wavEncoding';

export type { RecorderMasterMode } from './recorder/mastering';

export interface RecordedWav {
  /** Default export remains the CLEAN master for compatibility with the existing recorder flow. */
  blob: Blob;
  rawBlob: Blob;
  cleanBlob: Blob;
  loudBlob: Blob;
  durationSeconds: number;
  sampleRate: number;
  channels: 2;
  bitDepth: 24;
  peak: number;
  rawPeak: number;
  cleanPeak: number;
  loudPeak: number;
  masterMode: RecorderMasterMode;
  gainAppliedDb: number;
  cleanGainDb: number;
  loudGainDb: number;
}

const MAX_RECORDING_SECONDS = 120;

/** Lossless stereo recorder using an AudioWorklet tap on the final master signal. */
export class WavRecorder {
  private readonly context: AudioContext;
  private readonly source: AudioNode;
  private processor: AudioWorkletNode | null = null;
  private silentOutput: GainNode | null = null;
  private leftChunks: Float32Array[] = [];
  private rightChunks: Float32Array[] = [];
  private frameCount = 0;
  private peak = 0;
  private recording = false;
  private stopResolver: (() => void) | null = null;

  public constructor(context: AudioContext, source: AudioNode) {
    this.context = context;
    this.source = source;
  }

  public get isRecording(): boolean {
    return this.recording;
  }

  public get maxDurationSeconds(): number {
    return MAX_RECORDING_SECONDS;
  }

  public start(): void {
    if (this.recording) throw new Error('A sample is already being recorded.');
    this.resetBuffers();

    const processor = new AudioWorkletNode(
      this.context,
      'calcotone-recorder-processor',
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      }
    );
    const silentOutput = this.context.createGain();
    silentOutput.gain.value = 0;

    processor.port.onmessage = (
      event: MessageEvent<{
        type?: string;
        left?: Float32Array;
        right?: Float32Array;
        peak?: number;
      }>
    ) => {
      const data = event.data;
      if (data?.type === 'chunk' && data.left && data.right) {
        this.leftChunks.push(data.left);
        this.rightChunks.push(data.right);
        this.frameCount += Math.min(data.left.length, data.right.length);
        this.peak = Math.max(
          this.peak,
          Number.isFinite(data.peak) ? data.peak ?? 0 : 0
        );
        return;
      }
      if (data?.type === 'stopped') {
        this.stopResolver?.();
        this.stopResolver = null;
      }
    };

    processor.onprocessorerror = () => {
      this.recording = false;
      this.stopResolver?.();
      this.stopResolver = null;
      this.disconnectNodes();
      this.resetBuffers();
      console.error('CALCOTONE recorder AudioWorklet stopped unexpectedly.');
    };

    this.source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(this.context.destination);
    this.processor = processor;
    this.silentOutput = silentOutput;
    this.recording = true;
    processor.port.postMessage({
      type: 'start',
      maxFrames: Math.floor(MAX_RECORDING_SECONDS * this.context.sampleRate),
    });
  }

  public async stop(): Promise<RecordedWav> {
    if (!this.recording) throw new Error('No sample is currently being recorded.');
    this.recording = false;
    const processor = this.processor;
    if (!processor) throw new Error('Recorder processor is unavailable.');

    await new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        timeout = null;
        resolve();
      };
      this.stopResolver = finish;
      processor.port.postMessage({ type: 'stop' });
      timeout = globalThis.setTimeout(finish, 250);
    });

    this.stopResolver = null;
    this.disconnectNodes();
    if (this.frameCount === 0) {
      this.resetBuffers();
      throw new Error('The recording did not contain any audio frames.');
    }

    const left = flattenChunks(this.leftChunks, this.frameCount);
    const right = flattenChunks(this.rightChunks, this.frameCount);
    const rawPeak = measurePeak(left, right);
    const rawBlob = encodePcm24Wave(left, right, this.context.sampleRate);
    const clean = masterStereo(left, right, this.context.sampleRate, 'clean');
    const loud = masterStereo(left, right, this.context.sampleRate, 'loud');
    const cleanBlob = encodePcm24Wave(clean.left, clean.right, this.context.sampleRate);
    const loudBlob = encodePcm24Wave(loud.left, loud.right, this.context.sampleRate);

    const result: RecordedWav = {
      blob: cleanBlob,
      rawBlob,
      cleanBlob,
      loudBlob,
      durationSeconds: this.frameCount / this.context.sampleRate,
      sampleRate: this.context.sampleRate,
      channels: 2,
      bitDepth: 24,
      peak: clean.peak,
      rawPeak,
      cleanPeak: clean.peak,
      loudPeak: loud.peak,
      masterMode: 'clean',
      gainAppliedDb: clean.gainAppliedDb,
      cleanGainDb: clean.gainAppliedDb,
      loudGainDb: loud.gainAppliedDb,
    };

    this.resetBuffers();
    return result;
  }

  public cancel(): void {
    this.recording = false;
    this.stopResolver?.();
    this.stopResolver = null;
    this.processor?.port.postMessage({ type: 'cancel' });
    this.disconnectNodes();
    this.resetBuffers();
  }

  public dispose(): void {
    this.cancel();
  }

  private disconnectNodes(): void {
    if (this.processor) {
      this.processor.onprocessorerror = null;
      this.processor.port.onmessage = null;
      try {
        this.source.disconnect(this.processor);
      } catch {
        /* engine shutdown */
      }
      this.processor.disconnect();
      this.processor.port.close();
    }
    this.silentOutput?.disconnect();
    this.processor = null;
    this.silentOutput = null;
  }

  private resetBuffers(): void {
    this.leftChunks = [];
    this.rightChunks = [];
    this.frameCount = 0;
    this.peak = 0;
  }
}
