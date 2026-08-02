import type { EffectId } from './EffectFactory';

export interface PresetEffect {
  id: EffectId;
  enabled: boolean;
  parameters: Record<string, number>;
}

export interface Preset {
  schemaVersion?: number;
  id: string;
  name: string;
  inputGain: number;
  outputGain: number;
  effects: PresetEffect[];
}

export const DEFAULT_PRESET: Preset = {
  schemaVersion: 3,
  id: 'default-warm-drive',
  name: 'Warm Drive',
  inputGain: 1,
  outputGain: 0.72,
  effects: [
    {
      id: 'saturation',
      enabled: false,
      parameters: { mode: 0, drive: 0.14, tone: 9_500, heat: 0.18, character: 0.22, dynamics: 0.38, mix: 0.22 },
    },
    {
      id: 'chorus',
      enabled: false,
      parameters: { mode: 0, rate: 0.28, depth: 0.0022, shape: 0.35, spread: 0.62, motion: 0.32, mix: 0.14 },
    },
    {
      id: 'delay',
      enabled: false,
      parameters: {
        time: 0.36,
        feedback: 0.22,
        color: 0.42,
        character: 0.14,
        width: 0.58,
        mix: 0.14,
      },
    },
    {
      id: 'reverb',
      enabled: false,
      parameters: {
        decay: 2.4,
        size: 0.52,
        color: 0.42,
        diffusion: 0.74,
        motion: 0.18,
        mix: 0.13,
      },
    },
    {
      id: 'bitcrusher',
      enabled: false,
      parameters: {
        bits: 13,
        density: 0.42,
        pitch: 0.38,
        chaos: 0.16,
        bloom: 0.36,
        mix: 0.12,
      },
    },
    {
      id: 'media',
      enabled: false,
      parameters: {
        mode: 0,
        wear: 0.162,
        wow: 0.16,
        noise: 0.1,
        tone: 0.62,
        mix: 0.26,
      },
    },
    {
      id: 'chaos',
      enabled: true,
      parameters: {
        model: 5,
        cabinet: 2,
        drive: 0.36,
        tone: 0.52,
        sag: 0.34,
        mix: 0.62,
      },
    },
  ],
};

const LEGACY_GRAIN_SAMPLERS = ['sp1200','mpc60','mirage','s950','emulator2','fairlightiix'] as const;
const CURRENT_ARTIFACT_MODE_INDEX: Record<typeof LEGACY_GRAIN_SAMPLERS[number], number> = {
  sp1200: 8,
  mpc60: 9,
  mirage: 10,
  s950: 11,
  emulator2: 13,
  fairlightiix: 14,
};
const LEGACY_ARTIFACT_CONSOLE_TO_EMBER = new Map<number, number>([
  [8, 12],
  [9, 13],
  [10, 14],
  [11, 15],
]);
const V2_EMBER_CONSOLE_TO_ARTIFACT = new Map<number, number>([
  [12, 8],
  [13, 9],
  [14, 10],
  [15, 11],
]);
const V2_ARTIFACT_CAPTURE_TO_EMBER = new Map<number, number>([
  [8, 12],
  [9, 13],
  [10, 14],
  [11, 15],
  [13, 16],
  [14, 17],
]);

/**
 * Moves legacy machine selections to their current processing-family owners.
 * The transform is centralized at preset load so numeric mode indices never
 * select a different machine by accident after dropdown reorganization.
 */
export function migrateProcessingFamilyPreset(preset: Preset): Preset {
  const startingSchema = preset.schemaVersion ?? 1;
  if (startingSchema >= 3) return preset;
  const effects = preset.effects.map((effect) => ({
    ...effect,
    parameters: { ...effect.parameters },
  }));
  const grain = effects.find((effect) => effect.id === 'bitcrusher');
  const artifact = effects.find((effect) => effect.id === 'media');
  const ember = effects.find((effect) => effect.id === 'saturation');

  if (startingSchema < 2) {
    const legacyArtifactMode = Math.round(artifact?.parameters.mode ?? 0);
    const emberMode = LEGACY_ARTIFACT_CONSOLE_TO_EMBER.get(legacyArtifactMode);
    if (emberMode !== undefined && artifact && ember) {
      ember.parameters.mode = emberMode;
      ember.enabled = ember.enabled || artifact.enabled;
      artifact.enabled = false;
      artifact.parameters.mode = 0;
    }

    const legacyGrainMode = Math.round(grain?.parameters.mode ?? -1);
    const sampler = LEGACY_GRAIN_SAMPLERS[legacyGrainMode - 6];
    if (sampler && grain && artifact) {
      artifact.parameters.mode = CURRENT_ARTIFACT_MODE_INDEX[sampler];
      artifact.enabled = artifact.enabled || grain.enabled;
      grain.enabled = false;
      grain.parameters.mode = 2;
    }
  }

  if (artifact && ember) {
    const originalEmberMode = Math.round(ember.parameters.mode ?? 0);
    const originalArtifactMode = Math.round(artifact.parameters.mode ?? 0);
    const originalEmberParameters = { ...ember.parameters };
    const originalArtifactParameters = { ...artifact.parameters };
    const artifactConsoleMode = V2_EMBER_CONSOLE_TO_ARTIFACT.get(originalEmberMode);
    const emberCaptureMode = V2_ARTIFACT_CAPTURE_TO_EMBER.get(originalArtifactMode);
    const originalEmberEnabled = ember.enabled;
    const originalArtifactEnabled = artifact.enabled;

    if (artifactConsoleMode !== undefined) {
      artifact.parameters = {
        ...artifact.parameters,
        ...(startingSchema === 2 ? consoleParametersFromV2Ember(originalEmberMode, originalEmberParameters) : {}),
        mode: artifactConsoleMode,
      };
      artifact.enabled = originalEmberEnabled;
    }
    if (emberCaptureMode !== undefined) {
      ember.parameters = {
        ...ember.parameters,
        ...(startingSchema === 2 ? digitalCaptureParametersFromV2Artifact(originalArtifactParameters) : {}),
        mode: emberCaptureMode,
      };
      ember.enabled = originalArtifactEnabled;
    }
    if (artifactConsoleMode !== undefined && emberCaptureMode === undefined) {
      ember.parameters.mode = 0;
      ember.enabled = false;
    }
    if (emberCaptureMode !== undefined && artifactConsoleMode === undefined) {
      artifact.parameters.mode = 0;
      artifact.enabled = false;
    }
  }

  return { ...preset, schemaVersion: 3, effects };
}

function consoleParametersFromV2Ember(
  mode: number,
  parameters: Record<string, number>,
): Record<string, number> {
  const drive = clamp01(parameters.drive ?? 0.14);
  const heat = clamp01(parameters.heat ?? 0.18);
  const character = clamp01(parameters.character ?? 0.22);
  const dynamics = clamp01(parameters.dynamics ?? 0.38);
  return {
    wear: mode === 12 ? drive : dynamics,
    noise: character,
    tone: heat,
    mix: clamp01(parameters.mix ?? 0.22),
  };
}

function digitalCaptureParametersFromV2Artifact(
  parameters: Record<string, number>,
): Record<string, number> {
  return {
    drive: clamp01(parameters.wear ?? 0.162),
    tone: 200 + clamp01(parameters.wow ?? 0.16) * 17_800,
    heat: clamp01(parameters.noise ?? 0.1),
    character: clamp01(parameters.tone ?? 0.62),
    dynamics: 0.38,
    mix: clamp01(parameters.mix ?? 0.26),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
