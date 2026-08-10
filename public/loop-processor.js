const TRACKS = 8;
const MAX_SECONDS = 60;
const ENVELOPE_BINS = 16384;
const WAVEFORM_BINS = 256;
const MIN_LOOP_FRAMES = 64;
const QUANTIZED_COMMANDS = new Set(['record', 'overdub', 'play', 'trackPlay', 'trackStop', 'undo', 'redo', 'bounce']);

class CalcotoneLoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxFrames = Math.max(1, Math.floor(sampleRate * MAX_SECONDS));
    this.envelopeScale = ENVELOPE_BINS / this.maxFrames;
    // Large stereo loop buffers are allocated only when a track is first armed.
    // This avoids reserving ~184 MB up front at 48 kHz (much more at high rates).
    this.buffers = Array.from({ length: TRACKS }, () => null);
    this.envelopes = Array.from({ length: TRACKS }, () => new Float32Array(ENVELOPE_BINS));
    this.trackLevels = new Float32Array(TRACKS);
    this.trackLevels.fill(0.72);
    // RC-style performance state is intentionally independent from track level.
    // STOP removes a track from the running clock, MUTE leaves its clock running,
    // and SOLO is resolved only at the summing stage.
    this.occupied = new Uint8Array(TRACKS);
    this.active = new Uint8Array(TRACKS);
    this.muted = new Uint8Array(TRACKS);
    this.soloed = new Uint8Array(TRACKS);
    this.rawFrames = new Uint32Array(TRACKS);
    this.trimStartFrames = new Uint32Array(TRACKS);
    this.trimEndFrames = new Uint32Array(TRACKS);
    this.positions = new Uint32Array(TRACKS);

    // Undo is a journal, not a realtime full-buffer copy. The first time an
    // overdub session touches a frame, its previous stereo sample is preserved.
    // A generation tag tells undo/redo exactly which frames belong to that pass.
    this.undoBuffers = Array.from({ length: TRACKS }, () => null);
    this.undoTags = Array.from({ length: TRACKS }, () => null);
    this.undoGeneration = new Uint16Array(TRACKS);
    this.undoTouched = new Uint32Array(TRACKS);
    this.undoReady = new Uint8Array(TRACKS);
    this.redoReady = new Uint8Array(TRACKS);
    this.swapMode = new Uint8Array(TRACKS); // 0 none, 1 undo, 2 redo
    this.swapCursor = new Uint32Array(TRACKS);
    this.swapRemaining = new Uint32Array(TRACKS);

    this.enabled = false;
    this.selectedTrack = 0;
    this.masterLevel = 0.78;
    // RETAIN feedback: 0 = rolling live replace, 1 = classic additive overdub.
    this.overdub = 0;
    this.replaceEnvelopeBin = -1;
    this.fade = 0.18;

    // Loop owns a sample clock. UI defaults publish 120/BAR immediately after
    // attachment, while the processor itself defaults OFF for compatibility.
    this.bpm = 120;
    this.quantize = 'off';
    this.clockFrame = 0;
    this.scheduledCommands = [];

    this.playing = false;
    this.recording = false;
    this.recordTrack = 0;
    this.recordCount = 0;
    this.overdubbing = false;
    this.overdubTrack = 0;
    this.bouncing = false;
    this.bounceTrack = 0;
    this.bounceCount = 0;
    this.bounceFrames = 0;
    this.runtimeCountdown = 0;
    this.port.onmessage = (event) => this.onMessage(event.data || {});
  }

  clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
  clampBpm(value) { return Math.max(30, Math.min(300, Math.round(Number.isFinite(value) ? value : 120))); }

  onMessage(message) {
    if (message.type === 'settings') {
      if ('enabled' in message) this.enabled = message.enabled === true;
      if ('selectedTrack' in message) this.selectedTrack = Math.max(0, Math.min(TRACKS - 1, Math.round(message.selectedTrack || 0)));
      if ('masterLevel' in message) this.masterLevel = this.clamp01(message.masterLevel);
      if ('overdub' in message) this.overdub = this.clamp01(message.overdub);
      if ('fade' in message) this.fade = this.clamp01(message.fade);
      if ('bpm' in message) this.bpm = this.clampBpm(message.bpm);
      if ('quantize' in message) this.quantize = message.quantize === 'beat' || message.quantize === 'bar' ? message.quantize : 'off';
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

  anyActiveOccupied() {
    for (let track = 0; track < TRACKS; track += 1) if (this.occupied[track] && this.active[track]) return true;
    return false;
  }

  anySoloOccupied() {
    for (let track = 0; track < TRACKS; track += 1) if (this.occupied[track] && this.soloed[track]) return true;
    return false;
  }

  activeLength(track) {
    if (!this.occupied[track]) return 0;
    return Math.max(0, this.trimEndFrames[track] - this.trimStartFrames[track]);
  }

  quantizeFrames() {
    if (this.quantize === 'off') return 0;
    const beat = Math.max(MIN_LOOP_FRAMES, Math.round(sampleRate * 60 / this.bpm));
    return this.quantize === 'bar' ? beat * 4 : beat;
  }

  nextBoundaryFrame() {
    const quantum = this.quantizeFrames();
    if (quantum <= 0) return this.clockFrame;
    return (Math.floor(this.clockFrame / quantum) + 1) * quantum;
  }

  scheduleCommand(command, track) {
    const due = this.nextBoundaryFrame();
    // One pending transport-style action per track is enough for a foot-controller
    // performance surface and prevents accidental double taps from stacking toggles.
    this.scheduledCommands = this.scheduledCommands.filter((entry) => entry.track !== track || entry.command === 'mute' || entry.command === 'solo');
    this.scheduledCommands.push({ due, command, track });
  }

  runScheduledCommands() {
    if (this.scheduledCommands.length === 0) return;
    for (let index = this.scheduledCommands.length - 1; index >= 0; index -= 1) {
      const entry = this.scheduledCommands[index];
      if (entry.due > this.clockFrame) continue;
      this.scheduledCommands.splice(index, 1);
      this.executeCommand(entry.command, entry.track);
    }
  }

  clearEnvelope(track) {
    this.envelopes[track].fill(0);
  }

  updateEnvelope(track, frameIndex, left, right) {
    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));
    const peak = Math.max(Math.abs(left), Math.abs(right));
    if (peak > this.envelopes[track][bin]) this.envelopes[track][bin] = peak;
  }

  updateReplaceEnvelope(track, frameIndex, left, right) {
    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));
    const peak = Math.max(Math.abs(left), Math.abs(right));
    if (bin !== this.replaceEnvelopeBin) {
      this.envelopes[track][bin] = peak;
      this.replaceEnvelopeBin = bin;
    } else if (peak > this.envelopes[track][bin]) {
      this.envelopes[track][bin] = peak;
    }
  }

  ensureBuffer(track) {
    if (this.buffers[track]) return this.buffers[track];
    try {
      const buffer = new Float32Array(this.maxFrames * 2);
      this.buffers[track] = buffer;
      return buffer;
    } catch {
      return null;
    }
  }

  ensureUndoJournal(track) {
    if (this.undoBuffers[track] && this.undoTags[track]) return true;
    try {
      this.undoBuffers[track] = new Float32Array(this.maxFrames * 2);
      this.undoTags[track] = new Uint16Array(this.maxFrames);
      return true;
    } catch {
      this.undoBuffers[track] = null;
      this.undoTags[track] = null;
      return false;
    }
  }

  beginOverdubJournal(track) {
    if (!this.ensureUndoJournal(track)) return false;
    let generation = (this.undoGeneration[track] + 1) & 0xffff;
    if (generation === 0) {
      this.undoTags[track].fill(0);
      generation = 1;
    }
    this.undoGeneration[track] = generation;
    this.undoTouched[track] = 0;
    this.undoReady[track] = 0;
    this.redoReady[track] = 0;
    this.swapMode[track] = 0;
    return true;
  }

  journalBeforeWrite(track, absoluteFrame, writeIndex, buffer) {
    const journal = this.undoBuffers[track];
    const tags = this.undoTags[track];
    if (!journal || !tags) return;
    const generation = this.undoGeneration[track];
    if (generation === 0 || tags[absoluteFrame] === generation) return;
    journal[writeIndex] = buffer[writeIndex];
    journal[writeIndex + 1] = buffer[writeIndex + 1];
    tags[absoluteFrame] = generation;
    this.undoTouched[track] += 1;
  }

  finishOverdub() {
    if (!this.overdubbing) return;
    const track = this.overdubTrack;
    this.overdubbing = false;
    this.undoReady[track] = this.undoTouched[track] > 0 ? 1 : 0;
    this.redoReady[track] = 0;
  }

  beginJournalSwap(track, mode) {
    if (!this.occupied[track] || this.swapMode[track]) return;
    if (mode === 1 && !this.undoReady[track]) return;
    if (mode === 2 && !this.redoReady[track]) return;
    const length = this.activeLength(track);
    if (length <= 0) return;
    this.swapMode[track] = mode;
    this.swapCursor[track] = Math.min(this.positions[track], length - 1);
    this.swapRemaining[track] = length;
  }

  applyJournalSwapStep(track) {
    const mode = this.swapMode[track];
    if (!mode) return;
    const length = this.activeLength(track);
    const buffer = this.buffers[track];
    const journal = this.undoBuffers[track];
    const tags = this.undoTags[track];
    if (length <= 0 || !buffer || !journal || !tags) {
      this.swapMode[track] = 0;
      this.swapRemaining[track] = 0;
      return;
    }
    const relative = Math.min(this.swapCursor[track], length - 1);
    const absolute = this.trimStartFrames[track] + relative;
    if (tags[absolute] === this.undoGeneration[track]) {
      const index = absolute * 2;
      const oldL = buffer[index];
      const oldR = buffer[index + 1];
      buffer[index] = journal[index];
      buffer[index + 1] = journal[index + 1];
      journal[index] = oldL;
      journal[index + 1] = oldR;
    }
    this.swapCursor[track] = relative + 1 >= length ? 0 : relative + 1;
    if (this.swapRemaining[track] > 0) this.swapRemaining[track] -= 1;
    if (this.swapRemaining[track] === 0) {
      this.swapMode[track] = 0;
      if (mode === 1) {
        this.undoReady[track] = 0;
        this.redoReady[track] = 1;
      } else {
        this.undoReady[track] = 1;
        this.redoReady[track] = 0;
      }
    }
  }

  invalidateJournal(track) {
    this.undoReady[track] = 0;
    this.redoReady[track] = 0;
    this.swapMode[track] = 0;
    this.swapRemaining[track] = 0;
    this.undoTouched[track] = 0;
  }

  startRecording(track) {
    if (!this.ensureBuffer(track)) return false;
    this.recordTrack = track;
    this.occupied[track] = 0;
    this.active[track] = 1;
    this.muted[track] = 0;
    this.soloed[track] = 0;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.positions[track] = 0;
    this.invalidateJournal(track);
    this.clearEnvelope(track);
    this.recordCount = 0;
    this.recording = true;
    this.overdubbing = false;
    this.playing = true;
    return true;
  }

  finishRecording(track) {
    if (this.recordCount >= MIN_LOOP_FRAMES) {
      const frames = Math.min(this.maxFrames, this.recordCount);
      this.rawFrames[track] = frames;
      this.trimStartFrames[track] = 0;
      this.trimEndFrames[track] = frames;
      this.positions[track] = 0;
      this.occupied[track] = 1;
      this.active[track] = 1;
      this.playing = true;
    } else {
      this.active[track] = 0;
    }
    this.recording = false;
    this.recordCount = 0;
    if (!this.anyActiveOccupied()) this.playing = false;
  }

  clearTrack(track) {
    this.occupied[track] = 0;
    this.active[track] = 0;
    this.muted[track] = 0;
    this.soloed[track] = 0;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.positions[track] = 0;
    this.invalidateJournal(track);
    if (this.recording && this.recordTrack === track) {
      this.recording = false;
      this.recordCount = 0;
    }
    if (this.overdubbing && this.overdubTrack === track) this.finishOverdub();
    if (this.bouncing && this.bounceTrack === track) this.bouncing = false;
    if (!this.anyActiveOccupied()) this.playing = false;
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

  playTrack(track) {
    if (!this.occupied[track] || this.activeLength(track) <= 0) return;
    this.active[track] = 1;
    this.positions[track] = 0;
    this.playing = true;
  }

  stopTrack(track) {
    if (this.recording && this.recordTrack === track) this.finishRecording(track);
    if (this.overdubbing && this.overdubTrack === track) this.finishOverdub();
    this.active[track] = 0;
    this.positions[track] = 0;
    if (!this.anyActiveOccupied()) this.playing = false;
  }

  startBounce(track) {
    if (this.occupied[track] || !this.ensureBuffer(track)) return;
    const soloing = this.anySoloOccupied();
    let frames = 0;
    for (let source = 0; source < TRACKS; source += 1) {
      if (source === track || !this.occupied[source] || !this.active[source] || this.muted[source]) continue;
      if (soloing && !this.soloed[source]) continue;
      frames = Math.max(frames, this.activeLength(source));
    }
    if (frames < MIN_LOOP_FRAMES) return;
    this.bounceTrack = track;
    this.bounceFrames = Math.min(this.maxFrames, frames);
    this.bounceCount = 0;
    this.bouncing = true;
    this.occupied[track] = 0;
    this.active[track] = 0;
    this.muted[track] = 0;
    this.soloed[track] = 0;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.positions[track] = 0;
    this.invalidateJournal(track);
    this.clearEnvelope(track);
  }

  finishBounce() {
    if (!this.bouncing) return;
    const track = this.bounceTrack;
    const frames = Math.min(this.maxFrames, this.bounceCount);
    this.bouncing = false;
    this.bounceCount = 0;
    if (frames < MIN_LOOP_FRAMES) return;
    this.rawFrames[track] = frames;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = frames;
    this.positions[track] = 0;
    this.occupied[track] = 1;
    // Bounce lands stopped so the rendered mix is never doubled automatically.
    this.active[track] = 0;
  }

  executeCommand(command, track) {
    if (command === 'record') {
      if (this.recording) this.finishRecording(this.recordTrack);
      else this.startRecording(track);
    } else if (command === 'overdub') {
      if (this.overdubbing) {
        this.finishOverdub();
      } else if (this.occupied[track] && this.activeLength(track) > 0) {
        this.beginOverdubJournal(track);
        this.overdubTrack = track;
        this.active[track] = 1;
        this.overdubbing = true;
        this.replaceEnvelopeBin = -1;
        this.recording = false;
        this.playing = true;
      }
    } else if (command === 'play') {
      if (this.anyOccupied()) {
        const stopAll = this.anyActiveOccupied();
        for (let index = 0; index < TRACKS; index += 1) {
          if (!this.occupied[index]) continue;
          this.active[index] = stopAll ? 0 : 1;
          this.positions[index] = 0;
        }
        this.playing = !stopAll;
        if (this.overdubbing) this.finishOverdub();
        this.recording = false;
        this.recordCount = 0;
      }
    } else if (command === 'clear') {
      this.clearTrack(track);
    } else if (command === 'trackPlay') {
      this.playTrack(track);
    } else if (command === 'trackStop') {
      this.stopTrack(track);
    } else if (command === 'mute') {
      if (this.occupied[track]) this.muted[track] ^= 1;
    } else if (command === 'solo') {
      if (this.occupied[track]) this.soloed[track] ^= 1;
    } else if (command === 'undo') {
      this.beginJournalSwap(track, 1);
    } else if (command === 'redo') {
      this.beginJournalSwap(track, 2);
    } else if (command === 'bounce') {
      this.startBounce(track);
    }
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

    // The very first REC establishes clock phase immediately. Everything after it
    // can land sample-accurately on the selected beat/bar grid.
    if (command === 'record' && !this.anyOccupied() && !this.recording) {
      this.clockFrame = 0;
      this.executeCommand(command, track);
    } else if (QUANTIZED_COMMANDS.has(command) && this.quantizeFrames() > 0 && !((command === 'undo' || command === 'redo') && !this.playing)) {
      this.scheduleCommand(command, track);
    } else {
      this.executeCommand(command, track);
    }
    this.publishRuntime();
  }

  trackMask() {
    let mask = 0;
    for (let i = 0; i < TRACKS; i += 1) if (this.occupied[i]) mask |= 1 << i;
    return mask;
  }

  stateMask(values) {
    let mask = 0;
    for (let i = 0; i < TRACKS; i += 1) if (values[i]) mask |= 1 << i;
    return mask;
  }

  transport() {
    if (this.recording) return 'recording';
    if (this.overdubbing) return 'overdubbing';
    if (!this.anyOccupied()) return 'empty';
    return this.playing && this.anyActiveOccupied() ? 'playing' : 'stopped';
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
      trackActiveMask: this.stateMask(this.active),
      trackMuteMask: this.stateMask(this.muted),
      trackSoloMask: this.stateMask(this.soloed),
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
    if (!buffer) return 0;
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
      this.runScheduledCommands();
      for (let track = 0; track < TRACKS; track += 1) if (this.swapMode[track]) this.applyJournalSwapStep(track);

      const liveL = leftIn ? (Number.isFinite(leftIn[frame]) ? leftIn[frame] : 0) : 0;
      const liveR = rightIn ? (Number.isFinite(rightIn[frame]) ? rightIn[frame] : 0) : liveL;
      let loopL = 0;
      let loopR = 0;
      const soloing = this.anySoloOccupied();

      if (this.enabled && this.playing) {
        for (let track = 0; track < TRACKS; track += 1) {
          if (!this.occupied[track] || !this.active[track] || this.muted[track] || this.activeLength(track) <= 0) continue;
          if (soloing && !this.soloed[track]) continue;
          const level = this.trackLevels[track];
          loopL += this.readTrack(track, 0) * level;
          loopR += this.readTrack(track, 1) * level;
        }
      }

      leftOut[frame] = liveL + loopL * this.masterLevel;
      rightOut[frame] = liveR + loopR * this.masterLevel;

      if (this.enabled) {
        const track = this.recording ? this.recordTrack : this.overdubbing ? this.overdubTrack : this.selectedTrack;
        const selected = this.buffers[track];
        if (this.recording && selected) {
          if (this.recordCount < this.maxFrames) {
            const write = this.recordCount * 2;
            selected[write] = liveL;
            selected[write + 1] = liveR;
            this.updateEnvelope(track, this.recordCount, liveL, liveR);
            this.recordCount += 1;
          }
          if (this.recordCount >= this.maxFrames) this.finishRecording(track);
        } else if (this.overdubbing && selected && this.occupied[track]) {
          const length = this.activeLength(track);
          if (length > 0) {
            const relative = Math.min(this.positions[track], length - 1);
            const absolute = this.trimStartFrames[track] + relative;
            const write = absolute * 2;
            this.journalBeforeWrite(track, absolute, write, selected);
            // Continuous DUB is a rolling tape-style replacement pass. RETAIN=0
            // overwrites the previous take sample-for-sample; higher RETAIN values
            // intentionally preserve old material for conventional feedback overdub.
            const nextL = selected[write] * this.overdub + liveL;
            const nextR = selected[write + 1] * this.overdub + liveR;
            selected[write] = nextL;
            selected[write + 1] = nextR;
            if (this.overdub <= 0.001) this.updateReplaceEnvelope(track, absolute, nextL, nextR);
            else this.updateEnvelope(track, absolute, nextL, nextR);
          }
        }

        if (this.bouncing) {
          const target = this.buffers[this.bounceTrack];
          if (target && this.bounceCount < this.bounceFrames) {
            const write = this.bounceCount * 2;
            target[write] = loopL;
            target[write + 1] = loopR;
            this.updateEnvelope(this.bounceTrack, this.bounceCount, loopL, loopR);
            this.bounceCount += 1;
          }
          if (this.bounceCount >= this.bounceFrames) this.finishBounce();
        }

        if (this.playing) {
          for (let trackIndex = 0; trackIndex < TRACKS; trackIndex += 1) {
            if (this.occupied[trackIndex] && this.active[trackIndex]) this.advanceTrack(trackIndex);
          }
        }
      }
      this.clockFrame += 1;
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
