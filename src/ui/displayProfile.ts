export interface DisplayProfile {
  reference1440p: boolean;
  width: number;
  height: number;
  devicePixelRatio: number;
  visualFps: number;
  canvasScaleLimit: number;
}

const listeners = new Set<(profile: DisplayProfile) => void>();
let installed = false;
let profile = readDisplayProfile();
let resizeFrame = 0;

function readDisplayProfile(): DisplayProfile {
  if (typeof window === 'undefined') {
    return {
      reference1440p: false,
      width: 1920,
      height: 1080,
      devicePixelRatio: 1,
      visualFps: 30,
      canvasScaleLimit: 2,
    };
  }

  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const reference1440p = width >= 2200 && height >= 1200;
  return {
    reference1440p,
    width,
    height,
    devicePixelRatio,
    visualFps: reference1440p ? 45 : 30,
    canvasScaleLimit: reference1440p ? 2.5 : 2,
  };
}

function publishProfile(): void {
  profile = readDisplayProfile();
  const root = document.documentElement;
  root.dataset.displayProfile = profile.reference1440p ? '1440p' : 'standard';
  root.style.setProperty('--display-pixel-ratio', profile.devicePixelRatio.toFixed(3));
  root.style.setProperty('--visual-target-fps', String(profile.visualFps));
  for (const listener of listeners) listener(profile);
}

function scheduleProfileUpdate(): void {
  if (resizeFrame) return;
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    publishProfile();
  });
}

export function installDisplayProfile(): () => void {
  if (installed || typeof window === 'undefined') return () => undefined;
  installed = true;
  publishProfile();
  window.addEventListener('resize', scheduleProfileUpdate, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleProfileUpdate, { passive: true });
  return () => {
    window.removeEventListener('resize', scheduleProfileUpdate);
    window.visualViewport?.removeEventListener('resize', scheduleProfileUpdate);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    installed = false;
  };
}

export function getDisplayProfile(): DisplayProfile {
  return profile;
}

export function subscribeDisplayProfile(listener: (next: DisplayProfile) => void): () => void {
  listeners.add(listener);
  listener(profile);
  return () => listeners.delete(listener);
}

export function canvasPixelRatio(
  cssWidth: number,
  cssHeight: number,
  maximumPixels = 4_800_000,
): number {
  const current = getDisplayProfile();
  const desired = Math.min(current.devicePixelRatio, current.canvasScaleLimit);
  const cssPixels = Math.max(1, cssWidth * cssHeight);
  const budgetScale = Math.sqrt(maximumPixels / cssPixels);
  return Math.max(1, Math.min(desired, budgetScale));
}
