export const RANDOM_UI_MODULE_EVENT = 'calcotone:random-ui-module';
export const RANDOM_UI_COMPLETE_EVENT = 'calcotone:random-ui-complete';

export const RANDOM_UI_EFFECT_ORDER = [
  'saturation',
  'chorus',
  'bitcrusher',
  'media',
  'delay',
  'reverb',
] as const;

export type RandomUiModuleDetail = {
  effectId: string;
};

export type RandomUiCompleteDetail = {
  completed: boolean;
};

export function revealRandomUiModule(effectId: string): void {
  window.dispatchEvent(
    new CustomEvent<RandomUiModuleDetail>(RANDOM_UI_MODULE_EVENT, {
      detail: { effectId },
    })
  );
}

export function completeRandomUiFlow(completed = true): void {
  window.dispatchEvent(
    new CustomEvent<RandomUiCompleteDetail>(RANDOM_UI_COMPLETE_EVENT, {
      detail: { completed },
    })
  );
}
