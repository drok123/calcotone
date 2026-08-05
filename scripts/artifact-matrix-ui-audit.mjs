import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const moduleSource = fs.readFileSync('src/components/effects/EffectModule.tsx', 'utf8');
const media = fs.readFileSync('src/audio/effects/Media.ts', 'utf8');
const nativePatch = fs.readFileSync('native/tools/apply_atmos_parity.py', 'utf8');
const cmake = fs.readFileSync('native/CMakeLists.txt', 'utf8');

const checks = [
  [!app.includes("id: 'console'"), 'Artifact console UI state removed'],
  [!app.includes("id: 'tube'"), 'Artifact tube UI state removed'],
  [!app.includes("id: 'chainOrder'"), 'Artifact order UI state removed'],
  [!app.includes('isArtifactMatrixParameter'), 'Artifact discrete UI guard removed'],
  [!moduleSource.includes('ArtifactMatrixSelectors'), 'Artifact matrix selectors removed'],
  [!moduleSource.includes('normalizeArtifactMatrix'), 'Artifact matrix selector helper removed'],
  [(moduleSource.match(/aria-label="Artifact format"/g) ?? []).length === 1, 'one visible Artifact format selector'],
  [media.includes('this.initializeParameters([MODE, WEAR, WOW, NOISE, TONE, MIX])'), 'Artifact effect exposes only canonical controls'],
  [!nativePatch.includes('ArtifactChainProcessor'), 'hidden native Artifact chain removed'],
  [!nativePatch.includes('set_extra'), 'hidden native Artifact parameter router removed'],
  [!cmake.includes('artifact_chain_'), 'hidden Artifact chain targets removed'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, label] of failed) console.error(`FAIL: ${label}`);
  process.exit(1);
}

console.log(`Artifact UI audit passed (${checks.length} checks).`);
