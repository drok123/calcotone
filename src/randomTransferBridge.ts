import { AudioEngine } from './audio/AudioEngine';
import { beginViewportPerformanceHold } from './components/effects/viewportScheduler';
import {
  beginRandomCapture,
  finishRandomCapture,
  installRandomCapture,
  uninstallRandomCapture,
} from './features/random/randomCapture';
import { flushCapturedRandom } from './features/random/randomDspScheduler';
import { getActiveRailCRandomModuleIds } from './features/random/railCRandomRegistry';
import {
  completeRandomUiFlow,
  revealRandomUiModule,
} from './features/random/randomUiFlow';

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

function markTransactionBusy(button: HTMLButtonElement, busy: boolean): void {
  button.classList.toggle('transfer-busy', busy);
  if (busy) {
    button.setAttribute('aria-busy', 'true');
    button.style.pointerEvents = 'none';
  } else {
    button.removeAttribute('aria-busy');
    button.style.removeProperty('pointer-events');
  }
}

function markPlanningHold(busy: boolean): void {
  document.documentElement.classList.toggle('random-morphing', busy);
  document.documentElement.classList.toggle('random-hard-hold', busy);
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
  markTransactionBusy(button, true);
  window.setTimeout(() => markTransactionBusy(button, false), SIGNAL_LOCK_MS);
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
  markTransactionBusy(button, true);
  markPlanningHold(true);
  const releaseViewportHold = beginViewportPerformanceHold();
  const releasePlanningHold = (): void => {
    markPlanningHold(false);
    releaseViewportHold();
  };

  window.setTimeout(() => {
    if (activeEngine !== engine || engine.getState() !== 'running') {
      randomBusy = false;
      markTransactionBusy(button, false);
      releasePlanningHold();
      return;
    }

    replayButton = button;
    beginRandomCapture(engine);
    let parameters: Map<string, Map<string, number>>;
    const railCModuleIds = getActiveRailCRandomModuleIds();

    try {
      // Plan the six captured effects and the active Rail C controllers in one transaction.
      // Rail C applies later, when its serialized reveal packet reaches the UI.
      button.click();
    } catch (error) {
      replayButton = null;
      console.error('CALCOTONE RANDOM planning failed.', error);
    } finally {
      parameters = finishRandomCapture(engine);
    }

    // The capture transaction is complete. Resume the screens before the first
    // module packet is revealed; DSP serialization continues independently.
    releasePlanningHold();

    let completed = true;
    void flushCapturedRandom(
      engine,
      parameters,
      () => activeEngine === engine && engine.getState() === 'running',
      revealRandomUiModule,
      railCModuleIds
    )
      .then(() => sleep(RANDOM_SETTLE_MS))
      .catch((error) => {
        completed = false;
        console.error('CALCOTONE RANDOM staged commit failed.', error);
      })
      .finally(() => {
        completeRandomUiFlow(completed);
        randomBusy = false;
        markTransactionBusy(button, false);
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
