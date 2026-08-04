import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Artifact UI patch anchor missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function writeIfChanged(path, next) {
  const current = fs.readFileSync(path, 'utf8');
  if (current === next) return false;
  fs.writeFileSync(path, next, 'utf8');
  return true;
}

const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');

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
let effectModule = fs.readFileSync(modulePath, 'utf8');

effectModule = replaceOnce(
  effectModule,
  "import { ModuleViewport } from './ModuleViewport';",
  "import { ModuleViewport } from './ModuleViewport';\nimport { ArtifactMatrixSelectors } from './ArtifactMatrixSelectors';\nimport { normalizeArtifactMatrix } from '../../features/artifact/artifactMatrix';",
  'Artifact selector imports',
);

effectModule = replaceOnce(
  effectModule,
  "  const moduleStyle = {",
  "  const visibleParameters = module.parameters.filter((parameter) => !['console', 'tube', 'chainOrder'].includes(parameter.id));\n  const moduleStyle = {",
  'Artifact discrete knob filtering',
);

effectModule = replaceOnce(
  effectModule,
  "          {module.id === 'media' && (\n            <label className=\"algorithm-selector media-mode-selector\">\n              <span className=\"sr-only\">Format</span>\n              <select aria-label=\"Artifact format\" value={module.mediaMode ?? 'cassette'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}>\n                {MEDIA_MODE_GROUPS.map((group) => (\n                  <optgroup key={group.label} label={group.label}>\n                    {group.modes.map((mode) => <option key={mode} value={mode}>{formatMediaMode(mode)}</option>)}\n                  </optgroup>\n                ))}\n              </select>\n            </label>\n          )}",
  "          {module.id === 'media' && (\n            <>\n              <label className=\"algorithm-selector media-mode-selector\">\n                <span className=\"sr-only\">Format</span>\n                <select aria-label=\"Artifact format\" value={module.mediaMode ?? 'cassette'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}>\n                  {MEDIA_MODE_GROUPS.map((group) => (\n                    <optgroup key={group.label} label={group.label}>\n                      {group.modes.map((mode) => <option key={mode} value={mode}>{formatMediaMode(mode)}</option>)}\n                    </optgroup>\n                  ))}\n                </select>\n              </label>\n              <ArtifactMatrixSelectors\n                value={normalizeArtifactMatrix({\n                  console: module.parameters.find((parameter) => parameter.id === 'console')?.value,\n                  tube: module.parameters.find((parameter) => parameter.id === 'tube')?.value,\n                  chainOrder: module.parameters.find((parameter) => parameter.id === 'chainOrder')?.value,\n                })}\n                disabled={!module.available}\n                onChange={(next) => {\n                  onParameterChange('console', next.console);\n                  onParameterChange('tube', next.tube);\n                  onParameterChange('chainOrder', next.chainOrder);\n                }}\n              />\n            </>\n          )}",
  'Artifact selector rendering',
);

effectModule = replaceOnce(
  effectModule,
  '{module.parameters.map((parameter, index) => {',
  '{visibleParameters.map((parameter, index) => {',
  'Artifact custom faceplate knob filtering',
);

effectModule = replaceOnce(
  effectModule,
  '{module.parameters.map((parameter) => renderKnob(parameter))}',
  '{visibleParameters.map((parameter) => renderKnob(parameter))}',
  'Artifact standard knob filtering',
);

writeIfChanged(modulePath, effectModule);
console.log('Artifact matrix UI wiring applied.');
