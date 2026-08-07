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

export const STACK_MODULE_ID = 'chaos';
export const STOMP_MODULE_ID = 'stomp';
// Legacy layout key retained so the approved Pressure geometry becomes Loop
// without migrating or disturbing the faceplate coordinates.
export const LOOP_MODULE_ID = 'pressure';

export type SerialModuleId = (typeof DEFAULT_SERIAL_ORDER)[number];
export type SerialOrder = readonly string[];

export interface SerialRows {
  top: string[];
  bottom: string[];
}

export type RackRail = 'A' | 'B' | 'C';

export interface RackOrders {
  A: string[];
  B: string[];
  C: string[];
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

export function moveSerialModule(order: SerialOrder, sourceId: string, targetId: string): string[] {
  const current = normalizeSerialOrder(order);
  if (sourceId === targetId) return current;
  const from = current.indexOf(sourceId);
  const to = current.indexOf(targetId);
  if (from < 0 || to < 0) return current;
  current.splice(from, 1);
  current.splice(to, 0, sourceId);
  return current;
}

export function nudgeSerialModule(order: SerialOrder, moduleId: string, direction: -1 | 1): string[] {
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
  if (next.every((id, index) => id === current[index])) next.push(next.shift()!);
  return next;
}

export function describeSerialOrder(order: SerialOrder): string {
  return normalizeSerialOrder(order).join(' → ');
}

export function serialOrderFromRack(rack: RackOrders): string[] {
  const serialIds = new Set<string>([...DEFAULT_SERIAL_ORDER, STOMP_MODULE_ID, STACK_MODULE_ID]);
  const projected = ([...rack.A, ...rack.B, ...rack.C]).filter((moduleId) => serialIds.has(moduleId));
  return projected.length === DEFAULT_SERIAL_ORDER.length + 2
    ? projected
    : [...DEFAULT_SERIAL_ORDER, STOMP_MODULE_ID, STACK_MODULE_ID];
}

function locateRackModule(rack: RackOrders, moduleId: string): { rail: RackRail; index: number } | null {
  for (const rail of ['A', 'B', 'C'] as const) {
    const index = rack[rail].indexOf(moduleId);
    if (index >= 0) return { rail, index };
  }
  return null;
}

function cloneRack(rack: RackOrders): RackOrders {
  return { A: [...rack.A], B: [...rack.B], C: [...rack.C] };
}

/** LOOP is visually parked in Rail C but never participates in serial routing. */
export function moveRackModule(rack: RackOrders, sourceId: string, targetId: string): RackOrders {
  if (sourceId === LOOP_MODULE_ID || targetId === LOOP_MODULE_ID) return cloneRack(rack);
  if (sourceId === targetId) return cloneRack(rack);
  const source = locateRackModule(rack, sourceId);
  const target = locateRackModule(rack, targetId);
  if (!source || !target) return cloneRack(rack);

  const next = cloneRack(rack);
  if (source.rail === target.rail) {
    const order = next[source.rail];
    order.splice(source.index, 1);
    order.splice(target.index, 0, sourceId);
    return next;
  }

  next[source.rail][source.index] = targetId;
  next[target.rail][target.index] = sourceId;
  return next;
}

export function nudgeRackModule(rack: RackOrders, moduleId: string, direction: -1 | 1): RackOrders {
  if (moduleId === LOOP_MODULE_ID) return cloneRack(rack);
  const location = locateRackModule(rack, moduleId);
  if (!location) return cloneRack(rack);
  const targetIndex = location.index + direction;
  if (targetIndex < 0 || targetIndex >= rack[location.rail].length) return cloneRack(rack);
  const target = rack[location.rail][targetIndex]!;
  if (target === LOOP_MODULE_ID) return cloneRack(rack);
  return moveRackModule(rack, moduleId, target);
}

export function restoreRackRail(rack: RackOrders, rail: RackRail, defaults: RackOrders): RackOrders {
  const next = cloneRack(rack);
  for (let index = 0; index < defaults[rail].length; index += 1) {
    const wanted = defaults[rail][index]!;
    const location = locateRackModule(next, wanted);
    if (!location) continue;
    const displaced = next[rail][index]!;
    next[rail][index] = wanted;
    next[location.rail][location.index] = displaced;
  }
  return next;
}

function shuffled(values: readonly string[], random: () => number): string[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }
  if (next.length > 1 && next.every((value, index) => value === values[index])) next.push(next.shift()!);
  return next;
}

/** SIGNAL RANDOM leaves LOOP fixed and only shuffles effect/controller families. */
export function shuffledRackOrder(rack: RackOrders, random = Math.random): RackOrders {
  const next = cloneRack(rack);
  const serialIds = new Set<string>(DEFAULT_SERIAL_ORDER);
  const serialSlots: Array<{ rail: RackRail; index: number }> = [];
  const controllerSlots: Array<{ rail: RackRail; index: number }> = [];
  const serialModules: string[] = [];
  const controllerModules: string[] = [];

  for (const rail of ['A', 'B', 'C'] as const) {
    rack[rail].forEach((moduleId, index) => {
      if (moduleId === LOOP_MODULE_ID) return;
      if (serialIds.has(moduleId)) {
        serialSlots.push({ rail, index });
        serialModules.push(moduleId);
      } else {
        controllerSlots.push({ rail, index });
        controllerModules.push(moduleId);
      }
    });
  }

  shuffled(serialModules, random).forEach((moduleId, index) => {
    const slot = serialSlots[index]!;
    next[slot.rail][slot.index] = moduleId;
  });
  shuffled(controllerModules, random).forEach((moduleId, index) => {
    const slot = controllerSlots[index]!;
    next[slot.rail][slot.index] = moduleId;
  });
  return next;
}
