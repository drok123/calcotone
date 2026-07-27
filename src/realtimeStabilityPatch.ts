import { AudioEngine } from './audio/AudioEngine';
import { BaseEffect } from './audio/effects/Effect';
import { syncPhysicalBehavior } from './audio/PhysicalBehaviorRegistry';
import type { BehaviorMemoryProfile } from './audio/models/BehaviorMemoryStage';

type StabilityGlobal = typeof globalThis & {
  __calcotoneRealtimeStabilityPatch?: boolean;
};

type BaseEffectPrototype = {
  setBypassed(this: BaseEffect, bypassed: boolean): void;
  configureBehavior(
    this: BaseEffect,
    profile: BehaviorMemoryProfile,
    amount: number,
    motion: number,
    memory: number,
    color: number,
  ): void;
  configureSpringHardware(
    this: BaseEffect,
    enabled: boolean,
    decay: number,
    size: number,
    color: number,
    drive: number,
  ): void;
};

type EnginePrototype = {
  start: AudioEngine['start'];
};

const globalState = globalThis as StabilityGlobal;
const effectPrototype = BaseEffect.prototype as unknown as BaseEffectPrototype;
const enginePrototype = AudioEngine.prototype as unknown as EnginePrototype;

const originalSetBypassed = effectPrototype.setBypassed;
const originalConfigureBehavior = effectPrototype.configureBehavior;
const originalConfigureSpringHardware = effectPrototype.configureSpringHardware;
const originalStart = enginePrototype.start;

/**
 * Bypassed modules must be truly DSP-dead. The physical-behavior registry can
 * still be asked to resync while a faceplate is off (preset load, dropdown
 * changes, random planning). Ignore those requests until the module is live.
 */
function guardedConfigureBehavior(
  this: BaseEffect,
  profile: BehaviorMemoryProfile,
  amount: number,
  motion: number,
  memory: number,
  color: number,
): void {
  if (this.isBypassed() && profile !== 'bypass') return;
  originalConfigureBehavior.call(this, profile, amount, motion, memory, color);
}

function guardedConfigureSpringHardware(
  this: BaseEffect,
  enabled: boolean,
  decay: number,
  size: number,
  color: number,
  drive: number,
): void {
  if (this.isBypassed() && enabled) return;
  originalConfigureSpringHardware.call(this, enabled, decay, size, color, drive);
}

function stableSetBypassed(this: BaseEffect, bypassed: boolean): void {
  if (bypassed) {
    // Tear specialty mechanisms down before the effect leaves the serial graph.
    originalConfigureSpringHardware.call(this, false, 0, 0, 0, 0);
    originalConfigureBehavior.call(this, 'bypass', 0, 0, 0, 0.5);
    originalSetBypassed.call(this, true);
    return;
  }

  originalSetBypassed.call(this, false);
  // Restore the exact current machine behavior only when the effect becomes audible.
  syncPhysicalBehavior(this);
}

/**
 * Calcotone's DSP graph is now large enough that asking browsers for their
 * smallest "interactive" buffer can underrun on otherwise capable machines.
 * Keep the exact same DSP/sample rate, but request ~20 ms of scheduling
 * headroom. Browsers are free to choose the nearest supported hardware buffer.
 */
async function stableStart(
  this: AudioEngine,
  ...args: Parameters<AudioEngine['start']>
): Promise<void> {
  const scope = globalThis as typeof globalThis & { AudioContext: typeof AudioContext };
  const NativeAudioContext = scope.AudioContext;

  class CalcotoneBufferedAudioContext extends NativeAudioContext {
    public constructor(options?: AudioContextOptions) {
      const requested = options?.latencyHint;
      super({
        ...options,
        latencyHint: requested === 'interactive' ? 0.02 : requested,
      });
    }
  }

  scope.AudioContext = CalcotoneBufferedAudioContext;
  try {
    await originalStart.apply(this, args);
  } finally {
    scope.AudioContext = NativeAudioContext;
  }
}

function install(): void {
  if (globalState.__calcotoneRealtimeStabilityPatch) return;
  globalState.__calcotoneRealtimeStabilityPatch = true;
  effectPrototype.configureBehavior = guardedConfigureBehavior;
  effectPrototype.configureSpringHardware = guardedConfigureSpringHardware;
  effectPrototype.setBypassed = stableSetBypassed;
  enginePrototype.start = stableStart;
}

function uninstall(): void {
  if (!globalState.__calcotoneRealtimeStabilityPatch) return;
  effectPrototype.configureBehavior = originalConfigureBehavior;
  effectPrototype.configureSpringHardware = originalConfigureSpringHardware;
  effectPrototype.setBypassed = originalSetBypassed;
  enginePrototype.start = originalStart;
  delete globalState.__calcotoneRealtimeStabilityPatch;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
