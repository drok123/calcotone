const TRACKS = 8;
const MAX_SECONDS = 60;
const ENVELOPE_BINS = 16384;
const WAVEFORM_BINS = 64;
const MIN_LOOP_FRAMES = 64;

class CalcotoneLoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxFrames = Math.max(1, Math.floor(sampleRate * MAX_SECONDS));
    this.envelopeScale = ENVELOPE_BINS / this.maxFrames;
    this.buffers = Array.from({ length: TRACKS }, () => new Float32Array(this.maxFrames * 2));
    this.envelopes = Array.from({ length: TRACKS }, () => new Float32Array(ENVELOPE_BINS));
    this.trackLevels = new Float32Array(TRACKS);
    this.trackLevels.fill(0.72);
    this.occupied = new Uint8Array(TRACKS);
    this.rawFrames = new Uint32Array(TRACKS);
    this.trimStartFrames = new Uint32Array(TRACKS);
    this.trimEndFrames = new Uint32Array(TRACKS);
    this.positions = new Uint32Array(TRACKS);
    this.enabled = false;
    this.selectedTrack = 0;
    this.masterLevel = 0.78;
    this.overdub = 1;
    this.fade = 0.18;
    this.playing = false;
    this.recording = false;
    this.recordCount = 0;
    this.overdubbing = false;
    this.runtimeCountdown = 0;
    this.port.onmessage = (event) => this.onMessage(event.data || {});
  }

  clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

  onMessage(message) {
    if (message.type === 'settings') {
      if ('enabled' in message) this.enabled = message.enabled === true;
      if ('selectedTrack' in message) this.selectedTrack = Math.max(0, Math.min(TRACKS - 1, Math.round(message.selectedTrack || 0)));
      if ('masterLevel' in message) this.masterLevel = this.clamp01(message.masterLevel);
      if ('overdub' in message) this.overdub = this.clamp01(message.overdub);
      if ('fade' in message) this.fade = this.clamp01(message.fade);
      if (Array.isArray(message.trackLevels)) {
        for (let i = 0; i < TRACKS; i += 1) this.trackLevels[i] = this.clamp01(message.trackLevels[i] ?? this.trackLevels[i]);
      }
      this.publishRuntime();
      return;
    }
    if (message.type === 'command') this.command(message.command);
  }

  anyOccupied() {
    for (let track = 0; track < TRACKS; track += 1) if (this.occupied[track]) return true;
    return false;
  }

  activeLength(track) {
    if (!this.occupied[track]) return 0;
    return Math.max(0, this.trimEndFrames[track] - this.trimStartFrames[track]);
  }

  clearEnvelope(track) {
    this.envelopes[track].fill(0);
  }

  updateEnvelope(track, frameIndex, left, right) {
    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));
    const peak = Math.max(Math.abs(left), Math.abs(right));
    if (peak > this.envelopes[track][bin]) this.envelopes[track][bin] = peak;
  }

  startRecording(track) {
    this.occupied[track] = 0;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.positions[track] = 0;
    this.clearEnvelope(track);
    this.recordCount = 0;
    this.recording = true;
    this.overdubbing = false;
    this.playing = true;
  }

  finishRecording(track) {
    if (this.recordCount >= MIN_LOOP_FRAMES) {
      const frames = Math.min(this.maxFrames, this.recordCount);
      this.rawFrames[track] = frames;
      this.trimStartFrames[track] = 0;
      this.trimEndFrames[track] = frames;
      this.positions[track] = 0;
      this.occupied[track] = 1;
      this.playing = true;
    }
    this.recording = false;
    this.recordCount = 0;
    if (!this.anyOccupied()) this.playing = false;
  }

  clearTrack(track) {
    this.occupied[track] = 0;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.positions[track] = 0;
    if (this.recording) {
      this.recording = false;
      this.recordCount = 0;
    }
    this.overdubbing = false;
    if (!this.anyOccupied()) this.playing = false;
  }

  setTrimNormalized(track, requestedStart, requestedEnd) {
    const raw = this.rawFrames[track];
    if (!this.occupied[track] || raw < MIN_LOOP_FRAMES) return;
    const minimum = Math.min(raw, MIN_LOOP_FRAMES);
    let start = Math.max(0, Math.min(raw - minimum, Math.round(this.clamp01(requestedStart) * raw)));
    let end = Math.max(start + minimum, Math.min(raw, Math.round(this.clamp01(requestedEnd) * raw)));
    if (end > raw) {
      end = raw;
      start = Math.max(0, end - minimum);
    }
    this.trimStartFrames[track] = start;
    this.trimEndFrames[track] = end;
    this.positions[track] = Math.min(this.positions[track], Math.max(0, end - start - 1));
  }

  resetTrim(track) {
    if (!this.occupied[track]) return;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = this.rawFrames[track];
    this.positions[track] = 0;
  }

  usedEnvelopeBins(track) {
    const raw = this.rawFrames[track];
    return Math.max(1, Math.min(ENVELOPE_BINS, Math.ceil(raw * this.envelopeScale)));
  }

  autoTrim(track) {
    if (!this.occupied[track] || this.rawFrames[track] < MIN_LOOP_FRAMES) return;
    const used = this.usedEnvelopeBins(track);
    const envelope = this.envelopes[track];
    let peak = 0;
    for (let bin = 0; bin < used; bin += 1) peak = Math.max(peak, envelope[bin]);
    if (peak <= 1e-6) return;
    const threshold = Math.max(0.004, peak * 0.035);
    let first = -1;
    let last = -1;
    for (let bin = 0; bin < used; bin += 1) {
      if (envelope[bin] < threshold) continue;
      if (first < 0) first = bin;
      last = bin;
    }
    if (first < 0 || last < first) return;
    const binFrames = this.maxFrames / ENVELOPE_BINS;
    const padding = Math.max(1, Math.round(sampleRate * 0.004));
    let start = Math.max(0, Math.floor(first * binFrames) - padding);
    let end = Math.min(this.rawFrames[track], Math.ceil((last + 1) * binFrames) + padding);
    if (end - start < MIN_LOOP_FRAMES) end = Math.min(this.rawFrames[track], start + MIN_LOOP_FRAMES);
    if (end - start < MIN_LOOP_FRAMES) start = Math.max(0, end - MIN_LOOP_FRAMES);
    this.trimStartFrames[track] = start;
    this.trimEndFrames[track] = end;
    this.positions[track] = 0;
  }

  command(command) {
    const track = this.selectedTrack;
    if (typeof command === 'object' && command) {
      if (command.type === 'trim') this.setTrimNormalized(track, command.start, command.end);
      else if (command.type === 'autoTrim') this.autoTrim(track);
      else if (command.type === 'resetTrim') this.resetTrim(track);
      this.publishRuntime();
      return;
    }

    if (command === 'record') {
      if (this.recording) this.finishRecording(track);
      else this.startRecording(track);
    } else if (command === 'overdub') {
      if (this.occupied[track] && this.activeLength(track) > 0) {
        this.overdubbing = !this.overdubbing;
        this.recording = false;
        this.playing = true;
      }
    } else if (command === 'play') {
      if (this.anyOccupied()) {
        this.playing = !this.playing;
        this.overdubbing = false;
        this.recording = false;
        this.recordCount = 0;
      }
    } else if (command === 'clear') {
      this.clearTrack(track);
    }
    this.publishRuntime();
  }

  trackMask() {
    let mask = 0;
    for (let i = 0; i < TRACKS; i += 1) if (this.occupied[i]) mask |= 1 << i;
    return mask;
  }

  transport() {
    if (this.recording) return 'recording';
    if (this.overdubbing) return 'overdubbing';
    if (!this.anyOccupied()) return 'empty';
    return this.playing ? 'playing' : 'stopped';
  }

  selectedWaveform() {
    const track = this.selectedTrack;
    const output = new Array(WAVEFORM_BINS).fill(0);
    if (!this.occupied[track] || this.rawFrames[track] <= 0) return output;
    const used = this.usedEnvelopeBins(track);
    const envelope = this.envelopes[track];
    let maximum = 0;
    for (let bin = 0; bin < used; bin += 1) maximum = Math.max(maximum, envelope[bin]);
    if (maximum <= 1e-6) return output;
    for (let bucket = 0; bucket < WAVEFORM_BINS; bucket += 1) {
      const start = Math.min(used - 1, Math.floor(bucket * used / WAVEFORM_BINS));
      const end = Math.max(start + 1, Math.min(used, Math.ceil((bucket + 1) * used / WAVEFORM_BINS)));
      let peak = 0;
      for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, envelope[bin]);
      output[bucket] = this.clamp01(peak / maximum);
    }
    return output;
  }

  publishRuntime() {
    const track = this.selectedTrack;
    const raw = this.rawFrames[track];
    const length = this.activeLength(track);
    this.port.postMessage({
      type: 'runtime',
      transport: this.transport(),
      trackMask: this.trackMask(),
      loopFrames: length,
      rawFrames: raw,
      position: Math.min(this.positions[track], Math.max(0, length - 1)),
      sampleRate,
      trimStart: raw > 0 ? this.trimStartFrames[track] / raw : 0,
      trimEnd: raw > 0 ? this.trimEndFrames[track] / raw : 1,
      waveform: this.selectedWaveform(),
    });
  }

  readTrack(track, channel) {
    const length = this.activeLength(track);
    if (length <= 0) return 0;
    const relative = Math.min(this.positions[track], length - 1);
    const absolute = this.trimStartFrames[track] + relative;
    const buffer = this.buffers[track];
    const index = absolute * 2 + channel;
    const fadeSamples = Math.min(Math.floor(length / 4), Math.floor(this.fade * 0.02 * sampleRate));
    if (fadeSamples <= 1 || relative < length - fadeSamples) return buffer[index];
    const local = relative - (length - fadeSamples);
    const alpha = local / fadeSamples;
    const startRelative = Math.min(length - 1, local);
    const startAbsolute = this.trimStartFrames[track] + startRelative;
    return buffer[index] * (1 - alpha) + buffer[startAbsolute * 2 + channel] * alpha;
  }

  advanceTrack(track) {
    const length = this.activeLength(track);
    if (length <= 0) {
      this.positions[track] = 0;
      return;
    }
    const next = this.positions[track] + 1;
    this.positions[track] = next >= length ? 0 : next;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const leftIn = input[0];
    const rightIn = input[1] || leftIn;
    const leftOut = output[0];
    const rightOut = output[1] || leftOut;
    if (!leftOut || !rightOut) return true;

    for (let frame = 0; frame < leftOut.length; frame += 1) {
      const liveL = leftIn ? (Number.isFinite(leftIn[frame]) ? leftIn[frame] : 0) : 0;
      const liveR = rightIn ? (Number.isFinite(rightIn[frame]) ? rightIn[frame] : 0) : liveL;
      let loopL = 0;
      let loopR = 0;

      if (this.enabled && this.playing) {
        for (let track = 0; track < TRACKS; track += 1) {
          if (!this.occupied[track] || this.activeLength(track) <= 0) continue;
          const level = this.trackLevels[track];
          loopL += this.readTrack(track, 0) * level;
          loopR += this.readTrack(track, 1) * level;
        }
      }

      leftOut[frame] = liveL + loopL * this.masterLevel;
      rightOut[frame] = liveR + loopR * this.masterLevel;

      if (!this.enabled) continue;
      const track = this.selectedTrack;
      const selected = this.buffers[track];
      if (this.recording) {
        if (this.recordCount < this.maxFrames) {
          const write = this.recordCount * 2;
          selected[write] = liveL;
          selected[write + 1] = liveR;
          this.updateEnvelope(track, this.recordCount, liveL, liveR);
          this.recordCount += 1;
        }
        if (this.recordCount >= this.maxFrames) this.finishRecording(track);
      } else if (this.overdubbing && this.occupied[track]) {
        const length = this.activeLength(track);
        if (length > 0) {
          const relative = Math.min(this.positions[track], length - 1);
          const absolute = this.trimStartFrames[track] + relative;
          const write = absolute * 2;
          const nextL = selected[write] * this.overdub + liveL;
          const nextR = selected[write + 1] * this.overdub + liveR;
          selected[write] = nextL;
          selected[write + 1] = nextR;
          this.updateEnvelope(track, absolute, nextL, nextR);
        }
      }

      if (this.playing) {
        for (let trackIndex = 0; trackIndex < TRACKS; trackIndex += 1) {
          if (this.occupied[trackIndex]) this.advanceTrack(trackIndex);
        }
      }
    }

    this.runtimeCountdown += leftOut.length;
    if (this.runtimeCountdown >= Math.max(1024, sampleRate / 20)) {
      this.runtimeCountdown = 0;
      this.publishRuntime();
    }
    return true;
  }
}

registerProcessor('calcotone-loop-processor', CalcotoneLoopProcessor);
