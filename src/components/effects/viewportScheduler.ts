export type ViewportRenderCallback = (time: number) => void;

const viewportRenderCallbacks = new Set<ViewportRenderCallback>();
const lastCallbackRender = new Map<ViewportRenderCallback, number>();
let viewportAnimationFrame = 0;
let targetInterval = 1000 / 30;
let recoveryFrames = 0;
let callbackCursor = 0;
let performanceHoldCount = 0;
let lastFrameCostMs = 0;
let worstCallbackCostMs = 0;

const NORMAL_INTERVAL = 1000 / 30;
const REDUCED_INTERVAL = 1000 / 20;
const FRAME_BUDGET_MS = 7.5;
const REDUCED_FRAME_BUDGET_MS = 5.5;
const HEAVY_FRAME_MS = 11;
const RECOVERY_FRAME_COUNT = 75;

function scheduleNextFrame(): void {
  if (
    !viewportAnimationFrame &&
    viewportRenderCallbacks.size > 0 &&
    !document.hidden &&
    performanceHoldCount === 0
  ) {
    viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
  }
}

function runViewportAnimationFrame(time: number): void {
  viewportAnimationFrame = 0;
  if (viewportRenderCallbacks.size === 0 || document.hidden || performanceHoldCount > 0) return;

  const callbacks = [...viewportRenderCallbacks];
  if (callbacks.length === 0) return;

  const frameStarted = performance.now();
  const budget = targetInterval > NORMAL_INTERVAL ? REDUCED_FRAME_BUDGET_MS : FRAME_BUDGET_MS;
  let rendered = 0;
  let visited = 0;
  let frameWorst = 0;

  // Never draw every module blindly in one RAF. Walk the callbacks round-robin and
  // stop as soon as the visual budget is spent. A costly viewport therefore delays
  // another viewport instead of turning the entire workstation into one long task.
  while (visited < callbacks.length) {
    const index = callbackCursor % callbacks.length;
    callbackCursor = (callbackCursor + 1) % Math.max(1, callbacks.length);
    visited += 1;

    const callback = callbacks[index];
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

  // Visuals are secondary to audio. Reduce both update rate and per-RAF budget when
  // either a whole visual slice or a single canvas renderer is expensive.
  if (lastFrameCostMs > HEAVY_FRAME_MS || frameWorst > HEAVY_FRAME_MS) {
    targetInterval = REDUCED_INTERVAL;
    recoveryFrames = 0;
  } else if (targetInterval > NORMAL_INTERVAL) {
    recoveryFrames += 1;
    if (recoveryFrames >= RECOVERY_FRAME_COUNT) {
      targetInterval = NORMAL_INTERVAL;
      recoveryFrames = 0;
    }
  }

  scheduleNextFrame();
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
    viewportAnimationFrame = 0;
    return;
  }
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
  scheduleNextFrame();

  return () => {
    viewportRenderCallbacks.delete(callback);
    lastCallbackRender.delete(callback);
    if (viewportRenderCallbacks.size === 0) {
      if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
      viewportAnimationFrame = 0;
      targetInterval = NORMAL_INTERVAL;
      recoveryFrames = 0;
      callbackCursor = 0;
      lastFrameCostMs = 0;
      worstCallbackCostMs = 0;
    }
  };
}
