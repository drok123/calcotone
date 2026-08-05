import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

function read(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return readFileSync(path, 'utf8');
}

function write(path, source) {
  writeFileSync(path, source, 'utf8');
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`missing ${label}`);
  return source.replace(search, replacement);
}

function replaceRegexRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`missing ${label}`);
  return next;
}

let app = read('src/App.tsx');
for (const line of [
  "      { id: 'console', label: 'Console', value: 0, display: 'Bypass' },\n",
  "      { id: 'tube', label: 'Tube', value: 0, display: 'Bypass' },\n",
  "      { id: 'chainOrder', label: 'Order', value: 0, display: 'Console → Tube' },\n",
]) app = replaceRequired(app, line, '', `Artifact ghost parameter ${line.trim()}`);

app = replaceRegexRequired(
  app,
  /\nconst ARTIFACT_MATRIX_PARAMETER_IDS = new Set\(\['console', 'tube', 'chainOrder'\]\);\n\nfunction isArtifactMatrixParameter\(moduleId: string, parameterId: string\): boolean \{\n  return moduleId === 'media' && ARTIFACT_MATRIX_PARAMETER_IDS\.has\(parameterId\);\n\}\n/,
  '\n',
  'Artifact matrix parameter helper',
);
app = replaceRequired(
  app,
  '    if (isArtifactMatrixParameter(moduleId, parameterId)) value = Math.round(value);\n',
  '',
  'Artifact discrete update guard',
);
app = replaceRequired(
  app,
  "      else if (!isArtifactMatrixParameter(moduleId, parameterId)) setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);",
  "      else setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);",
  'Artifact WebAudio unknown-parameter guard',
);
app = replaceRegexRequired(
  app,
  /\n        if \(isArtifactMatrixParameter\(modeModule\.id, parameter\.id\)\) \{\n          const maximum = parameter\.id === 'chainOrder' \? 1 : 5;\n          const next = profile === 'mutate'\n            \? Math\.max\(0, Math\.min\(maximum, Math\.round\(parameter\.value \+ \(Math\.random\(\) < 0\.25 \? \(Math\.random\(\) < 0\.5 \? -1 : 1\) : 0\)\)\)\)\n            : Math\.floor\(Math\.random\(\) \* \(maximum \+ 1\)\);\n          return \{ \.\.\.parameter, value: next, display: formatParameterValue\(modeModule\.id, parameter\.id, next\) \};\n        \}/,
  '',
  'Artifact matrix randomization branch',
);
app = replaceRequired(
  app,
  '          if (isArtifactMatrixParameter(module.id, parameter.id)) continue;\n',
  '',
  'Artifact matrix restore skip',
);
for (const forbidden of ["id: 'chainOrder'", 'ARTIFACT_MATRIX_PARAMETER_IDS', 'isArtifactMatrixParameter']) {
  if (app.includes(forbidden)) throw new Error(`stale App Artifact control remains: ${forbidden}`);
}
write('src/App.tsx', app);

let parity = read('native/tools/apply_atmos_parity.py');
parity = parity.replace("        '#include \"calcotone/artifact_chain_processor.hpp\"\\n'\n", '');
parity = replaceRequired(
  parity,
  "    if '#include \"calcotone/artifact_chain_processor.hpp\"' not in source:\n",
  "    if '#include \"calcotone/atmos_parity_processor.hpp\"' not in source:\n",
  'Artifact chain include guard',
);
parity = parity.replace("  std::atomic<float> console{0.F}, tube{0.F}, chain_order{0.F};\n", '');
parity = parity.replace('  ArtifactChainProcessor chain;\n', '');
parity = replaceRequired(parity, '  explicit Artifact(float rate) : chain(rate) {\n', '  explicit Artifact(float rate) {\n', 'Artifact chain constructor');
parity = replaceRegexRequired(
  parity,
  /  bool set_extra\(std::string_view name, float value\) noexcept \{[\s\S]*?    return true;\n  \}\n/,
  '',
  'Artifact extra-parameter router',
);
parity = replaceRegexRequired(
  parity,
  /    chain\.set_parameter\("console", console\.load\(std::memory_order_relaxed\)\);\n    chain\.set_parameter\("tube", tube\.load\(std::memory_order_relaxed\)\);\n    chain\.set_parameter\("order", chain_order\.load\(std::memory_order_relaxed\)\);\n    chain\.set_parameter\("drive", p\.value\[1\]\);\n    chain\.set_parameter\("tone", p\.value\[4\]\);\n    chain\.process\(data, frames\);\n/,
  '',
  'Artifact hidden chain processing',
);
parity = replaceRegexRequired(
  parity,
  /\n    source = source\.replace\(\n        "case RackModule::Artifact:[\s\S]*?\n    \)\n/,
  '\n',
  'Artifact hidden native command injection',
);
for (const forbidden of ['artifact_chain_processor', 'ArtifactChainProcessor', 'set_extra', 'chainOrder']) {
  if (parity.includes(forbidden)) throw new Error(`stale native Artifact control remains: ${forbidden}`);
}
write('native/tools/apply_atmos_parity.py', parity);

let cmake = read('native/CMakeLists.txt');
for (const line of [
  '  src/artifact_chain_processor.cpp\n',
  'add_executable(artifact_chain_profile_test tests/artifact_chain_profile_test.cpp)\n',
  'target_link_libraries(artifact_chain_profile_test PRIVATE calcotone_dsp)\n',
  'add_executable(artifact_chain_processor_test tests/artifact_chain_processor_test.cpp)\n',
  'target_link_libraries(artifact_chain_processor_test PRIVATE calcotone_dsp)\n',
  'add_executable(native_artifact_chain_live_test tests/native_artifact_chain_live_test.cpp)\n',
  'target_link_libraries(native_artifact_chain_live_test PRIVATE calcotone_dsp)\n',
  'add_test(NAME artifact_chain_profile_test COMMAND artifact_chain_profile_test)\n',
  'add_test(NAME artifact_chain_processor_test COMMAND artifact_chain_processor_test)\n',
  'add_test(NAME native_artifact_chain_live_test COMMAND native_artifact_chain_live_test)\n',
]) cmake = replaceRequired(cmake, line, '', `CMake ${line.trim()}`);
write('native/CMakeLists.txt', cmake);

const artifactAudit = `import fs from 'node:fs';\n\nconst app = fs.readFileSync('src/App.tsx', 'utf8');\nconst moduleSource = fs.readFileSync('src/components/effects/EffectModule.tsx', 'utf8');\nconst media = fs.readFileSync('src/audio/effects/Media.ts', 'utf8');\nconst nativePatch = fs.readFileSync('native/tools/apply_atmos_parity.py', 'utf8');\nconst cmake = fs.readFileSync('native/CMakeLists.txt', 'utf8');\n\nconst checks = [\n  [!app.includes(\"id: 'console'\"), 'Artifact console UI state removed'],\n  [!app.includes(\"id: 'tube'\"), 'Artifact tube UI state removed'],\n  [!app.includes(\"id: 'chainOrder'\"), 'Artifact order UI state removed'],\n  [!app.includes('isArtifactMatrixParameter'), 'Artifact discrete UI guard removed'],\n  [!moduleSource.includes('ArtifactMatrixSelectors'), 'Artifact matrix selectors removed'],\n  [!moduleSource.includes('normalizeArtifactMatrix'), 'Artifact matrix selector helper removed'],\n  [(moduleSource.match(/aria-label=\"Artifact format\"/g) ?? []).length === 1, 'one visible Artifact format selector'],\n  [media.includes('this.initializeParameters([MODE, WEAR, WOW, NOISE, TONE, MIX])'), 'Artifact effect exposes only canonical controls'],\n  [!nativePatch.includes('ArtifactChainProcessor'), 'hidden native Artifact chain removed'],\n  [!nativePatch.includes('set_extra'), 'hidden native Artifact parameter router removed'],\n  [!cmake.includes('artifact_chain_'), 'hidden Artifact chain targets removed'],\n];\n\nconst failed = checks.filter(([ok]) => !ok);\nif (failed.length) {\n  for (const [, label] of failed) console.error(\`FAIL: \${label}\`);\n  process.exit(1);\n}\n\nconsole.log(\`Artifact UI audit passed (\${checks.length} checks).\`);\n`;
write('scripts/artifact-matrix-ui-audit.mjs', artifactAudit);

let structuralAudit = read('scripts/audit.mjs');
const auditAnchor = "for (const [moduleId, source, expected] of controlContracts) {\n";
if (!structuralAudit.includes("Artifact ghost console control")) {
  const guards = "forbidText(app, \"{ id: 'console', label: 'Console'\", 'Artifact ghost console control');\nforbidText(app, \"{ id: 'tube', label: 'Tube'\", 'Artifact ghost tube control');\nforbidText(app, \"{ id: 'chainOrder', label: 'Order'\", 'Artifact ghost chain-order control');\nforbidText(app, 'isArtifactMatrixParameter', 'Artifact ghost parameter plumbing');\n\n";
  structuralAudit = replaceRequired(structuralAudit, auditAnchor, guards + auditAnchor, 'structural control-contract loop');
}
write('scripts/audit.mjs', structuralAudit);

for (const path of [
  'src/features/artifact/artifactMatrix.ts',
  'native/include/calcotone/artifact_chain_processor.hpp',
  'native/include/calcotone/artifact_chain_profiles.hpp',
  'native/src/artifact_chain_processor.cpp',
  'native/tests/artifact_chain_profile_test.cpp',
  'native/tests/artifact_chain_processor_test.cpp',
  'native/tests/native_artifact_chain_live_test.cpp',
]) {
  if (existsSync(path)) rmSync(path);
}

console.log('Removed Artifact console/tube/chainOrder UI state and the unused native chain.');
