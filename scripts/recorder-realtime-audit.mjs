import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const source = readFileSync(resolve(process.cwd(), 'public/recorder-processor.js'), 'utf8');
const controller = readFileSync(resolve(process.cwd(), 'src/audio/WavRecorder.ts'), 'utf8');
const failures = [];
const reports = [];
const requireText = (text, needle, label) => { if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (text, needle, label) => { if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

for (const token of [
  'const RECORDER_POOL_SIZE = 8',
  'this.pool = Array.from({ length: RECORDER_POOL_SIZE }, (_, slot) => this.makeSlot(slot))',
  "type: 'chunk', slot, left, right, frames: 0, peak: 0",
  "data.type === 'recycle'",
  'findAvailableSlot()',
  'this.port.postMessage(message, [current.left.buffer, current.right.buffer])',
  "this.port.postMessage(this.overflowMessage)",
]) requireText(source, token, 'Recorder worklet pool contract');
forbidText(source, '.slice(', 'Recorder worklet render-time chunk allocation');

const flushStart = source.indexOf('  flush(');
const flushEnd = source.indexOf('  process(', flushStart);
if (flushStart < 0 || flushEnd < 0) failures.push('Recorder flush audit: function boundaries missing');
else {
  const body = source.slice(flushStart, flushEnd);
  forbidText(body, 'new Float32Array', 'Recorder flush typed-array allocation');
  forbidText(body, 'new ArrayBuffer', 'Recorder flush buffer allocation');
}

for (const token of [
  'this.leftChunks.push(data.left.slice(0, frames))',
  'this.rightChunks.push(data.right.slice(0, frames))',
  "type: 'recycle'",
  'leftBuffer,',
  'rightBuffer,',
  '[leftBuffer, rightBuffer]',
]) requireText(controller, token, 'Recorder main-thread recycle contract');

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      messages: [],
      onmessage: null,
      postMessage: (message, transfer) => this.port.messages.push({ message, transfer }),
      close() {},
    };
  }
}

let Processor = null;
runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  Float32Array,
  ArrayBuffer,
  Number,
  Math,
  registerProcessor(name, registered) {
    if (name === 'calcotone-recorder-processor') Processor = registered;
  },
});
if (!Processor) failures.push('Recorder worklet did not register');

if (Processor) {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'start', maxFrames: 12_000 } });
  let absolute = 0;
  for (let block = 0; block < 96 && processor.recording; block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    const outL = new Float32Array(BLOCK_SIZE);
    const outR = new Float32Array(BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const value = Math.sin((absolute + frame) / SAMPLE_RATE * Math.PI * 2 * 227) * .42;
      left[frame] = value;
      right[frame] = value * .93;
    }
    absolute += BLOCK_SIZE;
    processor.process([[left, right]], [[outL, outR]]);

    const pending = processor.port.messages.splice(0);
    for (const entry of pending) {
      const message = entry.message;
      if (message?.type !== 'chunk') continue;
      if (!Number.isInteger(message.slot) || message.slot < 0 || message.slot >= 8) failures.push('Recorder chunk: invalid pool slot');
      if (!(message.left instanceof Float32Array) || !(message.right instanceof Float32Array)) failures.push('Recorder chunk: missing Float32 transfer arrays');
      if (message.frames <= 0 || message.frames > 4096) failures.push(`Recorder chunk: invalid frame count ${message.frames}`);
      if (!Array.isArray(entry.transfer) || entry.transfer.length !== 2) failures.push('Recorder chunk: missing stereo transfer list');
      // VM mocks do not detach transferables. Recycle fresh same-size buffers to
      // exercise the real ownership protocol without relying on structured clone.
      processor.port.onmessage({
        data: {
          type: 'recycle',
          slot: message.slot,
          leftBuffer: new ArrayBuffer(4096 * 4),
          rightBuffer: new ArrayBuffer(4096 * 4),
        },
      });
    }
  }
  processor.port.onmessage({ data: { type: 'stop' } });
  const messages = processor.port.messages.map((entry) => entry.message);
  const chunks = messages.filter((message) => message?.type === 'chunk');
  const overflow = messages.some((message) => message?.type === 'overflow');
  reports.push(`pool=${processor.pool.length} finalChunks=${chunks.length} overflow=${overflow}`);
  if (processor.pool.length !== 8) failures.push(`Recorder pool resized to ${processor.pool.length}`);
  if (overflow) failures.push('Recorder recycle scenario exhausted transfer pool');
}

for (const report of reports) console.log(report);
if (failures.length) {
  console.error(`Recorder realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Recorder realtime audit passed · fixed transfer pool keeps chunk allocation off the AudioWorklet render path');
