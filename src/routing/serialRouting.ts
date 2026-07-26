export const SERIAL_SLOT_COUNT = 6;
export const SERIAL_ROW_SIZE = 3;

export const DEFAULT_SERIAL_ORDER = [
  'saturation',
  'chorus',
  'delay',
  'reverb',
  'bitcrusher',
  'media',
] as const;

export type SerialModuleId = (typeof DEFAULT_SERIAL_ORDER)[number];
export type SerialOrder = readonly string[];

export interface SerialRows {
  top: string[];
  bottom: string[];
}

export function isValidSerialOrder(order: SerialOrder): boolean {
  if (order.length !== SERIAL_SLOT_COUNT) return false;
  if (new Set(order).size !== SERIAL_SLOT_COUNT) return false;
  return DEFAULT_SERIAL_ORDER.every((id) => order.includes(id));
}

export function normalizeSerialOrder(order: SerialOrder): string[] {
  return isValidSerialOrder(order) ? [...order] : [...DEFAULT_SERIAL_ORDER];
}

export function serialRows(order: SerialOrder): SerialRows {
  const normalized = normalizeSerialOrder(order);
  return {
    top: normalized.slice(0, SERIAL_ROW_SIZE),
    bottom: normalized.slice(SERIAL_ROW_SIZE, SERIAL_SLOT_COUNT),
  };
}

export function moveSerialModule(
  order: SerialOrder,
  sourceId: string,
  targetId: string,
): string[] {
  const current = normalizeSerialOrder(order);
  if (sourceId === targetId) return current;

  const from = current.indexOf(sourceId);
  const to = current.indexOf(targetId);
  if (from < 0 || to < 0) return current;

  current.splice(from, 1);
  current.splice(to, 0, sourceId);
  return current;
}

export function nudgeSerialModule(
  order: SerialOrder,
  moduleId: string,
  direction: -1 | 1,
): string[] {
  const current = normalizeSerialOrder(order);
  const index = current.indexOf(moduleId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;

  [current[index], current[targetIndex]] = [current[targetIndex]!, current[index]!];
  return current;
}

export function shuffledSerialOrder(order: SerialOrder, random = Math.random): string[] {
  const current = normalizeSerialOrder(order);
  const next = [...current];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }

  // SIGNAL RANDOM should always produce a visible topology change.
  if (next.every((id, index) => id === current[index])) {
    next.push(next.shift()!);
  }

  return next;
}

export function describeSerialOrder(order: SerialOrder): string {
  return normalizeSerialOrder(order).join(' → ');
}
