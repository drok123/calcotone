import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value);

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

const cssPath = 'src/App.css';
write(cssPath, filterCss(read(cssPath)));

const forbiddenSource = /\bXYAssignment\b|\bXYAxis\b|\bMotionCurve\b|\bMotionSmoothing\b|INITIAL_XY_ASSIGNMENTS|xyAssignments|xyPosition|patchDraft|persistentPatchLines|xyPadRef|patchDraftRef|motionValueRef|applyXYAssignments|beginPatch|movePatch|finishPatch|disconnectPatch|detectPatchAxis|refreshPersistentPatchLines|createPatchPath|getEffectiveMotionValue|shapeMotionSource|onPatchStart|onPatchMove|onPatchEnd|onPatchDisconnect|patchTarget|\bPATCHES\b/;
const sourcePaths = [
  'src/App.tsx',
  'src/components/effects/EffectModule.tsx',
  'src/components/effects/RailCModules.tsx',
  'src/components/controls/Knob.tsx',
  'src/ui/types.ts',
];
for (const path of sourcePaths) {
  const hit = read(path).match(forbiddenSource);
  if (hit) throw new Error(`${path} still contains obsolete XY symbol: ${hit[0]}`);
}
if (fs.existsSync('src/ui/motion.ts')) throw new Error('src/ui/motion.ts still exists');

const cssForbidden = /\.xy|xy-|motion-route|route-axis|route-options|knob-patch-jack|patch-is-dragging|persistent-patch-layer|live-patch-layer|knob-modulation-ring|knob-effective-marker|cursor-life|cable-flow/i;
const cssHit = read(cssPath).match(cssForbidden);
if (cssHit) throw new Error(`${cssPath} still contains obsolete XY styling: ${cssHit[0]}`);

console.log('XY cleanup and source verification complete.');
