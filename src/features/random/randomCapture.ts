import { AudioEngine } from '../../audio/AudioEngine';

export type RandomParameterPlan = Map<string, Map<string, number>>;

type CaptureCallbacks = {
  onEngineStart?: (engine: AudioEngine) => void;
  onEngineStop?: (engine: AudioEngine) => void;
};

let captureEngine: AudioEngine | null = null;
let capturedParameters: RandomParameterPlan = new Map();
let capturedBypass = new Map<string, boolean>();
let callbacks: CaptureCallbacks = {};

const directSetEffectParameter = AudioEngine.prototype.setEffectParameter;
const directSetEffectBypassed = AudioEngine.prototype.setEffectBypassed;
const originalStart = AudioEngine.prototype.start;
const originalStop = AudioEngine.prototype.stop;

const capturedSetEffectParameter = function (
  this: AudioEngine,
  effectId: string,
  parameterId: string,
  value: number
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
  bypassed: boolean
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
  callbacks.onEngineStart?.(this);
  await originalStart.apply(this, args);
};

const trackedStop = async function (
  this: AudioEngine,
  ...args: Parameters<AudioEngine['stop']>
): Promise<void> {
  try {
    await originalStop.apply(this, args);
  } finally {
    callbacks.onEngineStop?.(this);
    if (captureEngine === this) resetCapture();
  }
};

export function installRandomCapture(nextCallbacks: CaptureCallbacks = {}): void {
  callbacks = nextCallbacks;
  AudioEngine.prototype.setEffectParameter = capturedSetEffectParameter;
  AudioEngine.prototype.setEffectBypassed = capturedSetEffectBypassed;
  AudioEngine.prototype.start = trackedStart;
  AudioEngine.prototype.stop = trackedStop;
}

export function uninstallRandomCapture(): void {
  if (AudioEngine.prototype.setEffectParameter === capturedSetEffectParameter) {
    AudioEngine.prototype.setEffectParameter = directSetEffectParameter;
  }
  if (AudioEngine.prototype.setEffectBypassed === capturedSetEffectBypassed) {
    AudioEngine.prototype.setEffectBypassed = directSetEffectBypassed;
  }
  if (AudioEngine.prototype.start === trackedStart) AudioEngine.prototype.start = originalStart;
  if (AudioEngine.prototype.stop === trackedStop) AudioEngine.prototype.stop = originalStop;
  callbacks = {};
  resetCapture();
}

export function beginRandomCapture(engine: AudioEngine): void {
  captureEngine = engine;
  capturedParameters = new Map<string, Map<string, number>>();
  capturedBypass = new Map<string, boolean>();
}

export function finishRandomCapture(engine: AudioEngine): RandomParameterPlan {
  if (captureEngine !== engine) return new Map();
  const parameters = capturedParameters;
  resetCapture();
  return parameters;
}

function resetCapture(): void {
  captureEngine = null;
  capturedParameters = new Map<string, Map<string, number>>();
  capturedBypass = new Map<string, boolean>();
}
