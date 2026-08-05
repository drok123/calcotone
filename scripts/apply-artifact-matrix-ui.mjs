import fs from 'node:fs';

function normalizeNewlines(source) {
  return source.replace(/\r\n?/g, '\n');
}

function readNormalized(path) {
  return normalizeNewlines(fs.readFileSync(path, 'utf8'));
}

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Artifact UI patch anchor missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function writeIfChanged(path, next) {
  const current = readNormalized(path);
  if (current === next) return false;
  fs.writeFileSync(path, next, 'utf8');
  return true;
}

const appPath = 'src/App.tsx';
let app = readNormalized(appPath);

app = replaceOnce(
  app,
  "      { id: 'mix', label: 'Mix', value: 0.26, display: '26%' },\n    ],\n  },\n];",
  "      { id: 'mix', label: 'Mix', value: 0.26, display: '26%' },\n      { id: 'console', label: 'Console', value: 0, display: 'Bypass' },\n      { id: 'tube', label: 'Tube', value: 0, display: 'Bypass' },\n      { id: 'chainOrder', label: 'Order', value: 0, display: 'Console → Tube' },\n    ],\n  },\n];",
  'Artifact initial matrix parameters',
);

app = replaceOnce(
  app,
  "function randomMusicalValue(range: MusicalRange, centerBias = 0.35): number {",
  "const ARTIFACT_MATRIX_PARAMETER_IDS = new Set(['console', 'tube', 'chainOrder']);\n\nfunction isArtifactMatrixParameter(moduleId: string, parameterId: string): boolean {\n  return moduleId === 'media' && ARTIFACT_MATRIX_PARAMETER_IDS.has(parameterId);\n}\n\nfunction randomMusicalValue(range: MusicalRange, centerBias = 0.35): number {",
  'Artifact matrix parameter helper',
);

app = replaceOnce(
  app,
  "  function updateParameter(\n    moduleId: string,\n    parameterId: string,\n    value: number\n  ): void {",
  "  function updateParameter(\n    moduleId: string,\n    parameterId: string,\n    value: number\n  ): void {\n    if (isArtifactMatrixParameter(moduleId, parameterId)) value = Math.round(value);",
  'Artifact discrete parameter clamping',
);

app = replaceOnce(
  app,
  "      else setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);",
  "      else if (!isArtifactMatrixParameter(moduleId, parameterId)) setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);",
  'Artifact web fallback guard',
);

app = replaceOnce(
  app,
  "        const range = profileRecipe?.parameters[parameter.id]\n          ?? sweetSpot?.parameters[parameter.id]\n          ?? genericRanges[parameter.id];\n        if (!range) return parameter;",
  "        if (isArtifactMatrixParameter(modeModule.id, parameter.id)) {\n          const maximum = parameter.id === 'chainOrder' ? 1 : 5;\n          const next = profile === 'mutate'\n            ? Math.max(0, Math.min(maximum, Math.round(parameter.value + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0))))\n            : Math.floor(Math.random() * (maximum + 1));\n          return { ...parameter, value: next, display: formatParameterValue(modeModule.id, parameter.id, next) };\n        }\n        const range = profileRecipe?.parameters[parameter.id]\n          ?? sweetSpot?.parameters[parameter.id]\n          ?? genericRanges[parameter.id];\n        if (!range) return parameter;",
  'Artifact matrix randomization',
);

app = replaceOnce(
  app,
  "        for (const parameter of module.parameters) {\n          setEffectParameterIfLoaded(\n            engine,",
  "        for (const parameter of module.parameters) {\n          if (isArtifactMatrixParameter(module.id, parameter.id)) continue;\n          setEffectParameterIfLoaded(\n            engine,",
  'Artifact web random sync guard',
);

writeIfChanged(appPath, app);

const modulePath = 'src/components/effects/EffectModule.tsx';
let effectModule = readNormalized(modulePath);

effectModule = effectModule
  .replace("\nimport { ArtifactMatrixSelectors } from './ArtifactMatrixSelectors';", '')
  .replace("\nimport { normalizeArtifactMatrix } from '../../features/artifact/artifactMatrix';", '');

if (!effectModule.includes("const visibleParameters = module.parameters.filter((parameter) => !['console', 'tube', 'chainOrder'].includes(parameter.id));")) {
  effectModule = replaceOnce(
    effectModule,
    "  const moduleStyle = {",
    "  const visibleParameters = module.parameters.filter((parameter) => !['console', 'tube', 'chainOrder'].includes(parameter.id));\n  const moduleStyle = {",
    'Artifact discrete knob filtering',
  );
}

const expandedArtifactSelector = `          {module.id === 'media' && (
            <>
              <label className="algorithm-selector media-mode-selector">
                <span className="sr-only">Format</span>
                <select aria-label="Artifact format" value={module.mediaMode ?? 'cassette'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}>
                  {MEDIA_MODE_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.modes.map((mode) => <option key={mode} value={mode}>{formatMediaMode(mode)}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <ArtifactMatrixSelectors
                value={normalizeArtifactMatrix({
                  console: module.parameters.find((parameter) => parameter.id === 'console')?.value,
                  tube: module.parameters.find((parameter) => parameter.id === 'tube')?.value,
                  chainOrder: module.parameters.find((parameter) => parameter.id === 'chainOrder')?.value,
                })}
                disabled={!module.available}
                onChange={(next) => {
                  onParameterChange('console', next.console);
                  onParameterChange('tube', next.tube);
                  onParameterChange('chainOrder', next.chainOrder);
                }}
              />
            </>
          )}`;

const singleArtifactSelector = `          {module.id === 'media' && (
            <label className="algorithm-selector media-mode-selector">
              <span className="sr-only">Format</span>
              <select aria-label="Artifact format" value={module.mediaMode ?? 'cassette'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}>
                {MEDIA_MODE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.modes.map((mode) => <option key={mode} value={mode}>{formatMediaMode(mode)}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}`;

effectModule = effectModule.replace(expandedArtifactSelector, singleArtifactSelector);
effectModule = effectModule.replaceAll('{module.parameters.map((parameter, index) => {', '{visibleParameters.map((parameter, index) => {');
effectModule = effectModule.replaceAll('{module.parameters.map((parameter) => renderKnob(parameter))}', '{visibleParameters.map((parameter) => renderKnob(parameter))}');

if (effectModule.includes('ArtifactMatrixSelectors') || effectModule.includes('normalizeArtifactMatrix')) {
  throw new Error('Artifact selector cleanup incomplete.');
}

writeIfChanged(modulePath, effectModule);
console.log('Artifact state wiring retained with one visible format selector.');
