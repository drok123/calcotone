export type RandomizationProfile =
  | 'smart'
  | 'bass'
  | 'pad'
  | 'lead'
  | 'retro-ambient'
  | 'lofi-tape'
  | 'gritty-drive'
  | 'mutate';

export const RANDOMIZATION_PROFILE_OPTIONS: readonly {
  id: Exclude<RandomizationProfile, 'mutate'>;
  label: string;
}[] = [
  { id: 'smart', label: 'Smart Patch' },
  { id: 'bass', label: 'Bass' },
  { id: 'pad', label: 'Pad / Ambient' },
  { id: 'lead', label: 'Lead / Keys' },
  { id: 'retro-ambient', label: 'Retro Ambient FX' },
  { id: 'lofi-tape', label: 'Lo-Fi Tape FX' },
  { id: 'gritty-drive', label: 'Gritty Drive FX' },
];

export const RANDOM_MORPH_SECONDS = 0.35;
export const RANDOM_MUTATION_AMOUNT = 0.10;
