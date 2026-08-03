import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (relative) => {
  const path = resolve(root, relative);
  if (!existsSync(path)) {
    failures.push(`Missing required file: ${relative}`);
    return '';
  }
  return readFileSync(path, 'utf8');
};
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};

const routing = read('src/routing/serialRouting.ts');
const app = read('src/App.tsx');
const railCModules = read('src/components/effects/RailCModules.tsx');
const vite = read('vite.config.ts');
const routingModule = await import('../src/routing/serialRouting.ts');

requireText(routing, 'SERIAL_SLOT_COUNT = 6', 'six-slot routing model');
requireText(routing, 'SERIAL_ROW_SIZE = 3', 'two-row visual projection');
requireText(routing, 'new Set(order).size !== SERIAL_SLOT_COUNT', 'duplicate-slot rejection');
requireText(routing, 'moveSerialModule(', 'cross-row move primitive');
requireText(routing, 'nudgeSerialModule(', 'six-position keyboard primitive');
requireText(routing, 'shuffledSerialOrder(', 'full-chain random primitive');
requireText(routing, "next.push(next.shift()!)", 'SIGNAL RANDOM visible-change guard');
requireText(routing, 'top: normalized.slice(0, SERIAL_ROW_SIZE)', 'top row projection');
requireText(routing, 'bottom: normalized.slice(SERIAL_ROW_SIZE, SERIAL_SLOT_COUNT)', 'bottom row projection');
requireText(routing, 'moveRackModule(', 'cross-rail rack move primitive');
requireText(routing, 'next[source.rail][source.index] = targetId', 'fixed-slot cross-rail exchange');
requireText(routing, 'serialOrderFromRack(', 'rack-to-eight-effect projection');
requireText(routing, "STACK_MODULE_ID = 'chaos'", 'STACK serial insert ownership');
requireText(routing, "STOMP_MODULE_ID = 'stomp'", 'STOMP serial insert ownership');
requireText(routing, 'restoreRackRail(', 'per-rail factory restore');
requireText(routing, 'shuffledRackOrder(', 'family-safe rack randomization');

requireText(app, "from './routing/serialRouting'", 'App directly uses routing owner');
requireText(app, 'moveRackModule(', 'native cross-rail drag');
requireText(app, 'nudgeRackModule(', 'native rack keyboard routing');
requireText(app, 'shuffledRackOrder(', 'native SIGNAL RANDOM routing');
requireText(app, "const DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure']", 'third rail ownership');
requireText(app, 'serialOrderFromRack({ A: nextA, B: nextB, C: nextC })', 'engine receives filtered eight-effect order');
requireText(app, 'setRailCOrder(next.C)', 'Rail C reorder state');
requireText(app, 'setRailCRandomOrder([...railAOrder, ...railBOrder, ...railCOrder])', 'controller RANDOM serialization follows rack order');
requireText(railCModules, 'STOMP_RACK_STATE', 'Stomp state survives cross-rail remount');
requireText(railCModules, 'CHAOS_RACK_STATE', 'Chaos state survives cross-rail remount');
if (vite.includes('serialRoutingTransform()')) failures.push('Retired serial routing transform is still enabled');

const defaultRack = {
  A: ['saturation', 'chorus', 'delay'],
  B: ['reverb', 'bitcrusher', 'media'],
  C: ['stomp', 'chaos', 'pressure'],
};
const exchanged = routingModule.moveRackModule(defaultRack, 'stomp', 'saturation');
if (exchanged.A.join(',') !== 'stomp,chorus,delay' || exchanged.C.join(',') !== 'saturation,chaos,pressure') {
  failures.push('Rail C → Rail A drag did not exchange fixed rack slots');
}
const exchangedIds = [...exchanged.A, ...exchanged.B, ...exchanged.C];
if (exchanged.A.length !== 3 || exchanged.B.length !== 3 || exchanged.C.length !== 3 || new Set(exchangedIds).size !== 9) {
  failures.push('Cross-rail drag changed the three-by-three rack topology');
}
const serialAfterExchange = routingModule.serialOrderFromRack(exchanged);
if (serialAfterExchange.join(',') !== 'stomp,chorus,delay,reverb,bitcrusher,media,saturation,chaos') {
  failures.push(`Cross-rail drag lost the eight-effect serial chain (${serialAfterExchange.join(',')})`);
}
const restored = routingModule.restoreRackRail(exchanged, 'A', defaultRack);
if (restored.A.join(',') !== defaultRack.A.join(',')) {
  failures.push('Rail A reset did not restore its factory modules after a cross-rail exchange');
}

if (failures.length) {
  console.error('\nCALCOTONE routing audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE routing audit passed (fixed nine-slot rack with cross-rail exchange and eight-effect projection).');
