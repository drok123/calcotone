import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const failures = [];

const css = read('src/App.css');
const effect = read('src/components/effects/EffectModule.tsx');
const layout = read('src/ui/faceplateLayout.ts');
const railC = read('src/components/effects/RailCModules.css');
const visualAudit = read('scripts/visual-audit.mjs');

const forbid = (condition, message) => { if (condition) failures.push(message); };
const require = (condition, message) => { if (!condition) failures.push(message); };

forbid(css.includes('Native faceplate geometry contract'), 'native-only absolute faceplate geometry returned');
forbid(/\.faceplate-knob-slot\s*>\s*\.knob-control\s*\{[^}]*width:\s*92px/s.test(css), 'core knobs are being forced to 92px');
forbid(/\.faceplate-layout-stage\s*\{[^}]*overflow:\s*hidden/s.test(css), 'faceplate stage clips knob labels');
forbid(/\.faceplate-control-surface\s*\{[^}]*position:\s*absolute/s.test(css), 'core controls were detached from the web flow layout');
require(css.includes('/* Definitive Windows workspace controls. */'), 'newer top-strip and fullscreen controls were accidentally removed');

require(effect.includes('const customFaceplate = faceplateEditor.layout.custom;'), 'EffectModule no longer follows the shared web layout state');
forbid(effect.includes('const customFaceplate = true;'), 'native build is forcing a separate core faceplate path');
const viewportIndex = effect.indexOf('className={`faceplate-viewport-shell');
const controlsIndex = effect.indexOf('className={`knob-row faceplate-control-surface');
require(viewportIndex >= 0 && controlsIndex > viewportIndex, 'viewport/knob DOM order drifted from the web build');

require(layout.includes("const FACTORY_LAYOUT_REVISION = '2026-08-05-web-ui-1to1-restoration';"), '1:1 layout migration revision is missing');
require(layout.includes("pressure: {\n      viewportHeight: 168,\n      stageHeight: 292,\n      knobs: [\n        { x: 0.14, y: 240 },\n        { x: 0.38, y: 240 },\n        { x: 0.62, y: 240 },\n        { x: 0.86, y: 240 },"), 'Pressure geometry does not match the web reference');
require(layout.includes('{ x: 0.07, y: 246 }') && layout.includes('{ x: 0.93, y: 246 }'), 'core six-knob geometry drifted');

require(railC.includes('.rail-c-control-surface .faceplate-knob-slot'), 'Rail C reference sizing was accidentally removed');
require(railC.includes('grid-template-rows: 18px 58px 16px;'), 'Rail C labels/value rows drifted');
require(visualAudit.includes("'Shared web layout revision'"), 'legacy visual audit still owns the native-compressed layout');
forbid(visualAudit.includes("viewportHeight: 150', 'Pressure factory viewport integration'"), 'legacy compressed Pressure viewport audit returned');
forbid(visualAudit.includes("y: 210 }', 'Pressure factory knob integration'"), 'legacy compressed Pressure knob audit returned');

if (failures.length) {
  console.error(`Web UI 1:1 parity audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Web UI 1:1 parity audit passed · native shell uses the canonical web knob, label, viewport, and Pressure geometry.');
