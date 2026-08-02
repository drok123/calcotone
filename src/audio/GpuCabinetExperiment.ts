export interface GpuCabinetBatchResult {
  blocks: number;
  algorithmicLatencyMs: number;
  cpuMs: number;
  gpuMs: number;
  deadlineRatio: number;
  maxError: number;
  realtimeSafe: boolean;
}

export interface GpuCabinetExperimentReport {
  supported: boolean;
  verdict: 'unsupported' | 'promising' | 'batch-only' | 'too-jittery';
  message: string;
  taps: number;
  sampleRate: number;
  batches: GpuCabinetBatchResult[];
}

interface MinimalGpuBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface MinimalGpuPipeline {
  getBindGroupLayout(index: number): unknown;
}

interface MinimalGpuDevice {
  queue: {
    writeBuffer(buffer: MinimalGpuBuffer, offset: number, data: ArrayBufferView): void;
    submit(commands: unknown[]): void;
  };
  createBuffer(descriptor: { size: number; usage: number }): MinimalGpuBuffer;
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: { layout: 'auto'; compute: { module: unknown; entryPoint: string } }): MinimalGpuPipeline;
  createBindGroup(descriptor: { layout: unknown; entries: Array<{ binding: number; resource: { buffer: MinimalGpuBuffer } }> }): unknown;
  createCommandEncoder(): {
    beginComputePass(): {
      setPipeline(pipeline: MinimalGpuPipeline): void;
      setBindGroup(index: number, bindGroup: unknown): void;
      dispatchWorkgroups(count: number): void;
      end(): void;
    };
    copyBufferToBuffer(source: MinimalGpuBuffer, sourceOffset: number, destination: MinimalGpuBuffer, destinationOffset: number, size: number): void;
    finish(): unknown;
  };
}

interface MinimalGpuAdapter { requestDevice(): Promise<MinimalGpuDevice>; }
interface MinimalGpuNavigator {
  gpu?: { requestAdapter(): Promise<MinimalGpuAdapter | null> };
}

interface GpuRuntimeConstants {
  GPUBufferUsage?: Record<'STORAGE' | 'COPY_DST' | 'COPY_SRC' | 'MAP_READ' | 'UNIFORM', number>;
  GPUMapMode?: { READ: number };
}

const CABINET_SHADER = /* wgsl */ `
struct Config { sampleCount: u32, tapCount: u32 }
@group(0) @binding(0) var<storage, read> inputSamples: array<f32>;
@group(0) @binding(1) var<storage, read> impulse: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputSamples: array<f32>;
@group(0) @binding(3) var<uniform> config: Config;

@compute @workgroup_size(64)
fn cabinetConvolution(@builtin(global_invocation_id) id: vec3<u32>) {
  let outputIndex = id.x;
  if (outputIndex >= config.sampleCount) { return; }
  var sum = 0.0;
  var tap = 0u;
  loop {
    if (tap >= config.tapCount || tap > outputIndex) { break; }
    sum += inputSamples[outputIndex - tap] * impulse[tap];
    tap += 1u;
  }
  outputSamples[outputIndex] = sum;
}`;

export async function runGpuCabinetExperiment(
  sampleRate = 48_000,
  taps = 1024,
): Promise<GpuCabinetExperimentReport> {
  const gpu = (navigator as unknown as MinimalGpuNavigator).gpu;
  const runtime = globalThis as unknown as GpuRuntimeConstants;
  const usage = runtime.GPUBufferUsage;
  const mapMode = runtime.GPUMapMode;
  if (!gpu || !usage || !mapMode) return unsupportedReport(sampleRate, taps);
  const adapter = await gpu.requestAdapter();
  if (!adapter) return unsupportedReport(sampleRate, taps);
  const device = await adapter.requestDevice();
  const shader = device.createShaderModule({ code: CABINET_SHADER });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shader, entryPoint: 'cabinetConvolution' },
  });
  const impulse = buildCabinetImpulse(taps, sampleRate);

  // Pay lazy shader compilation before collecting deadline figures.
  await runGpuBatch(device, pipeline, usage, mapMode.READ, buildInput(128), impulse);

  const batches: GpuCabinetBatchResult[] = [];
  for (const blocks of [1, 2, 4, 8, 16]) {
    const input = buildInput(blocks * 128);
    const cpuStarted = performance.now();
    const reference = convolveCpu(input, impulse);
    const cpuMs = performance.now() - cpuStarted;
    const gpuStarted = performance.now();
    const gpuOutput = await runGpuBatch(device, pipeline, usage, mapMode.READ, input, impulse);
    const gpuMs = performance.now() - gpuStarted;
    const algorithmicLatencyMs = input.length / sampleRate * 1000;
    const deadlineRatio = gpuMs / algorithmicLatencyMs;
    const maxError = maximumError(reference, gpuOutput);
    batches.push({
      blocks,
      algorithmicLatencyMs,
      cpuMs,
      gpuMs,
      deadlineRatio,
      maxError,
      realtimeSafe: deadlineRatio <= 0.7 && maxError <= 0.0001,
    });
  }

  const immediate = batches.find((batch) => batch.blocks === 1);
  const anySafe = batches.some((batch) => batch.realtimeSafe);
  const verdict = immediate?.realtimeSafe ? 'promising' : anySafe ? 'batch-only' : 'too-jittery';
  const message = verdict === 'promising'
    ? 'One-quantum GPU cabinet processing met the guarded deadline.'
    : verdict === 'batch-only'
      ? 'GPU throughput wins only after batching; keep the live amp path on CPU.'
      : 'GPU dispatch/readback missed every guarded deadline on this browser/device.';
  return { supported: true, verdict, message, taps, sampleRate, batches };
}

async function runGpuBatch(
  device: MinimalGpuDevice,
  pipeline: MinimalGpuPipeline,
  usage: Record<'STORAGE' | 'COPY_DST' | 'COPY_SRC' | 'MAP_READ' | 'UNIFORM', number>,
  readMode: number,
  input: Float32Array,
  impulse: Float32Array,
): Promise<Float32Array> {
  const byteLength = input.byteLength;
  const inputBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST });
  const impulseBuffer = device.createBuffer({ size: impulse.byteLength, usage: usage.STORAGE | usage.COPY_DST });
  const outputBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC });
  const readBuffer = device.createBuffer({ size: byteLength, usage: usage.MAP_READ | usage.COPY_DST });
  const configBuffer = device.createBuffer({ size: 8, usage: usage.UNIFORM | usage.COPY_DST });
  device.queue.writeBuffer(inputBuffer, 0, input);
  device.queue.writeBuffer(impulseBuffer, 0, impulse);
  device.queue.writeBuffer(configBuffer, 0, new Uint32Array([input.length, impulse.length]));
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: impulseBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: configBuffer } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(input.length / 64));
  pass.end();
  encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await readBuffer.mapAsync(readMode);
  const result = new Float32Array(readBuffer.getMappedRange()).slice();
  readBuffer.unmap();
  for (const buffer of [inputBuffer, impulseBuffer, outputBuffer, readBuffer, configBuffer]) buffer.destroy();
  return result;
}

function buildCabinetImpulse(length: number, sampleRate: number): Float32Array {
  const impulse = new Float32Array(length);
  let seed = 0x86c0ffee;
  let absoluteSum = 0;
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const time = index / sampleRate;
    const body = Math.sin(time * Math.PI * 2 * 96) * 0.44
      + Math.sin(time * Math.PI * 2 * 174) * 0.24;
    const value = (noise * 0.38 + body) * Math.exp(-time * 92);
    impulse[index] = value;
    absoluteSum += Math.abs(value);
  }
  impulse[0] += 0.72;
  const normalization = 1 / Math.max(1, absoluteSum * 0.18);
  for (let index = 0; index < impulse.length; index += 1) impulse[index] *= normalization;
  return impulse;
}

function buildInput(length: number): Float32Array {
  const input = new Float32Array(length);
  let seed = 0x1234abcd;
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    input[index] = ((seed / 0xffffffff) * 2 - 1) * 0.32;
  }
  return input;
}

function convolveCpu(input: Float32Array, impulse: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    let sum = 0;
    const lastTap = Math.min(impulse.length - 1, outputIndex);
    for (let tap = 0; tap <= lastTap; tap += 1) sum += input[outputIndex - tap] * impulse[tap];
    output[outputIndex] = sum;
  }
  return output;
}

function maximumError(reference: Float32Array, candidate: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < reference.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(reference[index] - candidate[index]));
  }
  return maximum;
}

function unsupportedReport(sampleRate: number, taps: number): GpuCabinetExperimentReport {
  return {
    supported: false,
    verdict: 'unsupported',
    message: 'WebGPU compute is unavailable in this browser/session. CPU STACK remains active.',
    taps,
    sampleRate,
    batches: [],
  };
}
