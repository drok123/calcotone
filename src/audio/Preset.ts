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
  schemaVersion: 2,
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

/**
 * Moves v1 machine selections to their processing-family owners. The transform
 * is intentionally centralized at preset load so numeric mode indices never
 * select a different machine by accident after the dropdown reorganization.
 */
export function migrateProcessingFamilyPreset(preset: Preset): Preset {
  if ((preset.schemaVersion ?? 1) >= 2) return preset;
  const effects = preset.effects.map((effect) => ({
    ...effect,
    parameters: { ...effect.parameters },
  }));
  const grain = effects.find((effect) => effect.id === 'bitcrusher');
  const artifact = effects.find((effect) => effect.id === 'media');
  const ember = effects.find((effect) => effect.id === 'saturation');

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

  return { ...preset, schemaVersion: 2, effects };
}
