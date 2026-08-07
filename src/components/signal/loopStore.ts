import { useSyncExternalStore } from 'react';

export const LOOP_TRACK_COUNT = 8;
export const LOOP_MAX_SECONDS = 60;
export const LOOP_COMMAND_EVENT = 'calcotone:loop-command';
export const LOOP_CHANGE_EVENT = 'calcotone:loop-change';

export type LoopTransport = 'empty' | 'stopped' | 'playing' | 'recording' | 'overdubbing';
export type LoopCommand = 'record' | 'overdub' | 'play' | 'clear';

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
  position: number;
  sampleRate: number;
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
  position: 0,
  sampleRate: 48_000,
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
  return { ...state, trackLevels: [...state.trackLevels] };
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
  state = {
    ...state,
    ...patch,
    trackMask: Math.max(0, Math.min(255, Math.round(patch.trackMask ?? state.trackMask))),
    loopFrames: Math.max(0, Math.round(patch.loopFrames ?? state.loopFrames)),
    position: Math.max(0, Math.round(patch.position ?? state.position)),
    sampleRate: Math.max(8_000, Math.round(patch.sampleRate ?? state.sampleRate)),
  };
  emit();
}

export function sendLoopCommand(command: LoopCommand): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<LoopCommand>(LOOP_COMMAND_EVENT, { detail: command }));
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
