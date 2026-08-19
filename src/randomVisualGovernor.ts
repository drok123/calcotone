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

  // Keep the last valid visual frame intact during RANDOM. The transfer bridge owns
  // the shared viewport scheduler hold; this governor only pauses decoder work and
  // marks the held canvases. Do not resize or clear backing stores here: doing so can
  // strand a renderer at 1x1 after RANDOM and leave a module window blank or white.
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.temporal-video-canvas, .spectrum-screen canvas')) {
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

  // Preserve each component's existing backing-store dimensions and simply let its normal
  // RAF/video-frame loop continue from the last good frame on the next animation frame.
  requestAnimationFrame(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-random-held="true"]')) {
      delete canvas.dataset.randomHeld;
    }
    window.dispatchEvent(new Event('resize'));
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
