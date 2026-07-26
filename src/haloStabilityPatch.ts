import { DelayEffect } from './audio/effects/Delay';

type DelayNetworkEntry = {
  network: { input: AudioNode };
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

const prototype = DelayEffect.prototype as unknown as HaloPrototype;
const originalSwitchAlgorithm = prototype.switchAlgorithm;
const originalDisposeRetiringNetwork = prototype.disposeRetiringNetwork;
const installedKey = Symbol.for('calcotone.halo-stability-patch');
const globalState = globalThis as typeof globalThis & { [installedKey]?: boolean };

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
  if (this.active === previous || !this.retiring.has(previous)) return;

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
