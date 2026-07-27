export type RecorderMasterMode = 'raw' | 'clean' | 'loud';

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
const CLEAN_TARGET_PEAK = dbToGain(-1);
const LOUD_TARGET_PEAK = dbToGain(-0.8);

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

  public get isRecording(): boolean { return this.recording; }
  public get maxDurationSeconds(): number { return MAX_RECORDING_SECONDS; }

  public start(): void {
    if (this.recording) throw new Error('A sample is already being recorded.');
    this.resetBuffers();
    const processor = new AudioWorkletNode(this.context, 'calcotone-recorder-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    const silentOutput = this.context.createGain();
    silentOutput.gain.value = 0;
    processor.port.onmessage = (event: MessageEvent<{ type?: string; left?: Float32Array; right?: Float32Array; peak?: number }>) => {
      const data = event.data;
      if (data?.type === 'chunk' && data.left && data.right) {
        this.leftChunks.push(data.left);
        this.rightChunks.push(data.right);
        this.frameCount += Math.min(data.left.length, data.right.length);
        this.peak = Math.max(this.peak, Number.isFinite(data.peak) ? data.peak ?? 0 : 0);
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

  public dispose(): void { this.cancel(); }

  private disconnectNodes(): void {
    if (this.processor) {
      this.processor.onprocessorerror = null;
      this.processor.port.onmessage = null;
      try { this.source.disconnect(this.processor); } catch { /* engine shutdown */ }
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

interface MasterResult {
  left: Float32Array;
  right: Float32Array;
  peak: number;
  gainAppliedDb: number;
}

function masterStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  mode: Exclude<RecorderMasterMode, 'raw'>
): MasterResult {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  const hp = makeHighPassState(sampleRate, 24);
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < left.length; i += 1) {
    const l = highPass(left[i], hp.left, hp.alpha);
    const r = highPass(right[i], hp.right, hp.alpha);
    outL[i] = l;
    outR[i] = r;
    sumSquares += (l * l + r * r) * 0.5;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, left.length));
  const targetRms = dbToGain(mode === 'loud' ? -12 : -16);
  const maxMakeup = dbToGain(mode === 'loud' ? 12 : 9);
  const targetPeak = mode === 'loud' ? LOUD_TARGET_PEAK : CLEAN_TARGET_PEAK;
  const rmsGain = rms > 1e-8 ? targetRms / rms : 1;
  const peakGain = peak > 1e-8 ? targetPeak / peak : 1;
  const transientAllowance = mode === 'loud' ? 1.7 : 1.25;
  const makeup = Math.min(maxMakeup, Math.max(0.25, rmsGain), peakGain * transientAllowance);
  const drive = mode === 'loud' ? 1.55 : 1.18;
  let finalPeak = 0;

  for (let i = 0; i < outL.length; i += 1) {
    outL[i] = softLimit(outL[i] * makeup, drive, targetPeak);
    outR[i] = softLimit(outR[i] * makeup, drive, targetPeak);
    finalPeak = Math.max(finalPeak, Math.abs(outL[i]), Math.abs(outR[i]));
  }

  return {
    left: outL,
    right: outR,
    peak: finalPeak,
    gainAppliedDb: 20 * Math.log10(Math.max(1e-8, makeup)),
  };
}

function makeHighPassState(sampleRate: number, frequency: number) {
  const rc = 1 / (2 * Math.PI * frequency);
  const dt = 1 / sampleRate;
  return {
    alpha: rc / (rc + dt),
    left: { x: 0, y: 0 },
    right: { x: 0, y: 0 },
  };
}

function highPass(input: number, state: { x: number; y: number }, alpha: number): number {
  const output = alpha * (state.y + input - state.x);
  state.x = input;
  state.y = output;
  return output;
}

function softLimit(sample: number, drive: number, ceiling: number): number {
  const sign = sample < 0 ? -1 : 1;
  const magnitude = Math.abs(sample);
  const knee = ceiling * (drive > 1.4 ? 0.68 : 0.78);
  if (magnitude <= knee) return sample;
  const span = Math.max(1e-8, ceiling - knee);
  const normalized = (magnitude - knee) / span;
  const compressed = Math.tanh(normalized * drive) / Math.tanh(drive);
  return sign * Math.min(ceiling, knee + span * compressed);
}

function measurePeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  return peak;
}

function dbToGain(db: number): number { return Math.pow(10, db / 20); }

function flattenChunks(chunks: Float32Array[], frameCount: number): Float32Array {
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

function encodePcm24Wave(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
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
  const integer = clamped < 0
    ? Math.round(clamped * 8_388_608)
    : Math.round(clamped * 8_388_607);
  view.setUint8(offset, integer & 0xff);
  view.setUint8(offset + 1, (integer >> 8) & 0xff);
  view.setUint8(offset + 2, (integer >> 16) & 0xff);
  return offset + 3;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}