export interface RecordedWav {
  blob: Blob;
  durationSeconds: number;
  sampleRate: number;
  channels: 2;
  bitDepth: 24;
  peak: number;
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
    if (!this.recording)
      throw new Error('No sample is currently being recorded.');
    this.recording = false;
    const processor = this.processor;
    if (!processor) throw new Error('Recorder processor is unavailable.');

    // Wait for the render thread to flush its final partial chunk before encoding.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.stopResolver = finish;
      processor.port.postMessage({ type: 'stop' });
      // A closed/suspended context should never strand the UI forever.
      globalThis.setTimeout(finish, 250);
    });

    this.disconnectNodes();
    if (this.frameCount === 0) {
      this.resetBuffers();
      throw new Error('The recording did not contain any audio frames.');
    }
    const left = flattenChunks(this.leftChunks, this.frameCount);
    const right = flattenChunks(this.rightChunks, this.frameCount);
    const blob = encodePcm24Wave(left, right, this.context.sampleRate);
    const result: RecordedWav = {
      blob,
      durationSeconds: this.frameCount / this.context.sampleRate,
      sampleRate: this.context.sampleRate,
      channels: 2,
      bitDepth: 24,
      peak: this.peak,
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

function flattenChunks(
  chunks: Float32Array[],
  frameCount: number
): Float32Array {
  const output = new Float32Array(frameCount);
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = frameCount - offset;
    if (remaining <= 0) break;
    output.set(chunk.subarray(0, remaining), offset);
    offset += Math.min(chunk.length, remaining);
  }
  return output;
}

function encodePcm24Wave(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): Blob {
  const channelCount = 2;
  const bytesPerSample = 3;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = left.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let index = 0; index < left.length; index += 1) {
    offset = writePcm24(view, offset, left[index]);
    offset = writePcm24(view, offset, right[index]);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writePcm24(view: DataView, offset: number, sample: number): number {
  const dither = (Math.random() - Math.random()) / 8_388_608;
  const clamped = Math.max(-1, Math.min(1, sample + dither));
  const integer =
    clamped < 0
      ? Math.round(clamped * 8_388_608)
      : Math.round(clamped * 8_388_607);
  view.setUint8(offset, integer & 0xff);
  view.setUint8(offset + 1, (integer >> 8) & 0xff);
  view.setUint8(offset + 2, (integer >> 16) & 0xff);
  return offset + 3;
}
function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index));
}
