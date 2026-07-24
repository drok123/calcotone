class CalcotoneRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.remainingFrames = 0;
    this.chunkSize = 4096;
    this.left = new Float32Array(this.chunkSize);
    this.right = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
    this.peak = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'start') {
        this.recording = true;
        this.remainingFrames = Math.max(0, Math.floor(Number(data.maxFrames) || 0));
        this.writeIndex = 0;
        this.peak = 0;
      } else if (data.type === 'stop' || data.type === 'cancel') {
        if (data.type === 'stop') { this.flush(); this.port.postMessage({ type: 'stopped' }); }
        this.recording = false;
        this.remainingFrames = 0;
        this.writeIndex = 0;
        this.peak = 0;
      }
    };
  }

  flush() {
    if (this.writeIndex <= 0) return;
    const left = this.left.slice(0, this.writeIndex);
    const right = this.right.slice(0, this.writeIndex);
    this.port.postMessage({ type: 'chunk', left, right, peak: this.peak }, [left.buffer, right.buffer]);
    this.writeIndex = 0;
    this.peak = 0;
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
      if (this.writeIndex >= this.chunkSize) this.flush();
      if (this.remainingFrames <= 0) {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'limit' });
        break;
      }
    }
    return true;
  }
}
registerProcessor('calcotone-recorder-processor', CalcotoneRecorderProcessor);
