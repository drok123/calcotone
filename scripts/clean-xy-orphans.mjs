import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const legacyTokens = [
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

function walk(root, test) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, test));
    else if (test(entry.name)) files.push(full);
  }
  return files;
}

function isLegacy(selector) {
  const lower = selector.toLowerCase();
  return legacyTokens.some((token) => lower.includes(token));
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
    if (legacyTokens.some((token) => lower.includes(token))) comment.remove();
  });
  const next = root.toString();
  if (next !== original) fs.writeFileSync(file, next);
}

const failures = [];
for (const file of walk('src', (name) => /\.(?:ts|tsx|js|jsx|css|json)$/i.test(name))) {
  const lower = fs.readFileSync(file, 'utf8').toLowerCase();
  for (const token of legacyTokens) {
    if (lower.includes(token)) failures.push(`${file}: ${token}`);
  }
}
if (failures.length) {
  console.error('Legacy XY patch-inspector remnants remain:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('Legacy XY patch-inspector orphan cleanup complete.');
