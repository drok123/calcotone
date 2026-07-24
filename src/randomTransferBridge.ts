import { AudioEngine } from './audio/AudioEngine';

const RANDOM_PREP_MS = 72;
const RANDOM_SETTLE_MS = 18;
const SIGNAL_LOCK_MS = 90;

let activeEngine: AudioEngine | null = null;
let randomBusy = false;
let replayButton: HTMLButtonElement | null = null;
let signalBusyUntil = 0;

// Keep this bridge deliberately outside React's render path. RANDOM is a bursty,
// hardware-style operation; handling its transfer envelope here avoids adding more
// component state/re-renders just to protect a ~100 ms audio transition.
const originalStart = AudioEngine.prototype.start;
AudioEngine.prototype.start = async function (
  this: AudioEngine,
  ...args: Parameters<AudioEngine['start']>
): Promise<void> {
  activeEngine = this;
  await originalStart.apply(this, args);
};

const originalStop = AudioEngine.prototype.stop;
AudioEngine.prototype.stop = async function (
  this: AudioEngine,
  ...args: Parameters<AudioEngine['stop']>
): Promise<void> {
  try {
    await originalStop.apply(this, args);
  } finally {
    if (activeEngine === this) activeEngine = null;
  }
};

function consumeClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function markBusy(button: HTMLButtonElement, busy: boolean): void {
  button.classList.toggle('transfer-busy', busy);
  if (busy) {
    button.setAttribute('aria-busy', 'true');
    button.style.pointerEvents = 'none';
  } else {
    button.removeAttribute('aria-busy');
    button.style.removeProperty('pointer-events');
  }
}

function handleSignalRandom(button: HTMLButtonElement, event: MouseEvent): void {
  const now = performance.now();
  if (now < signalBusyUntil) {
    consumeClick(event);
    return;
  }

  // SIGNAL RANDOM already uses AudioEngine.reorderEffectsClickSafe(). This short
  // guard simply prevents repeated clicks from queueing several graph rebuilds while
  // the first click-safe reorder is still fading out/in.
  signalBusyUntil = now + SIGNAL_LOCK_MS;
  markBusy(button, true);
  window.setTimeout(() => markBusy(button, false), SIGNAL_LOCK_MS);
}

function handleMusicalRandom(button: HTMLButtonElement, event: MouseEvent): void {
  if (replayButton === button) {
    replayButton = null;
    return;
  }

  if (randomBusy) {
    consumeClick(event);
    return;
  }

  const engine = activeEngine;
  if (!engine || engine.getState() !== 'running') {
    // When audio is off, RANDOM only changes UI state; no transfer envelope is needed.
    return;
  }

  const snapshot = engine.getEffectOrder().map((id) => ({
    id,
    bypassed: engine.getEffect(id)?.isBypassed() ?? true,
  }));
  const active = snapshot.filter((entry) => !entry.bypassed);
  if (active.length === 0) return;

  consumeClick(event);
  randomBusy = true;
  markBusy(button, true);

  // Dry bridge: fade the old processed rack toward each effect's clean bypass path,
  // perform the existing RANDOM mutation while the wet rack is effectively hidden,
  // then fade the newly randomized rack back in. BaseEffect already owns a smooth
  // 28 ms bypass crossfade, so this adds no permanent latency and no master mute.
  for (const entry of active) engine.setEffectBypassed(entry.id, true);

  window.setTimeout(() => {
    if (activeEngine !== engine || engine.getState() !== 'running') {
      randomBusy = false;
      markBusy(button, false);
      return;
    }

    replayButton = button;
    button.click();

    window.setTimeout(() => {
      if (activeEngine === engine && engine.getState() === 'running') {
        for (const entry of snapshot) {
          engine.setEffectBypassed(entry.id, entry.bypassed);
        }
      }
      randomBusy = false;
      markBusy(button, false);
    }, RANDOM_SETTLE_MS);
  }, RANDOM_PREP_MS);
}

function onRandomizerClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('button.randomizer-toggle');
  if (!button) return;

  if (button.classList.contains('signal-randomizer-toggle')) {
    handleSignalRandom(button, event);
    return;
  }

  handleMusicalRandom(button, event);
}

document.addEventListener('click', onRandomizerClick, true);
