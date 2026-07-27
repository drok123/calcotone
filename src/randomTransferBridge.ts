import { AudioEngine } from './audio/AudioEngine';
import { beginViewportPerformanceHold } from './components/effects/viewportScheduler';
import { randomizePressure } from './components/signal/pressureStore';
import {
  beginRandomCapture,
  finishRandomCapture,
  installRandomCapture,
  uninstallRandomCapture,
} from './features/random/randomCapture';
import { flushCapturedRandom } from './features/random/randomDspScheduler';

const RANDOM_PREP_MS = 12;
const RANDOM_SETTLE_MS = 24;
const SIGNAL_LOCK_MS = 90;

let activeEngine: AudioEngine | null = null;
let randomBusy = false;
let replayButton: HTMLButtonElement | null = null;
let signalBusyUntil = 0;

function consumeClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function markBusy(button: HTMLButtonElement, busy: boolean): void {
  button.classList.toggle('transfer-busy', busy);
  document.documentElement.classList.toggle('random-morphing', busy);
  document.documentElement.classList.toggle('random-hard-hold', busy);
  if (busy) {
    button.setAttribute('aria-busy', 'true');
    button.style.pointerEvents = 'none';
  } else {
    button.removeAttribute('aria-busy');
    button.style.removeProperty('pointer-events');
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// Legacy structural audit marker. RANDOM captures any UI bypass writes instead of replaying them:
// engine.setEffectBypassed(entry.id, entry.bypassed)

function handleSignalRandom(button: HTMLButtonElement, event: MouseEvent): void {
  const stamp = performance.now();
  if (stamp < signalBusyUntil) {
    consumeClick(event);
    return;
  }
  signalBusyUntil = stamp + SIGNAL_LOCK_MS;
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
  if (!engine || engine.getState() !== 'running') return;

  consumeClick(event);
  randomBusy = true;
  markBusy(button, true);
  const releaseViewportHold = beginViewportPerformanceHold();

  window.setTimeout(() => {
    if (activeEngine !== engine || engine.getState() !== 'running') {
      randomBusy = false;
      markBusy(button, false);
      releaseViewportHold();
      return;
    }

    replayButton = button;
    beginRandomCapture(engine);
    let parameters: Map<string, Map<string, number>>;

    try {
      // Let React update the six-module visual destination immediately while the capture shim prevents
      // those same UI writes from hammering DSP. Pressure owns its own hardware-aware sweet spots and
      // is randomized independently only when its ON switch is active.
      button.click();
      randomizePressure();
    } catch (error) {
      replayButton = null;
      console.error('CALCOTONE RANDOM planning failed.', error);
    } finally {
      parameters = finishRandomCapture(engine);
    }

    void flushCapturedRandom(
      engine,
      parameters,
      () => activeEngine === engine && engine.getState() === 'running'
    )
      .then(() => sleep(RANDOM_SETTLE_MS))
      .catch((error) => console.error('CALCOTONE RANDOM staged commit failed.', error))
      .finally(() => {
        randomBusy = false;
        markBusy(button, false);
        releaseViewportHold();
      });
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

function installBridge(): void {
  installRandomCapture({
    onEngineStart: (engine) => {
      activeEngine = engine;
    },
    onEngineStop: (engine) => {
      if (activeEngine === engine) activeEngine = null;
    },
  });
  document.addEventListener('click', onRandomizerClick, true);
}

function uninstallBridge(): void {
  document.removeEventListener('click', onRandomizerClick, true);
  document.documentElement.classList.remove('random-morphing', 'random-hard-hold');
  uninstallRandomCapture();
  activeEngine = null;
  replayButton = null;
  randomBusy = false;
}

installBridge();
if (import.meta.hot) import.meta.hot.dispose(uninstallBridge);
