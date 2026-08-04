import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const moduleSource = fs.readFileSync('src/components/effects/EffectModule.tsx', 'utf8');
const matrix = fs.readFileSync('src/features/artifact/artifactMatrix.ts', 'utf8');
const selectors = fs.readFileSync('src/components/effects/ArtifactMatrixSelectors.tsx', 'utf8');

const checks = [
  [app.includes("id: 'console'"), 'Artifact console state parameter'],
  [app.includes("id: 'tube'"), 'Artifact tube state parameter'],
  [app.includes("id: 'chainOrder'"), 'Artifact order state parameter'],
  [app.includes('isArtifactMatrixParameter'), 'discrete parameter guard'],
  [app.includes("!isArtifactMatrixParameter(moduleId, parameterId)"), 'WebAudio unknown-parameter guard'],
  [moduleSource.includes('ArtifactMatrixSelectors'), 'selector rendered in EffectModule'],
  [moduleSource.includes("onParameterChange('console'"), 'console native command route'],
  [moduleSource.includes("onParameterChange('tube'"), 'tube native command route'],
  [moduleSource.includes("onParameterChange('chainOrder'"), 'order native command route'],
  [moduleSource.includes("!['console', 'tube', 'chainOrder'].includes(parameter.id)"), 'discrete selectors hidden from knob row'],
  [matrix.includes('NEVE_GOLD_LION_ARTIFACT_MATRIX'), 'legacy Neve/Gold Lion alias'],
  [selectors.includes('disabled={disabled || state.console === 0 || state.tube === 0}'), 'order selector bypass guard'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, label] of failed) console.error(`FAIL: ${label}`);
  process.exit(1);
}

console.log(`Artifact matrix UI audit passed (${checks.length} checks).`);
