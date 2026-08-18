import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const failures = [];

const css = read('src/App.css');
const effect = read('src/components/effects/EffectModule.tsx');
const layout = read('src/ui/faceplateLayout.ts');
const railC = read('src/components/effects/RailCModules.css');
const visualAudit = read('scripts/visual-audit.mjs');
const entry = read('src/main.tsx');
const approvedFaceplate = read('src/approvedFaceplate.css');
const microcosmFaceplate = read('src/microcosmFaceplate.css');
const pressureStyle = read('src/components/ascii/PressureStyleDisplay.css');
const knobControl = read('src/components/controls/Knob.tsx');
const knownGood = JSON.parse(read('docs/KNOWN_GOOD_FACEPLATE.json'));

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
require(effect.includes('const visibleParameters = module.parameters;'), 'core module knob parameters are being filtered out');
require(knobControl.includes('data-control-target={controlTarget}'), 'live core knob identity attribute is missing');
forbid(pressureStyle.includes('[data-control-target]'), 'live core knob identity is styled by the retired Rail C display layer');
const viewportIndex = effect.indexOf('className={`faceplate-viewport-shell');
const controlsIndex = effect.indexOf('className={`knob-row faceplate-control-surface');
require(viewportIndex >= 0 && controlsIndex > viewportIndex, 'viewport/knob DOM order drifted from the web build');

require(layout.includes("export const APPROVED_FACEPLATE_LAYOUT_REVISION = '2026-08-09-railc-latest-loop-centered-v4';"), 'approved v4 geometry revision is missing');
require(layout.includes("const FACTORY_LAYOUT_STORAGE_REVISION = '2026-08-17-known-good-faceplate-recovery-v1';"), 'known-good faceplate storage recovery is missing');
require(layout.includes('FACTORY_LAYOUT_REVISION_KEY) !== FACTORY_LAYOUT_STORAGE_REVISION'), 'saved v4 geometry is not reset by the recovery epoch');
require(layout.includes("stomp: {\n      viewportHeight: 168,\n      stageHeight: 304,\n      knobs: [\n        { x: 0.08187134502923976, y: 224 },"), 'Stomp geometry does not match the latest supplied faceplate');
require(layout.includes("chaos: {\n      viewportHeight: 168,\n      stageHeight: 304,\n      knobs: [\n        { x: 0.11695906432748537, y: 240 },\n        { x: 0.3742690058479532, y: 240 },\n        { x: 0.6432748538011696, y: 240 },\n        { x: 0.8888888888888888, y: 240 },"), 'Stack geometry does not match the latest supplied faceplate');
require(layout.includes("pressure: {\n      viewportHeight: 168,\n      stageHeight: 304,\n      knobs: [\n        { x: 0.14327485380116955, y: 216 },\n        { x: 0.38888888888888884, y: 216 },\n        { x: 0.6345029239766081, y: 216 },\n        { x: 0.8567251461988303, y: 216 },"), 'Loop fader bank is not centered as a rigid four-channel group');
require(layout.includes("buttons: [\n        { x: 0.14327485380116955, y: 272 },\n        { x: 0.38888888888888884, y: 272 },\n        { x: 0.6345029239766081, y: 272 },\n        { x: 0.8567251461988303, y: 272 },"), 'Loop track pads are not vertically aligned with the centered faders');
require(layout.includes('controlViewportCeiling('), 'Loop fader/button-aware viewport clearance is missing');
require(layout.includes('{ x: 0.09523809523809523, y: 224 }') && layout.includes('{ x: 0.9166666666666666, y: 224 }'), 'uploaded approved core six-knob geometry drifted');

require(railC.includes('.rail-c-control-surface .faceplate-knob-slot'), 'Rail C reference sizing was accidentally removed');
require(railC.includes('grid-template-rows: 18px 58px 16px;'), 'Rail C labels/value rows drifted');
require(railC.includes('.loop-track-fader'), 'Loop channel fader styling is missing');
require(railC.includes('.loop-utility-bank'), 'Loop master utility strip styling is missing');
require(visualAudit.includes("'Shared web layout revision'"), 'legacy visual audit still owns the native-compressed layout');
forbid(visualAudit.includes("viewportHeight: 150', 'Pressure factory viewport integration'"), 'legacy compressed Pressure viewport audit returned');
forbid(visualAudit.includes("y: 210 }', 'Pressure factory knob integration'"), 'legacy compressed Pressure knob audit returned');

const approvedIndex = entry.indexOf("import './approvedFaceplate.css'");
const materialIndex = entry.indexOf("import './components/effects/ModulePowerState.css'");
const microcosmIndex = entry.indexOf("import './microcosmFaceplate.css'");
require(approvedIndex >= 0 && materialIndex > approvedIndex, 'ModulePowerState must load after approvedFaceplate');
require(microcosmIndex > materialIndex, 'Microcosm header extension must load after the approved geometry/material layers');
forbid(approvedFaceplate.includes('.grain-header-controls') || approvedFaceplate.includes('.microcosm-hold'), 'Microcosm styling leaked into approved faceplate geometry');
require(microcosmFaceplate.includes('.grain-header-controls.is-microcosm'), 'isolated Microcosm header faceplate styling is missing');

require(knownGood.artifact?.name === 'calcotone-native-windows-optimized(2).zip', 'known-good artifact name drifted');
require(knownGood.artifact?.sha256 === '0794b30299464728ff0eae1e547abd2a1c998700c27451b13e7f74f9e35daa7b', 'known-good artifact hash drifted');
require(knownGood.faceplate?.sourceCommit === '9cfc06a2257f8616a1315818f8e9b00d19029910', 'known-good source commit drifted');
require(knownGood.faceplate?.assets?.javascript?.sha256 === '6ea5b9c35122aee0678a1e1a77de2b63cec6929496d0ccb0b11915698b7fffe4', 'approved JavaScript asset hash drifted');
require(knownGood.faceplate?.assets?.stylesheet?.sha256 === '2cb7aef4edfe10696df8b88fc855bbedbb1f58ea7223802722f1e2e7962e7564', 'approved stylesheet asset hash drifted');
require(knownGood.preservation?.controlVisibility === 'data-control-target identifies live core knobs and must never be hidden', 'core knob visibility contract is missing');

if (failures.length) {
  console.error(`Web UI 1:1 parity audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Web UI 1:1 parity audit passed · latest Stomp/Stack geometry, centered Loop fader bank, canonical core knobs, and 1440p viewport flow are locked for Windows.');
