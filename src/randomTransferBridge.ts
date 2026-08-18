import { AudioEngine } from './audio/AudioEngine';
import { beginViewportPerformanceHold } from './components/effects/viewportScheduler';
import {
  beginRandomCapture,
  finishRandomCapture,
  installRandomCapture,
  uninstallRandomCapture,
} from './features/random/randomCapture';
import { flushCapturedRandom } from './features/random/randomDspScheduler';
import {
  CORE_RANDOM_MODULE_IDS,
  isCoreRandomModuleId,
  randomizeCoreModule,
} from './features/random/coreRandomRegistry';
import {
  RAIL_C_RANDOM_ORDER,
  getActiveRailCRandomModuleIds,
  randomizeRailCModule,
  type RailCRandomModuleId,
} from './features/random/railCRandomRegistry';
import type { RandomizationProfile } from './features/random/randomProfiles';
import {
  completeRandomUiFlow,
  revealRandomUiModule,
} from './features/random/randomUiFlow';

const RANDOM_PREP_MS = 12;
const RANDOM_SETTLE_MS = 24;
const SIGNAL_LOCK_MS = 90;
const RANDOM_DRAG_MIME = 'application/x-calcotone-random-profile';
const RANDOM_DRAG_CLICK_SUPPRESS_MS = 180;
const RANDOM_PROFILES = new Set<RandomizationProfile>([
  'smart',
  'bass',
  'pad',
  'lead',
  'retro-ambient',
  'lofi-tape',
  'gritty-drive',
  'mutate',
]);

let activeEngine: AudioEngine | null = null;
let randomBusy = false;
let replayButton: HTMLButtonElement | null = null;
let signalBusyUntil = 0;
let suppressRandomClickUntil = 0;
let activeRandomDropTarget: HTMLElement | null = null;
let randomButtonObserver: MutationObserver | null = null;

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

function decorateRandomButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>('button.randomizer-toggle:not(.signal-randomizer-toggle)')
    .forEach((button) => {
      button.draggable = true;
      button.dataset.randomDragSource = 'true';
    });
}

function selectedRandomProfile(button: HTMLButtonElement): RandomizationProfile {
  if (button.classList.contains('mutate-randomizer-toggle')) return 'mutate';
  const selector = document.querySelector<HTMLSelectElement>('select[aria-label="Randomization profile"]');
  const candidate = selector?.value as RandomizationProfile | undefined;
  return candidate && RANDOM_PROFILES.has(candidate) ? candidate : 'smart';
}

function randomProfileFromTransfer(event: DragEvent): RandomizationProfile | null {
  const value = event.dataTransfer?.getData(RANDOM_DRAG_MIME) as RandomizationProfile | undefined;
  return value && RANDOM_PROFILES.has(value) ? value : null;
}

function hasRandomTransfer(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(RANDOM_DRAG_MIME);
}

function moduleIdFromElement(element: HTMLElement): string | null {
  for (const moduleId of CORE_RANDOM_MODULE_IDS) {
    if (element.classList.contains(`module-${moduleId}`)) return moduleId;
  }
  for (const moduleId of RAIL_C_RANDOM_ORDER) {
    if (element.classList.contains(`module-${moduleId}`)) return moduleId;
  }
  return null;
}

function clearRandomDropTarget(): void {
  activeRandomDropTarget?.classList.remove('random-drop-target');
  activeRandomDropTarget = null;
}

function setRandomDropTarget(target: HTMLElement): void {
  if (activeRandomDropTarget === target) return;
  clearRandomDropTarget();
  activeRandomDropTarget = target;
  target.classList.add('random-drop-target');
}

function flashRandomDropResult(target: HTMLElement, accepted: boolean): void {
  const className = accepted ? 'random-drop-hit' : 'random-drop-rejected';
  target.classList.remove('random-drop-hit', 'random-drop-rejected');
  target.classList.add(className);
  window.setTimeout(() => target.classList.remove(className), 360);
}

function onRandomDragStart(event: DragEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('button.randomizer-toggle:not(.signal-randomizer-toggle)');
  if (!button || !event.dataTransfer) return;
  const profile = selectedRandomProfile(button);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(RANDOM_DRAG_MIME, profile);
  event.dataTransfer.setData('text/plain', profile === 'mutate' ? 'CALCOTONE MUTATE 10%' : `CALCOTONE RANDOM ${profile}`);
  document.documentElement.classList.add('random-dragging');
  suppressRandomClickUntil = performance.now() + RANDOM_DRAG_CLICK_SUPPRESS_MS;
}

function onRandomDragOver(event: DragEvent): void {
  if (!hasRandomTransfer(event)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const moduleElement = target.closest<HTMLElement>('.effect-module');
  if (!moduleElement || !moduleIdFromElement(moduleElement)) {
    clearRandomDropTarget();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  setRandomDropTarget(moduleElement);
}

function onRandomDrop(event: DragEvent): void {
  if (!hasRandomTransfer(event)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const moduleElement = target.closest<HTMLElement>('.effect-module');
  const moduleId = moduleElement ? moduleIdFromElement(moduleElement) : null;
  const profile = randomProfileFromTransfer(event);
  if (!moduleElement || !moduleId || !profile) {
    clearRandomDropTarget();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  suppressRandomClickUntil = performance.now() + RANDOM_DRAG_CLICK_SUPPRESS_MS;

  let result: string | null = null;
  if (isCoreRandomModuleId(moduleId)) {
    result = randomizeCoreModule(moduleId, profile);
  } else if (RAIL_C_RANDOM_ORDER.includes(moduleId as RailCRandomModuleId)) {
    result = randomizeRailCModule(moduleId as RailCRandomModuleId, profile);
  }
  clearRandomDropTarget();
  flashRandomDropResult(moduleElement, result !== null);
}

function onRandomDragEnd(): void {
  suppressRandomClickUntil = performance.now() + RANDOM_DRAG_CLICK_SUPPRESS_MS;
  document.documentElement.classList.remove('random-dragging');
  clearRandomDropTarget();
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
  if (performance.now() < suppressRandomClickUntil) {
    consumeClick(event);
    return;
  }
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
  decorateRandomButtons();
  randomButtonObserver = new MutationObserver(() => decorateRandomButtons());
  randomButtonObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onRandomizerClick, true);
  document.addEventListener('dragstart', onRandomDragStart, true);
  document.addEventListener('dragover', onRandomDragOver, true);
  document.addEventListener('drop', onRandomDrop, true);
  document.addEventListener('dragend', onRandomDragEnd, true);
}

function uninstallBridge(): void {
  document.removeEventListener('click', onRandomizerClick, true);
  document.removeEventListener('dragstart', onRandomDragStart, true);
  document.removeEventListener('dragover', onRandomDragOver, true);
  document.removeEventListener('drop', onRandomDrop, true);
  document.removeEventListener('dragend', onRandomDragEnd, true);
  randomButtonObserver?.disconnect();
  randomButtonObserver = null;
  clearRandomDropTarget();
  document.documentElement.classList.remove('random-morphing', 'random-hard-hold', 'random-dragging');
  uninstallRandomCapture();
  activeEngine = null;
  replayButton = null;
  randomBusy = false;
}

installBridge();
if (import.meta.hot) import.meta.hot.dispose(uninstallBridge);
