const TRACKS = 8;
const MAX_SECONDS = 60;
const ENVELOPE_BINS = 16384;
const WAVEFORM_BINS = 256;
const MIN_LOOP_FRAMES = 64;
const SCHEDULED_SLOTS = TRACKS + 4;
const NO_DUE = Number.POSITIVE_INFINITY;
const UNDO_SCAN_PER_AUDIO_FRAME = 64;
const UNDO_SCAN_MINIMUM = 4096;
const UNDO_SCAN_MAXIMUM = 131072;

const COMMAND_CODE = Object.freeze({
  record: 0,
  overdub: 1,
  play: 2,
  clear: 3,
  trackPlay: 7,
  trackStop: 8,
  mute: 9,
  solo: 10,
  undo: 11,
  redo: 12,
  bounce: 13,
});
const COMMAND_NAME = Object.freeze([
  'record', 'overdub', 'play', 'clear', '', '', '', 'trackPlay', 'trackStop', 'mute', 'solo', 'undo', 'redo', 'bounce',
]);
const QUANTIZED_CODES = new Set([0, 1, 2, 7, 8, 11, 12, 13]);

class CalcotoneLoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxFrames = Math.max(1, Math.floor(sampleRate * MAX_SECONDS));
    this.envelopeScale = ENVELOPE_BINS / this.maxFrames;

    // Large stereo audio/undo buffers remain lazy. The native engine allocates them
    // on its control thread; browser fallback has to allocate inside the worklet realm.
    this.buffers = Array.from({ length: TRACKS }, () => null);
    this.envelopes = Array.from({ length: TRACKS }, () => new Float32Array(ENVELOPE_BINS));
    this.trackLevels = new Float32Array(TRACKS);
    this.trackLevels.fill(0.72);
    this.rawFrames = new Uint32Array(TRACKS);
    this.trimStartFrames = new Uint32Array(TRACKS);
    this.trimEndFrames = new Uint32Array(TRACKS);
    this.lengths = new Uint32Array(TRACKS);
    this.fadeFrames = new Uint32Array(TRACKS);
    this.positions = new Uint32Array(TRACKS);
    this.replaceEnvelopeBin = new Int32Array(TRACKS);
    this.replaceEnvelopeBin.fill(-1);

    // Bitmasks are the authoritative performance state. This removes repeated
    // all-track scans from every rendered sample and prevents duplicate arrays
    // from disagreeing about STOP/MUTE/SOLO state.
    this.occupiedMask = 0;
    this.activeMask = 0;
    this.muteMask = 0;
    this.soloMask = 0;
    this.playbackMask = 0;
    this.advanceMask = 0;

    this.undoBuffers = Array.from({ length: TRACKS }, () => null);
    this.undoTags = Array.from({ length: TRACKS }, () => null);
    this.undoGeneration = new Uint16Array(TRACKS);
    this.undoTouched = new Uint32Array(TRACKS);
    this.undoReady = new Uint8Array(TRACKS);
    this.redoReady = new Uint8Array(TRACKS);
    this.swapMode = new Uint8Array(TRACKS);
    this.swapCursor = new Uint32Array(TRACKS);
    this.swapRemaining = new Uint32Array(TRACKS);

    this.enabled = false;
    this.selectedTrack = 0;
    this.masterLevel = 0.78;
    this.overdub = 0;
    this.fade = 0.18;
    this.bpm = 120;
    this.quantize = 'off';
    this.clockFrame = 0;

    // Fixed scheduler: no filter/push/splice and no render-time array growth.
    this.scheduledActive = new Uint8Array(SCHEDULED_SLOTS);
    this.scheduledDue = new Float64Array(SCHEDULED_SLOTS);
    this.scheduledCode = new Uint8Array(SCHEDULED_SLOTS);
    this.scheduledTrack = new Uint8Array(SCHEDULED_SLOTS);
    this.nextScheduledDue = NO_DUE;

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

    // Runtime messages are diagnostics/UI telemetry, not audio control. Keep them
    // at 10 Hz and reuse the waveform array so the process callback stays quiet.
    this.runtimeCountdown = 0;
    this.runtimePeriod = Math.max(1024, Math.floor(sampleRate / 10));
    this.waveformCache = new Float32Array(WAVEFORM_BINS);
    this.waveformDirty = true;

    this.refreshFadeFrames();
    this.port.onmessage = (event) => this.onMessage(event.data || {});
  }

  bit(track) { return 1 << track; }
  clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
  clampBpm(value) { return Math.max(30, Math.min(300, Math.round(Number.isFinite(value) ? value : 120))); }

  onMessage(message) {
    if (message.type === 'settings') {
      if ('enabled' in message) this.enabled = message.enabled === true;
      if ('selectedTrack' in message) {
        const next = Math.max(0, Math.min(TRACKS - 1, Math.round(message.selectedTrack || 0)));
        if (next !== this.selectedTrack) this.waveformDirty = true;
        this.selectedTrack = next;
      }
      if ('masterLevel' in message) this.masterLevel = this.clamp01(message.masterLevel);
      if ('overdub' in message) this.overdub = this.clamp01(message.overdub);
      if ('fade' in message) {
        const nextFade = this.clamp01(message.fade);
        if (nextFade !== this.fade) {
          this.fade = nextFade;
          this.refreshFadeFrames();
        }
      }
      if ('bpm' in message) this.bpm = this.clampBpm(message.bpm);
      if ('quantize' in message) this.quantize = message.quantize === 'beat' || message.quantize === 'bar' ? message.quantize : 'off';
      if (Array.isArray(message.trackLevels)) {
        for (let i = 0; i < TRACKS; i += 1) this.trackLevels[i] = this.clamp01(message.trackLevels[i] ?? this.trackLevels[i]);
      }
      this.updateDerivedMasks();
      return;
    }
    if (message.type === 'command') this.command(message.command);
  }

  anyOccupied() { return this.occupiedMask !== 0; }
  anyActiveOccupied() { return (this.occupiedMask & this.activeMask) !== 0; }
  anySoloOccupied() { return (this.occupiedMask & this.soloMask) !== 0; }
  activeLength(track) { return this.lengths[track] || 0; }

  updateLength(track) {
    if (!(this.occupiedMask & this.bit(track)) || this.trimEndFrames[track] <= this.trimStartFrames[track]) {
      this.lengths[track] = 0;
      this.fadeFrames[track] = 0;
      return;
    }
    const length = this.trimEndFrames[track] - this.trimStartFrames[track];
    this.lengths[track] = length;
    this.fadeFrames[track] = Math.min(Math.floor(length / 4), Math.floor(this.fade * 0.02 * sampleRate));
  }

  refreshFadeFrames() {
    for (let track = 0; track < TRACKS; track += 1) this.updateLength(track);
  }

  updateDerivedMasks() {
    const soloing = this.anySoloOccupied();
    this.playbackMask = this.enabled && this.playing
      ? this.occupiedMask & this.activeMask & ~this.muteMask & (soloing ? this.soloMask : 0xff)
      : 0;
    this.advanceMask = this.enabled && this.playing ? this.occupiedMask & this.activeMask : 0;
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

  recomputeNextScheduledDue() {
    let next = NO_DUE;
    for (let slot = 0; slot < SCHEDULED_SLOTS; slot += 1) {
      if (this.scheduledActive[slot]) next = Math.min(next, this.scheduledDue[slot]);
    }
    this.nextScheduledDue = next;
  }

  scheduleCommand(code, track) {
    const due = this.nextBoundaryFrame();
    for (let slot = 0; slot < SCHEDULED_SLOTS; slot += 1) {
      if (this.scheduledActive[slot] && this.scheduledTrack[slot] === track) {
        this.scheduledDue[slot] = due;
        this.scheduledCode[slot] = code;
        this.recomputeNextScheduledDue();
        return;
      }
    }
    for (let slot = 0; slot < SCHEDULED_SLOTS; slot += 1) {
      if (this.scheduledActive[slot]) continue;
      this.scheduledActive[slot] = 1;
      this.scheduledDue[slot] = due;
      this.scheduledCode[slot] = code;
      this.scheduledTrack[slot] = track;
      this.nextScheduledDue = Math.min(this.nextScheduledDue, due);
      return;
    }
    this.scheduledActive[0] = 1;
    this.scheduledDue[0] = due;
    this.scheduledCode[0] = code;
    this.scheduledTrack[0] = track;
    this.recomputeNextScheduledDue();
  }

  runScheduledCommands() {
    if (this.nextScheduledDue > this.clockFrame) return;
    for (let slot = 0; slot < SCHEDULED_SLOTS; slot += 1) {
      if (!this.scheduledActive[slot] || this.scheduledDue[slot] > this.clockFrame) continue;
      const code = this.scheduledCode[slot];
      const track = this.scheduledTrack[slot];
      this.scheduledActive[slot] = 0;
      this.executeCommandCode(code, track);
    }
    this.recomputeNextScheduledDue();
  }

  clearEnvelope(track) {
    this.envelopes[track].fill(0);
    this.replaceEnvelopeBin[track] = -1;
    this.waveformDirty = true;
  }

  updateEnvelope(track, frameIndex, left, right, replace = false) {
    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));
    const peak = Math.max(Math.abs(left), Math.abs(right));
    if (replace && this.replaceEnvelopeBin[track] !== bin) {
      this.envelopes[track][bin] = peak;
      this.replaceEnvelopeBin[track] = bin;
    } else if (peak > this.envelopes[track][bin]) {
      this.envelopes[track][bin] = peak;
    }
    this.waveformDirty = true;
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
    this.replaceEnvelopeBin[track] = -1;
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
    this.waveformDirty = true;
  }

  invalidateJournal(track) {
    this.undoReady[track] = 0;
    this.redoReady[track] = 0;
    this.swapMode[track] = 0;
    this.swapRemaining[track] = 0;
    this.undoTouched[track] = 0;
  }

  beginJournalSwap(track, mode) {
    if (!(this.occupiedMask & this.bit(track)) || this.swapMode[track]) return;
    if (mode === 1 && !this.undoReady[track]) return;
    if (mode === 2 && !this.redoReady[track]) return;
    const length = this.activeLength(track);
    if (length <= 0 || !this.undoBuffers[track] || !this.undoTags[track]) return;
    this.swapMode[track] = mode;
    this.swapCursor[track] = 0;
    this.swapRemaining[track] = length;
  }

  applyJournalSwapBudget(track, budget) {
    const mode = this.swapMode[track];
    if (!mode || budget <= 0) return;
    const length = this.activeLength(track);
    const buffer = this.buffers[track];
    const journal = this.undoBuffers[track];
    const tags = this.undoTags[track];
    if (length <= 0 || !buffer || !journal || !tags) {
      this.swapMode[track] = 0;
      this.swapRemaining[track] = 0;
      return;
    }
    let remaining = Math.min(budget, this.swapRemaining[track]);
    while (remaining > 0 && this.swapRemaining[track] > 0) {
      remaining -= 1;
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
      this.swapRemaining[track] -= 1;
    }
    if (this.swapRemaining[track] === 0) {
      this.swapMode[track] = 0;
      if (mode === 1) {
        this.undoReady[track] = 0;
        this.redoReady[track] = 1;
      } else {
        this.undoReady[track] = 1;
        this.redoReady[track] = 0;
      }
      this.waveformDirty = true;
    }
  }

  applyJournalSwaps(frames) {
    const budget = Math.max(UNDO_SCAN_MINIMUM, Math.min(UNDO_SCAN_MAXIMUM, frames * UNDO_SCAN_PER_AUDIO_FRAME));
    for (let track = 0; track < TRACKS; track += 1) {
      if (this.swapMode[track]) this.applyJournalSwapBudget(track, budget);
    }
  }

  startRecording(track) {
    if (!this.ensureBuffer(track)) return false;
    const trackBit = this.bit(track);
    this.recordTrack = track;
    this.occupiedMask &= ~trackBit;
    this.activeMask |= trackBit;
    this.muteMask &= ~trackBit;
    this.soloMask &= ~trackBit;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.lengths[track] = 0;
    this.fadeFrames[track] = 0;
    this.positions[track] = 0;
    this.invalidateJournal(track);
    this.clearEnvelope(track);
    this.recordCount = 0;
    this.recording = true;
    this.overdubbing = false;
    this.playing = true;
    this.updateDerivedMasks();
    return true;
  }

  finishRecording(track) {
    const trackBit = this.bit(track);
    if (this.recordCount >= MIN_LOOP_FRAMES) {
      const frames = Math.min(this.maxFrames, this.recordCount);
      this.rawFrames[track] = frames;
      this.trimStartFrames[track] = 0;
      this.trimEndFrames[track] = frames;
      this.occupiedMask |= trackBit;
      this.activeMask |= trackBit;
      this.updateLength(track);
      this.positions[track] = 0;
      this.playing = true;
    } else {
      this.occupiedMask &= ~trackBit;
      this.activeMask &= ~trackBit;
      this.lengths[track] = 0;
    }
    this.recording = false;
    this.recordCount = 0;
    if (!this.anyActiveOccupied()) this.playing = false;
    this.waveformDirty = true;
    this.updateDerivedMasks();
  }

  clearTrack(track) {
    const trackBit = this.bit(track);
    this.occupiedMask &= ~trackBit;
    this.activeMask &= ~trackBit;
    this.muteMask &= ~trackBit;
    this.soloMask &= ~trackBit;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.lengths[track] = 0;
    this.fadeFrames[track] = 0;
    this.positions[track] = 0;
    this.invalidateJournal(track);
    if (this.recording && this.recordTrack === track) {
      this.recording = false;
      this.recordCount = 0;
    }
    if (this.overdubbing && this.overdubTrack === track) this.finishOverdub();
    if (this.bouncing && this.bounceTrack === track) this.bouncing = false;
    if (!this.anyActiveOccupied()) this.playing = false;
    this.clearEnvelope(track);
    this.updateDerivedMasks();
  }

  setTrimNormalized(track, requestedStart, requestedEnd) {
    const raw = this.rawFrames[track];
    if (!(this.occupiedMask & this.bit(track)) || raw < MIN_LOOP_FRAMES) return;
    const minimum = Math.min(raw, MIN_LOOP_FRAMES);
    let start = Math.max(0, Math.min(raw - minimum, Math.round(this.clamp01(requestedStart) * raw)));
    let end = Math.max(start + minimum, Math.min(raw, Math.round(this.clamp01(requestedEnd) * raw)));
    if (end > raw) {
      end = raw;
      start = Math.max(0, end - minimum);
    }
    this.trimStartFrames[track] = start;
    this.trimEndFrames[track] = end;
    this.updateLength(track);
    this.positions[track] = Math.min(this.positions[track], Math.max(0, this.lengths[track] - 1));
  }

  resetTrim(track) {
    if (!(this.occupiedMask & this.bit(track))) return;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = this.rawFrames[track];
    this.updateLength(track);
    this.positions[track] = 0;
  }

  usedEnvelopeBins(track) {
    return Math.max(1, Math.min(ENVELOPE_BINS, Math.ceil(this.rawFrames[track] * ENVELOPE_BINS / this.maxFrames)));
  }

  autoTrim(track) {
    if (!(this.occupiedMask & this.bit(track)) || this.rawFrames[track] < MIN_LOOP_FRAMES) return;
    const used = this.usedEnvelopeBins(track);
    const envelope = this.envelopes[track];
    let maximum = 0;
    for (let bin = 0; bin < used; bin += 1) maximum = Math.max(maximum, envelope[bin]);
    if (maximum <= 1e-6) return;
    const threshold = Math.max(0.004, maximum * 0.035);
    let first = used;
    let last = 0;
    for (let bin = 0; bin < used; bin += 1) {
      if (envelope[bin] < threshold) continue;
      first = Math.min(first, bin);
      last = bin;
    }
    if (first >= used || last < first) return;
    const binFrames = this.maxFrames / ENVELOPE_BINS;
    const padding = Math.max(1, Math.round(sampleRate * 0.004));
    let start = Math.max(0, Math.floor(first * binFrames) - padding);
    let end = Math.min(this.rawFrames[track], Math.ceil((last + 1) * binFrames) + padding);
    if (end - start < MIN_LOOP_FRAMES) end = Math.min(this.rawFrames[track], start + MIN_LOOP_FRAMES);
    if (end - start < MIN_LOOP_FRAMES) start = Math.max(0, end - MIN_LOOP_FRAMES);
    this.trimStartFrames[track] = start;
    this.trimEndFrames[track] = end;
    this.updateLength(track);
    this.positions[track] = 0;
  }

  playTrack(track) {
    if (!(this.occupiedMask & this.bit(track)) || this.activeLength(track) <= 0) return;
    this.activeMask |= this.bit(track);
    this.positions[track] = 0;
    this.playing = true;
    this.updateDerivedMasks();
  }

  stopTrack(track) {
    if (this.recording && this.recordTrack === track) this.finishRecording(track);
    if (this.overdubbing && this.overdubTrack === track) this.finishOverdub();
    this.activeMask &= ~this.bit(track);
    this.positions[track] = 0;
    if (!this.anyActiveOccupied()) this.playing = false;
    this.updateDerivedMasks();
  }

  startBounce(track) {
    const trackBit = this.bit(track);
    if ((this.occupiedMask & trackBit) || !this.ensureBuffer(track)) return;
    const soloing = this.anySoloOccupied();
    const sourceMask = this.occupiedMask & this.activeMask & ~this.muteMask & (soloing ? this.soloMask : 0xff);
    let frames = 0;
    for (let source = 0; source < TRACKS; source += 1) {
      if (sourceMask & this.bit(source)) frames = Math.max(frames, this.activeLength(source));
    }
    if (frames < MIN_LOOP_FRAMES) return;
    this.bounceTrack = track;
    this.bounceFrames = Math.min(this.maxFrames, frames);
    this.bounceCount = 0;
    this.bouncing = true;
    this.occupiedMask &= ~trackBit;
    this.activeMask &= ~trackBit;
    this.muteMask &= ~trackBit;
    this.soloMask &= ~trackBit;
    this.rawFrames[track] = 0;
    this.trimStartFrames[track] = 0;
    this.trimEndFrames[track] = 0;
    this.lengths[track] = 0;
    this.fadeFrames[track] = 0;
    this.positions[track] = 0;
    this.invalidateJournal(track);
    this.clearEnvelope(track);
    this.updateDerivedMasks();
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
    this.occupiedMask |= this.bit(track);
    this.activeMask &= ~this.bit(track);
    this.updateLength(track);
    this.positions[track] = 0;
    this.waveformDirty = true;
    this.updateDerivedMasks();
  }

  executeCommandCode(code, track) {
    const command = COMMAND_NAME[code];
    if (command === 'record') {
      if (this.recording) this.finishRecording(this.recordTrack);
      else this.startRecording(track);
    } else if (command === 'overdub') {
      if (this.overdubbing) {
        this.finishOverdub();
      } else if ((this.occupiedMask & this.bit(track)) && this.activeLength(track) > 0 && this.beginOverdubJournal(track)) {
        this.overdubTrack = track;
        this.activeMask |= this.bit(track);
        this.overdubbing = true;
        this.recording = false;
        this.playing = true;
        this.updateDerivedMasks();
      }
    } else if (command === 'play') {
      if (this.anyOccupied()) {
        const stopAll = this.anyActiveOccupied();
        for (let index = 0; index < TRACKS; index += 1) {
          if (this.occupiedMask & this.bit(index)) this.positions[index] = 0;
        }
        if (stopAll) this.activeMask &= ~this.occupiedMask;
        else this.activeMask |= this.occupiedMask;
        this.playing = !stopAll;
        if (this.overdubbing) this.finishOverdub();
        this.recording = false;
        this.recordCount = 0;
        this.updateDerivedMasks();
      }
    } else if (command === 'clear') {
      this.clearTrack(track);
    } else if (command === 'trackPlay') {
      this.playTrack(track);
    } else if (command === 'trackStop') {
      this.stopTrack(track);
    } else if (command === 'mute') {
      if (this.occupiedMask & this.bit(track)) this.muteMask ^= this.bit(track);
      this.updateDerivedMasks();
    } else if (command === 'solo') {
      if (this.occupiedMask & this.bit(track)) this.soloMask ^= this.bit(track);
      this.updateDerivedMasks();
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
      this.waveformDirty = true;
      return;
    }

    const code = COMMAND_CODE[command];
    if (!Number.isInteger(code)) return;
    if (command === 'record' && !this.anyOccupied() && !this.recording) {
      this.clockFrame = 0;
      this.executeCommandCode(code, track);
    } else if (QUANTIZED_CODES.has(code) && this.quantizeFrames() > 0 && !((command === 'undo' || command === 'redo') && !this.playing)) {
      this.scheduleCommand(code, track);
    } else {
      this.executeCommandCode(code, track);
    }
  }

  transport() {
    if (this.recording) return 'recording';
    if (this.overdubbing) return 'overdubbing';
    if (!this.anyOccupied()) return 'empty';
    return this.playing && this.anyActiveOccupied() ? 'playing' : 'stopped';
  }

  refreshWaveformCache() {
    this.waveformCache.fill(0);
    const track = this.selectedTrack;
    if (!(this.occupiedMask & this.bit(track)) || this.rawFrames[track] <= 0) {
      this.waveformDirty = false;
      return;
    }
    const used = this.usedEnvelopeBins(track);
    const envelope = this.envelopes[track];
    let maximum = 0;
    for (let bin = 0; bin < used; bin += 1) maximum = Math.max(maximum, envelope[bin]);
    if (maximum <= 1e-6) {
      this.waveformDirty = false;
      return;
    }
    for (let bucket = 0; bucket < WAVEFORM_BINS; bucket += 1) {
      const start = Math.min(used - 1, Math.floor(bucket * used / WAVEFORM_BINS));
      const end = Math.max(start + 1, Math.min(used, Math.ceil((bucket + 1) * used / WAVEFORM_BINS)));
      let peak = 0;
      for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, envelope[bin]);
      this.waveformCache[bucket] = this.clamp01(peak / maximum);
    }
    this.waveformDirty = false;
  }

  publishRuntime() {
    if (this.waveformDirty) this.refreshWaveformCache();
    const track = this.selectedTrack;
    const raw = this.rawFrames[track];
    const length = this.activeLength(track);
    this.port.postMessage({
      type: 'runtime',
      transport: this.transport(),
      trackMask: this.occupiedMask,
      trackActiveMask: this.activeMask & this.occupiedMask,
      trackMuteMask: this.muteMask & this.occupiedMask,
      trackSoloMask: this.soloMask & this.occupiedMask,
      loopFrames: length,
      rawFrames: raw,
      position: Math.min(this.positions[track], Math.max(0, length - 1)),
      sampleRate,
      trimStart: raw > 0 ? this.trimStartFrames[track] / raw : 0,
      trimEnd: raw > 0 ? this.trimEndFrames[track] / raw : 1,
      waveform: this.waveformCache,
    });
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const leftIn = input[0];
    const rightIn = input[1] || leftIn;
    const leftOut = output[0];
    const rightOut = output[1] || leftOut;
    if (!leftOut || !rightOut) return true;

    this.applyJournalSwaps(leftOut.length);

    for (let frame = 0; frame < leftOut.length; frame += 1) {
      if (this.nextScheduledDue <= this.clockFrame) this.runScheduledCommands();

      const liveL = leftIn ? (Number.isFinite(leftIn[frame]) ? leftIn[frame] : 0) : 0;
      const liveR = rightIn ? (Number.isFinite(rightIn[frame]) ? rightIn[frame] : 0) : liveL;
      let loopL = 0;
      let loopR = 0;

      if (this.enabled && this.playbackMask) {
        for (let track = 0; track < TRACKS; track += 1) {
          if (!(this.playbackMask & this.bit(track))) continue;
          const length = this.lengths[track];
          const buffer = this.buffers[track];
          if (!buffer || length <= 0) continue;
          const relative = Math.min(this.positions[track], length - 1);
          const absolute = this.trimStartFrames[track] + relative;
          const index = absolute * 2;
          let trackL = buffer[index];
          let trackR = buffer[index + 1];
          const seam = this.fadeFrames[track];
          if (seam > 1 && relative >= length - seam) {
            const local = relative - (length - seam);
            const alpha = local / seam;
            const startAbsolute = this.trimStartFrames[track] + Math.min(length - 1, local);
            const startIndex = startAbsolute * 2;
            trackL = trackL * (1 - alpha) + buffer[startIndex] * alpha;
            trackR = trackR * (1 - alpha) + buffer[startIndex + 1] * alpha;
          }
          const level = this.trackLevels[track];
          loopL += trackL * level;
          loopR += trackR * level;
        }
      }

      leftOut[frame] = liveL + loopL * this.masterLevel;
      rightOut[frame] = liveR + loopR * this.masterLevel;

      if (this.enabled) {
        if (this.recording) {
          const selected = this.buffers[this.recordTrack];
          if (selected && this.recordCount < this.maxFrames) {
            const write = this.recordCount * 2;
            selected[write] = liveL;
            selected[write + 1] = liveR;
            this.updateEnvelope(this.recordTrack, this.recordCount, liveL, liveR, false);
            this.recordCount += 1;
          }
          if (this.recordCount >= this.maxFrames) this.finishRecording(this.recordTrack);
        } else if (this.overdubbing && (this.occupiedMask & this.bit(this.overdubTrack))) {
          const track = this.overdubTrack;
          const selected = this.buffers[track];
          const length = this.lengths[track];
          if (selected && length > 0) {
            const relative = Math.min(this.positions[track], length - 1);
            const absolute = this.trimStartFrames[track] + relative;
            const write = absolute * 2;
            this.journalBeforeWrite(track, absolute, write, selected);
            const nextL = selected[write] * this.overdub + liveL;
            const nextR = selected[write + 1] * this.overdub + liveR;
            selected[write] = nextL;
            selected[write + 1] = nextR;
            this.updateEnvelope(track, absolute, nextL, nextR, this.overdub <= 0.001);
          }
        }

        if (this.bouncing) {
          const target = this.buffers[this.bounceTrack];
          if (target && this.bounceCount < this.bounceFrames) {
            const write = this.bounceCount * 2;
            target[write] = loopL;
            target[write + 1] = loopR;
            this.updateEnvelope(this.bounceTrack, this.bounceCount, loopL, loopR, false);
            this.bounceCount += 1;
          }
          if (this.bounceCount >= this.bounceFrames) this.finishBounce();
        }

        if (this.advanceMask) {
          for (let track = 0; track < TRACKS; track += 1) {
            if (!(this.advanceMask & this.bit(track))) continue;
            const length = this.lengths[track];
            if (length <= 0) { this.positions[track] = 0; continue; }
            const next = this.positions[track] + 1;
            this.positions[track] = next >= length ? 0 : next;
          }
        }
      }
      this.clockFrame += 1;
    }

    this.runtimeCountdown += leftOut.length;
    if (this.runtimeCountdown >= this.runtimePeriod) {
      this.runtimeCountdown %= this.runtimePeriod;
      this.publishRuntime();
    }
    return true;
  }
}

registerProcessor('calcotone-loop-processor', CalcotoneLoopProcessor);
