export type ViewportRenderCallback = (time: number) => void;
const viewportRenderCallbacks = new Set<ViewportRenderCallback>();
let viewportAnimationFrame = 0;
function runViewportAnimationFrame(time: number): void {
  viewportRenderCallbacks.forEach((callback) => callback(time));
  viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
}
export function subscribeViewportAnimation(callback: ViewportRenderCallback): () => void {
  viewportRenderCallbacks.add(callback);
  if (viewportRenderCallbacks.size === 1) viewportAnimationFrame = requestAnimationFrame(runViewportAnimationFrame);
  return () => {
    viewportRenderCallbacks.delete(callback);
    if (viewportRenderCallbacks.size === 0 && viewportAnimationFrame) { cancelAnimationFrame(viewportAnimationFrame); viewportAnimationFrame = 0; }
  };
}
