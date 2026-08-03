import { useSyncExternalStore } from 'react';

export interface FaceplatePoint {
  x: number;
  y: number;
}

export type RailCFaceplateId = 'stomp' | 'chaos' | 'pressure';
export type CoreFaceplateId = 'saturation' | 'chorus' | 'delay' | 'reverb' | 'bitcrusher' | 'media';
export type FaceplateModuleId = CoreFaceplateId | RailCFaceplateId;

export interface RailCFaceplateModuleLayout {
  viewportHeight: number;
  stageHeight: number;
  knobs: FaceplatePoint[];
  buttons: FaceplatePoint[];
}

export interface FaceplateLayout {
  version: 2;
  custom: boolean;
  viewportHeight: number;
  stageHeight: number;
  knobs: FaceplatePoint[];
  core: Record<CoreFaceplateId, RailCFaceplateModuleLayout>;
  railC: Record<RailCFaceplateId, RailCFaceplateModuleLayout>;
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
  linkedModules: boolean;
  guides: FaceplateGuides;
  undo: FaceplateLayout[];
  redo: FaceplateLayout[];
  gestureStart: FaceplateLayout | null;
}

export interface FaceplateEditorSnapshot {
  layout: FaceplateLayout;
  editing: boolean;
  snapEnabled: boolean;
  linkedModules: boolean;
  guides: FaceplateGuides;
  canUndo: boolean;
  canRedo: boolean;
}

const STORAGE_KEY = 'calcotone.faceplate-layout.v2';
const LEGACY_STORAGE_KEY = 'calcotone.faceplate-layout.v1';
const FACTORY_LAYOUT_REVISION_KEY = 'calcotone.faceplate-layout.factory-revision';
const FACTORY_LAYOUT_REVISION = '2026-07-30-banked-knob-faceplate';
const KNOB_COUNT = 6;
const listeners = new Set<() => void>();
const CORE_FACEPLATE_IDS: readonly CoreFaceplateId[] = ['saturation', 'chorus', 'delay', 'reverb', 'bitcrusher', 'media'];
const RAIL_C_FACEPLATE_IDS: readonly RailCFaceplateId[] = ['stomp', 'chaos', 'pressure'];

const MASTER_KNOBS: FaceplatePoint[] = [
  { x: 0.07, y: 246 },
  { x: 0.2099125364431487, y: 246 },
  { x: 0.3498542274052478, y: 246 },
  { x: 0.6530612244897959, y: 246 },
  { x: 0.793002915451895, y: 246 },
  { x: 0.93, y: 246 },
];

function createCoreFactoryLayouts(): Record<CoreFaceplateId, RailCFaceplateModuleLayout> {
  return Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [id, {
    viewportHeight: 168,
    stageHeight: 292,
    knobs: MASTER_KNOBS.map((point) => ({ ...point })),
    buttons: [],
  }])) as unknown as Record<CoreFaceplateId, RailCFaceplateModuleLayout>;
}

export const FACTORY_FACEPLATE_LAYOUT: FaceplateLayout = {
  version: 2,
  custom: true,
  viewportHeight: 168,
  stageHeight: 292,
  knobs: MASTER_KNOBS.map((point) => ({ ...point })),
  core: createCoreFactoryLayouts(),
  railC: {
    stomp: {
      viewportHeight: 168,
      stageHeight: 292,
      knobs: [
        { x: 0.07, y: 246 },
        { x: 0.2099125364431487, y: 246 },
        { x: 0.3498542274052478, y: 246 },
        { x: 0.6530612244897959, y: 246 },
        { x: 0.793002915451895, y: 246 },
        { x: 0.93, y: 246 },
      ],
      buttons: [],
    },
    chaos: {
      viewportHeight: 168,
      stageHeight: 292,
      knobs: [
        { x: 0.14, y: 246 },
        { x: 0.38, y: 246 },
        { x: 0.62, y: 246 },
        { x: 0.86, y: 246 },
      ],
      buttons: [],
    },
    pressure: {
      viewportHeight: 168,
      stageHeight: 292,
      knobs: [
        { x: 0.14, y: 240 },
        { x: 0.38, y: 240 },
        { x: 0.62, y: 240 },
        { x: 0.86, y: 240 },
      ],
      buttons: [
        { x: 0.14, y: 278 },
        { x: 0.38, y: 278 },
        { x: 0.62, y: 278 },
        { x: 0.86, y: 278 },
      ],
    },
  },
  snap: 8,
};

let state: FaceplateEditorState = {
  savedLayout: loadSavedLayout(),
  layout: cloneLayout(FACTORY_FACEPLATE_LAYOUT),
  editing: false,
  snapEnabled: true,
  linkedModules: true,
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
    window.localStorage.setItem(FACTORY_LAYOUT_REVISION_KEY, FACTORY_LAYOUT_REVISION);
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

export function toggleFaceplateModuleLink(): void {
  state = { ...state, linkedModules: !state.linkedModules };
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

export function setFaceplateKnob(
  moduleId: CoreFaceplateId,
  index: number,
  point: FaceplatePoint
): void {
  if (!state.editing || index < 0 || index >= KNOB_COUNT) return;
  const source = state.layout.core[moduleId];
  const knobs = source.knobs.map((candidate, candidateIndex) =>
    candidateIndex === index ? { x: clamp(point.x, 0.07, 0.93), y: clamp(point.y, 46, source.stageHeight - 46) } : candidate
  );
  const nextCore = state.linkedModules
    ? Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [id, { ...state.layout.core[id], knobs: knobs.map((candidate) => ({ ...candidate })) }])) as Record<CoreFaceplateId, RailCFaceplateModuleLayout>
    : { ...state.layout.core, [moduleId]: { ...source, knobs } };
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      knobs: state.linkedModules ? knobs.map((candidate) => ({ ...candidate })) : state.layout.knobs,
      core: nextCore,
    },
  };
  emit();
}

export function setFaceplateViewportHeight(
  moduleId: CoreFaceplateId,
  height: number
): void {
  if (!state.editing) return;
  const source = state.layout.core[moduleId];
  const firstRowY = Math.min(...source.knobs.map((point) => point.y));
  const collisionSafeMaximum = Math.max(160, firstRowY - 52);
  const viewportHeight = clamp(height, 120, Math.min(520, collisionSafeMaximum));
  const nextCore = state.linkedModules
    ? Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [id, { ...state.layout.core[id], viewportHeight }])) as Record<CoreFaceplateId, RailCFaceplateModuleLayout>
    : { ...state.layout.core, [moduleId]: { ...source, viewportHeight } };
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      viewportHeight: state.linkedModules ? viewportHeight : state.layout.viewportHeight,
      core: nextCore,
    },
  };
  emit();
}

export function setRailCFaceplateViewportHeight(
  moduleId: RailCFaceplateId,
  height: number
): void {
  if (!state.editing) return;
  const moduleLayout = state.layout.railC[moduleId];
  const firstControlY = Math.min(
    ...moduleLayout.knobs.map((point) => point.y),
    ...moduleLayout.buttons.map((point) => point.y),
  );
  const collisionSafeMaximum = Math.max(110, firstControlY - 48);
  const nextRailC = state.linkedModules
    ? Object.fromEntries(RAIL_C_FACEPLATE_IDS.map((id) => {
        const candidate = state.layout.railC[id];
        const firstY = Math.min(...candidate.knobs.map((point) => point.y), ...candidate.buttons.map((point) => point.y));
        return [id, { ...candidate, viewportHeight: clamp(height, 96, Math.min(260, Math.max(110, firstY - 48))) }];
      })) as Record<RailCFaceplateId, RailCFaceplateModuleLayout>
    : {
        ...state.layout.railC,
        [moduleId]: {
          ...moduleLayout,
          viewportHeight: clamp(height, 96, Math.min(260, collisionSafeMaximum)),
        },
      };
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      railC: nextRailC,
    },
  };
  emit();
}

export function setRailCFaceplateControl(
  moduleId: RailCFaceplateId,
  kind: 'knob' | 'button',
  index: number,
  point: FaceplatePoint
): void {
  if (!state.editing) return;
  const moduleLayout = state.layout.railC[moduleId];
  const key = kind === 'knob' ? 'knobs' : 'buttons';
  if (index < 0 || index >= moduleLayout[key].length) return;
  const points = moduleLayout[key].map((candidate, candidateIndex) =>
    candidateIndex === index
      ? {
          x: clamp(point.x, kind === 'knob' ? 0.07 : 0.06, kind === 'knob' ? 0.93 : 0.94),
          y: clamp(point.y, kind === 'knob' ? 46 : 14, moduleLayout.stageHeight - (kind === 'knob' ? 46 : 14)),
        }
      : candidate
  );
  const nextRailC = state.linkedModules && kind === 'knob'
    ? Object.fromEntries(RAIL_C_FACEPLATE_IDS.map((id) => {
        const candidate = state.layout.railC[id];
        if (index >= candidate.knobs.length) return [id, candidate];
        return [id, {
          ...candidate,
          knobs: candidate.knobs.map((candidatePoint, candidateIndex) =>
            candidateIndex === index
              ? {
                  x: clamp(point.x, 0.07, 0.93),
                  y: clamp(point.y, 46, candidate.stageHeight - 46),
                }
              : candidatePoint
          ),
        }];
      })) as Record<RailCFaceplateId, RailCFaceplateModuleLayout>
    : {
        ...state.layout.railC,
        [moduleId]: { ...moduleLayout, [key]: points },
      };
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      railC: nextRailC,
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
  moduleId: CoreFaceplateId,
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
  state.layout.core[moduleId].knobs.forEach((candidate, candidateIndex) => {
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

export function snapRailCFaceplatePoint(
  moduleId: RailCFaceplateId,
  kind: 'knob' | 'button',
  index: number,
  point: FaceplatePoint,
  surfaceWidth: number,
  altKey: boolean,
): { point: FaceplatePoint; guides: FaceplateGuides } {
  if (!state.snapEnabled || altKey || surfaceWidth <= 0) {
    return { point, guides: { x: null, y: null } };
  }

  const moduleLayout = state.layout.railC[moduleId];
  const points = kind === 'knob' ? moduleLayout.knobs : moduleLayout.buttons;
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
  points.forEach((candidate, candidateIndex) => {
    if (candidateIndex === index) return;
    xTargets.push(candidate.x * surfaceWidth);
    yTargets.push(candidate.y);
  });

  const otherPoints = kind === 'knob' ? moduleLayout.buttons : moduleLayout.knobs;
  otherPoints.forEach((candidate) => {
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

  const capturedKnobs = knobs.map((point) => ({
    ...point,
    y: (viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight) + 12 + point.y,
  }));
  const capturedViewportHeight = viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight;
  const capturedStageHeight = Math.max(
    capturedViewportHeight + 12,
    capturedViewportHeight + 12 + Math.max(...knobs.map((point) => point.y)) + 54,
  );
  const capturedModule: RailCFaceplateModuleLayout = {
    viewportHeight: capturedViewportHeight,
    stageHeight: capturedStageHeight,
    knobs: capturedKnobs,
    buttons: [],
  };
  return {
    version: 2,
    custom: true,
    viewportHeight: capturedViewportHeight,
    stageHeight: capturedStageHeight,
    knobs: capturedKnobs,
    core: Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [id, {
      ...capturedModule,
      knobs: capturedKnobs.map((point) => ({ ...point })),
    }])) as Record<CoreFaceplateId, RailCFaceplateModuleLayout>,
    railC: cloneLayout(FACTORY_FACEPLATE_LAYOUT).railC,
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
  if (typeof window === 'undefined') return cloneLayout(FACTORY_FACEPLATE_LAYOUT);
  try {
    if (window.localStorage.getItem(FACTORY_LAYOUT_REVISION_KEY) !== FACTORY_LAYOUT_REVISION) {
      const approved = cloneLayout(FACTORY_FACEPLATE_LAYOUT);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(approved));
        window.localStorage.setItem(FACTORY_LAYOUT_REVISION_KEY, FACTORY_LAYOUT_REVISION);
      } catch {
        // The approved layout still applies when storage is blocked by the browser.
      }
      return approved;
    }

    const current = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<FaceplateLayout> | null;
    if (current?.version === 2 && current.custom && Array.isArray(current.knobs) && current.knobs.length === KNOB_COUNT) {
      return sanitizeV2Layout(current);
    }

    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null') as {
      version?: number;
      custom?: boolean;
      viewportHeight?: number;
      controlTop?: number;
      controlAreaHeight?: number;
      knobs?: FaceplatePoint[];
      snap?: number;
    } | null;
    if (legacy?.version === 1 && legacy.custom && Array.isArray(legacy.knobs) && legacy.knobs.length === KNOB_COUNT) {
      const viewportHeight = clamp(Number(legacy.viewportHeight) || 192, 120, 520);
      const controlTop = clamp(Number(legacy.controlTop) || viewportHeight + 12, 120, 560);
      const migrated: FaceplateLayout = {
        version: 2,
        custom: true,
        viewportHeight,
        stageHeight: Math.max(
          controlTop + clamp(Number(legacy.controlAreaHeight) || 322, 150, 420),
          controlTop + Math.max(...legacy.knobs.map((point) => Number(point.y) || 54)) + 54,
        ),
        knobs: legacy.knobs.map((point) => ({
          x: clamp(Number(point.x) || 0.5, 0.07, 0.93),
          y: controlTop + clamp(Number(point.y) || 54, 46, 314),
        })),
        core: createCoreFactoryLayouts(),
        railC: cloneLayout(FACTORY_FACEPLATE_LAYOUT).railC,
        snap: clamp(Number(legacy.snap) || 8, 2, 24),
      };
      migrated.core = Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [id, {
        viewportHeight: migrated.viewportHeight,
        stageHeight: migrated.stageHeight,
        knobs: migrated.knobs.map((point) => ({ ...point })),
        buttons: [],
      }])) as unknown as Record<CoreFaceplateId, RailCFaceplateModuleLayout>;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        window.localStorage.setItem(FACTORY_LAYOUT_REVISION_KEY, FACTORY_LAYOUT_REVISION);
      } catch {
        // The live migration still works when storage is blocked by the browser.
      }
      return migrated;
    }
    return cloneLayout(FACTORY_FACEPLATE_LAYOUT);
  } catch {
    return cloneLayout(FACTORY_FACEPLATE_LAYOUT);
  }
}

function sanitizeV2Layout(layout: Partial<FaceplateLayout>): FaceplateLayout {
  const knobs = (layout.knobs ?? FACTORY_FACEPLATE_LAYOUT.knobs).map((point, index) => ({
    x: clamp(Number(point.x) || FACTORY_FACEPLATE_LAYOUT.knobs[index]?.x || 0.5, 0.07, 0.93),
    y: clamp(Number(point.y) || FACTORY_FACEPLATE_LAYOUT.knobs[index]?.y || 364, 46, 620),
  }));
  const stageHeight = clamp(
    Math.max(
      Number(layout.stageHeight) || FACTORY_FACEPLATE_LAYOUT.stageHeight,
      Math.max(...knobs.map((point) => point.y)) + 46
    ),
    220,
    680,
  );
  const masterLayout: RailCFaceplateModuleLayout = {
    viewportHeight: clamp(
      Number(layout.viewportHeight) || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
      120,
      Math.max(120, Math.min(520, Math.min(...knobs.map((point) => point.y)) - 52))
    ),
    stageHeight,
    knobs: knobs.map((point) => ({ ...point, y: clamp(point.y, 46, stageHeight - 46) })),
    buttons: [],
  };
  const sanitizeModule = (
    candidate: Partial<RailCFaceplateModuleLayout> | undefined,
    fallback: RailCFaceplateModuleLayout,
    knobCount: number,
    buttonCount: number
  ): RailCFaceplateModuleLayout => {
    const candidateStage = clamp(Number(candidate?.stageHeight) || fallback.stageHeight, 220, 680);
    const sanitizePoints = (
      source: FaceplatePoint[] | undefined,
      fallbackPoints: FaceplatePoint[],
      count: number,
      kind: 'knob' | 'button'
    ) => Array.from({ length: count }, (_, index) => {
      const point = source?.[index] ?? fallbackPoints[index] ?? { x: .5, y: kind === 'knob' ? 210 : 278 };
      return {
        x: clamp(Number(point.x) || .5, kind === 'knob' ? .07 : .06, kind === 'knob' ? .93 : .94),
        y: clamp(Number(point.y) || fallbackPoints[index]?.y || 210, kind === 'knob' ? 46 : 14, candidateStage - (kind === 'knob' ? 46 : 14)),
      };
    });
    const candidateKnobs = sanitizePoints(candidate?.knobs, fallback.knobs, knobCount, 'knob');
    const candidateButtons = sanitizePoints(candidate?.buttons, fallback.buttons, buttonCount, 'button');
    const firstControlY = Math.min(
      ...candidateKnobs.map((point) => point.y),
      ...candidateButtons.map((point) => point.y),
      candidateStage
    );
    return {
      viewportHeight: clamp(Number(candidate?.viewportHeight) || fallback.viewportHeight, 96, Math.min(520, Math.max(96, firstControlY - 48))),
      stageHeight: candidateStage,
      knobs: candidateKnobs,
      buttons: candidateButtons,
    };
  };
  const savedCore = layout.core as Partial<Record<CoreFaceplateId, RailCFaceplateModuleLayout>> | undefined;
  const savedRailC = layout.railC as Partial<Record<RailCFaceplateId | 'synth', RailCFaceplateModuleLayout>> | undefined;
  const core = Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [
    id,
    sanitizeModule(savedCore?.[id], masterLayout, KNOB_COUNT, 0),
  ])) as Record<CoreFaceplateId, RailCFaceplateModuleLayout>;
  const railC = {
    stomp: sanitizeModule(savedRailC?.stomp ?? savedRailC?.synth, FACTORY_FACEPLATE_LAYOUT.railC.stomp, 6, 0),
    chaos: sanitizeModule(savedRailC?.chaos, FACTORY_FACEPLATE_LAYOUT.railC.chaos, 4, 0),
    pressure: sanitizeModule(savedRailC?.pressure, FACTORY_FACEPLATE_LAYOUT.railC.pressure, 4, 4),
  };
  return {
    version: 2,
    custom: true,
    viewportHeight: clamp(
      Number(layout.viewportHeight) || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
      120,
      Math.max(120, Math.min(520, Math.min(...knobs.map((point) => point.y)) - 52))
    ),
    stageHeight,
    knobs: knobs.map((point) => ({ ...point, y: clamp(point.y, 46, stageHeight - 46) })),
    core,
    railC,
    snap: clamp(Number(layout.snap) || FACTORY_FACEPLATE_LAYOUT.snap, 2, 24),
  };
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
  const cloneModule = (moduleLayout: RailCFaceplateModuleLayout): RailCFaceplateModuleLayout => ({
    ...moduleLayout,
    knobs: moduleLayout.knobs.map((point) => ({ ...point })),
    buttons: moduleLayout.buttons.map((point) => ({ ...point })),
  });
  return {
    ...layout,
    knobs: layout.knobs.map((point) => ({ ...point })),
    core: Object.fromEntries(CORE_FACEPLATE_IDS.map((id) => [id, cloneModule(layout.core[id])])) as Record<CoreFaceplateId, RailCFaceplateModuleLayout>,
    railC: Object.fromEntries(RAIL_C_FACEPLATE_IDS.map((id) => [id, cloneModule(layout.railC[id])])) as Record<RailCFaceplateId, RailCFaceplateModuleLayout>,
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
    linkedModules: source.linkedModules,
    guides: source.guides,
    canUndo: source.undo.length > 0,
    canRedo: source.redo.length > 0,
  };
}

function emit(): void {
  publicSnapshot = makeSnapshot(state);
  listeners.forEach((listener) => listener());
}
