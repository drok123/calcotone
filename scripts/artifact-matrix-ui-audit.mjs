import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const moduleSource = fs.readFileSync('src/components/effects/EffectModule.tsx', 'utf8');
const matrix = fs.readFileSync('src/features/artifact/artifactMatrix.ts', 'utf8');

const checks = [
  [app.includes("id: 'console'"), 'Artifact console state parameter'],
  [app.includes("id: 'tube'"), 'Artifact tube state parameter'],
  [app.includes("id: 'chainOrder'"), 'Artifact order state parameter'],
  [app.includes('isArtifactMatrixParameter'), 'discrete parameter guard'],
  [app.includes("!isArtifactMatrixParameter(moduleId, parameterId)"), 'WebAudio unknown-parameter guard'],
  [!moduleSource.includes('ArtifactMatrixSelectors'), 'extra Artifact matrix selectors removed'],
  [!moduleSource.includes('normalizeArtifactMatrix'), 'Artifact matrix selector helper removed'],
  [(moduleSource.match(/aria-label="Artifact format"/g) ?? []).length === 1, 'one visible Artifact format selector'],
  [moduleSource.includes("const visibleParameters = module.parameters.filter"), 'discrete state hidden from knob rows'],
  [moduleSource.includes('{visibleParameters.map((parameter, index) => {'), 'custom faceplate indices use visible controls'],
  [moduleSource.includes('{visibleParameters.map((parameter) => renderKnob(parameter))}'), 'standard knob row uses visible controls'],
  [matrix.includes('NEVE_GOLD_LION_ARTIFACT_MATRIX'), 'legacy matrix state remains available internally'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, label] of failed) console.error(`FAIL: ${label}`);
  process.exit(1);
}

console.log(`Artifact UI audit passed (${checks.length} checks).`);
