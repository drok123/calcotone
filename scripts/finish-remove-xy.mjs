import fs from 'node:fs';
import path from 'node:path';

const read = (filePath) => fs.readFileSync(filePath, 'utf8');
const write = (filePath, value) => fs.writeFileSync(filePath, value);

function findNextOpenBrace(source, start) {
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];
    if (comment) {
      if (ch === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') return index;
  }
  return -1;
}

function matchingBrace(source, open) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];
    if (comment) {
      if (ch === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '*') {
      comment = true;
      index += 1;
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
  throw new Error(`Unterminated CSS block near ${open}`);
}

const forbiddenSelectorTokens = [
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
    const open = findNextOpenBrace(source, position);
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
          return !forbiddenSelectorTokens.some((token) => lower.includes(token));
        });
      if (selectors.length > 0) out += `${leading}${selectors.join(',\n')}{${body}}`;
    }
    position = close + 1;
  }
  return out;
}

for (const cssPath of ['src/App.css', 'src/UnifiedTextPalette.css']) {
  write(cssPath, filterCss(read(cssPath)));
}

// These files are the retired Dream/XY pad implementation itself. The app no longer
// renders them, so keeping them would preserve exactly the dead subsystem being removed.
const retiredFiles = [
  'src/ui/motion.ts',
  'src/components/motion/MotionPad.tsx',
  'src/components/motion/MotionPad.css',
  'src/components/motion/XYSignalField.tsx',
  'src/components/motion/UiPolish.css',
];
for (const filePath of retiredFiles) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}
if (fs.existsSync('src/components/motion') && fs.readdirSync('src/components/motion').length === 0) {
  fs.rmdirSync('src/components/motion');
}

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(fullPath));
    else if (/\.(?:ts|tsx|js|jsx|css|json)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

// Treat any surviving named XY API or cable/modulation plumbing as a failure.
// Lowercase x/y coordinate math is intentionally not banned; only the retired subsystem vocabulary is.
const forbiddenSource = /\bXY(?:Assignment|Axis|SignalField)\b|\bMotionCurve\b|\bMotionSmoothing\b|INITIAL_XY_ASSIGNMENTS|xyAssignments|xyPosition|xyPadRef|xy-pad|xy-patch|patchDraft|persistentPatchLines|patchDraftRef|motionValueRef|applyXYAssignments|beginPatch|movePatch|finishPatch|disconnectPatch|detectPatchAxis|refreshPersistentPatchLines|createPatchPath|getEffectiveMotionValue|shapeMotionSource|onPatchStart|onPatchMove|onPatchEnd|onPatchDisconnect|patchTarget|knob-patch-jack|persistent-patch-layer|live-patch-layer|motion-route|route-axis|route-options|\bMotionPad\b|components\/motion|ui\/motion|\bPATCHES\b/;
for (const filePath of sourceFiles('src')) {
  const hit = read(filePath).match(forbiddenSource);
  if (hit) throw new Error(`${filePath} still contains obsolete XY symbol: ${hit[0]}`);
}

const cssForbidden = /\.xy|xy-|motion-route|route-axis|route-options|knob-patch-jack|patch-is-dragging|persistent-patch-layer|live-patch-layer|knob-modulation-ring|knob-effective-marker|cursor-life|cable-flow/i;
for (const cssPath of ['src/App.css', 'src/UnifiedTextPalette.css']) {
  const cssHit = read(cssPath).match(cssForbidden);
  if (cssHit) throw new Error(`${cssPath} still contains obsolete XY styling: ${cssHit[0]}`);
}

console.log('XY cleanup and full src verification complete.');
