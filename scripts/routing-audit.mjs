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
const transform = read('build/serialRoutingTransform.ts');
const vite = read('vite.config.ts');

requireText(routing, 'SERIAL_SLOT_COUNT = 6', 'six-slot routing model');
requireText(routing, 'SERIAL_ROW_SIZE = 3', 'two-row visual projection');
requireText(routing, 'new Set(order).size !== SERIAL_SLOT_COUNT', 'duplicate-slot rejection');
requireText(routing, 'moveSerialModule(', 'cross-row move primitive');
requireText(routing, 'nudgeSerialModule(', 'six-position keyboard primitive');
requireText(routing, 'shuffledSerialOrder(', 'full-chain random primitive');
requireText(routing, "next.push(next.shift()!)", 'SIGNAL RANDOM visible-change guard');
requireText(routing, 'top: normalized.slice(0, SERIAL_ROW_SIZE)', 'top row projection');
requireText(routing, 'bottom: normalized.slice(SERIAL_ROW_SIZE, SERIAL_SLOT_COUNT)', 'bottom row projection');

requireText(transform, "from './routing/serialRouting'", 'App adapter uses routing owner');
requireText(transform, 'moveSerialModule([...railAOrder, ...railBOrder]', 'drag delegates to routing owner');
requireText(transform, 'nudgeSerialModule([...railAOrder, ...railBOrder]', 'nudge delegates to routing owner');
requireText(transform, 'shuffledSerialOrder([...railAOrder, ...railBOrder]', 'signal random delegates to routing owner');
requireText(transform, 'if (!draggedModuleId) return;', 'cross-row drag-over acceptance');
requireText(transform, 'cross-row lockout survived transform', 'adapter fail-closed guard');
requireText(transform, 'replaceRegexRequired(', 'adapter uses robust source matching');

requireText(vite, 'serialRoutingTransform()', 'temporary routing adapter enabled');

if (failures.length) {
  console.error('\nCALCOTONE routing audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE routing audit passed (six-slot serial model + cross-row drag adapter).');
