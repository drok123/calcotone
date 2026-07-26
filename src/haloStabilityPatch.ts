import { DelayEffect } from './audio/effects/Delay';

type PitchShifterLike = {
  context: AudioContext;
  timer: number | null;
  nextGrainTime: number;
  amount: number;
  disposed: boolean;
  scheduleAhead(): void;
  setPitch(semitones: number, amount: number): void;
  __calcotoneTuned?: boolean;
  __calcotoneOriginalSetPitch?: (semitones: number, amount: number) => void;
};

type DelayNetworkLike = {
  input: AudioNode;
  pitchShifters?: Array<PitchShifterLike | null>;
};

type DelayNetworkEntry = {
  network: DelayNetworkLike;
};

type HaloInternals = DelayEffect & {
  input: GainNode;
  active: DelayNetworkEntry;
  retiring: Set<DelayNetworkEntry>;
  switchAlgorithm(algorithm: string): void;
  disposeRetiringNetwork(entry: DelayNetworkEntry): void;
};

type HaloPrototype = {
  switchAlgorithm: (this: HaloInternals, algorithm: string) => void;
  disposeRetiringNetwork: (this: HaloInternals, entry: DelayNetworkEntry) => void;
};

const PITCH_SCHEDULER_MS = 72;
const PITCH_SLEEP_THRESHOLD = 0.001;
const prototype = DelayEffect.prototype as unknown as HaloPrototype;
const originalSwitchAlgorithm = prototype.switchAlgorithm;
const originalDisposeRetiringNetwork = prototype.disposeRetiringNetwork;
const installedKey = Symbol.for('calcotone.halo-stability-patch');
const globalState = globalThis as typeof globalThis & { [installedKey]?: boolean };

function stopPitchScheduler(shifter: PitchShifterLike): void {
  if (shifter.timer === null) return;
  globalThis.clearInterval(shifter.timer);
  shifter.timer = null;
}

function startPitchScheduler(shifter: PitchShifterLike): void {
  if (shifter.timer !== null || shifter.disposed || shifter.amount <= PITCH_SLEEP_THRESHOLD) return;
  // Restart from "now" instead of trying to catch up on grains that would have occurred while
  // sleeping. Catch-up loops are exactly the kind of scheduler burst that can rough up audio.
  shifter.nextGrainTime = shifter.context.currentTime + 0.02;
  shifter.timer = globalThis.setInterval(() => shifter.scheduleAhead(), PITCH_SCHEDULER_MS);
}

function tunePitchShifter(shifter: PitchShifterLike): void {
  if (shifter.__calcotoneTuned) return;
  shifter.__calcotoneTuned = true;
  const originalSetPitch = shifter.setPitch.bind(shifter);
  shifter.__calcotoneOriginalSetPitch = originalSetPitch;

  // The stock shifter wakes every 48 ms forever. Keep the generous 380 ms scheduling horizon,
  // but wake less often and sleep completely when pitch amount is effectively zero.
  stopPitchScheduler(shifter);
  shifter.setPitch = (semitones: number, amount: number): void => {
    originalSetPitch(semitones, amount);
    if (shifter.amount <= PITCH_SLEEP_THRESHOLD) stopPitchScheduler(shifter);
    else startPitchScheduler(shifter);
  };
  if (shifter.amount > PITCH_SLEEP_THRESHOLD) startPitchScheduler(shifter);
}

function tuneNetwork(entry: DelayNetworkEntry): void {
  entry.network.pitchShifters?.forEach((shifter) => {
    if (shifter) tunePitchShifter(shifter);
  });
}

function stableDisposeRetiringNetwork(this: HaloInternals, entry: DelayNetworkEntry): void {
  // Retired networks stay live-fed during their audible fade. Remove that source edge only
  // when the network is actually leaving the graph, otherwise Halo can briefly lose the
  // outgoing signal before the replacement delay has produced its first repeat.
  try { this.input.disconnect(entry.network.input); } catch { /* already detached */ }
  originalDisposeRetiringNetwork.call(this, entry);
}

function stableSwitchAlgorithm(this: HaloInternals, algorithm: string): void {
  const previous = this.active;
  originalSwitchAlgorithm.call(this, algorithm);

  // No switch happened (same algorithm), so there is nothing to repair.
  if (this.active === previous) return;
  tuneNetwork(this.active);
  if (!this.retiring.has(previous)) return;

  // DelayEffect's native switch intentionally crossfades old -> new, but historically
  // disconnected the old network's input before the fade. Re-feed it until retirement so
  // the crossfade always has two real signals rather than a dying tail versus an empty delay.
  try { this.input.connect(previous.network.input); } catch { /* connection already present */ }

  // Rapid RANDOM / dropdown changes used to allow active + two fully-running retired networks.
  // One retiring network is enough for a continuous transition and cuts worst-case Halo load.
  while (this.retiring.size > 1) {
    const oldest = this.retiring.values().next().value as DelayNetworkEntry | undefined;
    if (!oldest || oldest === previous) break;
    stableDisposeRetiringNetwork.call(this, oldest);
  }
}

function install(): void {
  if (globalState[installedKey]) return;
  globalState[installedKey] = true;
  prototype.switchAlgorithm = stableSwitchAlgorithm;
  prototype.disposeRetiringNetwork = stableDisposeRetiringNetwork;
}

function uninstall(): void {
  if (!globalState[installedKey]) return;
  prototype.switchAlgorithm = originalSwitchAlgorithm;
  prototype.disposeRetiringNetwork = originalDisposeRetiringNetwork;
  delete globalState[installedKey];
}

install();

if (import.meta.hot) {
  import.meta.hot.dispose(uninstall);
}
