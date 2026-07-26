import type { Plugin } from 'vite';

function replaceRequired(source: string, before: string, after: string, label: string): string {
  if (!source.includes(before)) throw new Error(`CALCOTONE Signal Lab transform: ${label} pattern not found`);
  return source.replace(before, after);
}

export function signalLabUiTransform(): Plugin {
  return {
    name: 'calcotone-signal-lab-ui',
    enforce: 'pre',
    transform(code, id) {
      if (!/[/\\]src[/\\]App\.tsx(?:\?|$)/.test(id)) return null;
      let next = code;

      next = replaceRequired(next, `import { MotionPad } from './components/motion/MotionPad';`, `import { MotionPad } from './components/motion/MotionPad';\nimport { SignalLabPanel } from './components/signal/SignalLabPanel';\nimport { DEFAULT_SIGNAL_LAB_STATE, type SignalLabState } from './audio/SignalLab';`, 'imports');
      next = replaceRequired(next, `  const [modules, setModules] = useState<ModuleState[]>(INITIAL_MODULES);`, `  const [modules, setModules] = useState<ModuleState[]>(INITIAL_MODULES);\n  const [signalLabState, setSignalLabState] = useState<SignalLabState>({ ...DEFAULT_SIGNAL_LAB_STATE });`, 'state');
      next = replaceRequired(next, `  function getEngine(): AudioEngine {`, `  function updateSignalLab(nextState: Partial<SignalLabState>): void {\n    // UI/visual owner until Signal Lab has a native AudioEngine insert point.\n    setSignalLabState((current) => ({ ...current, ...nextState }));\n  }\n\n  function getEngine(): AudioEngine {`, 'state updater');
      next = replaceRequired(next, `              hoverAxis={patchDraft?.hoverAxis ?? null}\n              onDraggingChange={setXyDragging}`, `              hoverAxis={patchDraft?.hoverAxis ?? null}\n              signalLab={signalLabState}\n              onDraggingChange={setXyDragging}`, 'XY Signal artwork state');
      next = replaceRequired(next, `            />\n\n\n            <RecorderPanel`, `            />\n\n            <SignalLabPanel\n              state={signalLabState}\n              running={isRunning}\n              onChange={updateSignalLab}\n            />\n\n            <RecorderPanel`, 'panel placement');

      return { code: next, map: null };
    },
  };
}
