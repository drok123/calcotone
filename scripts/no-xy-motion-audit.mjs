import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'public'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.md', '.css']);
const forbidden = [
  'XYAssignment',
  'XYAxis',
  'xyAssignments',
  'xyPosition',
  'patchTarget',
  'onPatchStart',
  'onPatchMove',
  'onPatchEnd',
  'onPatchDisconnect',
  'shapeMotionSource',
  'getEffectiveMotionValue',
  'persistent-patch-layer',
  'live-patch-layer',
  'patch-is-dragging',
  'xy-worlds',
  'XYSignalField',
  'MotionPad',
  'xy-pad',
  'knob-patch-jack',
  'knob-modulation-ring',
  'knob-effective-marker',
  'effectiveValue',
  'motion-route',
  'route-inspector',
  'patch-target-active',
  'hover-axis-',
];

const failures = [];

function visit(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
    return;
  }
  if (!sourceExtensions.has(path.extname(target))) return;
  const source = fs.readFileSync(target, 'utf8');
  for (const token of forbidden) {
    if (source.includes(token)) failures.push(`${target}: obsolete XY token ${token}`);
  }
}

for (const root of roots) visit(root);
for (const retiredPath of ['src/components/motion/MotionPad.tsx', 'src/components/motion/MotionPad.css', 'src/components/motion/XYSignalField.tsx', 'src/components/motion/UiPolish.css', 'src/ui/motion.ts']) {
  if (fs.existsSync(retiredPath)) failures.push(`${retiredPath} must not exist`);
}
if (fs.existsSync('public/xy-worlds')) failures.push('public/xy-worlds must not exist');

if (failures.length) {
  console.error(`XY removal audit failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('XY removal audit passed: obsolete XY motion/patch architecture is absent.');
