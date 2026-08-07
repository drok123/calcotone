from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_exact(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'{path}: exact anchor not found: {old[:120]!r}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: regex anchor matched {count} times: {pattern}')
    target.write_text(next_text, encoding='utf-8')


write('src/components/signal/loopStore.ts', r'''import { useSyncExternalStore } from 'react';

export const LOOP_TRACK_COUNT = 8;
export const LOOP_MAX_SECONDS = 60;
export const LOOP_WAVEFORM_BINS = 64;
export const LOOP_COMMAND_EVENT = 'calcotone:loop-command';
export const LOOP_CHANGE_EVENT = 'calcotone:loop-change';

export type LoopTransport = 'empty' | 'stopped' | 'playing' | 'recording' | 'overdubbing';
export type LoopTransportCommand = 'record' | 'overdub' | 'play' | 'clear';
export type LoopCommand =
  | LoopTransportCommand
  | { type: 'trim'; start: number; end: number }
  | { type: 'autoTrim' }
  | { type: 'resetTrim' };

export interface LoopSettings {
  enabled: boolean;
  selectedTrack: number;
  masterLevel: number;
  overdub: number;
  fade: number;
  trackLevels: number[];
}

export interface LoopRuntime {
  transport: LoopTransport;
  trackMask: number;
  loopFrames: number;
  rawFrames: number;
  position: number;
  sampleRate: number;
  trimStart: number;
  trimEnd: number;
  waveform: number[];
}

export interface LoopState extends LoopSettings, LoopRuntime {}

const STORAGE_KEY = 'calcotone.loop-state.v1';
const listeners = new Set<() => void>();

const DEFAULT_SETTINGS: LoopSettings = {
  enabled: false,
  selectedTrack: 0,
  masterLevel: 0.78,
  overdub: 1,
  fade: 0.18,
  trackLevels: Array.from({ length: LOOP_TRACK_COUNT }, () => 0.72),
};

const DEFAULT_RUNTIME: LoopRuntime = {
  transport: 'empty',
  trackMask: 0,
  loopFrames: 0,
  rawFrames: 0,
  position: 0,
  sampleRate: 48_000,
  trimStart: 0,
  trimEnd: 1,
  waveform: Array.from({ length: LOOP_WAVEFORM_BINS }, () => 0),
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampTrack(value: number): number {
  return Math.max(0, Math.min(LOOP_TRACK_COUNT - 1, Math.round(Number.isFinite(value) ? value : 0)));
}

function normalizeTrackLevels(values: readonly number[] | undefined): number[] {
  return Array.from({ length: LOOP_TRACK_COUNT }, (_, index) => clamp01(values?.[index] ?? DEFAULT_SETTINGS.trackLevels[index]!));
}

function normalizeWaveform(values: readonly number[] | undefined): number[] {
  return Array.from({ length: LOOP_WAVEFORM_BINS }, (_, index) => clamp01(values?.[index] ?? 0));
}

function loadSettings(): LoopSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<LoopSettings> | null;
    if (!saved) return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };
    return {
      enabled: saved.enabled === true,
      selectedTrack: clampTrack(saved.selectedTrack ?? 0),
      masterLevel: clamp01(saved.masterLevel ?? DEFAULT_SETTINGS.masterLevel),
      overdub: clamp01(saved.overdub ?? DEFAULT_SETTINGS.overdub),
      fade: clamp01(saved.fade ?? DEFAULT_SETTINGS.fade),
      trackLevels: normalizeTrackLevels(saved.trackLevels),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };
  }
}

let state: LoopState = { ...loadSettings(), ...DEFAULT_RUNTIME };

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (typeof window === 'undefined') return;
  const { enabled, selectedTrack, masterLevel, overdub, fade, trackLevels } = state;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, selectedTrack, masterLevel, overdub, fade, trackLevels })); } catch { /* optional */ }
}

export function getLoopState(): LoopState {
  return { ...state, trackLevels: [...state.trackLevels], waveform: [...state.waveform] };
}

export function setLoopState(patch: Partial<LoopSettings>): void {
  state = {
    ...state,
    ...patch,
    enabled: patch.enabled ?? state.enabled,
    selectedTrack: clampTrack(patch.selectedTrack ?? state.selectedTrack),
    masterLevel: clamp01(patch.masterLevel ?? state.masterLevel),
    overdub: clamp01(patch.overdub ?? state.overdub),
    fade: clamp01(patch.fade ?? state.fade),
    trackLevels: patch.trackLevels ? normalizeTrackLevels(patch.trackLevels) : state.trackLevels,
  };
  persist();
  emit();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<LoopSettings>(LOOP_CHANGE_EVENT, { detail: getLoopState() }));
}

export function setSelectedTrackLevel(value: number): void {
  const levels = [...state.trackLevels];
  levels[state.selectedTrack] = clamp01(value);
  setLoopState({ trackLevels: levels });
}

export function setLoopRuntime(patch: Partial<LoopRuntime>): void {
  const trimStart = clamp01(patch.trimStart ?? state.trimStart);
  const trimEnd = Math.max(trimStart, clamp01(patch.trimEnd ?? state.trimEnd));
  state = {
    ...state,
    ...patch,
    trackMask: Math.max(0, Math.min(255, Math.round(patch.trackMask ?? state.trackMask))),
    loopFrames: Math.max(0, Math.round(patch.loopFrames ?? state.loopFrames)),
    rawFrames: Math.max(0, Math.round(patch.rawFrames ?? state.rawFrames)),
    position: Math.max(0, Math.round(patch.position ?? state.position)),
    sampleRate: Math.max(8_000, Math.round(patch.sampleRate ?? state.sampleRate)),
    trimStart,
    trimEnd,
    waveform: patch.waveform ? normalizeWaveform(patch.waveform) : state.waveform,
  };
  emit();
}

export function sendLoopCommand(command: LoopCommand): void {
  let normalized = command;
  if (typeof command !== 'string' && command.type === 'trim') {
    const rawFrames = state.rawFrames;
    const minimum = rawFrames > 0 ? Math.min(0.25, 64 / rawFrames) : 0.001;
    const start = clamp01(command.start);
    const end = clamp01(command.end);
    const boundedStart = Math.min(start, Math.max(0, end - minimum));
    const boundedEnd = Math.max(end, Math.min(1, boundedStart + minimum));
    normalized = { type: 'trim', start: boundedStart, end: boundedEnd };
    const loopFrames = rawFrames > 0 ? Math.max(64, Math.round((boundedEnd - boundedStart) * rawFrames)) : 0;
    setLoopRuntime({ trimStart: boundedStart, trimEnd: boundedEnd, loopFrames, position: Math.min(state.position, Math.max(0, loopFrames - 1)) });
  } else if (typeof command !== 'string' && command.type === 'resetTrim') {
    setLoopRuntime({ trimStart: 0, trimEnd: 1, loopFrames: state.rawFrames, position: Math.min(state.position, Math.max(0, state.rawFrames - 1)) });
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<LoopCommand>(LOOP_COMMAND_EVENT, { detail: normalized }));
}

export function useLoopState(): LoopState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
    () => state,
  );
}

export function occupiedLoopTracks(mask = state.trackMask): number {
  let count = 0;
  for (let index = 0; index < LOOP_TRACK_COUNT; index += 1) if ((mask & (1 << index)) !== 0) count += 1;
  return count;
}
''')


write('src/audio/LoopDeck.ts', r'''import type { LoopCommand, LoopSettings, LoopRuntime } from '../components/signal/loopStore';
import { LOOP_WAVEFORM_BINS } from '../components/signal/loopStore';

export class LoopDeck {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly node: AudioWorkletNode;

  private constructor(context: AudioContext, onRuntime: (runtime: LoopRuntime) => void) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.node = new AudioWorkletNode(context, 'calcotone-loop-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.input.connect(this.node);
    this.node.connect(this.output);
    this.node.port.onmessage = (event: MessageEvent<{ type?: string } & Partial<LoopRuntime>>) => {
      const detail = event.data;
      if (detail?.type !== 'runtime') return;
      onRuntime({
        transport: detail.transport ?? 'empty',
        trackMask: detail.trackMask ?? 0,
        loopFrames: detail.loopFrames ?? 0,
        rawFrames: detail.rawFrames ?? detail.loopFrames ?? 0,
        position: detail.position ?? 0,
        sampleRate: detail.sampleRate ?? context.sampleRate,
        trimStart: detail.trimStart ?? 0,
        trimEnd: detail.trimEnd ?? 1,
        waveform: Array.from({ length: LOOP_WAVEFORM_BINS }, (_, index) => detail.waveform?.[index] ?? 0),
      });
    };
  }

  public static async create(context: AudioContext, onRuntime: (runtime: LoopRuntime) => void): Promise<LoopDeck> {
    await context.audioWorklet.addModule('/loop-processor.js');
    return new LoopDeck(context, onRuntime);
  }

  public setSettings(settings: LoopSettings): void {
    this.node.port.postMessage({ type: 'settings', ...settings });
  }

  public command(command: LoopCommand): void {
    this.node.port.postMessage({ type: 'command', command });
  }

  public dispose(): void {
    this.node.port.onmessage = null;
    try { this.input.disconnect(); } catch { /* already disconnected */ }
    try { this.node.disconnect(); } catch { /* already disconnected */ }
    try { this.output.disconnect(); } catch { /* already disconnected */ }
  }
}
''')


write('public/loop-processor.js', r'''const TRACKS = 8;
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
''')


write('native/include/calcotone/loop_processor.hpp', r'''#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>

namespace calcotone {

inline constexpr unsigned kLoopTrackCount = 8U;
inline constexpr float kLoopMaxSeconds = 60.F;
inline constexpr unsigned kLoopWaveformBins = 64U;
inline constexpr unsigned kLoopEnvelopeBins = 16'384U;

enum class LoopCommand : unsigned { Record = 0U, Overdub = 1U, Play = 2U, Clear = 3U };
enum class LoopTransport : unsigned { Empty = 0U, Stopped = 1U, Playing = 2U, Recording = 3U, Overdubbing = 4U };

class LoopProcessor final {
 public:
  explicit LoopProcessor(float sample_rate = 48'000.F);
  ~LoopProcessor();
  LoopProcessor(const LoopProcessor&) = delete;
  LoopProcessor& operator=(const LoopProcessor&) = delete;

  void process(float* live_stereo, std::size_t frames) noexcept;
  void set_enabled(bool enabled) noexcept;
  void set_selected_track(unsigned track) noexcept;
  void set_master_level(float value) noexcept;
  void set_track_level(unsigned track, float value) noexcept;
  void set_overdub(float value) noexcept;
  void set_fade(float value) noexcept;
  void command(LoopCommand command) noexcept;
  void set_trim(float start, float end) noexcept;
  void auto_trim() noexcept;
  void reset_trim() noexcept;

  LoopTransport transport() const noexcept;
  unsigned selected_track() const noexcept;
  std::uint32_t track_mask() const noexcept;
  std::uint64_t loop_frames() const noexcept;
  std::uint64_t raw_frames() const noexcept;
  std::uint64_t position() const noexcept;
  float trim_start() const noexcept;
  float trim_end() const noexcept;
  std::array<float, kLoopWaveformBins> waveform() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
''')


write('native/src/loop_processor.cpp', r'''#include "calcotone/loop_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr unsigned kNoCommand = 0xffU;
constexpr unsigned kTrimCommand = 4U;
constexpr unsigned kAutoTrimCommand = 5U;
constexpr unsigned kResetTrimCommand = 6U;
constexpr std::size_t kMinimumLoopFrames = 64U;
float clamp01(float value) noexcept { return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F); }
}

struct LoopProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        max_frames(static_cast<std::size_t>(std::ceil(rate * kLoopMaxSeconds))),
        envelope_scale(static_cast<float>(kLoopEnvelopeBins) / static_cast<float>(max_frames)) {
    for (auto& buffer : tracks) buffer.assign(max_frames * 2U, 0.F);
    for (auto& level : track_levels) level.store(.72F, std::memory_order_relaxed);
  }

  bool any_occupied() const noexcept {
    for (const bool filled : occupied) if (filled) return true;
    return false;
  }

  std::size_t active_length(unsigned track) const noexcept {
    if (!occupied[track]) return 0U;
    return trim_end_frames[track] > trim_start_frames[track]
        ? trim_end_frames[track] - trim_start_frames[track] : 0U;
  }

  void clear_envelope(unsigned track) noexcept {
    envelopes[track].fill(0.F);
  }

  void update_envelope(unsigned track, std::size_t frame, float left, float right) noexcept {
    const auto bin = std::min<std::size_t>(kLoopEnvelopeBins - 1U,
        static_cast<std::size_t>(static_cast<float>(frame) * envelope_scale));
    const float peak = std::max(std::abs(left), std::abs(right));
    envelopes[track][bin] = std::max(envelopes[track][bin], peak);
  }

  void start_recording(unsigned track) noexcept {
    occupied[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    positions[track] = 0U;
    clear_envelope(track);
    recording = true;
    overdubbing = false;
    record_count = 0U;
    playing = true;
  }

  void finish_recording(unsigned track) noexcept {
    if (record_count >= kMinimumLoopFrames) {
      const auto frames = std::min(max_frames, record_count);
      raw_frames[track] = frames;
      trim_start_frames[track] = 0U;
      trim_end_frames[track] = frames;
      positions[track] = 0U;
      occupied[track] = true;
      playing = true;
    }
    recording = false;
    record_count = 0U;
    if (!any_occupied()) playing = false;
  }

  void clear_track(unsigned track) noexcept {
    occupied[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    positions[track] = 0U;
    if (recording) {
      recording = false;
      record_count = 0U;
    }
    overdubbing = false;
    if (!any_occupied()) playing = false;
  }

  void set_trim_window(unsigned track, float requested_start, float requested_end) noexcept {
    const auto raw = raw_frames[track];
    if (!occupied[track] || raw < kMinimumLoopFrames) return;
    const auto minimum = std::min(raw, kMinimumLoopFrames);
    auto start = static_cast<std::size_t>(std::llround(clamp01(requested_start) * static_cast<float>(raw)));
    auto end = static_cast<std::size_t>(std::llround(clamp01(requested_end) * static_cast<float>(raw)));
    start = std::min(start, raw - minimum);
    end = std::clamp(end, start + minimum, raw);
    trim_start_frames[track] = start;
    trim_end_frames[track] = end;
    positions[track] = std::min(positions[track], std::max<std::size_t>(1U, end - start) - 1U);
  }

  void reset_trim_window(unsigned track) noexcept {
    if (!occupied[track]) return;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = raw_frames[track];
    positions[track] = 0U;
  }

  std::size_t used_envelope_bins(unsigned track) const noexcept {
    const double used = std::ceil(static_cast<double>(raw_frames[track])
        * static_cast<double>(kLoopEnvelopeBins) / static_cast<double>(max_frames));
    return std::clamp<std::size_t>(static_cast<std::size_t>(std::max(1.0, used)), 1U, kLoopEnvelopeBins);
  }

  void auto_trim_window(unsigned track) noexcept {
    if (!occupied[track] || raw_frames[track] < kMinimumLoopFrames) return;
    const auto used = used_envelope_bins(track);
    float peak = 0.F;
    for (std::size_t bin = 0; bin < used; ++bin) peak = std::max(peak, envelopes[track][bin]);
    if (peak <= 1e-6F) return;
    const float threshold = std::max(.004F, peak * .035F);
    std::size_t first = used;
    std::size_t last = 0U;
    for (std::size_t bin = 0; bin < used; ++bin) {
      if (envelopes[track][bin] < threshold) continue;
      first = std::min(first, bin);
      last = bin;
    }
    if (first >= used || last < first) return;
    const double bin_frames = static_cast<double>(max_frames) / static_cast<double>(kLoopEnvelopeBins);
    const auto padding = static_cast<std::size_t>(std::max(1.0, std::round(static_cast<double>(rate) * .004)));
    auto start = static_cast<std::size_t>(std::floor(static_cast<double>(first) * bin_frames));
    start = start > padding ? start - padding : 0U;
    auto end = static_cast<std::size_t>(std::ceil(static_cast<double>(last + 1U) * bin_frames)) + padding;
    end = std::min(raw_frames[track], end);
    if (end - start < kMinimumLoopFrames) end = std::min(raw_frames[track], start + kMinimumLoopFrames);
    if (end - start < kMinimumLoopFrames) start = end > kMinimumLoopFrames ? end - kMinimumLoopFrames : 0U;
    trim_start_frames[track] = start;
    trim_end_frames[track] = end;
    positions[track] = 0U;
  }

  void consume_command() noexcept {
    const unsigned raw = pending_command.exchange(kNoCommand, std::memory_order_acq_rel);
    if (raw == kNoCommand) return;
    const unsigned track = selected.load(std::memory_order_relaxed);
    if (raw == kTrimCommand) {
      set_trim_window(track, pending_trim_start.load(std::memory_order_relaxed), pending_trim_end.load(std::memory_order_relaxed));
      return;
    }
    if (raw == kAutoTrimCommand) {
      auto_trim_window(track);
      return;
    }
    if (raw == kResetTrimCommand) {
      reset_trim_window(track);
      return;
    }

    const auto command = static_cast<LoopCommand>(raw);
    if (command == LoopCommand::Record) {
      if (recording) finish_recording(track);
      else start_recording(track);
      return;
    }
    if (command == LoopCommand::Overdub) {
      if (occupied[track] && active_length(track) > 0U) {
        overdubbing = !overdubbing;
        recording = false;
        playing = true;
      }
      return;
    }
    if (command == LoopCommand::Play) {
      if (any_occupied()) {
        playing = !playing;
        overdubbing = false;
        recording = false;
        record_count = 0U;
      }
      return;
    }
    if (command == LoopCommand::Clear) clear_track(track);
  }

  float read_track(unsigned track, unsigned channel) const noexcept {
    const auto length = active_length(track);
    if (length == 0U) return 0.F;
    const auto relative = std::min(positions[track], length - 1U);
    const auto absolute = trim_start_frames[track] + relative;
    const auto& buffer = tracks[track];
    const auto index = absolute * 2U + channel;
    const auto fade_samples = std::min<std::size_t>(
        length / 4U,
        static_cast<std::size_t>(std::round(fade.load(std::memory_order_relaxed) * .02F * rate)));
    if (fade_samples <= 1U || relative < length - fade_samples) return buffer[index];
    const auto local = relative - (length - fade_samples);
    const float alpha = static_cast<float>(local) / static_cast<float>(fade_samples);
    const auto start_relative = std::min(length - 1U, local);
    const auto start_absolute = trim_start_frames[track] + start_relative;
    const float start = buffer[start_absolute * 2U + channel];
    return buffer[index] * (1.F - alpha) + start * alpha;
  }

  void advance_track(unsigned track) noexcept {
    const auto length = active_length(track);
    if (length == 0U) {
      positions[track] = 0U;
      return;
    }
    const auto next = positions[track] + 1U;
    positions[track] = next >= length ? 0U : next;
  }

  LoopTransport current_transport() const noexcept {
    if (recording) return LoopTransport::Recording;
    if (overdubbing) return LoopTransport::Overdubbing;
    if (!any_occupied()) return LoopTransport::Empty;
    return playing ? LoopTransport::Playing : LoopTransport::Stopped;
  }

  void publish_runtime() noexcept {
    const unsigned track = selected.load(std::memory_order_relaxed);
    const auto raw = raw_frames[track];
    const auto length = active_length(track);
    published_frames.store(length, std::memory_order_relaxed);
    published_raw_frames.store(raw, std::memory_order_relaxed);
    published_position.store(std::min(positions[track], length > 0U ? length - 1U : 0U), std::memory_order_relaxed);
    published_trim_start.store(raw > 0U ? static_cast<float>(trim_start_frames[track]) / static_cast<float>(raw) : 0.F, std::memory_order_relaxed);
    published_trim_end.store(raw > 0U ? static_cast<float>(trim_end_frames[track]) / static_cast<float>(raw) : 1.F, std::memory_order_relaxed);
    std::uint32_t mask = 0U;
    for (unsigned index = 0U; index < kLoopTrackCount; ++index) if (occupied[index]) mask |= (1U << index);
    published_mask.store(mask, std::memory_order_relaxed);
    published_transport.store(static_cast<unsigned>(current_transport()), std::memory_order_relaxed);

    for (auto& bucket : published_waveform) bucket.store(0.F, std::memory_order_relaxed);
    if (!occupied[track] || raw == 0U) return;
    const auto used = used_envelope_bins(track);
    float maximum = 0.F;
    for (std::size_t bin = 0; bin < used; ++bin) maximum = std::max(maximum, envelopes[track][bin]);
    if (maximum <= 1e-6F) return;
    for (unsigned bucket = 0U; bucket < kLoopWaveformBins; ++bucket) {
      const auto start = std::min<std::size_t>(used - 1U, static_cast<std::size_t>(bucket) * used / kLoopWaveformBins);
      const auto end = std::max(start + 1U, std::min<std::size_t>(used,
          static_cast<std::size_t>(bucket + 1U) * used / kLoopWaveformBins + 1U));
      float peak = 0.F;
      for (auto bin = start; bin < end; ++bin) peak = std::max(peak, envelopes[track][bin]);
      published_waveform[bucket].store(clamp01(peak / maximum), std::memory_order_relaxed);
    }
  }

  void process(float* data, std::size_t frames) noexcept {
    consume_command();
    if (!enabled.load(std::memory_order_relaxed)) {
      publish_runtime();
      return;
    }

    const unsigned selected_track = selected.load(std::memory_order_relaxed);
    auto& selected_buffer = tracks[selected_track];
    const float loop_level = master_level.load(std::memory_order_relaxed);
    const float overdub_feedback = overdub.load(std::memory_order_relaxed);

    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float live_left = std::isfinite(data[frame * 2U]) ? data[frame * 2U] : 0.F;
      const float live_right = std::isfinite(data[frame * 2U + 1U]) ? data[frame * 2U + 1U] : 0.F;
      float loop_left = 0.F;
      float loop_right = 0.F;

      if (playing) {
        for (unsigned track = 0U; track < kLoopTrackCount; ++track) {
          if (!occupied[track] || active_length(track) == 0U) continue;
          const float level = track_levels[track].load(std::memory_order_relaxed);
          loop_left += read_track(track, 0U) * level;
          loop_right += read_track(track, 1U) * level;
        }
      }

      data[frame * 2U] = live_left + loop_left * loop_level;
      data[frame * 2U + 1U] = live_right + loop_right * loop_level;

      if (recording) {
        if (record_count < max_frames) {
          const auto write = record_count * 2U;
          selected_buffer[write] = live_left;
          selected_buffer[write + 1U] = live_right;
          update_envelope(selected_track, record_count, live_left, live_right);
          ++record_count;
        }
        if (record_count >= max_frames) finish_recording(selected_track);
      } else if (overdubbing && occupied[selected_track]) {
        const auto length = active_length(selected_track);
        if (length > 0U) {
          const auto relative = std::min(positions[selected_track], length - 1U);
          const auto absolute = trim_start_frames[selected_track] + relative;
          const auto write = absolute * 2U;
          const float next_left = selected_buffer[write] * overdub_feedback + live_left;
          const float next_right = selected_buffer[write + 1U] * overdub_feedback + live_right;
          selected_buffer[write] = next_left;
          selected_buffer[write + 1U] = next_right;
          update_envelope(selected_track, absolute, next_left, next_right);
        }
      }

      if (playing) {
        for (unsigned track = 0U; track < kLoopTrackCount; ++track) if (occupied[track]) advance_track(track);
      }
    }
    publish_runtime();
  }

  float rate;
  std::size_t max_frames;
  float envelope_scale;
  std::array<std::vector<float>, kLoopTrackCount> tracks;
  std::array<std::array<float, kLoopEnvelopeBins>, kLoopTrackCount> envelopes{};
  std::array<std::atomic<float>, kLoopTrackCount> track_levels{};
  std::array<bool, kLoopTrackCount> occupied{};
  std::array<std::size_t, kLoopTrackCount> raw_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_start_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_end_frames{};
  std::array<std::size_t, kLoopTrackCount> positions{};
  std::atomic<bool> enabled{false};
  std::atomic<unsigned> selected{0U};
  std::atomic<float> master_level{.78F};
  std::atomic<float> overdub{1.F};
  std::atomic<float> fade{.18F};
  std::atomic<unsigned> pending_command{kNoCommand};
  std::atomic<float> pending_trim_start{0.F};
  std::atomic<float> pending_trim_end{1.F};
  bool playing{false};
  bool recording{false};
  bool overdubbing{false};
  std::size_t record_count{};
  std::atomic<unsigned> published_transport{static_cast<unsigned>(LoopTransport::Empty)};
  std::atomic<std::uint32_t> published_mask{};
  std::atomic<std::uint64_t> published_frames{};
  std::atomic<std::uint64_t> published_raw_frames{};
  std::atomic<std::uint64_t> published_position{};
  std::atomic<float> published_trim_start{0.F};
  std::atomic<float> published_trim_end{1.F};
  std::array<std::atomic<float>, kLoopWaveformBins> published_waveform{};
};

LoopProcessor::LoopProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
LoopProcessor::~LoopProcessor() = default;
void LoopProcessor::process(float* data, std::size_t frames) noexcept { if (data && frames) impl_->process(data, frames); }
void LoopProcessor::set_enabled(bool value) noexcept { impl_->enabled.store(value, std::memory_order_relaxed); }
void LoopProcessor::set_selected_track(unsigned track) noexcept { impl_->selected.store(std::min(track, kLoopTrackCount - 1U), std::memory_order_relaxed); }
void LoopProcessor::set_master_level(float value) noexcept { impl_->master_level.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_track_level(unsigned track, float value) noexcept { if (track < kLoopTrackCount) impl_->track_levels[track].store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_overdub(float value) noexcept { impl_->overdub.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_fade(float value) noexcept { impl_->fade.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::command(LoopCommand value) noexcept { impl_->pending_command.store(static_cast<unsigned>(value), std::memory_order_release); }
void LoopProcessor::set_trim(float start, float end) noexcept {
  impl_->pending_trim_start.store(clamp01(start), std::memory_order_relaxed);
  impl_->pending_trim_end.store(clamp01(end), std::memory_order_relaxed);
  impl_->pending_command.store(kTrimCommand, std::memory_order_release);
}
void LoopProcessor::auto_trim() noexcept { impl_->pending_command.store(kAutoTrimCommand, std::memory_order_release); }
void LoopProcessor::reset_trim() noexcept { impl_->pending_command.store(kResetTrimCommand, std::memory_order_release); }
LoopTransport LoopProcessor::transport() const noexcept { return static_cast<LoopTransport>(impl_->published_transport.load(std::memory_order_relaxed)); }
unsigned LoopProcessor::selected_track() const noexcept { return impl_->selected.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_mask() const noexcept { return impl_->published_mask.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::loop_frames() const noexcept { return impl_->published_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::raw_frames() const noexcept { return impl_->published_raw_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::position() const noexcept { return impl_->published_position.load(std::memory_order_relaxed); }
float LoopProcessor::trim_start() const noexcept { return impl_->published_trim_start.load(std::memory_order_relaxed); }
float LoopProcessor::trim_end() const noexcept { return impl_->published_trim_end.load(std::memory_order_relaxed); }
std::array<float, kLoopWaveformBins> LoopProcessor::waveform() const noexcept {
  std::array<float, kLoopWaveformBins> result{};
  for (unsigned index = 0U; index < kLoopWaveformBins; ++index)
    result[index] = impl_->published_waveform[index].load(std::memory_order_relaxed);
  return result;
}

}  // namespace calcotone
''')


write('native/tests/loop_processor_test.cpp', r'''#include "calcotone/loop_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <vector>

namespace {
void fill(std::vector<float>& block, float left, float right) {
  for (std::size_t frame = 0; frame < block.size() / 2U; ++frame) {
    block[frame * 2U] = left;
    block[frame * 2U + 1U] = right;
  }
}

void consume(calcotone::LoopProcessor& loop) {
  std::array<float, 2> sample{};
  loop.process(sample.data(), 1U);
}
}

int main() {
  calcotone::LoopProcessor loop(48'000.F);
  loop.set_enabled(true);
  loop.set_master_level(.8F);
  loop.set_overdub(1.F);
  loop.set_fade(.1F);

  // Track 1 establishes a short phrase.
  loop.set_selected_track(0);
  std::vector<float> short_phrase(256U * 2U);
  fill(short_phrase, .2F, -.2F);
  loop.command(calcotone::LoopCommand::Record);
  loop.process(short_phrase.data(), 256U);
  assert(loop.transport() == calcotone::LoopTransport::Recording);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  assert(loop.loop_frames() == 256U);
  assert(loop.raw_frames() == 256U);
  assert((loop.track_mask() & 1U) != 0U);

  // Track 2 must be allowed to run longer than Track 1. This is the regression
  // that the original shared master_frames design could not support.
  loop.set_selected_track(1);
  consume(loop);
  std::vector<float> long_phrase(768U * 2U);
  fill(long_phrase, .12F, .08F);
  loop.command(calcotone::LoopCommand::Record);
  loop.process(long_phrase.data(), 768U);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  assert(loop.loop_frames() == 768U);
  assert(loop.raw_frames() == 768U);
  assert((loop.track_mask() & 2U) != 0U);

  loop.set_selected_track(0);
  consume(loop);
  assert(loop.loop_frames() == 256U);
  loop.set_selected_track(1);
  consume(loop);
  assert(loop.loop_frames() == 768U);

  // Manual trim is non-destructive: active loop length changes but the raw take remains.
  loop.set_trim(.25F, .75F);
  consume(loop);
  assert(loop.raw_frames() == 768U);
  assert(loop.loop_frames() >= 380U && loop.loop_frames() <= 386U);
  assert(loop.trim_start() > .24F && loop.trim_start() < .26F);
  assert(loop.trim_end() > .74F && loop.trim_end() < .76F);
  loop.reset_trim();
  consume(loop);
  assert(loop.loop_frames() == 768U);
  assert(loop.raw_frames() == 768U);

  // Auto trim uses the stored transient envelope instead of scanning a full
  // 60-second audio buffer on the realtime thread.
  loop.set_selected_track(2);
  consume(loop);
  std::vector<float> transient_phrase(8192U * 2U, 0.F);
  for (std::size_t frame = 2048U; frame < 6144U; ++frame) {
    transient_phrase[frame * 2U] = .3F;
    transient_phrase[frame * 2U + 1U] = -.22F;
  }
  loop.command(calcotone::LoopCommand::Record);
  loop.process(transient_phrase.data(), 8192U);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  const auto raw_before_auto = loop.raw_frames();
  loop.auto_trim();
  consume(loop);
  assert(loop.raw_frames() == raw_before_auto);
  assert(loop.loop_frames() < raw_before_auto);
  assert(loop.trim_start() > 0.F);
  assert(loop.trim_end() < 1.F);
  const auto waveform = loop.waveform();
  assert(*std::max_element(waveform.begin(), waveform.end()) > .9F);

  // Playback still returns stored audio, and clear is selected-track only.
  std::vector<float> silence(256U * 2U, 0.F);
  loop.process(silence.data(), 256U);
  float peak = 0.F;
  for (const auto sample : silence) peak = std::max(peak, std::abs(sample));
  assert(peak > .01F);
  loop.command(calcotone::LoopCommand::Clear);
  consume(loop);
  assert((loop.track_mask() & 4U) == 0U);
  assert((loop.track_mask() & 3U) == 3U);
  return 0;
}
''')


replace_exact('native/include/calcotone/native_processor.hpp',
'''  void set_loop_fade(float value) noexcept;\n  void loop_command(LoopCommand command) noexcept;\n  LoopTransport loop_transport() const noexcept;\n  unsigned loop_selected_track() const noexcept;\n  std::uint32_t loop_track_mask() const noexcept;\n  std::uint64_t loop_frames() const noexcept;\n  std::uint64_t loop_position() const noexcept;\n''',
'''  void set_loop_fade(float value) noexcept;\n  void loop_command(LoopCommand command) noexcept;\n  void set_loop_trim(float start, float end) noexcept;\n  void auto_trim_loop() noexcept;\n  void reset_loop_trim() noexcept;\n  LoopTransport loop_transport() const noexcept;\n  unsigned loop_selected_track() const noexcept;\n  std::uint32_t loop_track_mask() const noexcept;\n  std::uint64_t loop_frames() const noexcept;\n  std::uint64_t loop_raw_frames() const noexcept;\n  std::uint64_t loop_position() const noexcept;\n  float loop_trim_start() const noexcept;\n  float loop_trim_end() const noexcept;\n  std::array<float, kLoopWaveformBins> loop_waveform() const noexcept;\n''')
replace_exact('native/include/calcotone/native_processor.hpp', '#include <cstddef>\n', '#include <array>\n#include <cstddef>\n')

replace_exact('native/src/native_processor.cpp',
'''void NativeProcessor::set_loop_fade(float value) noexcept { impl_->loop.set_fade(value); }\nvoid NativeProcessor::loop_command(LoopCommand command) noexcept { impl_->loop.command(command); }\nLoopTransport NativeProcessor::loop_transport() const noexcept { return impl_->loop.transport(); }\nunsigned NativeProcessor::loop_selected_track() const noexcept { return impl_->loop.selected_track(); }\nstd::uint32_t NativeProcessor::loop_track_mask() const noexcept { return impl_->loop.track_mask(); }\nstd::uint64_t NativeProcessor::loop_frames() const noexcept { return impl_->loop.loop_frames(); }\nstd::uint64_t NativeProcessor::loop_position() const noexcept { return impl_->loop.position(); }\n''',
'''void NativeProcessor::set_loop_fade(float value) noexcept { impl_->loop.set_fade(value); }\nvoid NativeProcessor::loop_command(LoopCommand command) noexcept { impl_->loop.command(command); }\nvoid NativeProcessor::set_loop_trim(float start, float end) noexcept { impl_->loop.set_trim(start, end); }\nvoid NativeProcessor::auto_trim_loop() noexcept { impl_->loop.auto_trim(); }\nvoid NativeProcessor::reset_loop_trim() noexcept { impl_->loop.reset_trim(); }\nLoopTransport NativeProcessor::loop_transport() const noexcept { return impl_->loop.transport(); }\nunsigned NativeProcessor::loop_selected_track() const noexcept { return impl_->loop.selected_track(); }\nstd::uint32_t NativeProcessor::loop_track_mask() const noexcept { return impl_->loop.track_mask(); }\nstd::uint64_t NativeProcessor::loop_frames() const noexcept { return impl_->loop.loop_frames(); }\nstd::uint64_t NativeProcessor::loop_raw_frames() const noexcept { return impl_->loop.raw_frames(); }\nstd::uint64_t NativeProcessor::loop_position() const noexcept { return impl_->loop.position(); }\nfloat NativeProcessor::loop_trim_start() const noexcept { return impl_->loop.trim_start(); }\nfloat NativeProcessor::loop_trim_end() const noexcept { return impl_->loop.trim_end(); }\nstd::array<float, kLoopWaveformBins> NativeProcessor::loop_waveform() const noexcept { return impl_->loop.waveform(); }\n''')

replace_exact('src/audio/NativeAudioBridge.ts',
'''  loopFrames?: number;\n  loopPosition?: number;\n''',
'''  loopFrames?: number;\n  loopRawFrames?: number;\n  loopPosition?: number;\n  loopTrimStart?: number;\n  loopTrimEnd?: number;\n  loopWaveform?: number[];\n''')

replace_exact('src/App.tsx',
'''          loopFrames: health.loopFrames ?? 0,\n          position: health.loopPosition ?? 0,\n          sampleRate: health.sampleRate,\n''',
'''          loopFrames: health.loopFrames ?? 0,\n          rawFrames: health.loopRawFrames ?? health.loopFrames ?? 0,\n          position: health.loopPosition ?? 0,\n          sampleRate: health.sampleRate,\n          trimStart: health.loopTrimStart ?? 0,\n          trimEnd: health.loopTrimEnd ?? 1,\n          waveform: health.loopWaveform ?? [],\n''')
replace_exact('src/App.tsx',
'''    const syncNativeLoopCommand = (event: Event): void => {\n      if (backendRef.current !== 'native') return;\n      const command = (event as CustomEvent<LoopCommand>).detail;\n      if (command) void nativeBridgeRef.current.commandLine(`loop ${command}`);\n    };\n''',
'''    const syncNativeLoopCommand = (event: Event): void => {\n      if (backendRef.current !== 'native') return;\n      const command = (event as CustomEvent<LoopCommand>).detail;\n      if (!command) return;\n      if (typeof command === 'string') {\n        void nativeBridgeRef.current.commandLine(`loop ${command}`);\n      } else if (command.type === 'trim') {\n        void nativeBridgeRef.current.commandLine(`loop trim ${command.start} ${command.end}`);\n      } else if (command.type === 'autoTrim') {\n        void nativeBridgeRef.current.commandLine('loop autoTrim');\n      } else if (command.type === 'resetTrim') {\n        void nativeBridgeRef.current.commandLine('loop resetTrim');\n      }\n    };\n''')

replace_exact('native/src/wasapi_host.cpp',
'''      if (line == "health" || line == "stats") {\n        std::ostringstream status;\n''',
'''      if (line == "health" || line == "stats") {\n        const auto loop_waveform = processor.loop_waveform();\n        std::ostringstream status;\n''')
replace_exact('native/src/wasapi_host.cpp',
'''               << ",\\\"loopTrackMask\\\":" << processor.loop_track_mask()\n               << ",\\\"loopFrames\\\":" << processor.loop_frames()\n               << ",\\\"loopPosition\\\":" << processor.loop_position()\n               << ",\\\"tunerHz\\\":" << processor.tuner_frequency()\n               << ",\\\"tunerLevel\\\":" << processor.tuner_level() << '}';\n        return status.str();\n''',
'''               << ",\\\"loopTrackMask\\\":" << processor.loop_track_mask()\n               << ",\\\"loopFrames\\\":" << processor.loop_frames()\n               << ",\\\"loopRawFrames\\\":" << processor.loop_raw_frames()\n               << ",\\\"loopPosition\\\":" << processor.loop_position()\n               << ",\\\"loopTrimStart\\\":" << processor.loop_trim_start()\n               << ",\\\"loopTrimEnd\\\":" << processor.loop_trim_end()\n               << ",\\\"loopWaveform\\\":[";\n        for (unsigned index = 0U; index < loop_waveform.size(); ++index) {\n          if (index) status << ',';\n          status << loop_waveform[index];\n        }\n        status << ']'\n               << ",\\\"tunerHz\\\":" << processor.tuner_frequency()\n               << ",\\\"tunerLevel\\\":" << processor.tuner_level() << '}';\n        return status.str();\n''')
replace_exact('native/src/wasapi_host.cpp',
'''      if (name == "loop") {\n        std::string action; command >> action;\n        if (!command) return R"({\\\"error\\\":\\\"expected loop record|overdub|play|clear\\\"})";\n        if (action == "record") processor.loop_command(calcotone::LoopCommand::Record);\n        else if (action == "overdub") processor.loop_command(calcotone::LoopCommand::Overdub);\n        else if (action == "play") processor.loop_command(calcotone::LoopCommand::Play);\n        else if (action == "clear") processor.loop_command(calcotone::LoopCommand::Clear);\n        else return R"({\\\"error\\\":\\\"unknown loop command\\\"})";\n        return R"({\\\"ok\\\":true,\\\"command\\\":\\\"loop\\\"})";\n      }\n''',
'''      if (name == "loop") {\n        std::string action; command >> action;\n        if (!command) return R"({\\\"error\\\":\\\"expected loop record|overdub|play|clear|trim|autoTrim|resetTrim\\\"})";\n        if (action == "record") processor.loop_command(calcotone::LoopCommand::Record);\n        else if (action == "overdub") processor.loop_command(calcotone::LoopCommand::Overdub);\n        else if (action == "play") processor.loop_command(calcotone::LoopCommand::Play);\n        else if (action == "clear") processor.loop_command(calcotone::LoopCommand::Clear);\n        else if (action == "trim") {\n          float start = 0.F, end = 1.F; command >> start >> end;\n          if (!command || !std::isfinite(start) || !std::isfinite(end)) return R"({\\\"error\\\":\\\"expected loop trim start end\\\"})";\n          processor.set_loop_trim(start, end);\n        } else if (action == "autoTrim") processor.auto_trim_loop();\n        else if (action == "resetTrim") processor.reset_loop_trim();\n        else return R"({\\\"error\\\":\\\"unknown loop command\\\"})";\n        return R"({\\\"ok\\\":true,\\\"command\\\":\\\"loop\\\"})";\n      }\n''')

loop_module = r'''function LoopModule({
  running,
  visualState,
  ...props
}: RailInteractionProps & {
  running: boolean;
  visualState: VisualAudioState;
}) {
  const state = useLoopState();
  const [trimEditing, setTrimEditing] = useState(false);
  const trackLevel = state.trackLevels[state.selectedTrack] ?? 0.72;
  const occupied = occupiedLoopTracks(state.trackMask);
  const seconds = state.loopFrames > 0 ? state.loopFrames / Math.max(1, state.sampleRate) : 0;
  const rawSeconds = state.rawFrames > 0 ? state.rawFrames / Math.max(1, state.sampleRate) : 0;
  const selectedFilled = (state.trackMask & (1 << state.selectedTrack)) !== 0;
  const minimumTrim = state.rawFrames > 0 ? Math.min(0.25, 64 / state.rawFrames) : 0.001;
  const knobLabels = trimEditing ? ['IN', 'OUT', 'Track', 'Fade'] as const : ['Track', 'Loop', 'Overdub', 'Fade'] as const;
  const knobValues = trimEditing
    ? [state.trimStart, state.trimEnd, trackLevel, state.fade] as const
    : [trackLevel, state.masterLevel, state.overdub, state.fade] as const;

  useEffect(() => {
    if (!selectedFilled && trimEditing) setTrimEditing(false);
  }, [selectedFilled, trimEditing]);

  function setKnob(index: number, value: number): void {
    if (trimEditing) {
      if (index === 0) sendLoopCommand({ type: 'trim', start: Math.min(value, state.trimEnd - minimumTrim), end: state.trimEnd });
      else if (index === 1) sendLoopCommand({ type: 'trim', start: state.trimStart, end: Math.max(value, state.trimStart + minimumTrim) });
      else if (index === 2) setSelectedTrackLevel(value);
      else setLoopState({ fade: value });
      return;
    }
    if (index === 0) setSelectedTrackLevel(value);
    else if (index === 1) setLoopState({ masterLevel: value });
    else if (index === 2) setLoopState({ overdub: value });
    else setLoopState({ fade: value });
  }

  function resetKnob(index: number): void {
    if (trimEditing) {
      if (index === 0) sendLoopCommand({ type: 'trim', start: 0, end: state.trimEnd });
      else if (index === 1) sendLoopCommand({ type: 'trim', start: state.trimStart, end: 1 });
      else if (index === 2) setSelectedTrackLevel(0.72);
      else setLoopState({ fade: 0.18 });
      return;
    }
    if (index === 0) setSelectedTrackLevel(0.72);
    else if (index === 1) setLoopState({ masterLevel: 0.78 });
    else if (index === 2) setLoopState({ overdub: 1 });
    else setLoopState({ fade: 0.18 });
  }

  const buttons = trimEditing ? [
    { key: 'auto', label: 'AUTO', active: false, action: () => sendLoopCommand({ type: 'autoTrim' } as const) },
    { key: 'reset', label: 'RESET', active: false, action: () => sendLoopCommand({ type: 'resetTrim' } as const) },
    { key: 'play', label: 'PLAY', active: state.transport === 'playing', action: () => sendLoopCommand('play') },
    { key: 'done', label: 'DONE', active: true, action: () => setTrimEditing(false) },
  ] : [
    { key: 'record', label: 'REC', active: state.transport === 'recording', action: () => sendLoopCommand('record') },
    { key: 'overdub', label: 'DUB', active: state.transport === 'overdubbing', action: () => sendLoopCommand('overdub') },
    { key: 'play', label: 'PLAY', active: state.transport === 'playing', action: () => sendLoopCommand('play') },
    { key: 'clear', label: 'CLEAR', active: false, action: () => sendLoopCommand('clear') },
  ];

  return (
    <RailModuleFrame
      {...props}
      id="pressure"
      name="Loop"
      enabled={state.enabled}
      onToggle={() => setLoopState({ enabled: !state.enabled })}
      headerControl={(
        <div className="loop-header-controls">
          <label className="algorithm-selector pressure-machine-selector">
            <span className="sr-only">Loop track</span>
            <select
              aria-label="Loop track"
              value={state.selectedTrack}
              onChange={(event) => {
                setTrimEditing(false);
                setLoopState({ selectedTrack: Number(event.target.value) });
              }}
            >
              {Array.from({ length: LOOP_TRACK_COUNT }, (_, index) => (
                <option value={index} key={index}>{`T${index + 1}${(state.trackMask & (1 << index)) !== 0 ? ' ●' : ''}`}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`loop-trim-toggle ${trimEditing ? 'active' : ''}`}
            disabled={!selectedFilled}
            aria-pressed={trimEditing}
            onClick={() => setTrimEditing((current) => !current)}
            title={selectedFilled ? 'Edit non-destructive loop boundaries' : 'Record this track before trimming'}
          >
            TRIM
          </button>
        </div>
      )}
    >
      <RailCFaceplateSurface
        moduleId="pressure"
        knobRowClass="pressure-rail-knobs"
        viewport={(
          <div className={`pressure-ascii dsp-viewport ${state.enabled ? 'active' : 'is-off'}`} aria-label="Loop memory transport display">
            <RailCHardwareDisplay
              kind="loop"
              enabled={state.enabled}
              visualState={visualState}
              modeLabel={trimEditing ? 'TRIM EDIT' : state.transport}
              detailLabel={trimEditing
                ? `T${state.selectedTrack + 1} · ${seconds.toFixed(2)}s / ${rawSeconds.toFixed(2)}s RAW`
                : `T${state.selectedTrack + 1} · ${selectedFilled ? 'MEM' : 'EMPTY'} · ${occupied}/8 · ${seconds.toFixed(1)}s · ${running ? 'LIVE' : 'READY'}`}
              loopWaveform={state.waveform}
              trimStart={state.trimStart}
              trimEnd={state.trimEnd}
              trimEditing={trimEditing}
              loopProgress={state.loopFrames > 0 ? state.position / state.loopFrames : 0}
            />
          </div>
        )}
        knobs={knobLabels.map((label, index) => (
          <Knob
            key={label}
            label={label}
            value={knobValues[index]}
            effectiveValue={knobValues[index]}
            display={trimEditing && index < 2
              ? `${(knobValues[index] * 100).toFixed(1)}%`
              : index === 3
                ? `${Math.round(knobValues[index] * 20)} ms`
                : `${Math.round(knobValues[index] * 100)}%`}
            patchTarget={`pressure.loop-${index}`}
            onChange={(value) => setKnob(index, value)}
            onReset={() => resetKnob(index)}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
        buttons={buttons.map((button) => (
          <button type="button" key={button.key} className={button.active ? 'active' : ''} aria-pressed={button.active} onClick={button.action}>
            {button.label}
          </button>
        ))}
      />
    </RailModuleFrame>
  );
}
'''
replace_regex('src/components/effects/RailCModules.tsx', r'function LoopModule\(\{.*?\n\}\n\n\nexport function RailCModule', loop_module + '\n\n\nexport function RailCModule')

replace_exact('src/components/effects/RailCModules.css',
'''@keyframes pressure-scan {\n  to { transform: translateY(520%); }\n}\n''',
'''@keyframes pressure-scan {\n  to { transform: translateY(520%); }\n}\n\n.loop-header-controls {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  width: 100%;\n  min-width: 0;\n}\n\n.loop-header-controls .algorithm-selector {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.loop-header-controls select {\n  width: 100%;\n  min-width: 0;\n}\n\n.loop-trim-toggle {\n  flex: 0 0 auto;\n  min-height: 22px;\n  padding: 0 7px;\n  border: 1px solid rgba(255,190,114,.26);\n  border-radius: 3px;\n  color: rgba(242,234,216,.72);\n  background: #100c08;\n  font: 800 .47rem/1 var(--mono);\n  letter-spacing: .05em;\n  cursor: pointer;\n}\n\n.loop-trim-toggle.active {\n  border-color: rgba(215,200,255,.72);\n  color: #fffaf0;\n  background: rgba(95,84,122,.34);\n  box-shadow: inset 0 0 8px rgba(215,200,255,.08);\n}\n\n.loop-trim-toggle:disabled {\n  cursor: not-allowed;\n  opacity: .34;\n}\n''')

replace_exact('src/components/ascii/RailCHardwareDisplay.tsx',
'''  modeLabel: string;\n  detailLabel?: string;\n}\n''',
'''  modeLabel: string;\n  detailLabel?: string;\n  loopWaveform?: readonly number[];\n  trimStart?: number;\n  trimEnd?: number;\n  trimEditing?: boolean;\n  loopProgress?: number;\n}\n''')
replace_exact('src/components/ascii/RailCHardwareDisplay.tsx',
'''  const phase = ((stamp / 1000) % 18) / 18 * TAU;\n  const activity = props.enabled ? clamp01(props.visualState.level * 0.72 + props.visualState.transient * 0.28) : 0;\n''',
'''  const phase = ((stamp / 1000) % 18) / 18 * TAU;\n  const drawPhase = props.kind === 'loop' && Number.isFinite(props.loopProgress)\n    ? clamp01(props.loopProgress ?? 0) * TAU\n    : phase;\n  const activity = props.enabled ? clamp01(props.visualState.level * 0.72 + props.visualState.transient * 0.28) : 0;\n''')
replace_exact('src/components/ascii/RailCHardwareDisplay.tsx',
'''  const mode = fitText(props.modeLabel.toUpperCase(), Math.max(8, innerWidth - 6));\n  const detail = fitText((props.detailLabel ?? '').toUpperCase(), Math.max(8, innerWidth - 6));\n''',
'''  const trimStart = clamp01(props.trimStart ?? 0);\n  const trimEnd = Math.max(trimStart, clamp01(props.trimEnd ?? 1));\n  const mode = fitText((props.kind === 'loop' && props.trimEditing ? 'TRIM EDIT' : props.modeLabel).toUpperCase(), Math.max(8, innerWidth - 6));\n  const detailText = props.kind === 'loop' && props.trimEditing\n    ? `IN ${(trimStart * 100).toFixed(1)}% // OUT ${(trimEnd * 100).toFixed(1)}%`\n    : (props.detailLabel ?? '');\n  const detail = fitText(detailText.toUpperCase(), Math.max(8, innerWidth - 6));\n''')
old_graph = r'''    else if (row >= graphStart && row < graphEnd) {
      const chars = Array.from({ length: innerWidth }, () => ' ');
      const accents = Array.from({ length: innerWidth }, () => ' ');
      const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;
      for (let column = 0; column < innerWidth; column += 1) {
        const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;
        const normalized = clamp01(field(props.kind, x, y, phase, props.visualState));
        if (!props.enabled && normalized < 0.72) continue;
        if (normalized < 0.22) continue;
        const glyphIndex = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));
        chars[column] = profile.glyphs[glyphIndex] ?? ' ';
        if (normalized > 0.76 && (column + row) % 13 === 0) accents[column] = chars[column];
        intensity = Math.max(intensity, normalized);
      }
      line = `║${chars.join('')}║`;
      accentLine = ` ${accents.join('')} `;
    } else if (row === rows - 2) {
      const footer = props.kind === 'loop'
        ? (props.enabled ? 'MEMORY ONLINE // 8 TRACKS' : 'MEMORY HELD // STANDBY')
        : (props.enabled ? 'ONLINE // SIGNAL LOCK' : 'BYPASS // STANDBY');
      line = `║${centerText(footer, innerWidth)}║`;
'''
new_graph = r'''    else if (row >= graphStart && row < graphEnd) {
      const chars = Array.from({ length: innerWidth }, () => ' ');
      const accents = Array.from({ length: innerWidth }, () => ' ');
      if (props.kind === 'loop' && props.trimEditing) {
        const waveform = props.loopWaveform ?? [];
        const localRow = row - graphStart;
        const center = (graphRows - 1) * 0.5;
        const vertical = Math.abs(localRow - center) / Math.max(1, center);
        const inColumn = Math.round(trimStart * Math.max(1, innerWidth - 1));
        const outColumn = Math.round(trimEnd * Math.max(1, innerWidth - 1));
        const playColumn = Math.round(clamp01(props.loopProgress ?? 0) * Math.max(1, innerWidth - 1));
        for (let column = 0; column < innerWidth; column += 1) {
          const normalizedX = column / Math.max(1, innerWidth - 1);
          const waveformIndex = waveform.length > 0
            ? Math.min(waveform.length - 1, Math.floor(normalizedX * waveform.length))
            : 0;
          const amplitude = clamp01(waveform[waveformIndex] ?? 0);
          const inside = normalizedX >= trimStart && normalizedX <= trimEnd;
          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '█' : '│') : '·';
          else if (Math.abs(localRow - center) < 0.6) chars[column] = inside ? '─' : '·';
          if (column === inColumn || column === outColumn) accents[column] = '┃';
          if (column === playColumn && inside && localRow === Math.round(center)) accents[column] = '●';
          intensity = Math.max(intensity, amplitude);
        }
      } else {
        const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;
        for (let column = 0; column < innerWidth; column += 1) {
          const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;
          const normalized = clamp01(field(props.kind, x, y, drawPhase, props.visualState));
          if (!props.enabled && normalized < 0.72) continue;
          if (normalized < 0.22) continue;
          const glyphIndex = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));
          chars[column] = profile.glyphs[glyphIndex] ?? ' ';
          if (normalized > 0.76 && (column + row) % 13 === 0) accents[column] = chars[column];
          intensity = Math.max(intensity, normalized);
        }
      }
      line = `║${chars.join('')}║`;
      accentLine = ` ${accents.join('')} `;
    } else if (row === rows - 2) {
      const footer = props.kind === 'loop'
        ? props.trimEditing
          ? 'TRANSIENT MEMORY // NON-DESTRUCTIVE TRIM'
          : (props.enabled ? 'MEMORY ONLINE // 8 TRACKS' : 'MEMORY HELD // STANDBY')
        : (props.enabled ? 'ONLINE // SIGNAL LOCK' : 'BYPASS // STANDBY');
      line = `║${centerText(footer, innerWidth)}║`;
'''
replace_exact('src/components/ascii/RailCHardwareDisplay.tsx', old_graph, new_graph)

# Add a focused regression audit and wire it into the normal check chain.
write('scripts/loop-audit.mjs', r'''import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const failures = [];
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const store = read('src/components/signal/loopStore.ts');
const worklet = read('public/loop-processor.js');
const native = read('native/src/loop_processor.cpp');
const nativeHeader = read('native/include/calcotone/loop_processor.hpp');
const rail = read('src/components/effects/RailCModules.tsx');
const display = read('src/components/ascii/RailCHardwareDisplay.tsx');
const random = read('src/features/random/railCRandomRegistry.ts');

requireText(store, 'export const LOOP_TRACK_COUNT = 8', 'Loop hard track limit');
requireText(worklet, 'this.rawFrames = new Uint32Array(TRACKS)', 'browser independent track lengths');
requireText(worklet, 'this.positions = new Uint32Array(TRACKS)', 'browser independent playheads');
forbidText(worklet, 'masterFrames', 'browser retired shared master length');
requireText(native, 'std::array<std::size_t, kLoopTrackCount> raw_frames{}', 'native independent track lengths');
requireText(native, 'std::array<std::size_t, kLoopTrackCount> positions{}', 'native independent playheads');
forbidText(native, 'master_frames', 'native retired shared master length');
requireText(nativeHeader, 'kLoopEnvelopeBins = 16\'384U', 'native transient envelope resolution');
requireText(worklet, 'const ENVELOPE_BINS = 16384', 'browser transient envelope resolution');
requireText(worklet, 'autoTrim(track)', 'browser auto trim');
requireText(native, 'auto_trim_window(unsigned track)', 'native auto trim');
requireText(rail, 'className={`loop-trim-toggle ${trimEditing ? \'active\' : \'\'}`}', 'Loop trim mode control');
requireText(rail, "{ key: 'auto', label: 'AUTO'", 'Loop auto-trim button');
requireText(rail, "{ key: 'reset', label: 'RESET'", 'Loop reset-trim button');
requireText(display, 'TRANSIENT MEMORY // NON-DESTRUCTIVE TRIM', 'ASCII transient trim view');
requireText(display, "accents[column] = '┃'", 'ASCII trim markers');
forbidText(random, "'pressure'", 'Loop excluded from RANDOM registry');

if (failures.length) {
  console.error(`Loop usability audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('CALCOTONE Loop audit passed · 8 independent track lengths, non-destructive trim, auto trim, and transient ASCII editor locked');
''')

package_path = ROOT / 'package.json'
package_data = json.loads(package_path.read_text(encoding='utf-8'))
scripts = package_data['scripts']
scripts['audit:loop'] = 'node scripts/loop-audit.mjs'
check = scripts['check']
if 'npm run audit:loop' not in check:
    check = check.replace('npm run audit:signal &&', 'npm run audit:signal && npm run audit:loop &&')
scripts['check'] = check
package_path.write_text(json.dumps(package_data, indent=2) + '\n', encoding='utf-8')

print('Loop usability patch applied.')
