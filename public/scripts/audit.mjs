import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const problems = [];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

for (const dir of ['src', 'public']) {
  if (!existsSync(join(root, dir))) continue;
  for (const file of walk(join(root, dir))) {
    if (statSync(file).size === 0) problems.push(`zero-byte file: ${relative(root, file)}`);
  }
}

for (const file of ['grain-processor.js','dream-buffer-processor.js','recorder-processor.js']) {
  const path = join(root, 'public', file);
  if (!existsSync(path)) { problems.push(`missing worklet: public/${file}`); continue; }
  try { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); }
  catch { problems.push(`invalid worklet syntax: public/${file}`); }
  const source = readFileSync(path, 'utf8');
  if (source.includes('performance.now()')) problems.push(`AudioWorklet uses unsupported performance.now(): public/${file}`);
}

const engine = readFileSync(join(root, 'src/audio/AudioEngine.ts'), 'utf8');
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const graph = readFileSync(join(root, 'src/audio/AudioGraph.ts'), 'utf8');
const preset = readFileSync(join(root, 'src/audio/Preset.ts'), 'utf8');
const grain = readFileSync(join(root, 'src/audio/effects/Bitcrusher.ts'), 'utf8');
const css = readFileSync(join(root, 'src/App.css'), 'utf8');

if (/enabled:\s*true/.test(preset)) problems.push('default preset powers an effect on at boot');
if (grain.includes('setWetPostGain')) problems.push('Grain depends on removed BaseEffect wet-post helper');
if (!engine.includes('reorderEffectsClickSafe')) problems.push('click-safe routing helper missing');
if (!graph.includes('effect.output.disconnect(destination)')) problems.push('routing reorder may disconnect side paths');
if (!app.includes("DEFAULT_RAIL_A_ORDER = ['saturation', 'chorus', 'delay']")) problems.push('Rail A membership changed');
if (!app.includes("DEFAULT_RAIL_B_ORDER = ['reverb', 'bitcrusher', 'media']")) problems.push('Rail B membership changed');
if (!app.includes('engine.setAdaptiveMode(adaptiveMode)')) problems.push('SAFE state is not synchronized on engine startup');
if (/flutter:\s*\[/.test(app)) problems.push('stale Artifact flutter randomizer remains');
if (css.includes('\\n/*')) problems.push('literal escaped newline remains in CSS');

if (problems.length) {
  console.error('CALCOTONE audit FAILED');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log('CALCOTONE audit OK');
