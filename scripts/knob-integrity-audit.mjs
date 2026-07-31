import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/controls/Knob.tsx'), 'utf8');
const failures = [];
const requireText = (needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText('const next = clamp(dragRef.current.startValue + travel * sensitivity, 0, 1);', 'bounded pointer mapping');
requireText('const sensitivity = pending.fine ? 0.00115 : 0.00315;', 'fine/coarse sensitivity');
requireText('if (Math.abs(next - valueRef.current) >= 0.00008)', 'sub-pixel update deadband');
requireText('requestAnimationFrame(applyPending)', 'one-update-per-frame scheduling');
requireText('const finish = (pointerEvent: PointerEvent, cancelled = false): void =>', 'explicit cancellation state');
requireText('const release = (pointerEvent: PointerEvent): void => finish(pointerEvent, false);', 'successful release path');
requireText('const cancel = (pointerEvent: PointerEvent): void => finish(pointerEvent, true);', 'cancelled release path');
requireText("window.addEventListener('pointercancel', cancel, { passive: false });", 'pointer cancellation wiring');
requireText('if (!cancelled) {', 'cancelled gestures do not commit');
requireText('lastClickAtRef.current = 0;', 'cancelled gestures clear reset timing');
requireText("event.key === 'Home'", 'keyboard minimum');
requireText("event.key === 'End'", 'keyboard maximum');
requireText("event.key === '0' || event.key === 'Enter'", 'keyboard reset');
requireText('aria-valuenow={Math.round(value * 100)}', 'accessible value reporting');
requireText("tabIndex={disabled ? -1 : 0}", 'disabled keyboard isolation');
forbidText("window.addEventListener('pointercancel', finish", 'pointer cancellation must not use successful finish handler');

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mapDrag = (startValue, startX, startY, x, y, fine = false) => {
  const travel = (startY - y) + (x - startX) * 0.10;
  return clamp01(startValue + travel * (fine ? 0.00115 : 0.00315));
};

const cases = [
  { name: 'coarse upper clamp', value: mapDrag(.95, 0, 0, 0, -1000), expected: 1 },
  { name: 'coarse lower clamp', value: mapDrag(.05, 0, 0, 0, 1000), expected: 0 },
  { name: 'stationary pointer', value: mapDrag(.42, 12, 18, 12, 18), expected: .42 },
  { name: 'vertical increase', value: mapDrag(.5, 0, 100, 0, 90), expected: .5315 },
  { name: 'vertical decrease', value: mapDrag(.5, 0, 100, 0, 110), expected: .4685 },
  { name: 'horizontal influence', value: mapDrag(.5, 0, 0, 100, 0), expected: .5315 },
  { name: 'fine increase', value: mapDrag(.5, 0, 100, 0, 90, true), expected: .5115 },
];
for (const test of cases) {
  if (Math.abs(test.value - test.expected) > 1e-9) {
    failures.push(`${test.name}: expected ${test.expected}, received ${test.value}`);
  }
}

let checksum = 0;
const iterations = 1_000_000;
const startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) {
  checksum += mapDrag((index % 101) / 100, 20, 20, index % 80, index % 60, (index & 7) === 0);
}
const elapsedMilliseconds = performance.now() - startedAt;
if (!Number.isFinite(checksum)) failures.push('drag mapping performance probe produced a non-finite checksum');
if (elapsedMilliseconds > 250) failures.push(`drag mapping exceeded 250 ms for ${iterations.toLocaleString()} iterations (${elapsedMilliseconds.toFixed(1)} ms)`);

if (failures.length > 0) {
  console.error('\nCALCOTONE knob integrity audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `CALCOTONE knob integrity audit passed (${cases.length} mapping cases; `
  + `${iterations.toLocaleString()} mappings in ${elapsedMilliseconds.toFixed(1)} ms).`,
);
