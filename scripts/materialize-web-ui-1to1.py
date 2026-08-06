from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8", newline="\n")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one source match, found {count}")
    return source.replace(old, new, 1)


app_css = read("src/App.css")
start_marker = "/* Native faceplate geometry contract: viewport and controls share one full-width stage. */"
end_marker = "/* Definitive Windows workspace controls. */"
if start_marker in app_css:
    start = app_css.index(start_marker)
    end = app_css.index(end_marker, start)
    app_css = app_css[:start].rstrip() + "\n\n\n" + app_css[end:]

for forbidden in (
    start_marker,
    ".faceplate-knob-slot > .knob-control {\n  width: 92px;\n}",
):
    if forbidden in app_css:
        raise RuntimeError(f"App.css still contains native-only faceplate override: {forbidden}")
write("src/App.css", app_css)


effect_module = read("src/components/effects/EffectModule.tsx")
effect_module = replace_once(
    effect_module,
    "  const customFaceplate = true;",
    "  const customFaceplate = faceplateEditor.layout.custom;",
    "restore web faceplate ownership",
)
write("src/components/effects/EffectModule.tsx", effect_module)


layout = read("src/ui/faceplateLayout.ts")
revision_prefix = "const FACTORY_LAYOUT_REVISION = '"
revision_start = layout.index(revision_prefix)
revision_end = layout.index("';", revision_start) + 2
layout = (
    layout[:revision_start]
    + "const FACTORY_LAYOUT_REVISION = '2026-08-05-web-ui-1to1-restoration';"
    + layout[revision_end:]
)
layout = replace_once(
    layout,
    "    pressure: {\n      viewportHeight: 150,\n      stageHeight: 292,\n      knobs: [\n        { x: 0.14, y: 210 },\n        { x: 0.38, y: 210 },\n        { x: 0.62, y: 210 },\n        { x: 0.86, y: 210 },",
    "    pressure: {\n      viewportHeight: 168,\n      stageHeight: 292,\n      knobs: [\n        { x: 0.14, y: 240 },\n        { x: 0.38, y: 240 },\n        { x: 0.62, y: 240 },\n        { x: 0.86, y: 240 },",
    "restore Pressure web geometry",
)
write("src/ui/faceplateLayout.ts", layout)


audit = r'''import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const failures = [];

const css = read('src/App.css');
const effect = read('src/components/effects/EffectModule.tsx');
const layout = read('src/ui/faceplateLayout.ts');
const railC = read('src/components/effects/RailCModules.css');

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

if (failures.length) {
  console.error(`Web UI 1:1 parity audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Web UI 1:1 parity audit passed · native shell uses the canonical web knob, label, viewport, and Pressure geometry.');
'''
write("scripts/web-ui-1to1-audit.mjs", audit)


package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
scripts = package["scripts"]
scripts["audit:web-ui-1to1"] = "node scripts/web-ui-1to1-audit.mjs"
check = scripts["check"]
anchor = "npm run audit:windows-ui-parity &&"
addition = "npm run audit:windows-ui-parity && npm run audit:web-ui-1to1 &&"
if addition not in check:
    if anchor not in check:
        raise RuntimeError("package.json check chain is missing the Windows UI parity anchor")
    scripts["check"] = check.replace(anchor, addition, 1)
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8", newline="\n")

print("Restored canonical web UI geometry and installed the persistent 1:1 release audit.")
