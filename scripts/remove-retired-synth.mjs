import fs from 'node:fs';

function replaceIfPresent(source, pattern, replacement) {
  return source.replace(pattern, replacement);
}

function readNormalized(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function assertAbsent(source, needles, label) {
  const remaining = needles.filter((needle) => source.includes(needle));
  if (remaining.length) {
    throw new Error(`${label} cleanup incomplete: ${remaining.join(', ')}`);
  }
}

const appPath = 'src/App.tsx';
let app = readNormalized(appPath);

app = replaceIfPresent(
  app,
  /import type \{\n  SynthArchetype,\n  SynthMachine,\n  SynthSequencerState,\n  SynthSequencerStep,\n\} from '\.\/audio\/SynthEngine';\n/,
  '',
);
app = replaceIfPresent(app, /\s*type PointerEvent as ReactPointerEvent,\n/, '\n');

app = replaceIfPresent(
  app,
  /  const setSynthEnabled = useCallback\([\s\S]*?\n  const setStompEnabled = useCallback/,
  '  const setStompEnabled = useCallback',
);

for (const prop of [
  'onSynthEnabledChange={setSynthEnabled}',
  'onSynthMachineChange={setSynthMachine}',
  'onSynthArchetypeChange={setSynthArchetype}',
  'onSynthParametersChange={setSynthParameters}',
  'onSynthTriggerNote={triggerSynthNote}',
  'onSynthSequencerChange={setSynthSequencerState}',
  'onSynthSequencerStepListenerChange={setSynthSequencerStepListener}',
]) {
  app = replaceIfPresent(
    app,
    new RegExp(`\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`),
    '\n',
  );
}

app = replaceIfPresent(
  app,
  /\s*motionPadProps=\{\{[\s\S]*?\n\s*\}\}\n\s*\{\.\.\.routingProps\}/,
  '\n                            {...routingProps}',
);
app = replaceIfPresent(app, /\n  const \[xyDragging, setXyDragging\] = useState\(false\);/, '');
app = replaceIfPresent(
  app,
  /const \[xyPosition, setXyPosition\] = useState\(\{ x: 50, y: 50 \}\);/,
  'const [xyPosition] = useState({ x: 50, y: 50 });',
);
app = replaceIfPresent(
  app,
  /\n  function handleXYPad\([\s\S]*?\n  \}\n\n  function applyXYAssignments/,
  '\n  function applyXYAssignments',
);
app = replaceIfPresent(
  app,
  /\n  function updateMotionRoute\([\s\S]*?\n  \}\n\n  function refreshPersistentPatchLines/,
  '\n  function refreshPersistentPatchLines',
);

assertAbsent(app, [
  "from './audio/SynthEngine'",
  'ReactPointerEvent',
  'onSynthEnabledChange=',
  'onSynthMachineChange=',
  'onSynthArchetypeChange=',
  'onSynthParametersChange=',
  'onSynthTriggerNote=',
  'onSynthSequencerChange=',
  'onSynthSequencerStepListenerChange=',
  'motionPadProps={{',
  'xyDragging, setXyDragging',
  'setXyPosition',
  'function handleXYPad(',
  'function updateMotionRoute(',
], 'App retired UI');
write(appPath, app);

const railPath = 'src/components/effects/RailCModules.tsx';
let rail = readNormalized(railPath);

rail = replaceIfPresent(
  rail,
  /import type \{\n  SynthArchetype,\n  SynthMachine,\n  SynthSequencerNote,\n  SynthSequencerState,\n  SynthSequencerStep,\n\} from '\.\.\/\.\.\/audio\/SynthEngine';\n/,
  '',
);
rail = replaceIfPresent(rail, /import type \{ MotionPadProps \} from '\.\.\/motion\/MotionPad';\n/, '');
rail = replaceIfPresent(rail, /import \{ MotionPad \} from '\.\.\/motion\/MotionPad';\n/, '');
rail = replaceIfPresent(rail, /\s*type WheelEvent as ReactWheelEvent,\n/, '\n');
rail = replaceIfPresent(rail, /\s*RANDOM_MORPH_SECONDS,\n/, '\n');

rail = replaceIfPresent(
  rail,
  /const SYNTH_MACHINES:[\s\S]*?\nexport const STOMP_MODE_LABELS = \[/,
  'export const STOMP_MODE_LABELS = [',
);

for (const name of [
  'onSynthEnabledChange',
  'onSynthMachineChange',
  'onSynthArchetypeChange',
  'onSynthParametersChange',
  'onSynthTriggerNote',
  'onSynthSequencerChange',
  'onSynthSequencerStepListenerChange',
]) {
  rail = replaceIfPresent(rail, new RegExp(`\\n  ${name},`), '');
}

rail = replaceIfPresent(
  rail,
  /  onSynthEnabledChange: \(enabled: boolean\) => void;\n  onSynthMachineChange: \(machine: SynthMachine\) => void;\n  onSynthArchetypeChange: \(archetype: SynthArchetype\) => void;\n  onSynthParametersChange: \(values: readonly number\[\], morphSeconds\?: number\) => void;\n  onSynthTriggerNote: \(midi: number, durationSeconds: number\) => void;\n  onSynthSequencerChange: \(state: SynthSequencerState\) => void;\n  onSynthSequencerStepListenerChange: \(\n    listener: \(\(position: SynthSequencerStep\) => void\) \| null\n  \) => void;\n/,
  '',
);

rail = replaceIfPresent(
  rail,
  /  if \(moduleId === 'synth'\) \{[\s\S]*?\n  \}\n  if \(moduleId === 'chaos'\)/,
  "  if (moduleId === 'chaos')",
);

rail = replaceIfPresent(rail, /  motionPadProps,\n/, '');
rail = replaceIfPresent(rail, /  motionPadProps: MotionPadProps;\n/, '');
rail = replaceIfPresent(rail, /\s*<MotionPad \{\.\.\.motionPadProps\} \/>\n/, '\n');
rail = replaceIfPresent(rail, /  motionPadProps,\n/, '');
rail = replaceIfPresent(rail, /  motionPadProps: MotionPadProps;\n/, '');
rail = replaceIfPresent(rail, /\n      motionPadProps=\{motionPadProps\}/, '');

assertAbsent(rail, [
  "from '../../audio/SynthEngine'",
  "from '../motion/MotionPad'",
  'const SYNTH_MACHINES',
  "moduleId === 'synth'",
  'SynthModule',
  'onSynthEnabledChange',
  'onSynthMachineChange',
  'onSynthArchetypeChange',
  'onSynthParametersChange',
  'onSynthTriggerNote',
  'onSynthSequencerChange',
  'onSynthSequencerStepListenerChange',
  'motionPadProps',
  '<MotionPad',
  'ReactWheelEvent',
  'RANDOM_MORPH_SECONDS',
], 'Rail C retired UI');
write(railPath, rail);

console.log('Retired Synth module and Stack XY input panel removed from App and Rail C source.');
