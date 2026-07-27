import { createRoot, type Root } from 'react-dom/client';
import { AudioEngine } from './audio/AudioEngine';
import { SignalLab } from './audio/SignalLab';
import { SignalLabPanel } from './components/signal/SignalLabPanel';
import { getPressureState, setPressureState, usePressureState } from './components/signal/pressureStore';

interface EngineInternals {
  context: AudioContext | null;
  graph: { output: GainNode } | null;
  dcBlock: BiquadFilterNode | null;
  safetyClipper: WaveShaperNode | null;
  limiter: DynamicsCompressorNode | null;
  analyser: AnalyserNode | null;
  outputGain: GainNode | null;
}

interface PressurePrototype {
  connectMasterChain(this: AudioEngine): void;
  start: AudioEngine['start'];
  resume: AudioEngine['resume'];
  stop: AudioEngine['stop'];
}

const enginePrototype = AudioEngine.prototype as unknown as PressurePrototype;
const originalConnectMasterChain = enginePrototype.connectMasterChain;
const originalStart = enginePrototype.start;
const originalResume = enginePrototype.resume;
const originalStop = enginePrototype.stop;

const processors = new WeakMap<AudioEngine, SignalLab>();
let activeEngine: AudioEngine | null = null;
let pressureRoot: Root | null = null;
let pressureHost: HTMLElement | null = null;

function PressureMount() {
  const state = usePressureState();
  const running = activeEngine?.getState() === 'running';
  return <SignalLabPanel state={state} running={running} onChange={setPressureState} />;
}

function renderPressure(): void {
  pressureRoot?.render(<PressureMount />);
}

function applyPostRackPressure(engine: AudioEngine): void {
  const pressure = processors.get(engine);
  if (!pressure || !getPressureState().enabled) return;

  const internal = engine as unknown as EngineInternals;
  const { graph, dcBlock, safetyClipper, limiter, analyser, outputGain } = internal;
  if (!graph || !dcBlock || !safetyClipper || !limiter || !analyser || !outputGain) return;

  // Pressure is a fixed post-rack insert. Master safety still follows it.
  try { graph.output.disconnect(); } catch { /* already disconnected */ }
  try { pressure.output.disconnect(); } catch { /* already disconnected */ }
  try { dcBlock.disconnect(); } catch { /* already disconnected */ }
  try { safetyClipper.disconnect(); } catch { /* already disconnected */ }
  try { limiter.disconnect(); } catch { /* already disconnected */ }
  try { analyser.disconnect(); } catch { /* already disconnected */ }

  graph.output.connect(pressure.input);
  pressure.output.connect(dcBlock);
  dcBlock.connect(safetyClipper);
  safetyClipper.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(outputGain);
}

function rebuildMasterWithPressure(engine: AudioEngine): void {
  const pressure = processors.get(engine);
  if (pressure) {
    try { pressure.output.disconnect(); } catch { /* already disconnected */ }
  }
  originalConnectMasterChain.call(engine);
  applyPostRackPressure(engine);
}

function attachPressure(engine: AudioEngine): void {
  const existing = processors.get(engine);
  if (existing) {
    activeEngine = engine;
    existing.setState(getPressureState());
    rebuildMasterWithPressure(engine);
    renderPressure();
    return;
  }

  const internal = engine as unknown as EngineInternals;
  if (!internal.context || !internal.graph) return;

  const pressure = new SignalLab(internal.context);
  pressure.setState(getPressureState());
  processors.set(engine, pressure);
  activeEngine = engine;
  rebuildMasterWithPressure(engine);
  renderPressure();
}

function detachPressure(engine: AudioEngine): void {
  const pressure = processors.get(engine);
  if (!pressure) return;

  try { pressure.output.disconnect(); } catch { /* already disconnected */ }
  pressure.dispose();
  processors.delete(engine);
  if (activeEngine === engine) activeEngine = null;
  renderPressure();
}

enginePrototype.connectMasterChain = function patchedConnectMasterChain(this: AudioEngine): void {
  const pressure = processors.get(this);
  if (pressure) {
    try { pressure.output.disconnect(); } catch { /* already disconnected */ }
  }
  originalConnectMasterChain.call(this);
  applyPostRackPressure(this);
};

enginePrototype.start = async function patchedPressureStart(
  this: AudioEngine,
  ...args: Parameters<AudioEngine['start']>
): Promise<void> {
  await originalStart.apply(this, args);
  attachPressure(this);
};

enginePrototype.resume = async function patchedPressureResume(
  this: AudioEngine,
  ...args: Parameters<AudioEngine['resume']>
): Promise<void> {
  await originalResume.apply(this, args);
  attachPressure(this);
};

enginePrototype.stop = async function patchedPressureStop(
  this: AudioEngine,
  ...args: Parameters<AudioEngine['stop']>
): Promise<void> {
  detachPressure(this);
  await originalStop.apply(this, args);
};

function mountPressurePanel(): void {
  if (document.querySelector('.pressure-panel')) return;
  const modules = document.querySelector<HTMLElement>('.modules-section');
  if (!modules || pressureHost?.isConnected) return;

  const host = document.createElement('div');
  host.className = 'pressure-host';
  host.setAttribute('data-pressure-host', 'true');
  const grid = modules.querySelector('.module-grid');
  modules.insertBefore(host, grid ?? modules.firstChild);
  pressureHost = host;
  pressureRoot = createRoot(host);
  renderPressure();
}

function onPressureChange(event: Event): void {
  const detail = (event as CustomEvent<ReturnType<typeof getPressureState>>).detail;
  if (activeEngine) {
    const pressure = processors.get(activeEngine);
    pressure?.setState(detail ?? getPressureState());
    rebuildMasterWithPressure(activeEngine);
  }
  renderPressure();
}

function install(): void {
  window.addEventListener('calcotone:pressure-change', onPressureChange);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPressurePanel, { once: true });
  else mountPressurePanel();

  const observer = new MutationObserver(() => mountPressurePanel());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  (window as Window & { __calcotonePressureObserver?: MutationObserver }).__calcotonePressureObserver = observer;
}

function uninstall(): void {
  window.removeEventListener('calcotone:pressure-change', onPressureChange);
  (window as Window & { __calcotonePressureObserver?: MutationObserver }).__calcotonePressureObserver?.disconnect();

  if (activeEngine) {
    detachPressure(activeEngine);
    try { originalConnectMasterChain.call(activeEngine); } catch { /* engine may already be stopped */ }
  }

  enginePrototype.connectMasterChain = originalConnectMasterChain;
  enginePrototype.start = originalStart;
  enginePrototype.resume = originalResume;
  enginePrototype.stop = originalStop;

  pressureRoot?.unmount();
  pressureRoot = null;
  pressureHost?.remove();
  pressureHost = null;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
