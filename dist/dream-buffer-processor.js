class CalcotoneDreamBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.historySeconds = 8;
    this.length = Math.max(2048, Math.ceil(sampleRate * this.historySeconds));
    this.left = new Float32Array(this.length);
    this.right = new Float32Array(this.length);
    this.writeIndex = 0;
    this.samplesWritten = 0;
    this.profileCounter = 0;
    this.profilePeak = 0;
    this.captures = 0;

    // Deliberately irrational-ish offsets reduce obvious resonance when these
    // heads are eventually fed back into different Dream Engine modules.
    this.offsetsL = [0.071, 0.347, 1.371].map((seconds) => Math.max(1, Math.round(seconds * sampleRate)));
    this.offsetsR = [0.089, 0.431, 1.613].map((seconds) => Math.max(1, Math.round(seconds * sampleRate)));
  }

  read(buffer, index, offset) {
    let readIndex = index - offset;
    if (readIndex < 0) readIndex += this.length;
    return buffer[readIndex];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);
    const frames = outputs[0]?.[0]?.length || 128;

    for (let i = 0; i < frames; i += 1) {
      let l = inL ? inL[i] || 0 : 0;
      let r = inR ? inR[i] || 0 : l;
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;

      // The memory store itself is protected but intentionally almost linear.
      // tanh only catches pathological summed sends before they poison history.
      if (Math.abs(l) > 1.25) l = Math.tanh(l);
      if (Math.abs(r) > 1.25) r = Math.tanh(r);
      if (Math.abs(l) < 1e-20) l = 0;
      if (Math.abs(r) < 1e-20) r = 0;

      this.left[this.writeIndex] = l;
      this.right[this.writeIndex] = r;
      const absPeak = Math.max(Math.abs(l), Math.abs(r));
      if (absPeak > this.profilePeak) this.profilePeak = absPeak;

      for (let head = 0; head < 3; head += 1) {
        const out = outputs[head];
        if (!out) continue;
        const outL = out[0];
        const outR = out[1] || out[0];
        if (outL) outL[i] = this.read(this.left, this.writeIndex, this.offsetsL[head]);
        if (outR) outR[i] = this.read(this.right, this.writeIndex, this.offsetsR[head]);
      }

      this.writeIndex += 1;
      if (this.writeIndex >= this.length) {
        this.writeIndex = 0;
        this.captures += 1;
      }
      if (this.samplesWritten < this.length) this.samplesWritten += 1;
    }

    // ~5 Hz diagnostics: low enough not to turn the realtime thread into a UI bus.
    this.profileCounter += 1;
    if (this.profileCounter >= Math.max(1, Math.round(sampleRate / frames / 5))) {
      this.profileCounter = 0;
      this.port.postMessage({
        type: 'profile',
        fillRatio: this.samplesWritten / this.length,
        historySeconds: this.historySeconds,
        inputPeak: this.profilePeak,
        captures: this.captures,
      });
      this.profilePeak = 0;
    }

    return true;
  }
}

registerProcessor('calcotone-dream-buffer', CalcotoneDreamBufferProcessor);
