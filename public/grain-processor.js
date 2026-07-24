class CalcotoneGrainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 8, automationRate: 'k-rate' },
      { name: 'bits', defaultValue: 13, minValue: 4, maxValue: 16, automationRate: 'k-rate' },
      { name: 'density', defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 0.38, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'chaos', defaultValue: 0.16, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bloom', defaultValue: 0.36, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
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

    // Hardware-sampler conversion state. These modes intentionally bypass the grain cloud
    // and behave like a live A/D -> memory clock -> D/A coloration path.
    this.hardwarePhase = 0;
    this.hardwareHeldL = 0;
    this.hardwareHeldR = 0;
    this.hardwareEnvelope = 0;
    this.hardwareFilterL = [0, 0, 0, 0];
    this.hardwareFilterR = [0, 0, 0, 0];
    this.hardwarePreviousMode = -1;

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
    if (mode === 1) historySeconds *= 1.5;
    if (mode === 2) historySeconds = 0.08 + this.random() * 0.55;
    if (mode === 4) {
      const cells = [0.025, 0.05, 0.075, 0.10, 0.15, 0.20];
      historySeconds = cells[(this.random() * cells.length) | 0] * (0.8 + density * 0.6);
    }
    if (mode === 5) historySeconds *= 1.9;
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

    if (!pitchLocked) {
      if (mode === 3) {
        const prismSets = [[0,0,7,-5],[0,4,7,-12],[0,3,7,12],[0,5,7,12,-12],[0,7,12,19,-12]];
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
    const reverseChance = mode === 1 ? 0.20 + chaos * 0.42 : mode === 5 ? 0.34 + chaos * 0.48 : chaos * 0.30;
    if (this.random() < reverseChance) step *= -1;

    voice.active = true;
    voice.phase = 0;
    voice.length = length;
    voice.read = (this.writeIndex - history + this.bufferSize) & this.mask;
    voice.step = step;
    voice.gain = mode === 2 ? 0.42 + density * 0.18 : mode === 1 ? 0.55 + density * 0.25 : mode === 5 ? 0.52 + density * 0.25 : 0.50 + density * 0.22;
    voice.pan = (this.random() * 2 - 1) * (mode === 3 ? 0.98 : 0.50 + density * 0.42);
    voice.panDrift = (this.random() * 2 - 1) * (0.08 + chaos * 0.22);
    voice.tone = mode === 2 ? 0.16 + this.random() * 0.28 : mode === 5 ? 0.10 + this.random() * 0.72 : 0.22 + this.random() * 0.56;
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
    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * fraction + c2) * fraction + c1) * fraction + c0;
  }

  quantize(value, bits) {
    const levels = Math.pow(2, bits - 1);
    return Math.round(Math.max(-1, Math.min(1, value)) * levels) / levels;
  }

  onePole(value, cutoff, state, index) {
    const safeCutoff = Math.max(60, Math.min(sampleRate * 0.46, cutoff));
    const coefficient = 1 - Math.exp(-2 * Math.PI * safeCutoff / sampleRate);
    state[index] += (value - state[index]) * coefficient;
    return state[index];
  }

  fourPole(value, cutoff, resonance, state) {
    const feedback = state[3] * Math.max(0, Math.min(0.88, resonance));
    let out = value - feedback;
    for (let stage = 0; stage < 4; stage += 1) out = this.onePole(out, cutoff, state, stage);
    return out;
  }

  resetHardwareState(mode) {
    if (this.hardwarePreviousMode === mode) return;
    this.hardwarePreviousMode = mode;
    this.hardwarePhase = 0;
    this.hardwareHeldL = 0;
    this.hardwareHeldR = 0;
    this.hardwareEnvelope = 0;
    this.hardwareFilterL.fill(0);
    this.hardwareFilterR.fill(0);
  }

  processHardware(dryL, dryR, mode, bitsControl, density, pitch, chaos, bloom) {
    this.resetHardwareState(mode);
    const inputPeak = Math.max(Math.abs(dryL), Math.abs(dryR));
    this.hardwareEnvelope += (inputPeak - this.hardwareEnvelope) * (inputPeak > this.hardwareEnvelope ? 0.018 : 0.0018);

    let targetRate = 26040;
    let bitDepth = 12;
    let inputDrive = 0.9 + density * 1.2;
    if (mode === 7) {
      targetRate = 40000;
      bitDepth = 12;
      inputDrive = 0.88 + density * 0.52;
    } else if (mode === 8) {
      targetRate = pitch <= 0.005 ? 32000 : 10000 + pitch * 23000;
      bitDepth = 8;
      inputDrive = 0.8 + density * 1.45;
    } else if (pitch > 0.005) {
      // SP-1200 clock coloration extension: unity at Pitch=0, increasingly abusive clocking above it.
      targetRate = 26040 * (0.72 + pitch * 0.56);
    }

    this.hardwarePhase += targetRate / sampleRate;
    if (this.hardwarePhase >= 1) {
      this.hardwarePhase -= Math.floor(this.hardwarePhase);
      const headroom = mode === 7 ? 0.98 - ((bitsControl - 4) / 12) * 0.12 : 1;
      const shapedL = Math.tanh((dryL / headroom) * inputDrive) / Math.max(1, inputDrive * 0.72);
      const shapedR = Math.tanh((dryR / headroom) * inputDrive) / Math.max(1, inputDrive * 0.72);
      this.hardwareHeldL = this.quantize(shapedL, bitDepth);
      this.hardwareHeldR = this.quantize(shapedR, bitDepth);
    }

    let outL = this.hardwareHeldL;
    let outR = this.hardwareHeldR;

    if (mode === 6) {
      // SP-1200: four output-pair families. Pair 1/2 is the dynamic SSM2044-style path,
      // 3/4 and 5/6 are progressively more open fixed filters, 7/8 is effectively raw.
      const pair = Math.max(0, Math.min(3, Math.floor(((bitsControl - 4) / 12) * 4)));
      if (pair === 0) {
        const cutoff = 3600 + bloom * 5600 + this.hardwareEnvelope * (1800 + chaos * 3200);
        outL = this.fourPole(outL, cutoff, 0.08 + chaos * 0.30, this.hardwareFilterL);
        outR = this.fourPole(outR, cutoff * 0.985, 0.08 + chaos * 0.30, this.hardwareFilterR);
      } else if (pair === 1) {
        const cutoff = 7200 + bloom * 2200;
        outL = this.onePole(this.onePole(outL, cutoff, this.hardwareFilterL, 0), cutoff, this.hardwareFilterL, 1);
        outR = this.onePole(this.onePole(outR, cutoff, this.hardwareFilterR, 0), cutoff, this.hardwareFilterR, 1);
      } else if (pair === 2) {
        const cutoff = 9800 + bloom * 2300;
        outL = this.onePole(outL, cutoff, this.hardwareFilterL, 0);
        outR = this.onePole(outR, cutoff, this.hardwareFilterR, 0);
      }
      const imaging = Math.sin(this.writeIndex * (26040 / sampleRate) * Math.PI * 2) * (0.0015 + chaos * 0.0035);
      outL += imaging;
      outR -= imaging * 0.82;
    } else if (mode === 7) {
      // MPC60: intentionally cleaner 40 kHz / 12-bit conversion with a fixed reconstruction path.
      const cutoff = 15_500 + bloom * 2_600;
      outL = this.onePole(this.onePole(outL, cutoff, this.hardwareFilterL, 0), cutoff, this.hardwareFilterL, 1);
      outR = this.onePole(this.onePole(outR, cutoff, this.hardwareFilterR, 0), cutoff, this.hardwareFilterR, 1);
      const converterTexture = (chaos - 0.5) * 0.006;
      outL = Math.tanh(outL * (1 + converterTexture));
      outR = Math.tanh(outR * (1 + converterTexture));
    } else {
      // Mirage: 8-bit converter into a resonant four-pole analog-style low-pass path.
      const cutoff = 700 + bloom * 13_500;
      const resonance = 0.05 + chaos * 0.72;
      outL = this.fourPole(outL, cutoff, resonance, this.hardwareFilterL);
      outR = this.fourPole(outR, cutoff * 0.992, resonance, this.hardwareFilterR);
    }

    return [Math.max(-1.15, Math.min(1.15, outL)), Math.max(-1.15, Math.min(1.15, outR))];
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
    const mode = Math.max(0, Math.min(8, Math.round(parameters.mode[0])));
    const bits = Math.max(4, Math.min(16, parameters.bits[0]));
    const targetDensity = Math.max(0, Math.min(1, parameters.density[0]));
    const targetPitch = Math.max(0, Math.min(1, parameters.pitch[0]));
    const targetChaos = Math.max(0, Math.min(1, parameters.chaos[0]));
    const bloom = Math.max(0, Math.min(1, parameters.bloom[0]));
    const pitchLocked = targetPitch <= 0.005;
    this.smoothedDensity += (targetDensity - this.smoothedDensity) * 0.08;
    this.smoothedPitch += (targetPitch - this.smoothedPitch) * 0.06;
    this.smoothedChaos += (targetChaos - this.smoothedChaos) * 0.06;
    const density = this.smoothedDensity;
    const pitch = pitchLocked ? 0 : this.smoothedPitch;
    const chaos = this.smoothedChaos;
    const hardwareMode = mode >= 6;
    const spawnRateScale = mode === 2 ? 0.72 : mode === 1 ? 1.35 : mode === 4 ? 1.55 : mode === 5 ? 1.18 : 1;
    const spawnInterval = Math.max(24, Math.floor(sampleRate / ((14 + density * 104) * spawnRateScale)));

    for (let i = 0; i < outL.length; i += 1) {
      let dryL = inL ? inL[i] : 0;
      let dryR = inR ? inR[i] : dryL;
      if (!Number.isFinite(dryL) || Math.abs(dryL) < 1e-20) dryL = 0;
      if (!Number.isFinite(dryR) || Math.abs(dryR) < 1e-20) dryR = 0;
      this.left[this.writeIndex] = dryL;
      this.right[this.writeIndex] = dryR;

      if (hardwareMode) {
        const processed = this.processHardware(dryL, dryR, mode, bits, density, pitch, chaos, bloom);
        this.outputL += (processed[0] - this.outputL) * 0.88;
        this.outputR += (processed[1] - this.outputR) * 0.88;
        outL[i] = this.outputL;
        outR[i] = this.outputR;
        this.writeIndex = (this.writeIndex + 1) & this.mask;
        continue;
      }

      this.spawnCounter -= 1;
      if (this.spawnCounter <= 0) {
        const spawned = this.spawnVoice(density, pitch, chaos, mode, pitchLocked);
        this.spawnCounter = spawned ? Math.max(16, spawnInterval + (((this.random() - 0.5) * spawnInterval * chaos) | 0)) : 32;
        if (!spawned) this.profileDroppedSpawns += 1;
      }

      let wetL = 0, wetR = 0, active = 0;
      for (let v = 0; v < this.effectiveVoiceLimit; v += 1) {
        const voice = this.voices[v];
        if (!voice.active) continue;
        const normalized = voice.phase / voice.length;
        if (normalized >= 1) { voice.active = false; continue; }
        const sine = Math.sin(normalized * Math.PI);
        const envelope = sine * sine;
        let sampleL = this.interpolate(this.left, voice.read);
        let sampleR = this.interpolate(this.right, voice.read);
        const toneCoefficient = mode === 2 ? 0.12 + voice.tone * 0.38 : mode === 5 ? 0.10 + voice.tone * 0.76 : 0.22 + voice.tone * 0.66;
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

      if (mode === 1) {
        const hold = 1 + Math.floor(chaos * 9 + (1 - bits / 16) * 5);
        if ((this.writeIndex % hold) !== 0) { processedL = this.outputL; processedR = this.outputR; }
      } else if (mode === 2) {
        const mid = (processedL + processedR) * 0.5;
        processedL = processedL * 0.72 + mid * 0.28;
        processedR = processedR * 0.72 + mid * 0.28;
      } else if (mode === 4) {
        const cell = Math.max(64, Math.floor(sampleRate * (0.018 + (1-density) * 0.055)));
        const phase = (this.writeIndex % cell) / cell;
        const gate = 0.62 + 0.38 * Math.sin(Math.PI * phase);
        processedL *= gate;
        processedR *= gate;
      } else if (mode === 5) {
        const fold = 1.1 + chaos * 1.8;
        processedL = Math.tanh(processedL * fold + processedR * 0.08 * chaos);
        processedR = Math.tanh(processedR * fold - processedL * 0.08 * chaos);
      }

      const effectiveBits = mode === 5 ? Math.max(4, bits - Math.round(chaos * 5)) : mode === 1 ? Math.max(5, bits - Math.round(chaos * 2)) : bits;
      const modeQuantization = Math.pow(2, effectiveBits - 1);
      const quantizedL = Math.round(processedL * modeQuantization) / modeQuantization;
      const quantizedR = Math.round(processedR * modeQuantization) / modeQuantization;
      let safeL = Math.tanh(quantizedL * 1.04) / Math.tanh(1.04);
      let safeR = Math.tanh(quantizedR * 1.04) / Math.tanh(1.04);
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
        type: 'profile', averageCallbackMs, worstCallbackMs: this.profileWorstMs, callbackBudgetMs,
        cpuLoad: callbackBudgetMs > 0 ? averageCallbackMs / callbackBudgetMs : 0,
        callbackJitterMs: Math.sqrt(variance), activeVoices, maxVoices: this.maxVoices,
        effectiveVoiceLimit: this.effectiveVoiceLimit, overruns: this.profileOverruns, droppedSpawns: this.profileDroppedSpawns,
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
