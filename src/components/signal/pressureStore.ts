import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SIGNAL_LAB_STATE,
  SIGNAL_LAB_SWEET_SPOTS,
  type SignalLabState,
} from '../../audio/SignalLab';

const STORAGE_KEY = 'calcotone.pressure-state.v1';
const listeners = new Set<() => void>();

let state: SignalLabState = loadState();

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function loadState(): SignalLabState {
  if (typeof window === 'undefined') return { ...DEFAULT_SIGNAL_LAB_STATE };
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SignalLabState> | null;
    if (!saved) return { ...DEFAULT_SIGNAL_LAB_STATE };
    return {
      ...DEFAULT_SIGNAL_LAB_STATE,
      ...saved,
      drive: clamp01(saved.drive ?? DEFAULT_SIGNAL_LAB_STATE.drive),
      time: clamp01(saved.time ?? DEFAULT_SIGNAL_LAB_STATE.time),
      character: clamp01(saved.character ?? DEFAULT_SIGNAL_LAB_STATE.character),
      mix: clamp01(saved.mix ?? DEFAULT_SIGNAL_LAB_STATE.mix),
    };
  } catch {
    return { ...DEFAULT_SIGNAL_LAB_STATE };
  }
}

function persist(): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
}

function emit(): void {
  for (const listener of listeners) listener();
  window.dispatchEvent(new CustomEvent<SignalLabState>('calcotone:pressure-change', { detail: { ...state } }));
}

export function getPressureState(): SignalLabState {
  return { ...state };
}

export function setPressureState(patch: Partial<SignalLabState>): void {
  state = {
    ...state,
    ...patch,
    drive: clamp01(patch.drive ?? state.drive),
    time: clamp01(patch.time ?? state.time),
    character: clamp01(patch.character ?? state.character),
    mix: clamp01(patch.mix ?? state.mix),
  };
  persist();
  emit();
}

export function usePressureState(): SignalLabState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
    () => state,
  );
}

function randomIn(range: readonly [number, number]): number {
  const centered = (Math.random() + Math.random()) * 0.5;
  return range[0] + (range[1] - range[0]) * centered;
}

/** Randomize Pressure only when the hardware section is switched on. */
export function randomizePressure(): string | null {
  if (!state.enabled) return null;
  const recipe = SIGNAL_LAB_SWEET_SPOTS[Math.floor(Math.random() * SIGNAL_LAB_SWEET_SPOTS.length)];
  if (!recipe) return null;
  setPressureState({
    mode: recipe.mode,
    style: recipe.style,
    drive: Math.min(0.72, randomIn(recipe.drive)),
    time: randomIn(recipe.time),
    character: randomIn(recipe.character),
    mix: Math.min(0.82, randomIn(recipe.mix)),
  });
  return `${recipe.mode.toUpperCase()} · ${recipe.style.toUpperCase()} · LEVEL MATCHED`;
}
