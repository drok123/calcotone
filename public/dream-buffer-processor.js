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
    this.silentFrames = 0;
    this.memoryAgeSeconds = [0, 0, 0];

    // V12 memory ages: NOW stays close to the present, ECHO revisits the recent
    // phrase, and GHOST deliberately reaches deep enough to justify the 8 s store.
    // Left/right offsets differ slightly so recalls retain width without a chorus-like wobble.
    this.heads = [
      { baseL: 0.061, baseR: 0.079, depthL: 0.014, depthR: 0.017, rate: 0.071, phase: 0.37 },
      { baseL: 0.43, baseR: 0.53, depthL: 0.085, depthR: 0.105, rate: 0.031, phase: 1.41 },
      { baseL: 3.85, baseR: 4.55, depthL: 1.10, depthR: 1.28, rate: 0.009, phase: 2.27 },
    ];
    this.offsetsL = new Float64Array(3);
    this.offsetsR = new Float64Array(3);
    for (let head = 0; head < 3; head += 1) {
      const config = this.heads[head];
      this.offsetsL[head] = config.baseL * sampleRate;
      this.offsetsR[head] = config.baseR * sampleRate;
    }
    this.maxRecallSeconds = 6.2;
    this.maxRecallSamples = Math.ceil(this.maxRecallSeconds * sampleRate);
  }

  readInterpolated(buffer, index, offsetSamples) {
    let position = index - offsetSamples;
    while (position < 0) position += this.length;
    while (position >= this.length) position -= this.length;
    const index0 = Math.floor(position);
    const index1 = index0 + 1 < this.length ? index0 + 1 : 0;
    const fraction = position - index0;
    return buffer[index0] + (buffer[index1] - buffer[index0]) * fraction;
  }

  updateHeadTargets(frames) {
    const blockSeconds = frames / sampleRate;
    for (let head = 0; head < 3; head += 1) {
      const config = this.heads[head];
      config.phase += blockSeconds * config.rate * Math.PI * 2;
      if (config.phase > Math.PI * 2) config.phase -= Math.PI * 2;
      const sway = Math.sin(config.phase);
      const counterSway = Math.sin(config.phase * 0.73 + 1.17);
      const targetLSeconds = Math.max(0.012, Math.min(this.historySeconds - 0.1, config.baseL + config.depthL * sway));
      const targetRSeconds = Math.max(0.012, Math.min(this.historySeconds - 0.1, config.baseR + config.depthR * counterSway));
      this.memoryAgeSeconds[head] = (targetLSeconds + targetRSeconds) * 0.5;
      config.targetL = targetLSeconds * sampleRate;
      config.targetR = targetRSeconds * sampleRate;
    }
  }

  publishProfile(frames) {
    this.profileCounter += 1;
    if (this.profileCounter < Math.max(1, Math.round(sampleRate / frames))) return;
    this.profileCounter = 0;
    this.port.postMessage({
      type: 'profile',
      fillRatio: this.samplesWritten / this.length,
      historySeconds: this.historySeconds,
      inputPeak: this.profilePeak,
      captures: this.captures,
      memoryAgeSeconds: [...this.memoryAgeSeconds],
    });
    this.profilePeak = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);
    const frames = outputs[0]?.[0]?.length || 128;
    const hasInput = Boolean(inL || inR);

    // When no source is connected and every readable memory age has been overwritten
    // by silence, the worklet becomes effectively idle until a source reconnects.
    if (!hasInput && this.samplesWritten === 0) {
      this.publishProfile(frames);
      return true;
    }

    if (hasInput) this.silentFrames = 0;
    else this.silentFrames += frames;

    this.updateHeadTargets(frames);
    const startL0 = this.offsetsL[0], startL1 = this.offsetsL[1], startL2 = this.offsetsL[2];
    const startR0 = this.offsetsR[0], startR1 = this.offsetsR[1], startR2 = this.offsetsR[2];
    const stepL0 = (this.heads[0].targetL - startL0) / frames;
    const stepL1 = (this.heads[1].targetL - startL1) / frames;
    const stepL2 = (this.heads[2].targetL - startL2) / frames;
    const stepR0 = (this.heads[0].targetR - startR0) / frames;
    const stepR1 = (this.heads[1].targetR - startR1) / frames;
    const stepR2 = (this.heads[2].targetR - startR2) / frames;

    for (let i = 0; i < frames; i += 1) {
      let l = inL ? inL[i] || 0 : 0;
      let r = inR ? inR[i] || 0 : l;
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;

      // Capture stays intentionally close to linear. This is memory infrastructure,
      // not another saturation effect; tanh only catches pathological summed sends.
      if (Math.abs(l) > 1.25) l = Math.tanh(l);
      if (Math.abs(r) > 1.25) r = Math.tanh(r);
      if (Math.abs(l) < 1e-20) l = 0;
      if (Math.abs(r) < 1e-20) r = 0;

      this.left[this.writeIndex] = l;
      this.right[this.writeIndex] = r;
      const absPeak = Math.max(Math.abs(l), Math.abs(r));
      if (absPeak > this.profilePeak) this.profilePeak = absPeak;

      const offsetsL = [
        startL0 + stepL0 * i,
        startL1 + stepL1 * i,
        startL2 + stepL2 * i,
      ];
      const offsetsR = [
        startR0 + stepR0 * i,
        startR1 + stepR1 * i,
        startR2 + stepR2 * i,
      ];
      for (let head = 0; head < 3; head += 1) {
        const out = outputs[head];
        if (!out) continue;
        const outL = out[0];
        const outR = out[1] || out[0];
        if (outL) outL[i] = this.readInterpolated(this.left, this.writeIndex, offsetsL[head]);
        if (outR) outR[i] = this.readInterpolated(this.right, this.writeIndex, offsetsR[head]);
      }

      this.writeIndex += 1;
      if (this.writeIndex >= this.length) {
        this.writeIndex = 0;
        this.captures += 1;
      }
      if (this.samplesWritten < this.length) this.samplesWritten += 1;
    }

    this.offsetsL[0] = this.heads[0].targetL;
    this.offsetsL[1] = this.heads[1].targetL;
    this.offsetsL[2] = this.heads[2].targetL;
    this.offsetsR[0] = this.heads[0].targetR;
    this.offsetsR[1] = this.heads[1].targetR;
    this.offsetsR[2] = this.heads[2].targetR;

    if (!hasInput && this.silentFrames >= this.maxRecallSamples + frames) {
      this.samplesWritten = 0;
      this.silentFrames = 0;
      this.profilePeak = 0;
    }

    this.publishProfile(frames);
    return true;
  }
}

registerProcessor('calcotone-dream-buffer', CalcotoneDreamBufferProcessor);
