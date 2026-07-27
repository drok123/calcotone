const ROOT_HOLD_CLASS = 'random-hard-hold';

type HeldVideo = {
  video: HTMLVideoElement;
  shouldResume: boolean;
};

let heldVideos: HeldVideo[] = [];
let held = false;
let observer: MutationObserver | null = null;

function enterHold(): void {
  if (held) return;
  held = true;

  heldVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video.temporal-video-source')).map((video) => {
    const shouldResume = !video.paused && !video.ended;
    if (shouldResume) video.pause();
    return { video, shouldResume };
  });

  // The viewport scheduler already stops its registered renderers during RANDOM.
  // Shrinking the two independent canvas families prevents their own RAF loops from
  // spending meaningful compositor/GPU time while DSP modes and graphs are changing.
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.temporal-video-canvas, .spectrum-screen canvas')) {
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.randomHeld = 'true';
  }
}

function exitHold(): void {
  if (!held) return;
  held = false;

  for (const { video, shouldResume } of heldVideos) {
    if (!video.isConnected || !shouldResume) continue;
    void video.play().catch(() => undefined);
  }
  heldVideos = [];

  // Components own their actual backing-store size. A resize event lets their normal
  // resize logic restore full resolution on the first calm frame after RANDOM.
  window.dispatchEvent(new Event('resize'));
  requestAnimationFrame(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-random-held="true"]')) {
      delete canvas.dataset.randomHeld;
    }
  });
}

function syncHoldState(): void {
  if (document.documentElement.classList.contains(ROOT_HOLD_CLASS)) enterHold();
  else exitHold();
}

function install(): void {
  observer = new MutationObserver(syncHoldState);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  syncHoldState();
}

function uninstall(): void {
  observer?.disconnect();
  observer = null;
  document.documentElement.classList.remove(ROOT_HOLD_CLASS);
  exitHold();
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
