import { AudioEngine } from './audio/AudioEngine';
import { applyRandomBatch } from './perf/randomBatch';
import { beginViewportPerformanceHold } from './components/effects/viewportScheduler';

const RANDOM_PREP_MS = 18;
const RANDOM_MODULE_STEP_MS = 28;
const RANDOM_POWER_STEP_MS = 36;
const RANDOM_SETTLE_MS = 42;
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
  if (captureEngine !== engine) {
    return { parameters: new Map(), bypass: new Map() };
  }
  const result = { parameters: capturedParameters, bypass: capturedBypass };
  captureEngine = null;
  capturedParameters = new Map();
  capturedBypass = new Map();
  return result;
}

async function applyOneBatch(
  engine: AudioEngine,
  effectId: string,
  values: Map<string, number>,
): Promise<void> {
  if (!values.size || activeEngine !== engine || engine.getState() !== 'running') return;
  const effect = engine.getEffect(effectId);
  if (!effect) return;

  // Existing effect setters already smooth continuous controls and crossfade heavy algorithm
  // switches. Giving each module its own short time slice keeps those transitions audible and
  // prevents RANDOM from becoming one giant synchronous DSP transaction.
  applyRandomBatch(effect, values);
  await sleep(RANDOM_MODULE_STEP_MS);
}

async function flushCapturedRandom(
  engine: AudioEngine,
  batches: Map<string, Map<string, number>>,
  bypasses: Map<string, boolean>,
): Promise<void> {
  for (const effectId of RANDOM_BATCH_ORDER) {
    const values = batches.get(effectId);
    if (values) await applyOneBatch(engine, effectId, values);
  }

  for (const [effectId, values] of batches) {
    if ((RANDOM_BATCH_ORDER as readonly string[]).includes(effectId)) continue;
    await applyOneBatch(engine, effectId, values);
  }

  // Power-state changes happen last and one at a time. The currently audible patch therefore
  // morphs first; only after the new DSP values have settled do modules enter or leave the chain.
  for (const [effectId, bypassed] of bypasses) {
    if (activeEngine !== engine || engine.getState() !== 'running') return;
    const effect = engine.getEffect(effectId);
    if (!effect || effect.isBypassed() === bypassed) continue;
    directSetEffectBypassed.call(engine, effectId, bypassed);
    await sleep(RANDOM_POWER_STEP_MS);
  }
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
    let plan: {
      parameters: Map<string, Map<string, number>>;
      bypass: Map<string, boolean>;
    };

    try {
      // The UI chooses exactly the same RANDOM patch, but all engine writes are captured first.
      // Nothing audible is interrupted during planning.
      button.click();
    } catch (error) {
      replayButton = null;
      console.error('CALCOTONE RANDOM planning failed.', error);
    } finally {
      plan = finishParameterCapture(engine);
    }

    void flushCapturedRandom(engine, plan.parameters, plan.bypass)
      .then(() => sleep(RANDOM_SETTLE_MS))
      .catch((error) => {
        console.error('CALCOTONE RANDOM staged morph failed.', error);
      })
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => uninstallBridge());
}
