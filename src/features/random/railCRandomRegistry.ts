import type { RandomizationProfile } from './randomProfiles';

// LOOP is deliberately absent: it is a standalone performance recorder and
// RANDOM must never mutate its track selection, levels, transport, or memory.
export const RAIL_C_RANDOM_ORDER = ['stomp', 'chaos'] as const;

export type RailCRandomModuleId = (typeof RAIL_C_RANDOM_ORDER)[number];

type RailCRandomController = {
  isEnabled: () => boolean;
  randomize: (profile: RandomizationProfile) => string | null;
};

const controllers = new Map<RailCRandomModuleId, RailCRandomController>();
let serialOrder: RailCRandomModuleId[] = [...RAIL_C_RANDOM_ORDER];

function isRailCRandomModuleId(moduleId: string): moduleId is RailCRandomModuleId {
  return RAIL_C_RANDOM_ORDER.some((candidate) => candidate === moduleId);
}

export function registerRailCRandomController(
  moduleId: RailCRandomModuleId,
  controller: RailCRandomController
): () => void {
  controllers.set(moduleId, controller);
  return () => {
    if (controllers.get(moduleId) === controller) controllers.delete(moduleId);
  };
}

export function setRailCRandomOrder(order: readonly string[]): void {
  const next = order.filter(isRailCRandomModuleId);
  for (const moduleId of RAIL_C_RANDOM_ORDER) {
    if (!next.includes(moduleId)) next.push(moduleId);
  }
  serialOrder = next;
}

export function getActiveRailCRandomModuleIds(): RailCRandomModuleId[] {
  return serialOrder.filter((moduleId) => controllers.get(moduleId)?.isEnabled());
}

export function randomizeRailCModule(
  moduleId: RailCRandomModuleId,
  profile: RandomizationProfile = 'smart'
): string | null {
  const controller = controllers.get(moduleId);
  if (!controller?.isEnabled()) return null;
  return controller.randomize(profile);
}
