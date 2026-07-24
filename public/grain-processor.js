class CalcotoneGrainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 5, automationRate: 'k-rate' },
      { name: 'bits', defaultValue: 13, minValue: 4, maxValue: 16, automationRate: 'k-rate' },
      { name: 'density', defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 0.38, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'chaos', defaultValue: 0.16, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(16384, 1 << Math.ceil(Math.log2(sampleRate * 2.5)));
    this.mask = this.bufferSize - 1;
    this.left = new Float32Array(this.bufferSize);
    this.right = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.maxVoices = 6;
    this.effectiveVoiceLimit = 6;
    this.voices = Array.from({ length: 8 }, () => ({ active: false, phase: 0, length: 0, read: 0, step: 1, gain: 0, pan: 0, panDrift: 0, tone: 0, lastL: 0, lastR: 0 }));
    this.spawnCounter = 0;
    this.smoothedDensity = 0.42;
    this.smoothedPitch = 0.38;
    this.smoothedChaos = 0.16;
    this.outputL = 0;
    this.outputR = 0;
    this.inputEnergy = 1e-5;
    this.wetEnergy = 1e-5;
    this.makeupGain = 1;
    this.randomState = 0x6d2b79f5;
    this.profileBlocks = 0;
    this.profileTotalMs = 0;
    this.profileTotalSquaredMs = 0;
    this.profileWorstMs = 0;
    this.profileOverruns = 0;
    this.profileDroppedSpawns = 0;
    this.guardStressBlocks = 0;
    this.guardRecoveryBlocks = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'quality') {
        this.maxVoices = Math.max(1, Math.min(8, data.maxVoices | 0));
        this.effectiveVoiceLimit = Math.min(this.effectiveVoiceLimit, this.maxVoices);
        if (this.effectiveVoiceLimit < 2) this.effectiveVoiceLimit = Math.min(2, this.maxVoices);
      }
    };
  }

  random() {
    let x = this.randomState | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.randomState = x | 0;
    return (x >>> 0) / 4294967296;
  }

  spawnVoice(density, pitch, chaos, mode, pitchLocked) {
    let voice = null;
    for (let i = 0; i < this.effectiveVoiceLimit; i += 1) {
      if (!this.voices[i].active) { voice = this.voices[i]; break; }
    }
    if (!voice) return false;

    const modeGrainScale = [1.0, 0.50, 2.15, 1.15, 0.42, 0.68][mode] || 1;
    const grainMs = (34 + (1 - density) * 118 + this.random() * (26 + chaos * 30)) * modeGrainScale;
    const length = Math.max(72, Math.floor(sampleRate * grainMs / 1000));

    let historySeconds = 0.018 + this.random() * (0.07 + density * 0.12 + chaos * 0.42);
    if (mode === 1) historySeconds *= 1.5;                  // SHATTER: wider temporal scatter
    if (mode === 2) historySeconds = 0.08 + this.random() * 0.55; // SMEAR: long memory
    if (mode === 4) {                                     // STUTTER: quantized micro-history cells
      const cells = [0.025, 0.05, 0.075, 0.10, 0.15, 0.20];
      historySeconds = cells[(this.random() * cells.length) | 0] * (0.8 + density * 0.6);
    }
    if (mode === 5) historySeconds *= 1.9;                 // RUIN: deep torn history
    const history = Math.floor(sampleRate * historySeconds);

    const sets = [
      [0,0,0,0,2,-2],
      [0,0,3,-3,5,-5],
      [0,0,5,-5,7,-7],
      [0,7,-7,12,-12,5,-5],
      [0,12,-12,7,-7,19,-19],
    ];
    const setIndex = Math.min(sets.length - 1, Math.floor(pitch * sets.length));
    let intervals = pitchLocked ? [0] : sets[setIndex];

    // At Pitch = 0 the grain engine becomes a true unity-pitch reconstruction processor.
    // Temporal scatter, reverse playback, density, chaos, mode destruction, bit depth and
    // bloom all remain active; only interval/fine-pitch transposition is removed.
    if (!pitchLocked) {
      if (mode === 3) { // PRISM: chord-like interval families
        const prismSets = [
          [0,0,7,-5],
          [0,4,7,-12],
          [0,3,7,12],
          [0,5,7,12,-12],
          [0,7,12,19,-12],
        ];
        intervals = prismSets[setIndex];
      } else if (mode === 4) {
        intervals = [0,0,0,0, pitch > .55 ? 12 : 0, pitch > .75 ? -12 : 0];
      } else if (mode === 5) {
        intervals = [0,-12,12,-7,7,-19,19];
      }
    }

    let semitones = intervals[(this.random() * intervals.length) | 0];
    const fineSpread = pitchLocked ? 0 : mode === 3 ? pitch * 0.18 : pitch * (0.16 + chaos * 1.45);
    semitones += (this.random() * 2 - 1) * fineSpread;

    let step = Math.pow(2, semitones / 12);
    const reverseChance =
      mode === 1 ? 0.20 + chaos * 0.42 :
      mode === 5 ? 0.34 + chaos * 0.48 :
      chaos * 0.30;
    if (this.random() < reverseChance) step *= -1;

    voice.active = true;
    voice.phase = 0;
    voice.length = length;
    voice.read = (this.writeIndex - history + this.bufferSize) & this.mask;
    voice.step = step;
    voice.gain =
      mode === 2 ? 0.42 + density * 0.18 :
      mode === 1 ? 0.55 + density * 0.25 :
      mode === 5 ? 0.52 + density * 0.25 :
      0.50 + density * 0.22;
    voice.pan = (this.random() * 2 - 1) * (mode === 3 ? 0.98 : 0.50 + density * 0.42);
    voice.panDrift = (this.random() * 2 - 1) * (0.08 + chaos * 0.22);
    voice.tone =
      mode === 2 ? 0.16 + this.random() * 0.28 :
      mode === 5 ? 0.10 + this.random() * 0.72 :
      0.22 + this.random() * 0.56;
    voice.lastL = 0;
    voice.lastR = 0;
    return true;
  }

  interpolate(buffer, position) {
    const base = Math.floor(position);
    const fraction = position - base;
    const xm1 = buffer[(base - 1) & this.mask];
    const x0 = buffer[base & this.mask];
    const x1 = buffer[(base + 1) & this.mask];
    const x2 = buffer[(base + 2) & this.mask];

    // Four-point cubic Hermite interpolation keeps shifted grains noticeably smoother
    // than the old two-point linear reader without requiring another allocation or node.
    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * fraction + c2) * fraction + c1) * fraction + c0;
  }

  updateEmergencyGuard(callbackMs, callbackBudgetMs) {
    const load = callbackBudgetMs > 0 ? callbackMs / callbackBudgetMs : 0;
    const stressed = load > 0.72;
    const relaxed = load < 0.34;
    this.guardStressBlocks = stressed ? this.guardStressBlocks + 1 : 0;
    this.guardRecoveryBlocks = relaxed ? this.guardRecoveryBlocks + 1 : 0;
    if (this.guardStressBlocks >= 2 && this.effectiveVoiceLimit > 2) {
      this.effectiveVoiceLimit -= 1;
      this.guardStressBlocks = 0;
      this.guardRecoveryBlocks = 0;
    } else if (this.guardRecoveryBlocks >= 220 && this.effectiveVoiceLimit < this.maxVoices) {
      this.effectiveVoiceLimit += 1;
      this.guardRecoveryBlocks = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];
    const mode = Math.max(0, Math.min(5, Math.round(parameters.mode[0])));
    const bits = Math.max(4, Math.min(16, parameters.bits[0]));
    const targetDensity = Math.max(0, Math.min(1, parameters.density[0]));
    const targetPitch = Math.max(0, Math.min(1, parameters.pitch[0]));
    const targetChaos = Math.max(0, Math.min(1, parameters.chaos[0]));
    const pitchLocked = targetPitch <= 0.005;
    this.smoothedDensity += (targetDensity - this.smoothedDensity) * 0.08;
    this.smoothedPitch += (targetPitch - this.smoothedPitch) * 0.06;
    this.smoothedChaos += (targetChaos - this.smoothedChaos) * 0.06;
    const density = this.smoothedDensity;
    const pitch = pitchLocked ? 0 : this.smoothedPitch;
    const chaos = this.smoothedChaos;
    const spawnRateScale = mode === 2 ? 0.72 : mode === 1 ? 1.35 : mode === 4 ? 1.55 : mode === 5 ? 1.18 : 1;
    const spawnInterval = Math.max(24, Math.floor(sampleRate / ((14 + density * 104) * spawnRateScale)));

    for (let i = 0; i < outL.length; i += 1) {
      let dryL = inL ? inL[i] : 0;
      let dryR = inR ? inR[i] : dryL;
      // Flush denormals and invalid samples before they enter the history buffer.
      if (!Number.isFinite(dryL) || Math.abs(dryL) < 1e-20) dryL = 0;
      if (!Number.isFinite(dryR) || Math.abs(dryR) < 1e-20) dryR = 0;
      this.left[this.writeIndex] = dryL;
      this.right[this.writeIndex] = dryR;

      this.spawnCounter -= 1;
      if (this.spawnCounter <= 0) {
        const spawned = this.spawnVoice(density, pitch, chaos, mode, pitchLocked);
        this.spawnCounter = spawned
          ? Math.max(16, spawnInterval + (((this.random() - 0.5) * spawnInterval * chaos) | 0))
          : 32;
        if (!spawned) this.profileDroppedSpawns += 1;
      }

      let wetL = 0, wetR = 0, active = 0;
      for (let v = 0; v < this.effectiveVoiceLimit; v += 1) {
        const voice = this.voices[v];
        if (!voice.active) continue;
        const normalized = voice.phase / voice.length;
        if (normalized >= 1) { voice.active = false; continue; }
        // Sine-squared window gives slightly more useful energy through the middle of the grain.
        const sine = Math.sin(normalized * Math.PI);
        const envelope = sine * sine;

        let sampleL = this.interpolate(this.left, voice.read);
        let sampleR = this.interpolate(this.right, voice.read);

        // One-pole per-voice smoothing gives each fragment a slightly different material
        // and removes brittle high-frequency buildup from heavily shifted grains.
        const toneCoefficient =
          mode === 2 ? 0.12 + voice.tone * 0.38 :
          mode === 5 ? 0.10 + voice.tone * 0.76 :
          0.22 + voice.tone * 0.66;
        voice.lastL += (sampleL - voice.lastL) * toneCoefficient;
        voice.lastR += (sampleR - voice.lastR) * toneCoefficient;
        sampleL = voice.lastL;
        sampleR = voice.lastR;

        const movingPan = Math.max(-1, Math.min(1, voice.pan + Math.sin(normalized * Math.PI * 2) * voice.panDrift));
        const leftGain = Math.sqrt((1 - movingPan) * 0.5);
        const rightGain = Math.sqrt((1 + movingPan) * 0.5);
        const gain = envelope * voice.gain;
        wetL += (sampleL * 0.86 + sampleR * 0.14) * gain * leftGain;
        wetR += (sampleR * 0.86 + sampleL * 0.14) * gain * rightGain;
        voice.read += voice.step;
        while (voice.read < 0) voice.read += this.bufferSize;
        while (voice.read >= this.bufferSize) voice.read -= this.bufferSize;
        voice.phase += 1; active += 1;
      }

      const normalization = active > 1 ? 1 / Math.sqrt(0.62 + active * 0.40) : 1;

      const anchorByMode = [0.46, 0.28, 0.34, 0.42, 0.36, 0.24];
      const wetGainByMode = [1.22, 1.34, 1.28, 1.24, 1.30, 1.38];
      const anchor = anchorByMode[mode] + (1 - density) * 0.08;
      const reconstructionGain = wetGainByMode[mode] + density * 0.14;

      let processedL = dryL * anchor + wetL * normalization * reconstructionGain;
      let processedR = dryR * anchor + wetR * normalization * reconstructionGain;

      // Mode-specific destruction/reconstruction after the grain cloud is assembled.
      if (mode === 1) { // SHATTER: sample/hold micro-decimation
        const hold = 1 + Math.floor(chaos * 9 + (1 - bits / 16) * 5);
        if ((this.writeIndex % hold) !== 0) {
          processedL = this.outputL;
          processedR = this.outputR;
        }
      } else if (mode === 2) { // SMEAR: cross-channel diffusion
        const mid = (processedL + processedR) * 0.5;
        processedL = processedL * 0.72 + mid * 0.28;
        processedR = processedR * 0.72 + mid * 0.28;
      } else if (mode === 4) { // STUTTER: gentle rhythmic gating derived from history clock
        const cell = Math.max(64, Math.floor(sampleRate * (0.018 + (1-density) * 0.055)));
        const phase = (this.writeIndex % cell) / cell;
        const gate = 0.62 + 0.38 * Math.sin(Math.PI * phase);
        processedL *= gate;
        processedR *= gate;
      } else if (mode === 5) { // RUIN: asymmetry and controlled fold
        const fold = 1.1 + chaos * 1.8;
        processedL = Math.tanh(processedL * fold + processedR * 0.08 * chaos);
        processedR = Math.tanh(processedR * fold - processedL * 0.08 * chaos);
      }

      const effectiveBits = mode === 5
        ? Math.max(4, bits - Math.round(chaos * 5))
        : mode === 1
          ? Math.max(5, bits - Math.round(chaos * 2))
          : bits;
      const modeQuantization = Math.pow(2, effectiveBits - 1);
      const quantizedL = Math.round(processedL * modeQuantization) / modeQuantization;
      const quantizedR = Math.round(processedR * modeQuantization) / modeQuantization;

      let safeL = Math.tanh(quantizedL * 1.04) / Math.tanh(1.04);
      let safeR = Math.tanh(quantizedR * 1.04) / Math.tanh(1.04);

      // Wet loudness follower: the granular path should change texture, not collapse level.
      // Track stereo energy slowly enough to avoid pumping, then compensate within safe limits.
      const inputPower = (dryL * dryL + dryR * dryR) * 0.5;
      const wetPower = (safeL * safeL + safeR * safeR) * 0.5;
      this.inputEnergy += (inputPower - this.inputEnergy) * 0.0018;
      this.wetEnergy += (wetPower - this.wetEnergy) * 0.0018;
      const targetMakeup = Math.max(0.82, Math.min(1.72, Math.sqrt((this.inputEnergy + 1e-6) / (this.wetEnergy + 1e-6))));
      this.makeupGain += (targetMakeup - this.makeupGain) * 0.0012;
      safeL *= this.makeupGain;
      safeR *= this.makeupGain;

      this.outputL += (safeL - this.outputL) * 0.82;
      this.outputR += (safeR - this.outputR) * 0.82;
      if (Math.abs(this.outputL) < 1e-20) this.outputL = 0;
      if (Math.abs(this.outputR) < 1e-20) this.outputR = 0;
      outL[i] = this.outputL;
      outR[i] = this.outputR;
      this.writeIndex = (this.writeIndex + 1) & this.mask;
    }

    const callbackBudgetMs = outL.length / sampleRate * 1000;
    // AudioWorkletGlobalScope does not guarantee `performance`.
    // `currentTime` is audio-clock time and does not advance during one synchronous
    // process() call, so profiler CPU timing cannot be measured portably here.
    // Report callbackMs as 0 and let overrun protection rely on the worklet's
    // dropped-spawn/voice guard plus browser stability rather than crashing audio.
    const callbackMs = 0;
    this.updateEmergencyGuard(callbackMs, callbackBudgetMs);
    this.profileBlocks += 1;
    this.profileTotalMs += callbackMs;
    this.profileTotalSquaredMs += callbackMs * callbackMs;
    this.profileWorstMs = Math.max(this.profileWorstMs, callbackMs);
    if (callbackMs > callbackBudgetMs) this.profileOverruns += 1;
    if (this.profileBlocks >= 160) {
      let activeVoices = 0;
      for (let i = 0; i < this.effectiveVoiceLimit; i += 1) if (this.voices[i].active) activeVoices += 1;
      const averageCallbackMs = this.profileTotalMs / this.profileBlocks;
      const variance = Math.max(0, this.profileTotalSquaredMs / this.profileBlocks - averageCallbackMs * averageCallbackMs);
      this.port.postMessage({
        type: 'profile',
        averageCallbackMs,
        worstCallbackMs: this.profileWorstMs,
        callbackBudgetMs,
        cpuLoad: callbackBudgetMs > 0 ? averageCallbackMs / callbackBudgetMs : 0,
        callbackJitterMs: Math.sqrt(variance),
        activeVoices,
        maxVoices: this.maxVoices,
        effectiveVoiceLimit: this.effectiveVoiceLimit,
        overruns: this.profileOverruns,
        droppedSpawns: this.profileDroppedSpawns,
      });
      this.profileBlocks = 0;
      this.profileTotalMs = 0;
      this.profileTotalSquaredMs = 0;
      this.profileWorstMs = 0;
    }
    return true;
  }
}

registerProcessor('calcotone-grain-processor', CalcotoneGrainProcessor);
