import { AudioEngine } from './audio/AudioEngine';
import { LoopDeck } from './audio/LoopDeck';
import {
  getLoopState,
  setLoopRuntime,
  LOOP_CHANGE_EVENT,
  LOOP_COMMAND_EVENT,
  LOOP_PERFORMANCE_COMMAND_EVENT,
  type LoopCommand,
  type LoopPerformanceCommand,
} from './components/signal/loopStore';

interface EngineInternals {
  context: AudioContext | null;
  graph: { output: GainNode } | null;
  dcBlock: BiquadFilterNode | null;
  safetyClipper: WaveShaperNode | null;
  limiter: DynamicsCompressorNode | null;
  analyser: AnalyserNode | null;
  sharedVisualSpectrum: { connect(source: AudioNode): void } | null;
  outputGain: GainNode | null;
}

interface LoopPrototype {
  connectMasterChain(this: AudioEngine): void;
  start: AudioEngine['start'];
  resume: AudioEngine['resume'];
  stop: AudioEngine['stop'];
}

const enginePrototype = AudioEngine.prototype as unknown as LoopPrototype;
const originalConnectMasterChain = enginePrototype.connectMasterChain;
const originalStart = enginePrototype.start;
const originalResume = enginePrototype.resume;
const originalStop = enginePrototype.stop;
const decks = new WeakMap<AudioEngine, LoopDeck>();
let activeEngine: AudioEngine | null = null;

function connectPostRackLoop(engine: AudioEngine, loop: LoopDeck): void {
  const internal = engine as unknown as EngineInternals;
  const { graph, dcBlock, safetyClipper, limiter, analyser, sharedVisualSpectrum, outputGain } = internal;
  if (!graph || !dcBlock || !safetyClipper || !limiter || !analyser || !outputGain) return;

  try { graph.output.disconnect(); } catch { /* already disconnected */ }
  try { loop.output.disconnect(); } catch { /* already disconnected */ }
  try { dcBlock.disconnect(); } catch { /* already disconnected */ }
  try { safetyClipper.disconnect(); } catch { /* already disconnected */ }
  try { limiter.disconnect(); } catch { /* already disconnected */ }
  try { analyser.disconnect(); } catch { /* already disconnected */ }

  graph.output.connect(loop.input);
  loop.output.connect(dcBlock);
  dcBlock.connect(safetyClipper);
  safetyClipper.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(outputGain);
  sharedVisualSpectrum?.connect(analyser);
}

async function attachLoop(engine: AudioEngine): Promise<void> {
  activeEngine = engine;
  const existing = decks.get(engine);
  if (existing) {
    existing.setSettings(getLoopState());
    connectPostRackLoop(engine, existing);
    return;
  }
  const internal = engine as unknown as EngineInternals;
  if (!internal.context || !internal.graph) return;
  const loop = await LoopDeck.create(internal.context, setLoopRuntime);
  decks.set(engine, loop);
  loop.setSettings(getLoopState());
  originalConnectMasterChain.call(engine);
  connectPostRackLoop(engine, loop);
}

function detachLoop(engine: AudioEngine): void {
  const loop = decks.get(engine);
  if (loop) {
    loop.dispose();
    decks.delete(engine);
  }
  if (activeEngine === engine) activeEngine = null;
}

enginePrototype.connectMasterChain = function patchedConnectMasterChain(this: AudioEngine): void {
  originalConnectMasterChain.call(this);
  const loop = decks.get(this);
  if (loop) connectPostRackLoop(this, loop);
};

enginePrototype.start = async function patchedLoopStart(this: AudioEngine, ...args: Parameters<AudioEngine['start']>): Promise<void> {
  await originalStart.apply(this, args);
  await attachLoop(this);
};

enginePrototype.resume = async function patchedLoopResume(this: AudioEngine, ...args: Parameters<AudioEngine['resume']>): Promise<void> {
  await originalResume.apply(this, args);
  await attachLoop(this);
};

enginePrototype.stop = async function patchedLoopStop(this: AudioEngine, ...args: Parameters<AudioEngine['stop']>): Promise<void> {
  detachLoop(this);
  await originalStop.apply(this, args);
};

function onLoopChange(): void {
  if (!activeEngine) return;
  decks.get(activeEngine)?.setSettings(getLoopState());
}

function onLoopCommand(event: Event): void {
  if (!activeEngine) return;
  decks.get(activeEngine)?.command((event as CustomEvent<LoopCommand>).detail);
}

function onLoopPerformanceCommand(event: Event): void {
  if (!activeEngine) return;
  const detail = (event as CustomEvent<LoopPerformanceCommand>).detail;
  if (!detail) return;
  decks.get(activeEngine)?.command(detail.command, detail.track);
}

window.addEventListener(LOOP_CHANGE_EVENT, onLoopChange);
window.addEventListener(LOOP_COMMAND_EVENT, onLoopCommand);
window.addEventListener(LOOP_PERFORMANCE_COMMAND_EVENT, onLoopPerformanceCommand);

function uninstall(): void {
  window.removeEventListener(LOOP_CHANGE_EVENT, onLoopChange);
  window.removeEventListener(LOOP_COMMAND_EVENT, onLoopCommand);
  window.removeEventListener(LOOP_PERFORMANCE_COMMAND_EVENT, onLoopPerformanceCommand);
  if (activeEngine) {
    detachLoop(activeEngine);
    try { originalConnectMasterChain.call(activeEngine); } catch { /* engine may already be stopped */ }
  }
  enginePrototype.connectMasterChain = originalConnectMasterChain;
  enginePrototype.start = originalStart;
  enginePrototype.resume = originalResume;
  enginePrototype.stop = originalStop;
}

if (import.meta.hot) import.meta.hot.dispose(uninstall);
