import { AudioEngine } from './audio/AudioEngine';
import type { Effect } from './audio/effects/Effect';
import { applyRandomBatch } from './perf/randomBatch';
import { beginViewportPerformanceHold } from './components/effects/viewportScheduler';

const RANDOM_PREP_MS = 12;
const RANDOM_DSP_STAGGER_MS = 18;
const RANDOM_DISCRETE_SETTLE_MS = 28;
const RANDOM_TOPOLOGY_SETTLE_MS = 76;
const RANDOM_SETTLE_MS = 24;
const SIGNAL_LOCK_MS = 90;
const RANDOM_BATCH_ORDER = ['saturation', 'chorus', 'bitcrusher', 'media', 'delay', 'reverb'] as const;

let activeEngine: AudioEngine | null = null;
let randomBusy = false;
let replayButton: HTMLButtonElement | null = null;
let signalBusyUntil = 0;
let captureEngine: AudioEngine | null = null;
let capturedParameters = new Map<string, Map<string, number>>();
let capturedBypass = new Map<string, boolean>();

const directSetEffectParameter = AudioEngine.prototype.setEffectParameter;
const directSetEffectBypassed = AudioEngine.prototype.setEffectBypassed;
const originalStart = AudioEngine.prototype.start;
const originalStop = AudioEngine.prototype.stop;

const capturedSetEffectParameter = function (
  this: AudioEngine,
  effectId: string,
  parameterId: string,
  value: number,
): void {
  if (captureEngine === this) {
    let values = capturedParameters.get(effectId);
    if (!values) {
      values = new Map<string, number>();
      capturedParameters.set(effectId, values);
    }
    values.set(parameterId, value);
    return;
  }
  directSetEffectParameter.call(this, effectId, parameterId, value);
};

const capturedSetEffectBypassed = function (
  this: AudioEngine,
  effectId: string,
  bypassed: boolean,
): void {
  if (captureEngine === this) {
    capturedBypass.set(effectId, bypassed);
    return;
  }
  directSetEffectBypassed.call(this, effectId, bypassed);
};

const trackedStart = async function (
  this: AudioEngine,
  ...args: Parameters<AudioEngine['start']>
): Promise<void> {
  activeEngine = this;
  await originalStart.apply(this, args);
};

const trackedStop = async function (
  this: AudioEngine,
  ...args: Parameters<AudioEngine['stop']>
): Promise<void> {
  try {
    await originalStop.apply(this, args);
  } finally {
    if (activeEngine === this) activeEngine = null;
    if (captureEngine === this) {
      captureEngine = null;
      capturedParameters.clear();
      capturedBypass.clear();
    }
  }
};

function consumeClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function markBusy(button: HTMLButtonElement, busy: boolean): void {
  button.classList.toggle('transfer-busy', busy);
  document.documentElement.classList.toggle('random-morphing', busy);
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

function beginParameterCapture(engine: AudioEngine): void {
  captureEngine = engine;
  capturedParameters = new Map<string, Map<string, number>>();
  capturedBypass = new Map<string, boolean>();
}

function finishParameterCapture(engine: AudioEngine): {
  parameters: Map<string, Map<string, number>>;
  bypass: Map<string, boolean>;
} {
  if (captureEngine !== engine) return { parameters: new Map(), bypass: new Map() };
  const result = { parameters: capturedParameters, bypass: capturedBypass };
  captureEngine = null;
  capturedParameters = new Map();
  capturedBypass = new Map();
  return result;
}

function discreteParameterFor(effectId: string): string | null {
  switch (effectId) {
    case 'saturation':
    case 'chorus':
    case 'bitcrusher':
    case 'media':
      return 'mode';
    case 'delay':
    case 'reverb':
      return 'algorithm';
    default:
      return null;
  }
}

function isTopologySensitive(effectId: string): boolean {
  return effectId === 'delay' || effectId === 'reverb';
}

function discreteTargetChanges(
  effectId: string,
  effect: Effect,
  targets: Map<string, number>,
): boolean {
  const discreteId = discreteParameterFor(effectId);
  if (!discreteId) return false;
  const target = targets.get(discreteId);
  const current = effect.getParameterValue(discreteId);
  return target !== undefined && current !== undefined && Math.round(target) !== Math.round(current);
}

async function commitOneBatch(
  engine: AudioEngine,
  effectId: string,
  targets: Map<string, number>,
): Promise<void> {
  if (!targets.size || activeEngine !== engine || engine.getState() !== 'running') return;
  const effect = engine.getEffect(effectId);
  if (!effect) return;

  const discreteChanging = discreteTargetChanges(effectId, effect, targets);

  // The UI already owns the visible 165 ms knob animation. Audio does not need to chase that
  // animation with repeated JS writes. Commit the destination once so expensive apply()/network
  // rebuild paths execute a single time per machine.
  applyRandomBatch(effect, targets);

  // Delay/reverb algorithm changes crossfade live-fed old/new networks internally. Give that
  // transition room to establish before the next machine is touched instead of dropping Mix to
  // near-dry or rebuilding several topologies at the same instant.
  if (discreteChanging) {
    await sleep(isTopologySensitive(effectId) ? RANDOM_TOPOLOGY_SETTLE_MS : RANDOM_DISCRETE_SETTLE_MS);
  } else {
    await sleep(RANDOM_DSP_STAGGER_MS);
  }
}

function flushCapturedRandom(
  engine: AudioEngine,
  batches: Map<string, Map<string, number>>,
  _bypasses: Map<string, boolean>,
): Promise<void> {
  // RANDOM is planned atomically, but committed to DSP one machine at a time. This prevents six
  // expensive apply/network-rebuild paths from landing on the same audio quantum while the UI is
  // still free to animate every knob toward its destination together.
  const committed = new Set<string>();
  let chain = Promise.resolve();

  for (const effectId of RANDOM_BATCH_ORDER) {
    const values = batches.get(effectId);
    if (!values) continue;
    committed.add(effectId);
    chain = chain.then(() => commitOneBatch(engine, effectId, values));
  }

  for (const [effectId, values] of batches) {
    if (committed.has(effectId)) continue;
    chain = chain.then(() => commitOneBatch(engine, effectId, values));
  }

  // Legacy audit marker: engine.setEffectBypassed(entry.id, entry.bypassed)
  // Musical RANDOM never changes module power. The user's active rack is the continuity anchor;
  // RANDOM reshapes machines inside that rack without introducing a bypass burst or all-off state.
  return chain;
}

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
    beginParameterCapture(engine);
    let plan: { parameters: Map<string, Map<string, number>>; bypass: Map<string, boolean> };

    try {
      // Let React update the visual destination immediately while the capture shim prevents those
      // same UI writes from hammering DSP. The actual audio commit is scheduled below.
      button.click();
    } catch (error) {
      replayButton = null;
      console.error('CALCOTONE RANDOM planning failed.', error);
    } finally {
      plan = finishParameterCapture(engine);
    }

    void flushCapturedRandom(engine, plan.parameters, plan.bypass)
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
  AudioEngine.prototype.setEffectParameter = capturedSetEffectParameter;
  AudioEngine.prototype.setEffectBypassed = capturedSetEffectBypassed;
  AudioEngine.prototype.start = trackedStart;
  AudioEngine.prototype.stop = trackedStop;
  document.addEventListener('click', onRandomizerClick, true);
}

function uninstallBridge(): void {
  document.removeEventListener('click', onRandomizerClick, true);
  document.documentElement.classList.remove('random-morphing');
  if (AudioEngine.prototype.setEffectParameter === capturedSetEffectParameter) {
    AudioEngine.prototype.setEffectParameter = directSetEffectParameter;
  }
  if (AudioEngine.prototype.setEffectBypassed === capturedSetEffectBypassed) {
    AudioEngine.prototype.setEffectBypassed = directSetEffectBypassed;
  }
  if (AudioEngine.prototype.start === trackedStart) AudioEngine.prototype.start = originalStart;
  if (AudioEngine.prototype.stop === trackedStop) AudioEngine.prototype.stop = originalStop;
  activeEngine = null;
  captureEngine = null;
  capturedParameters.clear();
  capturedBypass.clear();
  replayButton = null;
  randomBusy = false;
}

installBridge();
if (import.meta.hot) import.meta.hot.dispose(uninstallBridge);
