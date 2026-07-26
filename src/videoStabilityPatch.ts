const DRIFT_STABLE_MODES = new Set(['drift-doppler', 'drift-liquid', 'drift-orbit']);

type VideoPatchGlobal = typeof globalThis & { __calcotoneVideoStabilityPatch?: boolean };
const globalState = globalThis as VideoPatchGlobal;

function stableDriftUrl(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}visuals/drift.mp4`;
}

function repairViewport(viewport: Element): void {
  const mode = viewport.getAttribute('data-visual-mode');
  if (!mode || !DRIFT_STABLE_MODES.has(mode)) return;
  const video = viewport.querySelector<HTMLVideoElement>('video.module-video');
  if (!video) return;
  const current = video.getAttribute('src') ?? '';
  if (current.endsWith('visuals/drift.mp4')) return;
  video.src = stableDriftUrl();
  video.load();
  void video.play().catch(() => undefined);
}

function repairAll(): void {
  document.querySelectorAll('.module-video-viewport').forEach(repairViewport);
}

let observer: MutationObserver | null = null;

function install(): void {
  if (globalState.__calcotoneVideoStabilityPatch) return;
  globalState.__calcotoneVideoStabilityPatch = true;
  observer = new MutationObserver(repairAll);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-visual-mode'],
  });
  queueMicrotask(repairAll);
}

function uninstall(): void {
  observer?.disconnect();
  observer = null;
  delete globalState.__calcotoneVideoStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
