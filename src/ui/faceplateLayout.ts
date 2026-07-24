import { useSyncExternalStore } from 'react';

export interface FaceplatePoint {
  x: number;
  y: number;
}

export interface FaceplateLayout {
  version: 1;
  custom: boolean;
  viewportHeight: number;
  controlAreaHeight: number;
  knobs: FaceplatePoint[];
  snap: number;
}

export interface FaceplateGuides {
  x: number | null;
  y: number | null;
}

interface FaceplateEditorState {
  savedLayout: FaceplateLayout;
  layout: FaceplateLayout;
  editing: boolean;
  snapEnabled: boolean;
  guides: FaceplateGuides;
  undo: FaceplateLayout[];
  redo: FaceplateLayout[];
  gestureStart: FaceplateLayout | null;
}

export interface FaceplateEditorSnapshot {
  layout: FaceplateLayout;
  editing: boolean;
  snapEnabled: boolean;
  guides: FaceplateGuides;
  canUndo: boolean;
  canRedo: boolean;
}

const STORAGE_KEY = 'calcotone.faceplate-layout.v1';
const KNOB_COUNT = 6;
const listeners = new Set<() => void>();

export const FACTORY_FACEPLATE_LAYOUT: FaceplateLayout = {
  version: 1,
  custom: true,
  viewportHeight: 300,
  controlAreaHeight: 210,
  knobs: [
    { x: 0.17, y: 54 },
    { x: 0.50, y: 54 },
    { x: 0.83, y: 54 },
    { x: 0.17, y: 154 },
    { x: 0.50, y: 154 },
    { x: 0.83, y: 154 },
  ],
  snap: 8,
};

const AUTO_FACEPLATE_LAYOUT: FaceplateLayout = {
  ...cloneLayout(FACTORY_FACEPLATE_LAYOUT),
  custom: false,
};

let state: FaceplateEditorState = {
  savedLayout: loadSavedLayout(),
  layout: AUTO_FACEPLATE_LAYOUT,
  editing: false,
  snapEnabled: true,
  guides: { x: null, y: null },
  undo: [],
  redo: [],
  gestureStart: null,
};
state.layout = cloneLayout(state.savedLayout);

let publicSnapshot = makeSnapshot(state);

export function useFaceplateLayoutEditor(): FaceplateEditorSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function startFaceplateEditing(): void {
  if (state.editing) return;
  const startingLayout = state.savedLayout.custom
    ? cloneLayout(state.savedLayout)
    : captureCurrentFaceplateLayout() ?? cloneLayout(FACTORY_FACEPLATE_LAYOUT);

  state = {
    ...state,
    layout: startingLayout,
    editing: true,
    guides: { x: null, y: null },
    undo: [],
    redo: [],
    gestureStart: null,
  };
  emit();
}

export function saveFaceplateLayout(): void {
  const saved = { ...cloneLayout(state.layout), custom: true };
  state = {
    ...state,
    savedLayout: saved,
    layout: cloneLayout(saved),
    editing: false,
    guides: { x: null, y: null },
    undo: [],
    redo: [],
    gestureStart: null,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // The live layout still works when storage is blocked by the browser.
  }
  emit();
}

export function cancelFaceplateEditing(): void {
  state = {
    ...state,
    layout: cloneLayout(state.savedLayout),
    editing: false,
    guides: { x: null, y: null },
    undo: [],
    redo: [],
    gestureStart: null,
  };
  emit();
}

export function resetFaceplateDraft(): void {
  if (!state.editing) return;
  pushUndo();
  state = {
    ...state,
    layout: cloneLayout(FACTORY_FACEPLATE_LAYOUT),
    guides: { x: null, y: null },
  };
  emit();
}

export function undoFaceplateLayout(): void {
  const previous = state.undo.at(-1);
  if (!state.editing || !previous) return;
  state = {
    ...state,
    layout: cloneLayout(previous),
    undo: state.undo.slice(0, -1),
    redo: [...state.redo, cloneLayout(state.layout)],
    guides: { x: null, y: null },
    gestureStart: null,
  };
  emit();
}

export function redoFaceplateLayout(): void {
  const next = state.redo.at(-1);
  if (!state.editing || !next) return;
  state = {
    ...state,
    layout: cloneLayout(next),
    undo: [...state.undo, cloneLayout(state.layout)],
    redo: state.redo.slice(0, -1),
    guides: { x: null, y: null },
    gestureStart: null,
  };
  emit();
}

export function toggleFaceplateSnap(): void {
  state = { ...state, snapEnabled: !state.snapEnabled };
  emit();
}

export function beginFaceplateGesture(): void {
  if (!state.editing || state.gestureStart) return;
  state = { ...state, gestureStart: cloneLayout(state.layout) };
  emit();
}

export function endFaceplateGesture(): void {
  const before = state.gestureStart;
  if (!state.editing || !before) return;
  const changed = JSON.stringify(before) !== JSON.stringify(state.layout);
  state = {
    ...state,
    undo: changed ? [...state.undo, before] : state.undo,
    redo: changed ? [] : state.redo,
    gestureStart: null,
    guides: { x: null, y: null },
  };
  emit();
}

export function setFaceplateKnob(index: number, point: FaceplatePoint): void {
  if (!state.editing || index < 0 || index >= KNOB_COUNT) return;
  const knobs = state.layout.knobs.map((candidate, candidateIndex) =>
    candidateIndex === index ? { x: clamp(point.x, 0.07, 0.93), y: clamp(point.y, 46, state.layout.controlAreaHeight - 46) } : candidate
  );
  state = { ...state, layout: { ...state.layout, custom: true, knobs } };
  emit();
}

export function setFaceplateViewportHeight(height: number): void {
  if (!state.editing) return;
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      viewportHeight: clamp(height, 160, 520),
    },
  };
  emit();
}

export function setFaceplateGuides(guides: FaceplateGuides): void {
  if (!state.editing) return;
  state = { ...state, guides };
  emit();
}

export async function copyFaceplateLayoutJson(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.layout, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function snapFaceplatePoint(
  index: number,
  point: FaceplatePoint,
  surfaceWidth: number,
  altKey: boolean,
): { point: FaceplatePoint; guides: FaceplateGuides } {
  if (!state.snapEnabled || altKey || surfaceWidth <= 0) {
    return { point, guides: { x: null, y: null } };
  }

  const grid = Math.max(2, state.layout.snap);
  const tolerance = 7;
  let xPx = point.x * surfaceWidth;
  let yPx = point.y;
  let guideX: number | null = null;
  let guideY: number | null = null;

  const gridX = Math.round(xPx / grid) * grid;
  const gridY = Math.round(yPx / grid) * grid;
  if (Math.abs(gridX - xPx) <= tolerance) xPx = gridX;
  if (Math.abs(gridY - yPx) <= tolerance) yPx = gridY;

  const xTargets = [surfaceWidth / 2];
  const yTargets: number[] = [];
  state.layout.knobs.forEach((candidate, candidateIndex) => {
    if (candidateIndex === index) return;
    xTargets.push(candidate.x * surfaceWidth);
    yTargets.push(candidate.y);
  });

  const nearestX = nearestWithin(xPx, xTargets, tolerance);
  if (nearestX !== null) {
    xPx = nearestX;
    guideX = nearestX / surfaceWidth;
  }
  const nearestY = nearestWithin(yPx, yTargets, tolerance);
  if (nearestY !== null) {
    yPx = nearestY;
    guideY = nearestY;
  }

  return {
    point: { x: xPx / surfaceWidth, y: yPx },
    guides: { x: guideX, y: guideY },
  };
}

function captureCurrentFaceplateLayout(): FaceplateLayout | null {
  if (typeof document === 'undefined') return null;
  const modules = Array.from(document.querySelectorAll<HTMLElement>('.effect-module'));
  const module = modules.find((candidate) => candidate.querySelectorAll('.knob-row > .knob-control').length >= KNOB_COUNT);
  if (!module) return null;

  const viewport = module.querySelector<HTMLElement>('.dsp-viewport');
  const controlSurface = module.querySelector<HTMLElement>('.knob-row');
  if (!viewport || !controlSurface || controlSurface.offsetWidth <= 0) return null;

  const controls = Array.from(controlSurface.querySelectorAll<HTMLElement>(':scope > .knob-control')).slice(0, KNOB_COUNT);
  if (controls.length !== KNOB_COUNT) return null;

  const surfaceRect = controlSurface.getBoundingClientRect();
  const scale = surfaceRect.width > 0 ? surfaceRect.width / controlSurface.offsetWidth : 1;
  const knobs = controls.map((control) => {
    const rect = control.getBoundingClientRect();
    return {
      x: clamp((rect.left + rect.width / 2 - surfaceRect.left) / surfaceRect.width, 0.07, 0.93),
      y: clamp((rect.top + rect.height / 2 - surfaceRect.top) / Math.max(0.01, scale), 46, Math.max(46, controlSurface.offsetHeight - 46)),
    };
  });

  return {
    version: 1,
    custom: true,
    viewportHeight: viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
    controlAreaHeight: Math.max(controlSurface.offsetHeight, Math.max(...knobs.map((point) => point.y)) + 54),
    knobs,
    snap: 8,
  };
}

function pushUndo(): void {
  state = {
    ...state,
    undo: [...state.undo, cloneLayout(state.layout)],
    redo: [],
    gestureStart: null,
  };
}

function loadSavedLayout(): FaceplateLayout {
  if (typeof window === 'undefined') return cloneLayout(AUTO_FACEPLATE_LAYOUT);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<FaceplateLayout> | null;
    if (!parsed || parsed.version !== 1 || !parsed.custom || !Array.isArray(parsed.knobs) || parsed.knobs.length !== KNOB_COUNT) {
      return cloneLayout(AUTO_FACEPLATE_LAYOUT);
    }
    return {
      version: 1,
      custom: true,
      viewportHeight: clamp(Number(parsed.viewportHeight) || 300, 160, 520),
      controlAreaHeight: clamp(Number(parsed.controlAreaHeight) || 210, 150, 360),
      knobs: parsed.knobs.map((point) => ({
        x: clamp(Number(point.x) || 0.5, 0.07, 0.93),
        y: clamp(Number(point.y) || 54, 46, 314),
      })),
      snap: clamp(Number(parsed.snap) || 8, 2, 24),
    };
  } catch {
    return cloneLayout(AUTO_FACEPLATE_LAYOUT);
  }
}

function nearestWithin(value: number, targets: number[], tolerance: number): number | null {
  let result: number | null = null;
  let distance = tolerance + 1;
  for (const target of targets) {
    const candidateDistance = Math.abs(value - target);
    if (candidateDistance <= tolerance && candidateDistance < distance) {
      distance = candidateDistance;
      result = target;
    }
  }
  return result;
}

function cloneLayout(layout: FaceplateLayout): FaceplateLayout {
  return {
    ...layout,
    knobs: layout.knobs.map((point) => ({ ...point })),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): FaceplateEditorSnapshot {
  return publicSnapshot;
}

function makeSnapshot(source: FaceplateEditorState): FaceplateEditorSnapshot {
  return {
    layout: source.layout,
    editing: source.editing,
    snapEnabled: source.snapEnabled,
    guides: source.guides,
    canUndo: source.undo.length > 0,
    canRedo: source.redo.length > 0,
  };
}

function emit(): void {
  publicSnapshot = makeSnapshot(state);
  listeners.forEach((listener) => listener());
}
