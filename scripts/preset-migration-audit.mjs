import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = readFileSync(resolve(process.cwd(), 'src/audio/Preset.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const presetModule = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const { migrateProcessingFamilyPreset } = presetModule;

function preset(schemaVersion, saturation, media, grain = { enabled: false, mode: 2 }) {
  const { enabled: saturationEnabled, ...saturationParameters } = saturation;
  const { enabled: mediaEnabled, ...mediaParameters } = media;
  const { enabled: grainEnabled, ...grainParameters } = grain;
  return {
    schemaVersion,
    id: 'migration-audit',
    name: 'Migration audit',
    inputGain: 1,
    outputGain: 1,
    effects: [
      { id: 'saturation', enabled: saturationEnabled, parameters: saturationParameters },
      { id: 'media', enabled: mediaEnabled, parameters: mediaParameters },
      { id: 'bitcrusher', enabled: grainEnabled, parameters: grainParameters },
    ],
  };
}

function effect(result, id) {
  const found = result.effects.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing ${id} effect after migration.`);
  return found;
}

function requireState(label, result, expected) {
  if (result.schemaVersion !== 3) throw new Error(`${label}: expected schema v3.`);
  for (const [id, state] of Object.entries(expected)) {
    const migrated = effect(result, id);
    if (migrated.enabled !== state.enabled || migrated.parameters.mode !== state.mode) {
      throw new Error(
        `${label}: expected ${id} enabled=${state.enabled} mode=${state.mode}; `
        + `received enabled=${migrated.enabled} mode=${migrated.parameters.mode}.`,
      );
    }
    for (const [parameterId, expectedValue] of Object.entries(state.parameters ?? {})) {
      const actualValue = migrated.parameters[parameterId];
      if (Math.abs(actualValue - expectedValue) > 1e-9) {
        throw new Error(`${label}: expected ${id}.${parameterId}=${expectedValue}; received ${actualValue}.`);
      }
    }
  }
}

requireState(
  'v2 simultaneous ownership swap',
  migrateProcessingFamilyPreset(preset(
    2,
    { enabled: true, mode: 13, drive: 0.31, heat: 0.41, character: 0.51, dynamics: 0.61, mix: 0.71 },
    { enabled: true, mode: 14, wear: 0.21, wow: 0.31, noise: 0.41, tone: 0.51, mix: 0.61 },
  )),
  {
    saturation: {
      enabled: true,
      mode: 17,
      parameters: { drive: 0.21, tone: 5_718, heat: 0.41, character: 0.51, dynamics: 0.38, mix: 0.61 },
    },
    media: {
      enabled: true,
      mode: 9,
      parameters: { wear: 0.61, wow: 0.31, noise: 0.51, tone: 0.41, mix: 0.71 },
    },
  },
);

requireState(
  'v2 console-only migration',
  migrateProcessingFamilyPreset(preset(2, { enabled: true, mode: 12 }, { enabled: true, mode: 0 })),
  {
    saturation: { enabled: false, mode: 0 },
    media: { enabled: true, mode: 8 },
  },
);

requireState(
  'v2 digital-capture-only migration',
  migrateProcessingFamilyPreset(preset(2, { enabled: true, mode: 0 }, { enabled: true, mode: 13 })),
  {
    saturation: { enabled: true, mode: 16 },
    media: { enabled: false, mode: 0 },
  },
);

requireState(
  'v1 console plus Grain sampler migration',
  migrateProcessingFamilyPreset(preset(
    1,
    { enabled: false, mode: 0 },
    { enabled: true, mode: 10 },
    { enabled: true, mode: 11 },
  )),
  {
    saturation: { enabled: true, mode: 17 },
    media: { enabled: true, mode: 10 },
    bitcrusher: { enabled: false, mode: 2 },
  },
);

console.log('CALCOTONE preset migration audit passed (v1 and v2 family ownership preserved).');
