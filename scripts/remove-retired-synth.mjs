import fs from 'node:fs';

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Retired UI cleanup anchor missing: ${label}`);
  return next;
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');

app = replaceRequired(
  app,
  /import type \{\n  SynthArchetype,\n  SynthMachine,\n  SynthSequencerState,\n  SynthSequencerStep,\n\} from '\.\/audio\/SynthEngine';\n/,
  '',
  'App SynthEngine type import',
);

app = replaceRequired(
  app,
  /  const setSynthEnabled = useCallback\([\s\S]*?\n  const setStompEnabled = useCallback/,
  '  const setStompEnabled = useCallback',
  'App native Synth callbacks',
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
  app = replaceRequired(app, new RegExp(`\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`), '\n', `App ${prop}`);
}

app = replaceRequired(
  app,
  /\s*motionPadProps=\{\{[\s\S]*?\n\s*\}\}\n\s*\{\.\.\.routingProps\}/,
  '\n                            {...routingProps}',
  'Stack MotionPad prop block',
);
write(appPath, app);

const railPath = 'src/components/effects/RailCModules.tsx';
let rail = fs.readFileSync(railPath, 'utf8');

rail = replaceRequired(
  rail,
  /import type \{\n  SynthArchetype,\n  SynthMachine,\n  SynthSequencerNote,\n  SynthSequencerState,\n  SynthSequencerStep,\n\} from '\.\.\/\.\.\/audio\/SynthEngine';\n/,
  '',
  'Rail C SynthEngine type import',
);
rail = replaceRequired(rail, /import type \{ MotionPadProps \} from '\.\.\/motion\/MotionPad';\n/, '', 'MotionPadProps import');
rail = replaceRequired(rail, /import \{ MotionPad \} from '\.\.\/motion\/MotionPad';\n/, '', 'MotionPad import');

rail = replaceRequired(
  rail,
  /const SYNTH_MACHINES:[\s\S]*?\nexport const STOMP_MODE_LABELS = \[/,
  'export const STOMP_MODE_LABELS = [',
  'Synth implementation block',
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
  rail = replaceRequired(rail, new RegExp(`\\n  ${name},`), '', `Rail C destructured ${name}`);
}

rail = replaceRequired(
  rail,
  /  onSynthEnabledChange: \(enabled: boolean\) => void;\n  onSynthMachineChange: \(machine: SynthMachine\) => void;\n  onSynthArchetypeChange: \(archetype: SynthArchetype\) => void;\n  onSynthParametersChange: \(values: readonly number\[\], morphSeconds\?: number\) => void;\n  onSynthTriggerNote: \(midi: number, durationSeconds: number\) => void;\n  onSynthSequencerChange: \(state: SynthSequencerState\) => void;\n  onSynthSequencerStepListenerChange: \(\n    listener: \(\(position: SynthSequencerStep\) => void\) \| null\n  \) => void;\n/,
  '',
  'Rail C Synth prop contract',
);

rail = replaceRequired(
  rail,
  /  if \(moduleId === 'synth'\) \{[\s\S]*?\n  \}\n  if \(moduleId === 'chaos'\)/,
  "  if (moduleId === 'chaos')",
  'Rail C Synth render branch',
);

rail = replaceRequired(rail, /  motionPadProps,\n/, '', 'Chaos MotionPad destructuring');
rail = replaceRequired(rail, /  motionPadProps: MotionPadProps;\n/, '', 'Chaos MotionPad prop type');
rail = replaceRequired(rail, /\s*<MotionPad \{\.\.\.motionPadProps\} \/>\n/, '\n', 'Stack MotionPad render');
rail = replaceRequired(rail, /  motionPadProps,\n/, '', 'Rail C MotionPad destructuring');
rail = replaceRequired(rail, /  motionPadProps: MotionPadProps;\n/, '', 'Rail C MotionPad prop type');
rail = replaceRequired(rail, /\n      motionPadProps=\{motionPadProps\}/, '', 'Stack MotionPad forwarding');

write(railPath, rail);
console.log('Retired Synth module and Stack XY input panel removed from App and Rail C source.');
