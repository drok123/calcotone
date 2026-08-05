import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`missing ${label}`);
  return source.replace(search, replacement);
}

let effectModule = readFileSync('src/components/effects/EffectModule.tsx', 'utf8');
effectModule = replaceRequired(
  effectModule,
  "  const visibleParameters = module.parameters.filter((parameter) => !['console', 'tube', 'chainOrder'].includes(parameter.id));",
  '  const visibleParameters = module.parameters;',
  'Artifact hidden-knob filter',
);
writeFileSync('src/components/effects/EffectModule.tsx', effectModule, 'utf8');

let windowsAudit = readFileSync('scripts/windows-ui-parity-audit.mjs', 'utf8');
const oldBlock = `for (const parameter of ['console', 'tube', 'chainOrder']) {
  check(app.includes(\`id: '\${parameter}'\`), 'artifact', \`\${parameter} compatibility state\`);
  check(host.includes(parameter) || read('native/tools/apply_atmos_parity.py').includes(parameter), 'artifact', \`\${parameter} native route\`);
}
check(count(effectModule, 'aria-label="Artifact format"') === 1, 'artifact', 'exactly one visible Artifact dropdown');
check(!effectModule.includes('<ArtifactMatrixSelectors'), 'artifact', 'Artifact matrix selectors hidden from faceplate');
check(effectModule.includes("!['console', 'tube', 'chainOrder'].includes(parameter.id)"), 'artifact', 'internal Artifact matrix state excluded from knobs');`;
const newBlock = `for (const parameter of ['console', 'tube', 'chainOrder']) {
  check(!app.includes(\`id: '\${parameter}'\`), 'artifact', \`\${parameter} UI state removed\`);
}
check(!read('native/tools/apply_atmos_parity.py').includes('ArtifactChainProcessor'), 'artifact', 'hidden native Artifact chain removed');
check(count(effectModule, 'aria-label="Artifact format"') === 1, 'artifact', 'exactly one visible Artifact dropdown');
check(!effectModule.includes('<ArtifactMatrixSelectors'), 'artifact', 'Artifact matrix selectors removed');
check(effectModule.includes('const visibleParameters = module.parameters;'), 'artifact', 'all canonical Artifact knobs render directly');`;
windowsAudit = replaceRequired(windowsAudit, oldBlock, newBlock, 'Windows Artifact compatibility block');
writeFileSync('scripts/windows-ui-parity-audit.mjs', windowsAudit, 'utf8');

for (const path of [
  'scripts/apply-artifact-matrix-ui.mjs',
  'src/components/effects/ArtifactMatrixSelectors.tsx',
  'src/features/artifact/artifactMatrix.test.ts',
]) {
  if (existsSync(path)) rmSync(path);
}

for (const [path, forbidden] of [
  ['src/App.tsx', "id: 'chainOrder'"],
  ['src/App.tsx', 'isArtifactMatrixParameter'],
  ['src/components/effects/EffectModule.tsx', "['console', 'tube', 'chainOrder']"],
  ['native/tools/apply_atmos_parity.py', 'ArtifactChainProcessor'],
]) {
  if (readFileSync(path, 'utf8').includes(forbidden)) throw new Error(`${path} still contains ${forbidden}`);
}

console.log('Removed remaining Artifact matrix compatibility UI and mutation files.');
