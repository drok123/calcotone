import { getDisplayProfile } from '../../ui/displayProfile';

export type ViewportRenderCallback = (time: number) => void;

const HEAVY_FRAME_MS = 10.5;
const RECOVERY_FRAME_COUNT = 90;
const MAX_VISUAL_FPS = 20;

const viewportRenderCallbacks = new Set<ViewportRenderCallback>();
const lastCallbackRender = new Map<ViewportRenderCallback, number>();
let callbackSnapshot: ViewportRenderCallback[] = [];
let viewportAnimationFrame = 0;
let targetInterval = preferredInterval();
let recoveryFrames = 0;
let callbackCursor = 0;
let performanceHoldCount = 0;
let lastFrameCostMs = 0;
let worstCallbackCostMs = 0;

function preferredInterval(): number {
  return 1000 / Math.min(getDisplayProfile().visualFps, MAX_VISUAL_FPS);
}

function reducedInterval(): number {
  return 1000 / (getDisplayProfile().reference1440p ? 15 : 12);
}

function frameBudget(): number {
  const preferred = preferredInterval();
  return targetInterval > preferred + .25
    ? 4.5
    : getDisplayProfile().reference1440p
      ? 5.5
      : 6.25;
}

function refreshCallbackSnapshot(): void {
  callbackSnapshot = Array.from(viewportRenderCallbacks);
  if (callbackSnapshot.length === 0) callbackCursor = 0;
  else callbackCursor %= callbackSnapshot.length;
}

function scheduleNextFrame(): void {
  if (
    !viewportAnimationFrame &&
    callbackSnapshot.length > 0 &&
    !document.hidden &&
    performanceHoldCount === 0
  ) {
    viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
  }
}

function runViewportAnimationFrame(time: number): void {
  viewportAnimationFrame = 0;
  if (callbackSnapshot.length === 0 || document.hidden || performanceHoldCount > 0) return;

  const preferred = preferredInterval();
  if (targetInterval < preferred) targetInterval = preferred;

  const callbacks = callbackSnapshot;
  const frameStarted = performance.now();
  const budget = frameBudget();
  let rendered = 0;
  let visited = 0;
  let frameWorst = 0;

  // Walk a stable callback snapshot round-robin. Snapshot allocation only happens when
  // a viewport subscribes/unsubscribes, never on the animation hot path.
  while (visited < callbacks.length) {
    const index = callbackCursor % callbacks.length;
    callbackCursor = (callbackCursor + 1) % Math.max(1, callbacks.length);
    visited += 1;

    const callback = callbacks[index];
    if (!viewportRenderCallbacks.has(callback)) continue;
    const last = lastCallbackRender.get(callback) ?? 0;
    if (last !== 0 && time - last < targetInterval) continue;

    const callbackStarted = performance.now();
    callback(time);
    const callbackCost = performance.now() - callbackStarted;
    frameWorst = Math.max(frameWorst, callbackCost);
    worstCallbackCostMs = Math.max(worstCallbackCostMs * 0.97, callbackCost);
    lastCallbackRender.set(callback, time);
    rendered += 1;

    if (rendered > 0 && performance.now() - frameStarted >= budget) break;
  }

  lastFrameCostMs = performance.now() - frameStarted;

  // The paint clock is intentionally slower than the audio clock. Renderers always
  // sample the latest audio-derived phase, so skipped frames reduce CPU without
  // accumulating visual drift. Heavy frames fall back again before they can compete
  // with WebView/native control work.
  if (lastFrameCostMs > HEAVY_FRAME_MS || frameWorst > HEAVY_FRAME_MS) {
    targetInterval = reducedInterval();
    recoveryFrames = 0;
  } else if (targetInterval > preferred + .25) {
    recoveryFrames += 1;
    if (recoveryFrames >= RECOVERY_FRAME_COUNT) {
      targetInterval = preferred;
      recoveryFrames = 0;
    }
  } else {
    targetInterval = preferred;
  }

  scheduleNextFrame();
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
    viewportAnimationFrame = 0;
    return;
  }
  targetInterval = preferredInterval();
  scheduleNextFrame();
}

document.addEventListener('visibilitychange', handleVisibilityChange);

/**
 * Temporarily preserve the most recent viewport frames without redrawing them.
 * Audio-critical operations use this as a tiny "hold frame" switch so expensive
 * canvases never compete with graph/network construction on the same main thread.
 */
export function beginViewportPerformanceHold(): () => void {
  performanceHoldCount += 1;
  if (viewportAnimationFrame) {
    cancelAnimationFrame(viewportAnimationFrame);
    viewportAnimationFrame = 0;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    performanceHoldCount = Math.max(0, performanceHoldCount - 1);
    if (performanceHoldCount === 0) scheduleNextFrame();
  };
}

export function getViewportSchedulerStats(): {
  held: boolean;
  frameCostMs: number;
  worstCallbackCostMs: number;
  targetFps: number;
} {
  return {
    held: performanceHoldCount > 0,
    frameCostMs: lastFrameCostMs,
    worstCallbackCostMs,
    targetFps: Math.round(1000 / targetInterval),
  };
}

export function subscribeViewportAnimation(callback: ViewportRenderCallback): () => void {
  viewportRenderCallbacks.add(callback);
  lastCallbackRender.set(callback, 0);
  refreshCallbackSnapshot();
  scheduleNextFrame();

  return () => {
    viewportRenderCallbacks.delete(callback);
    lastCallbackRender.delete(callback);
    refreshCallbackSnapshot();
    if (viewportRenderCallbacks.size === 0) {
      if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
      viewportAnimationFrame = 0;
      targetInterval = preferredInterval();
      recoveryFrames = 0;
      callbackCursor = 0;
      lastFrameCostMs = 0;
      worstCallbackCostMs = 0;
    }
  };
}

function disposeViewportScheduler(): void {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
  viewportAnimationFrame = 0;
  viewportRenderCallbacks.clear();
  lastCallbackRender.clear();
  callbackSnapshot = [];
  targetInterval = preferredInterval();
  recoveryFrames = 0;
  callbackCursor = 0;
  performanceHoldCount = 0;
  lastFrameCostMs = 0;
  worstCallbackCostMs = 0;
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeViewportScheduler);
}
