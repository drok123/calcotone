import { AudioEngine } from './audio/AudioEngine';
import { DEFAULT_SIGNAL_LAB_STATE, SignalLab, type SignalLabState } from './audio/SignalLab';

declare module './audio/AudioEngine' {
  interface AudioEngine {
    setSignalLabState(next: Partial<SignalLabState>): void;
    getSignalLabState(): SignalLabState;
  }
}

type EngineInternals = {
  context: AudioContext | null;
  graph: { input: GainNode; output: GainNode } | null;
  inputGain: GainNode | null;
  dcBlock: BiquadFilterNode | null;
  safetyClipper: WaveShaperNode | null;
  limiter: DynamicsCompressorNode | null;
  analyser: AnalyserNode | null;
  outputGain: GainNode | null;
  effects: Map<string, { isBypassed(): boolean }>;
};

type EnginePrototype = {
  start: AudioEngine['start'];
  stop: AudioEngine['stop'];
  connectMasterChain: () => void;
  hasActiveProcessing: () => boolean;
  setSignalLabState?: AudioEngine['setSignalLabState'];
  getSignalLabState?: AudioEngine['getSignalLabState'];
};

type Runtime = {
  lab: SignalLab;
  state: SignalLabState;
};

type PatchGlobal = typeof globalThis & { __calcotoneSignalLabBridge?: boolean };

const runtimes = new WeakMap<AudioEngine, Runtime>();
const prototype = AudioEngine.prototype as unknown as EnginePrototype;
const originalStart = prototype.start;
const originalStop = prototype.stop;
const originalConnectMasterChain = prototype.connectMasterChain;
const originalHasActiveProcessing = prototype.hasActiveProcessing;
const globalState = globalThis as PatchGlobal;

function internals(engine: AudioEngine): EngineInternals {
  return engine as unknown as EngineInternals;
}

function runtimeFor(engine: AudioEngine): Runtime | undefined {
  return runtimes.get(engine);
}

function rebuildInputRoute(engine: AudioEngine): void {
  const internal = internals(engine);
  const runtime = runtimeFor(engine);
  if (!internal.inputGain || !internal.graph || !runtime) return;

  try { internal.inputGain.disconnect(); } catch { /* no edge */ }
  try { runtime.lab.output.disconnect(); } catch { /* no edge */ }

  if (runtime.state.position === 'pre') {
    internal.inputGain.connect(runtime.lab.input);
    runtime.lab.output.connect(internal.graph.input);
  } else {
    internal.inputGain.connect(internal.graph.input);
  }
}

function stableHasActiveProcessing(this: AudioEngine): boolean {
  return originalHasActiveProcessing.call(this) || Boolean(runtimeFor(this)?.state.enabled);
}

function stableConnectMasterChain(this: AudioEngine): void {
  const internal = internals(this);
  const runtime = runtimeFor(this);
  if (!runtime || !internal.graph || !internal.dcBlock || !internal.safetyClipper || !internal.limiter || !internal.analyser || !internal.outputGain) {
    originalConnectMasterChain.call(this);
    return;
  }

  try { internal.graph.output.disconnect(); } catch { /* no edge */ }
  try { runtime.lab.output.disconnect(); } catch { /* no edge */ }
  try { internal.dcBlock.disconnect(); } catch { /* no edge */ }
  try { internal.safetyClipper.disconnect(); } catch { /* no edge */ }
  try { internal.limiter.disconnect(); } catch { /* no edge */ }
  try { internal.analyser.disconnect(); } catch { /* no edge */ }

  if (!stableHasActiveProcessing.call(this)) {
    internal.graph.output.connect(internal.analyser);
    internal.analyser.connect(internal.outputGain);
    return;
  }

  if (runtime.state.position === 'post') {
    internal.graph.output.connect(runtime.lab.input);
    runtime.lab.output.connect(internal.dcBlock);
  } else {
    internal.graph.output.connect(internal.dcBlock);
  }
  internal.dcBlock.connect(internal.safetyClipper);
  internal.safetyClipper.connect(internal.limiter);
  internal.limiter.connect(internal.analyser);
  internal.analyser.connect(internal.outputGain);
}

async function stableStart(this: AudioEngine, options?: Parameters<AudioEngine['start']>[0]): Promise<void> {
  await originalStart.call(this, options);
  const context = this.getContext();
  if (!context) return;

  const existing = runtimeFor(this);
  existing?.lab.dispose();
  const lab = new SignalLab(context);
  const state = existing?.state ?? { ...DEFAULT_SIGNAL_LAB_STATE };
  lab.setState(state);
  runtimes.set(this, { lab, state });
  rebuildInputRoute(this);
  stableConnectMasterChain.call(this);
}

async function stableStop(this: AudioEngine): Promise<void> {
  const runtime = runtimeFor(this);
  if (runtime) {
    runtime.lab.dispose();
    runtimes.delete(this);
  }
  await originalStop.call(this);
}

function setSignalLabState(this: AudioEngine, next: Partial<SignalLabState>): void {
  const runtime = runtimeFor(this);
  if (!runtime) return;
  const previousPosition = runtime.state.position;
  runtime.state = { ...runtime.state, ...next };
  runtime.lab.setState(next);
  if (runtime.state.position !== previousPosition) rebuildInputRoute(this);
  stableConnectMasterChain.call(this);
}

function getSignalLabState(this: AudioEngine): SignalLabState {
  return { ...(runtimeFor(this)?.state ?? DEFAULT_SIGNAL_LAB_STATE) };
}

function install(): void {
  if (globalState.__calcotoneSignalLabBridge) return;
  globalState.__calcotoneSignalLabBridge = true;
  prototype.start = stableStart;
  prototype.stop = stableStop;
  prototype.connectMasterChain = stableConnectMasterChain;
  prototype.hasActiveProcessing = stableHasActiveProcessing;
  prototype.setSignalLabState = setSignalLabState;
  prototype.getSignalLabState = getSignalLabState;
}

function uninstall(): void {
  if (!globalState.__calcotoneSignalLabBridge) return;
  prototype.start = originalStart;
  prototype.stop = originalStop;
  prototype.connectMasterChain = originalConnectMasterChain;
  prototype.hasActiveProcessing = originalHasActiveProcessing;
  delete prototype.setSignalLabState;
  delete prototype.getSignalLabState;
  delete globalState.__calcotoneSignalLabBridge;
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
