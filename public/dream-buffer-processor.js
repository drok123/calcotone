class CalcotoneDreamBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.historySeconds = 8;
    this.length = Math.max(2048, Math.ceil(sampleRate * this.historySeconds));
    this.left = new Float32Array(this.length);
    this.right = new Float32Array(this.length);

    // V12 memory tags travel with the audio itself. Uint8 keeps the extra 8 s
    // history cheap while preserving enough resolution for subtle recall weighting.
    this.intentNow = new Uint8Array(this.length);
    this.intentEcho = new Uint8Array(this.length);
    this.intentGhost = new Uint8Array(this.length);

    this.writeIndex = 0;
    this.samplesWritten = 0;
    this.profileCounter = 0;
    this.profilePeak = 0;
    this.captures = 0;
    this.silentFrames = 0;
    this.memoryAgeSeconds = new Float32Array(3);
    this.profileIntent = new Float32Array(3);

    // Tiny deterministic capture analysis. No FFT, allocations, messages, or
    // expensive transcendental math in process(): just envelope/history state.
    this.fastEnvelope = 0;
    this.slowEnvelope = 0;
    this.previousMono = 0;

    // V12 memory ages: NOW stays close to the present, ECHO revisits the recent
    // phrase, and GHOST deliberately reaches deep enough to justify the 8 s store.
    this.heads = [
      { baseL: 0.061, baseR: 0.079, depthL: 0.014, depthR: 0.017, rate: 0.071, phase: 0.37, targetL: 0, targetR: 0 },
      { baseL: 0.43, baseR: 0.53, depthL: 0.085, depthR: 0.105, rate: 0.031, phase: 1.41, targetL: 0, targetR: 0 },
      { baseL: 3.85, baseR: 4.55, depthL: 1.10, depthR: 1.28, rate: 0.009, phase: 2.27, targetL: 0, targetR: 0 },
    ];
    this.offsetsL = new Float64Array(3);
    this.offsetsR = new Float64Array(3);
    for (let head = 0; head < 3; head += 1) {
      const config = this.heads[head];
      this.offsetsL[head] = config.baseL * sampleRate;
      this.offsetsR[head] = config.baseR * sampleRate;
      config.targetL = this.offsetsL[head];
      config.targetR = this.offsetsR[head];
    }
    this.maxRecallSeconds = 6.2;
    this.maxRecallSamples = Math.ceil(this.maxRecallSeconds * sampleRate);
  }

  clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
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

  readIntent(buffer, index, offsetSamples) {
    let position = index - offsetSamples;
    while (position < 0) position += this.length;
    while (position >= this.length) position -= this.length;
    const index0 = Math.floor(position);
    const index1 = index0 + 1 < this.length ? index0 + 1 : 0;
    const fraction = position - index0;
    return (buffer[index0] + (buffer[index1] - buffer[index0]) * fraction) / 255;
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
      memoryAgeSeconds: [this.memoryAgeSeconds[0], this.memoryAgeSeconds[1], this.memoryAgeSeconds[2]],
      memoryIntent: [this.profileIntent[0], this.profileIntent[1], this.profileIntent[2]],
    });
    this.profilePeak = 0;
    this.profileIntent[0] = 0;
    this.profileIntent[1] = 0;
    this.profileIntent[2] = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);
    const frames = outputs[0]?.[0]?.length || 128;
    const hasInput = Boolean(inL || inR);

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
      if (Math.abs(l) > 1.25) l = Math.tanh(l);
      if (Math.abs(r) > 1.25) r = Math.tanh(r);
      if (Math.abs(l) < 1e-20) l = 0;
      if (Math.abs(r) < 1e-20) r = 0;

      const mono = (l + r) * 0.5;
      const amplitude = Math.abs(mono);
      this.fastEnvelope += (amplitude - this.fastEnvelope) * 0.075;
      this.slowEnvelope += (amplitude - this.slowEnvelope) * 0.0025;
      const transient = this.clamp01((this.fastEnvelope - this.slowEnvelope * 1.18) * 8.5);
      const sustained = this.clamp01(this.slowEnvelope * 5.2);
      const brightness = this.clamp01(Math.abs(mono - this.previousMono) * 5.5);
      this.previousMono = mono;

      // NOW favors attacks and detail; ECHO favors body and continuity; GHOST
      // remembers fewer but more meaningful events: either a clear onset or a
      // sustained phrase with enough internal movement to remain interesting.
      const nowIntent = this.clamp01(0.18 + transient * 0.54 + brightness * 0.24 + sustained * 0.10);
      const echoIntent = this.clamp01(0.16 + sustained * 0.52 + transient * 0.18 + brightness * 0.12);
      const ghostIntent = this.clamp01(0.08 + transient * 0.34 + sustained * 0.38 + brightness * sustained * 0.28);

      this.left[this.writeIndex] = l;
      this.right[this.writeIndex] = r;
      this.intentNow[this.writeIndex] = Math.round(nowIntent * 255);
      this.intentEcho[this.writeIndex] = Math.round(echoIntent * 255);
      this.intentGhost[this.writeIndex] = Math.round(ghostIntent * 255);
      if (nowIntent > this.profileIntent[0]) this.profileIntent[0] = nowIntent;
      if (echoIntent > this.profileIntent[1]) this.profileIntent[1] = echoIntent;
      if (ghostIntent > this.profileIntent[2]) this.profileIntent[2] = ghostIntent;

      const absPeak = Math.max(Math.abs(l), Math.abs(r));
      if (absPeak > this.profilePeak) this.profilePeak = absPeak;

      const offsetL0 = startL0 + stepL0 * i;
      const offsetR0 = startR0 + stepR0 * i;
      const out0 = outputs[0];
      if (out0) {
        const intent = 0.60 + this.readIntent(this.intentNow, this.writeIndex, (offsetL0 + offsetR0) * 0.5) * 0.40;
        const oL = out0[0], oR = out0[1] || out0[0];
        if (oL) oL[i] = this.readInterpolated(this.left, this.writeIndex, offsetL0) * intent;
        if (oR) oR[i] = this.readInterpolated(this.right, this.writeIndex, offsetR0) * intent;
      }

      const offsetL1 = startL1 + stepL1 * i;
      const offsetR1 = startR1 + stepR1 * i;
      const out1 = outputs[1];
      if (out1) {
        const intent = 0.48 + this.readIntent(this.intentEcho, this.writeIndex, (offsetL1 + offsetR1) * 0.5) * 0.52;
        const oL = out1[0], oR = out1[1] || out1[0];
        if (oL) oL[i] = this.readInterpolated(this.left, this.writeIndex, offsetL1) * intent;
        if (oR) oR[i] = this.readInterpolated(this.right, this.writeIndex, offsetR1) * intent;
      }

      const offsetL2 = startL2 + stepL2 * i;
      const offsetR2 = startR2 + stepR2 * i;
      const out2 = outputs[2];
      if (out2) {
        const intent = 0.28 + this.readIntent(this.intentGhost, this.writeIndex, (offsetL2 + offsetR2) * 0.5) * 0.72;
        const oL = out2[0], oR = out2[1] || out2[0];
        if (oL) oL[i] = this.readInterpolated(this.left, this.writeIndex, offsetL2) * intent;
        if (oR) oR[i] = this.readInterpolated(this.right, this.writeIndex, offsetR2) * intent;
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
      this.fastEnvelope = 0;
      this.slowEnvelope = 0;
      this.previousMono = 0;
    }

    this.publishProfile(frames);
    return true;
  }
}

registerProcessor('calcotone-dream-buffer', CalcotoneDreamBufferProcessor);
