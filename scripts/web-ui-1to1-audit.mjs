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

require(/\.knob-control\s*\{[^}]*grid-template-rows:\s*24px 78px 19px;/s.test(css), 'core knob label/body/value rows drifted from the web reference');
require(/\.knob-shell\s*\{[^}]*width:\s*76px;[^}]*height:\s*76px;/s.test(css), 'core knob shell is not the original 76px web size');
require(/\.knob-label\s*\{[^}]*font-size:\s*\.72rem;/s.test(css), 'core knob label text size drifted');
require(/\.knob-value\s*\{[^}]*font:\s*800 \.65rem\/1 var\(--mono\);/s.test(css), 'core knob value text size drifted');

require(effect.includes('const customFaceplate = faceplateEditor.layout.custom;'), 'EffectModule no longer follows the shared web layout state');
forbid(effect.includes('const customFaceplate = true;'), 'native build is forcing a separate core faceplate path');
const viewportIndex = effect.indexOf('className={`faceplate-viewport-shell');
const controlsIndex = effect.indexOf('className={`knob-row faceplate-control-surface');
require(viewportIndex >= 0 && controlsIndex > viewportIndex, 'viewport/knob DOM order drifted from the web build');

require(layout.includes("const FACTORY_LAYOUT_REVISION = '2026-08-09-loop505-fader-faceplate-v2';"), 'Loop 505 fader layout migration revision is missing');
require(layout.includes("pressure: {\n      viewportHeight: 168,\n      stageHeight: 304,\n      knobs: [\n        { x: 0.19883040935672514, y: 216 },\n        { x: 0.4444444444444444, y: 216 },\n        { x: 0.6900584795321637, y: 216 },\n        { x: 0.9122807017543859, y: 216 },"), 'Loop fader geometry does not match the supplied faceplate');
require(layout.includes("buttons: [\n        { x: 0.19883040935672514, y: 182 },\n        { x: 0.4444444444444444, y: 182 },\n        { x: 0.6900584795321637, y: 182 },\n        { x: 0.9122807017543859, y: 182 },"), 'Loop track pads are not aligned above their faders');
require(layout.includes('controlViewportCeiling('), 'Loop fader/button-aware viewport clearance is missing');
require(layout.includes('{ x: 0.09523809523809523, y: 224 }') && layout.includes('{ x: 0.9166666666666666, y: 224 }'), 'uploaded approved core six-knob geometry drifted');

require(railC.includes('.rail-c-control-surface .faceplate-knob-slot'), 'Rail C reference sizing was accidentally removed');
require(railC.includes('grid-template-rows: 18px 58px 16px;'), 'Rail C labels/value rows drifted');
require(railC.includes('.loop-track-fader'), 'Loop channel fader styling is missing');
require(railC.includes('.loop-utility-bank'), 'Loop master utility strip styling is missing');
require(visualAudit.includes("'Shared web layout revision'"), 'legacy visual audit still owns the native-compressed layout');
forbid(visualAudit.includes("viewportHeight: 150', 'Pressure factory viewport integration'"), 'legacy compressed Pressure viewport audit returned');
forbid(visualAudit.includes("y: 210 }', 'Pressure factory knob integration'"), 'legacy compressed Pressure knob audit returned');

if (failures.length) {
  console.error(`Web UI 1:1 parity audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Web UI 1:1 parity audit passed · approved 304px faceplate, canonical core knobs, Loop 505 fader geometry, and 1440p viewport flow are locked for Windows.');