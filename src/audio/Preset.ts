import type { EffectId } from './EffectFactory';

export interface PresetEffect {
  id: EffectId;
  enabled: boolean;
  parameters: Record<string, number>;
}

export interface Preset {
  id: string;
  name: string;
  inputGain: number;
  outputGain: number;
  effects: PresetEffect[];
}

export const DEFAULT_PRESET: Preset = {
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
