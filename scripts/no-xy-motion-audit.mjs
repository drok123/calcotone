import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'public'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.md']);
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
if (fs.existsSync('src/ui/motion.ts')) failures.push('src/ui/motion.ts must not exist');
if (fs.existsSync('public/xy-worlds')) failures.push('public/xy-worlds must not exist');

if (failures.length) {
  console.error(`XY removal audit failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('XY removal audit passed: obsolete XY motion/patch architecture is absent.');
