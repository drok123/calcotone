const TRACKS = 8;
const MAX_SECONDS = 60;

class CalcotoneLoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxFrames = Math.max(1, Math.floor(sampleRate * MAX_SECONDS));
    this.buffers = Array.from({ length: TRACKS }, () => new Float32Array(this.maxFrames * 2));
    this.trackLevels = Array.from({ length: TRACKS }, () => 0.72);
    this.occupied = Array.from({ length: TRACKS }, () => false);
    this.enabled = false;
    this.selectedTrack = 0;
    this.masterLevel = 0.78;
    this.overdub = 1;
    this.fade = 0.18;
    this.masterFrames = 0;
    this.position = 0;
    this.playing = false;
    this.recording = false;
    this.recordFixed = false;
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

  command(command) {
    const track = this.selectedTrack;
    if (command === 'record') {
      if (this.recording) {
        if (this.masterFrames === 0 && this.recordCount >= 64) {
          this.masterFrames = Math.min(this.maxFrames, this.recordCount);
          this.occupied[track] = true;
          this.position = 0;
          this.playing = true;
        } else if (this.masterFrames > 0) {
          this.occupied[track] = true;
        }
        this.recording = false;
        this.recordFixed = false;
        this.recordCount = 0;
      } else {
        this.recording = true;
        this.recordFixed = this.masterFrames > 0;
        this.recordCount = 0;
        this.overdubbing = false;
        if (this.masterFrames === 0) this.position = 0;
        else this.playing = true;
      }
    } else if (command === 'overdub') {
      if (this.masterFrames > 0 && this.occupied[track]) {
        this.overdubbing = !this.overdubbing;
        this.recording = false;
        this.playing = true;
      }
    } else if (command === 'play') {
      if (this.masterFrames > 0) {
        this.playing = !this.playing;
        this.overdubbing = false;
        this.recording = false;
        this.recordFixed = false;
      }
    } else if (command === 'clear') {
      this.occupied[track] = false;
      if (this.recording) {
        this.recording = false;
        this.recordFixed = false;
        this.recordCount = 0;
      }
      if (this.overdubbing) this.overdubbing = false;
      if (!this.occupied.some(Boolean)) {
        this.masterFrames = 0;
        this.position = 0;
        this.playing = false;
      }
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
    if (this.masterFrames === 0) return 'empty';
    return this.playing ? 'playing' : 'stopped';
  }

  publishRuntime() {
    this.port.postMessage({
      type: 'runtime',
      transport: this.transport(),
      trackMask: this.trackMask(),
      loopFrames: this.masterFrames,
      position: this.position,
      sampleRate,
    });
  }

  readTrack(track, channel, position) {
    if (this.masterFrames <= 0) return 0;
    const buffer = this.buffers[track];
    const index = position * 2 + channel;
    const fadeSamples = Math.min(Math.floor(this.masterFrames / 4), Math.floor(this.fade * 0.02 * sampleRate));
    if (fadeSamples <= 1 || position < this.masterFrames - fadeSamples) return buffer[index];
    const local = position - (this.masterFrames - fadeSamples);
    const alpha = local / fadeSamples;
    const startIndex = Math.min(this.masterFrames - 1, local) * 2 + channel;
    return buffer[index] * (1 - alpha) + buffer[startIndex] * alpha;
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

      if (this.enabled && this.masterFrames > 0 && this.playing) {
        for (let track = 0; track < TRACKS; track += 1) {
          if (!this.occupied[track]) continue;
          if (this.recording && this.recordFixed && track === this.selectedTrack) continue;
          const level = this.trackLevels[track];
          loopL += this.readTrack(track, 0, this.position) * level;
          loopR += this.readTrack(track, 1, this.position) * level;
        }
      }

      leftOut[frame] = liveL + loopL * this.masterLevel;
      rightOut[frame] = liveR + loopR * this.masterLevel;

      if (!this.enabled) continue;
      const selected = this.buffers[this.selectedTrack];
      if (this.recording) {
        if (this.masterFrames === 0) {
          if (this.recordCount < this.maxFrames) {
            const write = this.recordCount * 2;
            selected[write] = liveL;
            selected[write + 1] = liveR;
            this.recordCount += 1;
          }
          if (this.recordCount >= this.maxFrames) {
            this.masterFrames = this.maxFrames;
            this.occupied[this.selectedTrack] = true;
            this.recording = false;
            this.playing = true;
            this.position = 0;
            this.recordCount = 0;
          }
          continue;
        }
        selected[this.position * 2] = liveL;
        selected[this.position * 2 + 1] = liveR;
        this.recordCount += 1;
        if (this.recordCount >= this.masterFrames) {
          this.occupied[this.selectedTrack] = true;
          this.recording = false;
          this.recordFixed = false;
          this.recordCount = 0;
        }
      } else if (this.overdubbing && this.masterFrames > 0 && this.occupied[this.selectedTrack]) {
        const write = this.position * 2;
        selected[write] = selected[write] * this.overdub + liveL;
        selected[write + 1] = selected[write + 1] * this.overdub + liveR;
      }

      if (this.masterFrames > 0 && (this.playing || this.recording || this.overdubbing)) {
        this.position += 1;
        if (this.position >= this.masterFrames) this.position = 0;
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
