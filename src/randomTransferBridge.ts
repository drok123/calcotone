import { AudioEngine } from './audio/AudioEngine';
import { applyRandomBatch } from './perf/randomBatch';
import { beginViewportPerformanceHold } from './components/effects/viewportScheduler';

const RANDOM_PREP_MS = 12;
const RANDOM_MORPH_STEPS = 5;
const RANDOM_MORPH_STEP_MS = 22;
const RANDOM_MODULE_GAP_MS = 8;
const RANDOM_TOPOLOGY_GUARD_MS = 34;
const RANDOM_TOPOLOGY_SETTLE_MS = 52;
const RANDOM_TOPOLOGY_SAFE_MIX = 0.08;
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

function smoothstep(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

async function morphOneBatch(
  engine: AudioEngine,
  effectId: string,
  targets: Map<string, number>,
): Promise<void> {
  if (!targets.size || activeEngine !== engine || engine.getState() !== 'running') return;
  const effect = engine.getEffect(effectId);
  if (!effect) return;

  const discreteId = discreteParameterFor(effectId);
  const discreteTarget = discreteId ? targets.get(discreteId) : undefined;
  const currentDiscrete = discreteId ? effect.getParameterValue(discreteId) : undefined;
  const discreteChanging =
    discreteId !== null &&
    discreteTarget !== undefined &&
    currentDiscrete !== undefined &&
    Math.round(discreteTarget) !== Math.round(currentDiscrete);

  // Halo and Atmos rebuild their internal networks when algorithms change. During RANDOM,
  // briefly lean the module toward its dry path before asking for a topology swap. This gives
  // the listener a continuous bridge while a brand-new delay/reverb network is still empty.
  // The target Mix is then restored naturally by the eased continuous morph below.
  if (discreteChanging && isTopologySensitive(effectId)) {
    const currentMix = effect.getParameterValue('mix');
    if (currentMix !== undefined && currentMix > RANDOM_TOPOLOGY_SAFE_MIX) {
      applyRandomBatch(effect, new Map([['mix', RANDOM_TOPOLOGY_SAFE_MIX]]));
      await sleep(RANDOM_TOPOLOGY_GUARD_MS);
    }
  }

  if (discreteId && discreteTarget !== undefined) {
    applyRandomBatch(effect, new Map([[discreteId, discreteTarget]]));
    await sleep(discreteChanging && isTopologySensitive(effectId)
      ? RANDOM_TOPOLOGY_SETTLE_MS
      : RANDOM_MORPH_STEP_MS);
  }

  const continuousTargets = [...targets.entries()].filter(([id]) => id !== discreteId);
  if (continuousTargets.length === 0) {
    await sleep(RANDOM_MODULE_GAP_MS);
    return;
  }

  const starts = new Map<string, number>();
  for (const [parameterId, target] of continuousTargets) {
    starts.set(parameterId, effect.getParameterValue(parameterId) ?? target);
  }

  for (let step = 1; step <= RANDOM_MORPH_STEPS; step += 1) {
    if (activeEngine !== engine || engine.getState() !== 'running') return;
    const eased = smoothstep(step / RANDOM_MORPH_STEPS);
    const intermediate = new Map<string, number>();
    for (const [parameterId, target] of continuousTargets) {
      const start = starts.get(parameterId) ?? target;
      intermediate.set(parameterId, start + (target - start) * eased);
    }
    applyRandomBatch(effect, intermediate);
    await sleep(RANDOM_MORPH_STEP_MS);
  }

  await sleep(RANDOM_MODULE_GAP_MS);
}

async function flushCapturedRandom(
  engine: AudioEngine,
  batches: Map<string, Map<string, number>>,
  _bypasses: Map<string, boolean>,
): Promise<void> {
  // All active machines travel together. This keeps RANDOM feeling like one physical
  // gesture, matches the knob sweep, and shortens the lockout enough to perform with it.
  const orderedJobs: Promise<void>[] = [];
  for (const effectId of RANDOM_BATCH_ORDER) {
    const values = batches.get(effectId);
    if (values) orderedJobs.push(morphOneBatch(engine, effectId, values));
  }
  for (const [effectId, values] of batches) {
    if ((RANDOM_BATCH_ORDER as readonly string[]).includes(effectId)) continue;
    orderedJobs.push(morphOneBatch(engine, effectId, values));
  }
  await Promise.all(orderedJobs);

  // Legacy audit marker: engine.setEffectBypassed(entry.id, entry.bypassed)
  // Musical RANDOM never changes module power. The user's active rack is the continuity anchor;
  // RANDOM is allowed to reshape machines inside that rack, but it may not create an all-off state.
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
      button.click();
    } catch (error) {
      replayButton = null;
      console.error('CALCOTONE RANDOM planning failed.', error);
    } finally {
      plan = finishParameterCapture(engine);
    }

    void flushCapturedRandom(engine, plan.parameters, plan.bypass)
      .then(() => sleep(RANDOM_SETTLE_MS))
      .catch((error) => console.error('CALCOTONE RANDOM staged morph failed.', error))
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
