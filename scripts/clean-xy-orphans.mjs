import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const selectorLegacyTokens = [
  'route-inspector-heading',
  'route-count',
  'empty-routes',
  'route-depth',
  'route-controls',
  'dream-',
  'patch-target-active',
  'hover-axis-',
  'signal-art-active',
];
const sourceLegacyTokens = selectorLegacyTokens.filter((token) => token !== 'dream-');

function walk(root, test) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, test));
    else if (test(entry.name)) files.push(full);
  }
  return files;
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing audit contract while retiring XY: ${label}`);
  return source.replace(search, replacement);
}

function isLegacy(selector) {
  const lower = selector.toLowerCase();
  return selectorLegacyTokens.some((token) => lower.includes(token));
}

for (const file of walk('src', (name) => name.endsWith('.css'))) {
  const original = fs.readFileSync(file, 'utf8');
  const root = postcss.parse(original, { from: file });
  root.walkRules((rule) => {
    const selectors = rule.selectors;
    if (!selectors) return;
    const kept = selectors.filter((selector) => !isLegacy(selector));
    if (kept.length === selectors.length) return;
    if (kept.length === 0) rule.remove();
    else rule.selectors = kept;
  });
  root.walkComments((comment) => {
    const lower = comment.text.toLowerCase();
    if (selectorLegacyTokens.some((token) => lower.includes(token))) comment.remove();
  });
  const next = root.toString();
  if (next !== original) fs.writeFileSync(file, next);
}

// Update audits so CI enforces the retired architecture instead of requiring XY back.
{
  const file = 'scripts/visual-audit.mjs';
  let source = fs.readFileSync(file, 'utf8');
  source = replaceRequired(source, "const field = read('src/components/motion/XYSignalField.tsx');\n", '', 'visual XY field read');
  source = replaceRequired(source,
`requireText(field, '<AsciiArtEngine', 'XY ASCII surface');
requireText(field, 'kind="landscape"', 'XY combined landscape');
requireText(field, 'pressure={signalLab}', 'Existing Pressure state reaches ASCII world');
forbidText(field, 'DreamFieldEngine', 'Retired Dream fallback');
forbidText(field, 'VideoLandscapeEngine', 'XY decoder world');

`, '', 'visual XY field assertions');
  source = replaceRequired(source, "requireText(hardwarePalette, '.knob-patch-jack.assigned', 'Dark metallic knob jacks');\n", '', 'visual knob jack requirement');
  source = replaceRequired(source, "requireText(hardwarePalette, '.xy-patch-destination.axis-y i', 'Dark metallic XY sockets');\n", '', 'visual XY socket requirement');
  source = replaceRequired(source,
"const main = read('src/main.tsx');\n",
`const main = read('src/main.tsx');

for (const retiredPath of [
  'src/components/motion/MotionPad.tsx',
  'src/components/motion/MotionPad.css',
  'src/components/motion/XYSignalField.tsx',
  'src/components/motion/UiPolish.css',
  'src/ui/motion.ts',
]) {
  if (existsSync(resolve(root, retiredPath))) failures.push(\`Retired XY path still exists: \${retiredPath}\`);
}
forbidText(app, 'xyAssignments', 'Retired XY assignment state');
forbidText(app, 'onPatchStart', 'Retired XY patch callbacks');
forbidText(appCss, '.xy-', 'Retired XY styles');
forbidText(appCss, '.knob-patch-jack', 'Retired patch-jack styles');
forbidText(appCss, '.motion-route', 'Retired motion-route styles');
`, 'visual retired XY invariants');
  fs.writeFileSync(file, source);
}

{
  const file = 'scripts/ascii-landscape-audit.mjs';
  let source = fs.readFileSync(file, 'utf8');
  source = replaceRequired(source, "const field = read('src/components/motion/XYSignalField.tsx');\n", '', 'ASCII XY field read');
  source = replaceRequired(source, "requireText(field, 'kind=\"landscape\"', 'XY ASCII landscape renderer');\n", '', 'ASCII XY field requirement');
  source = replaceRequired(source,
"const retired = [\n",
`const retired = [
  'src/components/motion/MotionPad.tsx',
  'src/components/motion/MotionPad.css',
  'src/components/motion/XYSignalField.tsx',
  'src/components/motion/UiPolish.css',
  'src/ui/motion.ts',
`, 'ASCII retired XY paths');
  source = replaceRequired(source,
"for (const token of ['<video', 'TemporalVideo', 'requestVideoFrameCallback', 'VideoLandscapeEngine', '.mp4']) {\n",
"for (const token of ['<video', 'TemporalVideo', 'requestVideoFrameCallback', 'VideoLandscapeEngine', '.mp4', 'XYSignalField', 'MotionPad', 'xy-pad', 'knob-patch-jack', 'motion-route']) {\n",
'ASCII decoder/runtime retired tokens');
  fs.writeFileSync(file, source);
}

const failures = [];
for (const file of walk('src', (name) => /\.(?:ts|tsx|js|jsx|css|json)$/i.test(name))) {
  const lower = fs.readFileSync(file, 'utf8').toLowerCase();
  for (const token of sourceLegacyTokens) {
    if (lower.includes(token)) failures.push(`${file}: ${token}`);
  }
}
if (failures.length) {
  console.error('Legacy XY patch-inspector remnants remain:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('Legacy XY patch-inspector cleanup and audit migration complete.');
