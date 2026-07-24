import { AudioEngine } from './audio/AudioEngine';
import {
  abortRandomProfile,
  beginRandomProfile,
  finishMusicalRandomProfile,
  noteRandomMutationWall,
} from './perf/randomProfiler';
import { applyRandomBatch } from './perf/randomBatch';

const RANDOM_PREP_MS = 72;
const RANDOM_SETTLE_MS = 18;
const SIGNAL_LOCK_MS = 90;
const RANDOM_BATCH_ORDER = ['chorus', 'bitcrusher', 'saturation', 'media', 'delay', 'reverb'] as const;

let activeEngine: AudioEngine | null = null;
let randomBusy = false;
let replayButton: HTMLButtonElement | null = null;
let signalBusyUntil = 0;
let captureEngine: AudioEngine | null = null;
let capturedParameters = new Map<string, Map<string, number>>();

// The profiler patches AudioEngine.setEffectParameter first. Keep that instrumented
// function as the normal path, but capture RANDOM's synchronous setter burst instead
// of executing all 41 mutations in one JavaScript turn.
const instrumentedSetEffectParameter = AudioEngine.prototype.setEffectParameter;
AudioEngine.prototype.setEffectParameter = function (
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
  instrumentedSetEffectParameter.call(this, effectId, parameterId, value);
};

// Keep this bridge deliberately outside React's render path. RANDOM is a bursty,
// hardware-style operation; handling its transfer envelope here avoids adding more
// component state/re-renders just to protect a short audio transition.
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
    if (captureEngine === this) {
      captureEngine = null;
      capturedParameters.clear();
    }
    abortRandomProfile();
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function beginParameterCapture(engine: AudioEngine): void {
  captureEngine = engine;
  capturedParameters = new Map<string, Map<string, number>>();
}

function finishParameterCapture(engine: AudioEngine): Map<string, Map<string, number>> {
  if (captureEngine !== engine) return new Map();
  const result = capturedParameters;
  captureEngine = null;
  capturedParameters = new Map();
  return result;
}

async function flushCapturedRandom(
  engine: AudioEngine,
  batches: Map<string, Map<string, number>>,
): Promise<void> {
  // Give rendering a scheduling boundary between module transactions. This prevents
  // Atmos/Halo network construction and Ember/Artifact curve generation from piling
  // into one 100+ ms main-thread frame.
  for (const effectId of RANDOM_BATCH_ORDER) {
    const values = batches.get(effectId);
    if (!values?.size) continue;
    if (activeEngine !== engine || engine.getState() !== 'running') return;

    await nextFrame();
    const effect = engine.getEffect(effectId);
    if (effect) applyRandomBatch(effect, values);
  }

  // Future modules not represented in the fixed rack order still get a safe batch.
  for (const [effectId, values] of batches) {
    if ((RANDOM_BATCH_ORDER as readonly string[]).includes(effectId) || !values.size) continue;
    if (activeEngine !== engine || engine.getState() !== 'running') return;
    await nextFrame();
    const effect = engine.getEffect(effectId);
    if (effect) applyRandomBatch(effect, values);
  }
}

function handleSignalRandom(button: HTMLButtonElement, event: MouseEvent): void {
  const stamp = performance.now();
  if (stamp < signalBusyUntil) {
    consumeClick(event);
    return;
  }

  // SIGNAL RANDOM already uses AudioEngine.reorderEffectsClickSafe(). The profiler
  // measures both its intentional transfer window and the synchronous graph surgery.
  if (activeEngine?.getState() === 'running') beginRandomProfile('signal');

  // Prevent repeated clicks from queueing several graph rebuilds while the first
  // click-safe reorder is still fading out/in.
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
  beginRandomProfile('musical');

  // Dry bridge: fade the old processed rack toward each effect's clean bypass path.
  // The finished random patch is then built behind that bridge one module at a time.
  for (const entry of active) engine.setEffectBypassed(entry.id, true);

  window.setTimeout(() => {
    if (activeEngine !== engine || engine.getState() !== 'running') {
      randomBusy = false;
      markBusy(button, false);
      abortRandomProfile();
      return;
    }

    replayButton = button;
    beginParameterCapture(engine);
    const planningStarted = performance.now();
    try {
      // HTMLElement.click() is synchronous. During this replay the existing RANDOM
      // logic still computes the exact same final patch and updates React state, but
      // AudioEngine parameter writes are captured instead of executed immediately.
      button.click();
    } finally {
      noteRandomMutationWall(performance.now() - planningStarted);
    }

    const batches = finishParameterCapture(engine);
    void flushCapturedRandom(engine, batches)
      .then(() => new Promise<void>((resolve) => window.setTimeout(resolve, RANDOM_SETTLE_MS)))
      .then(() => {
        if (activeEngine === engine && engine.getState() === 'running') {
          for (const entry of snapshot) {
            engine.setEffectBypassed(entry.id, entry.bypassed);
          }
        }
      })
      .catch((error) => {
        console.error('CALCOTONE RANDOM batch transfer failed.', error);
      })
      .finally(() => {
        randomBusy = false;
        markBusy(button, false);
        finishMusicalRandomProfile();
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

document.addEventListener('click', onRandomizerClick, true);
