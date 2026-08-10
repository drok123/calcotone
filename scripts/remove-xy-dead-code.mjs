import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value);

function mustReplace(source, search, replacement, label) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Expected replacement not found: ${label}`);
  return next;
}

function removeNamedBlock(source, declaration, name) {
  const marker = `${declaration} ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker}`);
  const brace = source.indexOf('{', start + marker.length);
  if (brace < 0) throw new Error(`Missing opening brace for ${marker}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        let end = index + 1;
        while (source[end] === '\r' || source[end] === '\n') end += 1;
        const lineStart = source.lastIndexOf('\n', start - 1) + 1;
        return source.slice(0, lineStart) + source.slice(end);
      }
    }
  }
  throw new Error(`Unterminated ${marker}`);
}

function removeHookContaining(source, hook, needle) {
  const needleAt = source.indexOf(needle);
  if (needleAt < 0) throw new Error(`Missing hook needle: ${needle}`);
  const marker = `${hook}(() => {`;
  const callStart = source.lastIndexOf(marker, needleAt);
  if (callStart < 0) throw new Error(`Could not find ${hook} for ${needle}`);
  const paren = source.indexOf('(', callStart + hook.length);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = paren; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        let end = index + 1;
        if (source[end] === ';') end += 1;
        while (source[end] === '\r' || source[end] === '\n') end += 1;
        const lineStart = source.lastIndexOf('\n', callStart - 1) + 1;
        return source.slice(0, lineStart) + source.slice(end);
      }
    }
  }
  throw new Error(`Unterminated ${hook} containing ${needle}`);
}

function matchingBrace(source, open) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('Unterminated CSS block');
}

const forbiddenCssSelectorTokens = [
  '.xy',
  'xy-',
  'motion-route',
  'route-axis',
  'route-options',
  'knob-patch-jack',
  'patch-is-dragging',
  'persistent-patch-layer',
  'live-patch-layer',
  'knob-modulation-ring',
  'knob-effective-marker',
];

function filterCss(source) {
  let out = '';
  let position = 0;
  while (position < source.length) {
    const open = source.indexOf('{', position);
    if (open < 0) {
      out += source.slice(position);
      break;
    }
    const close = matchingBrace(source, open);
    const rawHeader = source.slice(position, open);
    const leading = rawHeader.match(/^\s*/)?.[0] ?? '';
    const header = rawHeader.slice(leading.length).trimEnd();
    const body = source.slice(open + 1, close);
    const lowerHeader = header.toLowerCase();

    if (lowerHeader.startsWith('@media') || lowerHeader.startsWith('@supports') || lowerHeader.startsWith('@layer')) {
      out += `${leading}${header}{${filterCss(body)}}`;
    } else if (lowerHeader.startsWith('@keyframes') || lowerHeader.startsWith('@-webkit-keyframes')) {
      if (!lowerHeader.includes('cursor-life') && !lowerHeader.includes('cable-flow')) {
        out += `${leading}${header}{${body}}`;
      }
    } else if (header.startsWith('@')) {
      out += `${leading}${header}{${body}}`;
    } else {
      const selectors = header
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean)
        .filter((selector) => {
          const lower = selector.toLowerCase();
          return !forbiddenCssSelectorTokens.some((token) => lower.includes(token));
        });
      if (selectors.length > 0) {
        out += `${leading}${selectors.join(',\n')}{${body}}`;
      }
    }
    position = close + 1;
  }
  return out;
}

// App: remove the obsolete XY assignment model, patch-cable gestures, modulation application,
// overlays, footer counter, and props that used to feed those systems into modules.
let app = read('src/App.tsx');
app = mustReplace(app, "import type { ModuleState, XYAssignment, XYAxis } from './ui/types';", "import type { ModuleState } from './ui/types';", 'App XY type import');
app = mustReplace(app, "import { shapeMotionSource } from './ui/motion';\n", '', 'App motion import');
app = mustReplace(app, /\nconst INITIAL_XY_ASSIGNMENTS: XYAssignment\[\] = \[\];\n/, '\n', 'initial XY assignments');
app = removeNamedBlock(app, 'interface', 'PersistentPatchLine');
app = removeNamedBlock(app, 'interface', 'PatchDraft');
app = mustReplace(app, /  const \[xyPosition\] = useState\(\{ x: 50, y: 50 \}\);\n/, '', 'XY position state');
app = mustReplace(app, /  const \[xyAssignments, setXyAssignments\] = useState<XYAssignment\[\]>\(\n    INITIAL_XY_ASSIGNMENTS\n  \);\n/, '', 'XY assignment state');
app = mustReplace(app, /  const \[patchDraft, setPatchDraft\] = useState<PatchDraft \| null>\(null\);\n/, '', 'patch draft state');
app = mustReplace(app, /  const \[persistentPatchLines, setPersistentPatchLines\] = useState<\n    PersistentPatchLine\[\]\n  >\(\[\]\);\n/, '', 'persistent patch state');
app = mustReplace(app, /  const xyPadRef = useRef<HTMLDivElement \| null>\(null\);\n/, '', 'XY pad ref');
app = mustReplace(app, /  const patchDraftRef = useRef<PatchDraft \| null>\(null\);\n/, '', 'patch draft ref');
app = mustReplace(app, /  const motionValueRef = useRef\(new Map<string, number>\(\)\);\n/, '', 'motion value ref');

app = mustReplace(
  app,
  /\n      if \(revealedEverything\) \{\n        applyXYAssignments\(\n          xyPosition\.x \/ 100,\n          xyPosition\.y \/ 100,\n          plan\.finalModules\n        \);\n      \}/,
  '',
  'random-flow XY reapply'
);
app = mustReplace(app, '  }, [engineState, xyAssignments, xyPosition.x, xyPosition.y]);', '  }, [engineState]);', 'random flow dependencies');

app = removeHookContaining(app, 'useEffect', 'applyXYAssignments(xyPosition.x / 100, xyPosition.y / 100);');
app = removeHookContaining(app, 'useLayoutEffect', 'const frame = window.requestAnimationFrame(refreshPersistentPatchLines);');

for (const name of ['applyXYAssignments', 'beginPatch', 'movePatch', 'finishPatch', 'detectPatchAxis', 'disconnectPatch', 'refreshPersistentPatchLines']) {
  app = removeNamedBlock(app, 'function', name);
}
app = removeNamedBlock(app, 'function', 'createPatchPath');

for (const prop of [
  '                            assignments={xyAssignments}\n',
  '                          assignments={xyAssignments}\n',
  '                          xyPosition={xyPosition}\n',
  '                          onPatchStart={beginPatch}\n',
  '                          onPatchMove={movePatch}\n',
  '                          onPatchEnd={finishPatch}\n',
  '                          onPatchDisconnect={disconnectPatch}\n',
]) {
  if (app.includes(prop)) app = app.replace(prop, '');
}
app = mustReplace(app, /\n            <span><i className=\{xyAssignments\.length \? 'active' : ''\} \/>\{xyAssignments\.length\} PATCHES<\/span>/, '', 'footer patch count');

const persistentOverlay = `\n        {persistentPatchLines.length > 0 && (\n          <svg className="persistent-patch-layer" aria-hidden="true">\n            {persistentPatchLines.map((line) => (\n              <path\n                key={line.id}\n                className={\`axis-\${line.axis}\`}\n                d={createPatchPath(\n                  line.startX,\n                  line.startY,\n                  line.endX,\n                  line.endY\n                )}\n              />\n            ))}\n          </svg>\n        )}\n`;
app = mustReplace(app, persistentOverlay, '\n', 'persistent patch overlay');
const liveOverlay = `\n        {patchDraft && (\n          <svg className="live-patch-layer" aria-hidden="true">\n            <path\n              d={createPatchPath(\n                patchDraft.startX,\n                patchDraft.startY,\n                patchDraft.pointerX,\n                patchDraft.pointerY\n              )}\n            />\n            <circle cx={patchDraft.startX} cy={patchDraft.startY} r="6" />\n            <circle cx={patchDraft.pointerX} cy={patchDraft.pointerY} r="7" />\n          </svg>\n        )}\n`;
app = mustReplace(app, liveOverlay, '\n', 'live patch overlay');
write('src/App.tsx', app);

// Effect modules: knobs are direct parameter controls again; no hidden XY effective value.
let effect = read('src/components/effects/EffectModule.tsx');
effect = mustReplace(effect, "import type { ModuleParameter, ModuleState, XYAssignment } from '../../ui/types';", "import type { ModuleParameter, ModuleState } from '../../ui/types';", 'EffectModule XY import');
effect = mustReplace(effect, "import { getEffectiveMotionValue } from '../../ui/motion';\n", '', 'EffectModule motion import');
for (const line of ['  assignments,\n', '  xyPosition,\n', '  onPatchStart,\n', '  onPatchMove,\n', '  onPatchEnd,\n', '  onPatchDisconnect,\n']) {
  effect = mustReplace(effect, line, '', `EffectModule destructured ${line.trim()}`);
}
effect = mustReplace(effect, /  assignments: XYAssignment\[\];\n  xyPosition: \{ x: number; y: number \};\n  onPatchStart: \(\n    target: string,\n    label: string,\n    startX: number,\n    startY: number,\n    pointerX: number,\n    pointerY: number\n  \) => void;\n  onPatchMove: \(pointerX: number, pointerY: number\) => void;\n  onPatchEnd: \(pointerX: number, pointerY: number\) => void;\n  onPatchDisconnect: \(target: string\) => void;\n/, '', 'EffectModule XY prop types');
effect = mustReplace(effect, /    const assignment = assignments\.find\(\(candidate\) => candidate\.target === `\$\{module\.id\}\.\$\{parameter\.id\}`\);\n    const effectiveValue = assignment \? getEffectiveMotionValue\(parameter\.value, assignment, xyPosition\) : parameter\.value;\n/, '', 'EffectModule knob modulation');
for (const line of [
  '        effectiveValue={effectiveValue}\n',
  '        patchTarget={`${module.id}.${parameter.id}`}\n',
  '        assignment={assignment}\n',
  '        onPatchStart={(startX: number, startY: number, pointerX: number, pointerY: number) => onPatchStart(`${module.id}.${parameter.id}`, `${module.name} ${presentation.label}`, startX, startY, pointerX, pointerY)}\n',
  '        onPatchMove={onPatchMove}\n',
  '        onPatchEnd={onPatchEnd}\n',
  '        onPatchDisconnect={() => onPatchDisconnect(`${module.id}.${parameter.id}`)}\n',
]) {
  effect = mustReplace(effect, line, '', `EffectModule knob prop ${line.trim().slice(0, 30)}`);
}
write('src/components/effects/EffectModule.tsx', effect);

// Rail C had no working XY modulation, only compatibility props. Remove them completely.
let railC = read('src/components/effects/RailCModules.tsx');
railC = mustReplace(railC, "import type { ModuleState, XYAssignment } from '../../ui/types';", "import type { ModuleState } from '../../ui/types';", 'RailC XY import');
railC = mustReplace(railC, '  assignments,\n', '', 'RailC assignments destructuring');
railC = mustReplace(railC, '  assignments: XYAssignment[];\n', '', 'RailC assignments type');
railC = mustReplace(railC, '  void assignments;\n', '', 'RailC assignments void');
railC = railC.replace(/\s+effectiveValue=\{[^}\n]+\}/g, '');
railC = railC.replace(/\s+patchTarget=\{`[^`]+`\}/g, '');
railC = railC.replace(/\s+onPatch(?:Start|Move|End|Disconnect)=\{\(\)\s*=>\s*undefined\}/g, '');
write('src/components/effects/RailCModules.tsx', railC);

// Shared knob: delete the now-unused legacy compatibility API and modulation marker.
let knob = read('src/components/controls/Knob.tsx');
knob = mustReplace(knob, "import type { XYAssignment } from '../../ui/types';\n", '', 'Knob XY import');
knob = mustReplace(knob, '/**\n * Shared hardware knob. Legacy patch props remain temporarily accepted so\n * existing module declarations can migrate independently, but no jack,\n * assignment badge, cable gesture, or patch interaction is rendered.\n */', '/** Shared hardware knob. */', 'Knob legacy comment');
knob = mustReplace(knob, '  effectiveValue,\n', '', 'Knob effective value destructuring');
knob = mustReplace(knob, '  effectiveValue: number;\n', '', 'Knob effective value type');
knob = mustReplace(knob, /  assignment\?: XYAssignment;\n  patchTarget\?: string;\n/, '', 'Knob XY compatibility fields');
knob = mustReplace(knob, /  onPatchStart\?: \(startX: number, startY: number, pointerX: number, pointerY: number\) => void;\n  onPatchMove\?: \(pointerX: number, pointerY: number\) => void;\n  onPatchEnd\?: \(pointerX: number, pointerY: number\) => void;\n  onPatchDisconnect\?: \(\) => void;\n/, '', 'Knob patch callback types');
knob = mustReplace(knob, '  const effectiveRotation = -135 + effectiveValue * 270;\n', '', 'Knob effective rotation');
knob = mustReplace(knob, '        style={{ \'--effective-rotation\': `${effectiveRotation}deg`, \'--base-rotation\': `${rotation}deg` } as CSSProperties}\n', '', 'Knob effective style vars');
knob = mustReplace(knob, '        <span className="knob-effective-marker" aria-hidden="true" />\n', '', 'Knob effective marker');
write('src/components/controls/Knob.tsx', knob);

// Type layer and dedicated motion helper are XY-only.
let types = read('src/ui/types.ts');
types = mustReplace(types, /export type XYAxis = 'x' \| 'y';\nexport type MotionCurve = 'linear' \| 'soft' \| 'exponential' \| 'stepped';\nexport type MotionSmoothing = 'fast' \| 'medium' \| 'slow';\nexport interface XYAssignment \{ id: string; axis: XYAxis; target: string; depth: number; inverted: boolean; min: number; max: number; curve: MotionCurve; smoothing: MotionSmoothing; \}\n/, '', 'XY type model');
write('src/ui/types.ts', types);
if (!fs.existsSync('src/ui/motion.ts')) throw new Error('Expected src/ui/motion.ts');
fs.rmSync('src/ui/motion.ts');

// Remove old XY/patched-knob CSS selectors while preserving unrelated selectors in mixed groups.
let css = read('src/App.css');
css = filterCss(css);
write('src/App.css', css);

const forbiddenTs = /\bXYAssignment\b|\bXYAxis\b|\bMotionCurve\b|\bMotionSmoothing\b|INITIAL_XY_ASSIGNMENTS|xyAssignments|xyPosition|patchDraft|persistentPatchLines|xyPadRef|patchDraftRef|motionValueRef|applyXYAssignments|beginPatch|movePatch|finishPatch|disconnectPatch|detectPatchAxis|refreshPersistentPatchLines|createPatchPath|getEffectiveMotionValue|shapeMotionSource|onPatchStart|onPatchMove|onPatchEnd|onPatchDisconnect|patchTarget|\bPATCHES\b/;
for (const path of ['src/App.tsx', 'src/components/effects/EffectModule.tsx', 'src/components/effects/RailCModules.tsx', 'src/components/controls/Knob.tsx', 'src/ui/types.ts']) {
  const value = read(path);
  const hit = value.match(forbiddenTs);
  if (hit) throw new Error(`${path} still contains obsolete XY symbol: ${hit[0]}`);
}
const cssForbidden = /\.xy|xy-|motion-route|route-axis|route-options|knob-patch-jack|patch-is-dragging|persistent-patch-layer|live-patch-layer|knob-modulation-ring|knob-effective-marker|cursor-life|cable-flow/i;
const cssHit = read('src/App.css').match(cssForbidden);
if (cssHit) throw new Error(`src/App.css still contains obsolete XY styling: ${cssHit[0]}`);

console.log('XY system removed from application source.');
