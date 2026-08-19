import { useSyncExternalStore } from 'react';

// The audio engine keeps its established eight-track storage contract for preset/
// native compatibility. The redesigned faceplate intentionally exposes four tracks
// as the first RC-style performance layer; the remaining slots stay reserved.
export const LOOP_TRACK_COUNT = 8;
export const LOOP_VISIBLE_TRACK_COUNT = 4;
export const LOOP_MAX_SECONDS = 60;
export const LOOP_WAVEFORM_BINS = 256;
export const LOOP_MIN_BPM = 30;
export const LOOP_MAX_BPM = 300;
export const LOOP_COMMAND_EVENT = 'calcotone:loop-command';
export const LOOP_PERFORMANCE_COMMAND_EVENT = 'calcotone:loop-performance-command';
export const LOOP_CHANGE_EVENT = 'calcotone:loop-change';

export type LoopTransport = 'empty' | 'stopped' | 'playing' | 'recording' | 'overdubbing';
export type LoopQuantize = 'off' | 'beat' | 'bar';
export type LoopTransportCommand = 'record' | 'overdub' | 'play' | 'clear';
export type LoopUtilityCommand = 'undo' | 'redo' | 'bounce';
export type LoopPerformanceCommandName = 'trackPlay' | 'trackStop' | 'mute' | 'solo';
export interface LoopPerformanceCommand {
  command: LoopPerformanceCommandName;
  track: number;
}
export type LoopCommand =
  | LoopTransportCommand
  | LoopUtilityCommand
  | LoopPerformanceCommandName
  | { type: 'trim'; start: number; end: number }
  | { type: 'autoTrim' }
  | { type: 'resetTrim' };

export interface LoopSettings {
  enabled: boolean;
  selectedTrack: number;
  masterLevel: number;
  overdub: number;
  fade: number;
  bpm: number;
  quantize: LoopQuantize;
  trackLevels: number[];
}

export interface LoopRuntime {
  transport: LoopTransport;
  trackMask: number;
  trackActiveMask: number;
  trackMuteMask: number;
  trackSoloMask: number;
  loopFrames: number;
  rawFrames: number;
  position: number;
  sampleRate: number;
  trimStart: number;
  trimEnd: number;
  waveform: number[];
}

export interface LoopTrackRuntime {
  loopFrames: number;
  rawFrames: number;
  position: number;
  trimStart: number;
  trimEnd: number;
  waveform: number[];
  updatedAtMs: number;
}

export interface LoopState extends LoopSettings, LoopRuntime {
  trackRuntime: LoopTrackRuntime[];
}

const STORAGE_KEY = 'calcotone.loop-state.v2';
const LEGACY_STORAGE_KEY = 'calcotone.loop-state.v1';
const PERSIST_INTERVAL_MS = 180;
const listeners = new Set<() => void>();
const PERFORMANCE_COMMANDS = new Set<LoopPerformanceCommandName>(['trackPlay', 'trackStop', 'mute', 'solo']);
const TRANSPORT_COMMANDS = new Set<LoopTransportCommand>(['record', 'overdub', 'play', 'clear']);

const DEFAULT_SETTINGS: LoopSettings = {
  enabled: false,
  selectedTrack: 0,
  masterLevel: 0.78,
  // Internally retained as `overdub` for command/schema compatibility.
  // Semantically this is old-loop RETAIN: 0 = live replace, 1 = classic additive dub.
  overdub: 0,
  fade: 0.18,
  bpm: 120,
  quantize: 'bar',
  trackLevels: Array.from({ length: LOOP_TRACK_COUNT }, () => 0.72),
};

const DEFAULT_RUNTIME: LoopRuntime = {
  transport: 'empty',
  trackMask: 0,
  trackActiveMask: 0,
  trackMuteMask: 0,
  trackSoloMask: 0,
  loopFrames: 0,
  rawFrames: 0,
  position: 0,
  sampleRate: 48_000,
  trimStart: 0,
  trimEnd: 1,
  waveform: Array.from({ length: LOOP_WAVEFORM_BINS }, () => 0),
};

function nowMilliseconds(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function makeTrackRuntime(): LoopTrackRuntime {
  return {
    loopFrames: 0,
    rawFrames: 0,
    position: 0,
    trimStart: 0,
    trimEnd: 1,
    waveform: Array.from({ length: LOOP_WAVEFORM_BINS }, () => 0),
    updatedAtMs: nowMilliseconds(),
  };
}

function defaultTrackRuntime(): LoopTrackRuntime[] {
  return Array.from({ length: LOOP_TRACK_COUNT }, () => makeTrackRuntime());
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampTrack(value: number): number {
  return Math.max(0, Math.min(LOOP_TRACK_COUNT - 1, Math.round(Number.isFinite(value) ? value : 0)));
}

function clampVisibleTrack(value: number): number {
  return Math.max(0, Math.min(LOOP_VISIBLE_TRACK_COUNT - 1, Math.round(Number.isFinite(value) ? value : 0)));
}

function clampMask(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

function clampBpm(value: number): number {
  return Math.max(LOOP_MIN_BPM, Math.min(LOOP_MAX_BPM, Math.round(Number.isFinite(value) ? value : DEFAULT_SETTINGS.bpm)));
}

function normalizeQuantize(value: unknown): LoopQuantize {
  return value === 'off' || value === 'beat' || value === 'bar' ? value : DEFAULT_SETTINGS.quantize;
}

function normalizeTrackLevels(values: readonly number[] | undefined): number[] {
  return Array.from({ length: LOOP_TRACK_COUNT }, (_, index) => clamp01(values?.[index] ?? DEFAULT_SETTINGS.trackLevels[index]!));
}

function normalizeWaveform(values: readonly number[] | undefined, current?: number[]): number[] {
  if (current && current.length === LOOP_WAVEFORM_BINS) {
    let unchanged = true;
    for (let index = 0; index < LOOP_WAVEFORM_BINS; index += 1) {
      if (current[index] !== clamp01(values?.[index] ?? 0)) { unchanged = false; break; }
    }
    if (unchanged) return current;
  }
  return Array.from({ length: LOOP_WAVEFORM_BINS }, (_, index) => clamp01(values?.[index] ?? 0));
}

function sameTrackLevels(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function loadSettings(): LoopSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };
  try {
    const currentRaw = window.localStorage.getItem(STORAGE_KEY);
    const legacyRaw = currentRaw === null ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const saved = JSON.parse(currentRaw ?? legacyRaw ?? 'null') as Partial<LoopSettings> | null;
    if (!saved) return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };
    const migratedLegacy = currentRaw === null && legacyRaw !== null;
    return {
      enabled: saved.enabled === true,
      selectedTrack: clampTrack(saved.selectedTrack ?? 0),
      masterLevel: clamp01(saved.masterLevel ?? DEFAULT_SETTINGS.masterLevel),
      // v1 shipped with 100% feedback as its default. Migrating that value
      // would defeat the new live-replace workflow, so legacy sessions start at 0% RETAIN.
      overdub: migratedLegacy ? DEFAULT_SETTINGS.overdub : clamp01(saved.overdub ?? DEFAULT_SETTINGS.overdub),
      fade: clamp01(saved.fade ?? DEFAULT_SETTINGS.fade),
      bpm: clampBpm(saved.bpm ?? DEFAULT_SETTINGS.bpm),
      quantize: normalizeQuantize(saved.quantize),
      trackLevels: normalizeTrackLevels(saved.trackLevels),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };
  }
}

let state: LoopState = { ...loadSettings(), ...DEFAULT_RUNTIME, trackRuntime: defaultTrackRuntime() };
let persistTimer = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function settingsSnapshot(): LoopSettings {
  return {
    enabled: state.enabled,
    selectedTrack: state.selectedTrack,
    masterLevel: state.masterLevel,
    overdub: state.overdub,
    fade: state.fade,
    bpm: state.bpm,
    quantize: state.quantize,
    trackLevels: [...state.trackLevels],
  };
}

function persistNow(): void {
  if (typeof window === 'undefined') return;
  const snapshot = settingsSnapshot();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch { /* optional */ }
}

function schedulePersist(): void {
  if (typeof window === 'undefined' || persistTimer) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = 0;
    persistNow();
  }, PERSIST_INTERVAL_MS);
}

export function getLoopSettings(): LoopSettings {
  return settingsSnapshot();
}

export function getLoopState(): LoopState {
  const source = state;
  let trackLevels: number[] | null = null;
  let waveform: number[] | null = null;
  let trackRuntime: LoopTrackRuntime[] | null = null;
  const snapshot = { ...source } as LoopState;
  Object.defineProperties(snapshot, {
    trackLevels: {
      enumerable: true,
      configurable: true,
      get: () => (trackLevels ??= [...source.trackLevels]),
      set: (value: number[]) => { trackLevels = value; },
    },
    waveform: {
      enumerable: true,
      configurable: true,
      get: () => (waveform ??= [...source.waveform]),
      set: (value: number[]) => { waveform = value; },
    },
    trackRuntime: {
      enumerable: true,
      configurable: true,
      get: () => (trackRuntime ??= source.trackRuntime.map((track) => ({ ...track, waveform: [...track.waveform] }))),
      set: (value: LoopTrackRuntime[]) => { trackRuntime = value; },
    },
  });
  return snapshot;
}

/**
 * Allocation-free read for internal render/timing hot paths. The returned object
 * is Calcotone-owned live state: consumers must treat it as immutable and must
 * never retain an array with the intent to mutate it. Public/export/serialization
 * callers should continue using getLoopState(), which returns defensive copies.
 */
export function peekLoopState(): Readonly<LoopState> {
  return state;
}

/** BPM-only hot read avoids cloning all cached Loop waveform bins for clocked visuals. */
export function getLoopBpm(): number {
  return state.bpm;
}

export function setLoopState(patch: Partial<LoopSettings>): void {
  const previousTrack = state.selectedTrack;
  const selectedTrack = clampTrack(patch.selectedTrack ?? state.selectedTrack);
  const cached = state.trackRuntime[selectedTrack] ?? makeTrackRuntime();
  const changedTrack = selectedTrack !== previousTrack;
  let trackLevels = patch.trackLevels ? normalizeTrackLevels(patch.trackLevels) : state.trackLevels;
  if (patch.trackLevels && sameTrackLevels(trackLevels, state.trackLevels)) trackLevels = state.trackLevels;

  const enabled = patch.enabled ?? state.enabled;
  const masterLevel = clamp01(patch.masterLevel ?? state.masterLevel);
  const overdub = clamp01(patch.overdub ?? state.overdub);
  const fade = clamp01(patch.fade ?? state.fade);
  const bpm = clampBpm(patch.bpm ?? state.bpm);
  const quantize = normalizeQuantize(patch.quantize ?? state.quantize);
  const changed = changedTrack
    || enabled !== state.enabled
    || masterLevel !== state.masterLevel
    || overdub !== state.overdub
    || fade !== state.fade
    || bpm !== state.bpm
    || quantize !== state.quantize
    || trackLevels !== state.trackLevels;
  if (!changed) return;

  state = {
    ...state,
    ...(changedTrack ? {
      loopFrames: cached.loopFrames,
      rawFrames: cached.rawFrames,
      position: cached.position,
      trimStart: cached.trimStart,
      trimEnd: cached.trimEnd,
      waveform: cached.waveform,
    } : {}),
    enabled,
    selectedTrack,
    masterLevel,
    overdub,
    fade,
    bpm,
    quantize,
    trackLevels,
  };
  schedulePersist();
  emit();
  if (typeof window !== 'undefined') {
    // Native/browser audio consumers only need settings here. Do not deep-copy the
    // eight waveform caches on every control tick merely to publish a fader change.
    window.dispatchEvent(new CustomEvent<LoopSettings>(LOOP_CHANGE_EVENT, { detail: settingsSnapshot() }));
  }
}

export function setLoopBpm(value: number): void {
  setLoopState({ bpm: clampBpm(value) });
}

export function cycleLoopQuantize(): LoopQuantize {
  const next: LoopQuantize = state.quantize === 'off' ? 'beat' : state.quantize === 'beat' ? 'bar' : 'off';
  setLoopState({ quantize: next });
  return next;
}

export function setSelectedTrackLevel(value: number): void {
  const next = clamp01(value);
  if (state.trackLevels[state.selectedTrack] === next) return;
  const levels = [...state.trackLevels];
  levels[state.selectedTrack] = next;
  setLoopState({ trackLevels: levels });
}

export function setLoopRuntime(patch: Partial<LoopRuntime>): void {
  const transport = patch.transport ?? state.transport;
  const trimStart = clamp01(patch.trimStart ?? state.trimStart);
  const trimEnd = Math.max(trimStart, clamp01(patch.trimEnd ?? state.trimEnd));
  const loopFrames = Math.max(0, Math.round(patch.loopFrames ?? state.loopFrames));
  const rawFrames = Math.max(0, Math.round(patch.rawFrames ?? state.rawFrames));
  const position = Math.max(0, Math.round(patch.position ?? state.position));
  const sampleRate = Math.max(8_000, Math.round(patch.sampleRate ?? state.sampleRate));
  const waveform = patch.waveform ? normalizeWaveform(patch.waveform, state.waveform) : state.waveform;
  const nextTrackMask = clampMask(patch.trackMask ?? state.trackMask);
  const clearingAll = patch.transport === 'empty' && nextTrackMask === 0;
  const trackActiveMask = clearingAll ? 0 : clampMask(patch.trackActiveMask ?? state.trackActiveMask);
  const trackMuteMask = clearingAll ? 0 : clampMask(patch.trackMuteMask ?? state.trackMuteMask);
  const trackSoloMask = clearingAll ? 0 : clampMask(patch.trackSoloMask ?? state.trackSoloMask);

  const unchanged = transport === state.transport
    && nextTrackMask === state.trackMask
    && trackActiveMask === state.trackActiveMask
    && trackMuteMask === state.trackMuteMask
    && trackSoloMask === state.trackSoloMask
    && loopFrames === state.loopFrames
    && rawFrames === state.rawFrames
    && position === state.position
    && sampleRate === state.sampleRate
    && trimStart === state.trimStart
    && trimEnd === state.trimEnd
    && waveform === state.waveform;
  if (unchanged) return;

  const trackRuntime = [...state.trackRuntime];
  trackRuntime[state.selectedTrack] = {
    loopFrames,
    rawFrames,
    position,
    trimStart,
    trimEnd,
    waveform,
    updatedAtMs: nowMilliseconds(),
  };
  state = {
    ...state,
    transport,
    trackMask: nextTrackMask,
    trackActiveMask,
    trackMuteMask,
    trackSoloMask,
    loopFrames,
    rawFrames,
    position,
    sampleRate,
    trimStart,
    trimEnd,
    waveform,
    trackRuntime,
  };
  emit();
}

function optimisticPerformanceCommand(command: LoopPerformanceCommandName, track: number): void {
  const bit = 1 << track;
  if (command === 'trackPlay') {
    setLoopRuntime({ trackActiveMask: state.trackActiveMask | bit, transport: state.trackMask ? 'playing' : state.transport });
  } else if (command === 'trackStop') {
    const nextActive = state.trackActiveMask & ~bit;
    const nextTransport = state.transport === 'recording' || state.transport === 'overdubbing'
      ? state.transport
      : (nextActive & state.trackMask) !== 0 ? 'playing' : state.trackMask ? 'stopped' : 'empty';
    setLoopRuntime({ trackActiveMask: nextActive, position: track === state.selectedTrack ? 0 : state.position, transport: nextTransport });
  } else if (command === 'mute') {
    setLoopRuntime({ trackMuteMask: state.trackMuteMask ^ bit });
  } else if (command === 'solo') {
    setLoopRuntime({ trackSoloMask: state.trackSoloMask ^ bit });
  }
}

function optimisticTransportCommand(command: LoopTransportCommand): void {
  const track = state.selectedTrack;
  const bit = 1 << track;
  if (command === 'record') {
    setLoopRuntime({ trackActiveMask: state.trackActiveMask | bit });
  } else if (command === 'overdub') {
    setLoopRuntime({ trackActiveMask: state.trackActiveMask | bit });
  } else if (command === 'play') {
    if (state.transport === 'stopped') {
      setLoopRuntime({
        trackActiveMask: state.trackActiveMask || state.trackMask,
        transport: state.trackMask ? 'playing' : 'empty',
      });
    } else if (state.transport === 'playing') {
      setLoopRuntime({ transport: state.trackMask ? 'stopped' : 'empty' });
    }
  } else if (command === 'clear') {
    const nextMask = state.trackMask & ~bit;
    const nextActive = state.trackActiveMask & ~bit;
    setLoopRuntime({
      trackMask: nextMask,
      trackActiveMask: nextActive,
      trackMuteMask: state.trackMuteMask & ~bit,
      trackSoloMask: state.trackSoloMask & ~bit,
      transport: nextMask === 0 ? 'empty' : (nextActive & nextMask) !== 0 ? 'playing' : 'stopped',
      loopFrames: 0,
      rawFrames: 0,
      position: 0,
      trimStart: 0,
      trimEnd: 1,
      waveform: Array.from({ length: LOOP_WAVEFORM_BINS }, () => 0),
    });
  }
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
  } else if (typeof command === 'string' && PERFORMANCE_COMMANDS.has(command as LoopPerformanceCommandName)) {
    const performanceCommand = command as LoopPerformanceCommandName;
    optimisticPerformanceCommand(performanceCommand, state.selectedTrack);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<LoopPerformanceCommand>(LOOP_PERFORMANCE_COMMAND_EVENT, {
        detail: { command: performanceCommand, track: state.selectedTrack },
      }));
    }
    return;
  } else if (typeof command === 'string' && TRANSPORT_COMMANDS.has(command as LoopTransportCommand)) {
    optimisticTransportCommand(command as LoopTransportCommand);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<LoopCommand>(LOOP_COMMAND_EVENT, { detail: normalized }));
}

/**
 * RC-style one-button track transport for the four-track faceplate.
 * Empty -> REC, REC -> PLAY, PLAY -> DUB, DUB -> PLAY.
 * A stopped individual track starts from its own beginning before DUB is available.
 * Switching tracks is intentionally blocked while a write pass is active so a
 * recording target can never be stolen underneath the realtime thread.
 */
export function pressLoopTrack(track: number): boolean {
  const target = clampVisibleTrack(track);
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing && target !== state.selectedTrack) return false;

  const occupied = (state.trackMask & (1 << target)) !== 0;
  const active = (state.trackActiveMask & (1 << target)) !== 0;
  if (target !== state.selectedTrack) setLoopState({ selectedTrack: target });

  if (state.transport === 'recording') sendLoopCommand('record');
  else if (state.transport === 'overdubbing') sendLoopCommand('overdub');
  else if (!occupied) sendLoopCommand('record');
  else if (!active || state.transport === 'stopped') sendLoopCommand('trackPlay');
  else sendLoopCommand('overdub');
  return true;
}

export function toggleLoopTrackPlayback(track: number): boolean {
  const target = clampVisibleTrack(track);
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing && target !== state.selectedTrack) return false;
  const occupied = (state.trackMask & (1 << target)) !== 0;
  if (!occupied && !(writing && target === state.selectedTrack)) return false;
  if (target !== state.selectedTrack) setLoopState({ selectedTrack: target });
  const active = (state.trackActiveMask & (1 << target)) !== 0;
  sendLoopCommand(active ? 'trackStop' : 'trackPlay');
  return true;
}

export function toggleLoopTrackMute(track: number): boolean {
  const target = clampVisibleTrack(track);
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing && target !== state.selectedTrack) return false;
  if ((state.trackMask & (1 << target)) === 0) return false;
  if (target !== state.selectedTrack) setLoopState({ selectedTrack: target });
  sendLoopCommand('mute');
  return true;
}

export function toggleLoopTrackSolo(track: number): boolean {
  const target = clampVisibleTrack(track);
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing && target !== state.selectedTrack) return false;
  if ((state.trackMask & (1 << target)) === 0) return false;
  if (target !== state.selectedTrack) setLoopState({ selectedTrack: target });
  sendLoopCommand('solo');
  return true;
}

export function clearLoopTrack(track: number): boolean {
  const target = clampVisibleTrack(track);
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing && target !== state.selectedTrack) return false;
  if (target !== state.selectedTrack) setLoopState({ selectedTrack: target });
  sendLoopCommand('clear');
  return true;
}

export function bounceLoopMix(): boolean {
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing || state.trackMask === 0) return false;
  let destination = -1;
  for (let track = 0; track < LOOP_VISIBLE_TRACK_COUNT; track += 1) {
    if ((state.trackMask & (1 << track)) === 0) { destination = track; break; }
  }
  if (destination < 0) return false;
  setLoopState({ selectedTrack: destination });
  sendLoopCommand('bounce');
  return true;
}

export function loopTrackProgress(track: number, atMs = nowMilliseconds()): number {
  const target = clampTrack(track);
  const runtime = state.trackRuntime[target];
  if (!runtime || runtime.loopFrames <= 0) return 0;
  let position = runtime.position;
  const writingTarget = target === state.selectedTrack && (state.transport === 'recording' || state.transport === 'overdubbing');
  const active = (state.trackActiveMask & (1 << target)) !== 0;
  const transportRunning = state.transport === 'playing' || state.transport === 'recording' || state.transport === 'overdubbing';
  const moving = writingTarget || (transportRunning && active);
  if (moving && ((state.trackMask & (1 << target)) !== 0 || writingTarget)) {
    const elapsedFrames = Math.max(0, atMs - runtime.updatedAtMs) * state.sampleRate / 1000;
    position = (position + elapsedFrames) % runtime.loopFrames;
  }
  return clamp01(position / runtime.loopFrames);
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
