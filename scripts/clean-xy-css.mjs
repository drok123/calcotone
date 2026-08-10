import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const SRC = 'src';
const retiredSelectorTokens = [
  '.xy',
  'xy-',
  'motion-route',
  'route-axis',
  'route-options',
  'knob-patch-jack',
  'patch-is-dragging',
  'persistent-patch-layer',
  'live-patch-layer',
  'patch-cable-overlay',
  'patch-cable-layer',
  'xy-jack-panel',
  'motion-jack-panel',
  'knob-modulation-ring',
  'knob-effective-marker',
];

const retiredText = /\bXY(?:Assignment|Axis|SignalField)\b|\bMotionCurve\b|\bMotionSmoothing\b|INITIAL_XY_ASSIGNMENTS|xyAssignments|xyPosition|xyPadRef|xy-pad|xy-patch|patchDraft|persistentPatchLines|patchDraftRef|motionValueRef|applyXYAssignments|beginPatch|movePatch|finishPatch|disconnectPatch|detectPatchAxis|refreshPersistentPatchLines|createPatchPath|getEffectiveMotionValue|shapeMotionSource|onPatchStart|onPatchMove|onPatchEnd|onPatchDisconnect|patchTarget|data-patch-target|knob-patch-jack|persistent-patch-layer|live-patch-layer|patch-cable-overlay|patch-cable-layer|xy-jack-panel|motion-jack-panel|motion-route|route-axis|route-options|\bMotionPad\b|components\/motion|ui\/motion|knob-modulation-ring|knob-effective-marker|cursor-life|cable-flow/;

function walk(root, test) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, test));
    else if (test(entry.name)) files.push(full);
  }
  return files;
}

function selectorIsRetired(selector) {
  const lower = selector.toLowerCase();
  return retiredSelectorTokens.some((token) => lower.includes(token));
}

for (const file of walk(SRC, (name) => name.endsWith('.css'))) {
  const original = fs.readFileSync(file, 'utf8');
  const migrated = original.replaceAll('data-patch-target', 'data-control-target');
  const root = postcss.parse(migrated, { from: file });

  root.walkRules((rule) => {
    const selectors = rule.selectors;
    if (!selectors) return;
    const kept = selectors.filter((selector) => !selectorIsRetired(selector));
    if (kept.length === selectors.length) return;
    if (kept.length === 0) rule.remove();
    else rule.selectors = kept;
  });

  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    const params = atRule.params.toLowerCase();
    if ((name === 'keyframes' || name === '-webkit-keyframes') && (params === 'cursor-life' || params === 'cable-flow')) {
      atRule.remove();
    }
  });

  root.walkComments((comment) => {
    if (retiredText.test(comment.text)) comment.remove();
  });

  const next = root.toString();
  if (next !== original) fs.writeFileSync(file, next);
}

const sourceFiles = walk(SRC, (name) => /\.(?:ts|tsx|js|jsx|css|json)$/i.test(name));
const failures = [];
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(retiredText);
  if (match) failures.push(`${file}: ${match[0]}`);
}

const retiredFiles = [
  'src/ui/motion.ts',
  'src/components/motion/MotionPad.tsx',
  'src/components/motion/MotionPad.css',
  'src/components/motion/XYSignalField.tsx',
  'src/components/motion/UiPolish.css',
];
for (const file of retiredFiles) {
  if (fs.existsSync(file)) failures.push(`${file}: retired file still exists`);
}

if (failures.length) {
  console.error('XY cleanup verifier found remnants:\n' + failures.join('\n'));
  process.exit(1);
}

console.log('Selector-aware XY cleanup complete; no retired XY plumbing remains in src.');
