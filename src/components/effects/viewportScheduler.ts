export type ViewportRenderCallback = (time: number) => void;

const viewportRenderCallbacks = new Set<ViewportRenderCallback>();
let viewportAnimationFrame = 0;
let lastRenderTime = 0;
let targetInterval = 1000 / 30;
let recoveryFrames = 0;

const NORMAL_INTERVAL = 1000 / 30;
const REDUCED_INTERVAL = 1000 / 24;
const HEAVY_FRAME_MS = 10;
const RECOVERY_FRAME_COUNT = 90;

function scheduleNextFrame(): void {
  if (!viewportAnimationFrame && viewportRenderCallbacks.size > 0 && !document.hidden) {
    viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
  }
}

function runViewportAnimationFrame(time: number): void {
  viewportAnimationFrame = 0;

  if (viewportRenderCallbacks.size === 0 || document.hidden) return;

  if (lastRenderTime === 0 || time - lastRenderTime >= targetInterval) {
    const started = performance.now();
    viewportRenderCallbacks.forEach((callback) => callback(time));
    const renderCost = performance.now() - started;
    lastRenderTime = time;

    // Visuals are secondary to audio. If a visual frame becomes expensive, reduce the
    // shared viewport rate until the UI has demonstrated sustained headroom again.
    if (renderCost > HEAVY_FRAME_MS) {
      targetInterval = REDUCED_INTERVAL;
      recoveryFrames = 0;
    } else if (targetInterval > NORMAL_INTERVAL) {
      recoveryFrames += 1;
      if (recoveryFrames >= RECOVERY_FRAME_COUNT) {
        targetInterval = NORMAL_INTERVAL;
        recoveryFrames = 0;
      }
    }
  }

  scheduleNextFrame();
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
    viewportAnimationFrame = 0;
    lastRenderTime = 0;
    return;
  }
  scheduleNextFrame();
}

document.addEventListener('visibilitychange', handleVisibilityChange);

export function subscribeViewportAnimation(callback: ViewportRenderCallback): () => void {
  viewportRenderCallbacks.add(callback);
  scheduleNextFrame();

  return () => {
    viewportRenderCallbacks.delete(callback);
    if (viewportRenderCallbacks.size === 0) {
      if (viewportAnimationFrame) cancelAnimationFrame(viewportAnimationFrame);
      viewportAnimationFrame = 0;
      lastRenderTime = 0;
      targetInterval = NORMAL_INTERVAL;
      recoveryFrames = 0;
    }
  };
}
