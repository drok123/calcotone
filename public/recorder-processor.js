const RECORDER_CHUNK_SIZE = 4096;
const RECORDER_POOL_SIZE = 8;

class CalcotoneRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.remainingFrames = 0;
    this.chunkSize = RECORDER_CHUNK_SIZE;
    this.pool = Array.from({ length: RECORDER_POOL_SIZE }, (_, slot) => this.makeSlot(slot));
    this.activeSlot = 0;
    this.pool[0].available = false;
    this.left = this.pool[0].left;
    this.right = this.pool[0].right;
    this.writeIndex = 0;
    this.peak = 0;
    this.stoppedMessage = { type: 'stopped' };
    this.limitMessage = { type: 'limit' };
    this.overflowMessage = { type: 'overflow' };
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'start') {
        this.recording = true;
        this.remainingFrames = Math.max(0, Math.floor(Number(data.maxFrames) || 0));
        this.writeIndex = 0;
        this.peak = 0;
      } else if (data.type === 'recycle') {
        this.recycleSlot(data);
      } else if (data.type === 'stop' || data.type === 'cancel') {
        if (data.type === 'stop') {
          this.flush(true);
          this.port.postMessage(this.stoppedMessage);
        }
        this.recording = false;
        this.remainingFrames = 0;
        this.writeIndex = 0;
        this.peak = 0;
      }
    };
  }

  makeSlot(slot) {
    const left = new Float32Array(this.chunkSize);
    const right = new Float32Array(this.chunkSize);
    return {
      slot,
      available: true,
      left,
      right,
      message: { type: 'chunk', slot, left, right, frames: 0, peak: 0 },
    };
  }

  recycleSlot(data) {
    const slotIndex = Math.trunc(Number(data.slot));
    if (slotIndex < 0 || slotIndex >= this.pool.length) return;
    if (!(data.leftBuffer instanceof ArrayBuffer) || !(data.rightBuffer instanceof ArrayBuffer)) return;
    if (data.leftBuffer.byteLength !== this.chunkSize * 4 || data.rightBuffer.byteLength !== this.chunkSize * 4) return;
    const slot = this.pool[slotIndex];
    slot.left = new Float32Array(data.leftBuffer);
    slot.right = new Float32Array(data.rightBuffer);
    slot.message.left = slot.left;
    slot.message.right = slot.right;
    slot.available = true;
  }

  findAvailableSlot() {
    for (let offset = 1; offset <= this.pool.length; offset += 1) {
      const slotIndex = (this.activeSlot + offset) % this.pool.length;
      if (this.pool[slotIndex].available) return slotIndex;
    }
    return -1;
  }

  flush(finalChunk = false) {
    if (this.writeIndex <= 0) return true;
    const current = this.pool[this.activeSlot];
    let nextSlot = -1;
    if (!finalChunk) {
      nextSlot = this.findAvailableSlot();
      if (nextSlot < 0) {
        this.port.postMessage(this.overflowMessage);
        this.recording = false;
        return false;
      }
      this.pool[nextSlot].available = false;
    }

    const message = current.message;
    message.frames = this.writeIndex;
    message.peak = this.peak;
    message.left = current.left;
    message.right = current.right;
    this.port.postMessage(message, [current.left.buffer, current.right.buffer]);
    this.writeIndex = 0;
    this.peak = 0;

    if (!finalChunk) {
      this.activeSlot = nextSlot;
      const next = this.pool[nextSlot];
      this.left = next.left;
      this.right = next.right;
    }
    return true;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const leftIn = input && input[0];
    const rightIn = input && (input[1] || input[0]);
    const leftOut = output && output[0];
    const rightOut = output && (output[1] || output[0]);

    // Transparent pass-through into a zero-gain sink keeps this node in the
    // render graph without changing CALCOTONE's audible master path.
    if (leftOut) {
      for (let i = 0; i < leftOut.length; i += 1) {
        leftOut[i] = leftIn ? leftIn[i] || 0 : 0;
        if (rightOut && rightOut !== leftOut) rightOut[i] = rightIn ? rightIn[i] || 0 : 0;
      }
    }

    if (!this.recording || !leftIn || this.remainingFrames <= 0) return true;
    const frames = Math.min(leftIn.length, this.remainingFrames);
    for (let i = 0; i < frames; i += 1) {
      const l = Number.isFinite(leftIn[i]) ? leftIn[i] : 0;
      const r = Number.isFinite(rightIn ? rightIn[i] : l) ? (rightIn ? rightIn[i] : l) : 0;
      this.left[this.writeIndex] = l;
      this.right[this.writeIndex] = r;
      this.peak = Math.max(this.peak, Math.abs(l), Math.abs(r));
      this.writeIndex += 1;
      this.remainingFrames -= 1;
      if (this.writeIndex >= this.chunkSize && !this.flush(false)) break;
      if (this.remainingFrames <= 0) {
        this.flush(true);
        this.recording = false;
        this.port.postMessage(this.limitMessage);
        break;
      }
    }
    return true;
  }
}
registerProcessor('calcotone-recorder-processor', CalcotoneRecorderProcessor);
