from __future__ import annotations

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
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


# Keep the complete positioned faceplate system, but restore the original web-sized controls.
css = read("src/App.css")
if "Native faceplate geometry contract" not in css:
    raise RuntimeError("The recovery baseline is missing the paired faceplate geometry CSS.")
css = replace_once(
    css,
    ".faceplate-knob-slot > .knob-control {\n  width: 92px;\n}",
    ".faceplate-knob-slot > .knob-control {\n  width: 76px;\n}",
    "core control width",
)
write("src/App.css", css)

rail_css = read("src/components/effects/RailCModules.css")
rail_css = replace_once(
    rail_css,
    ".rail-c-control-surface .faceplate-knob-slot {\n  width: 92px;\n}",
    ".rail-c-control-surface .faceplate-knob-slot {\n  width: 76px;\n}",
    "Rail C control width",
)
write("src/components/effects/RailCModules.css", rail_css)

# Stop hard-coding a second Windows-only ownership mode. The fresh factory layout remains custom,
# but the UI can now honor RESET/CANCEL/SAVE exactly like the web editor.
effect = read("src/components/effects/EffectModule.tsx")
effect = replace_once(
    effect,
    "  const customFaceplate = true;",
    "  const customFaceplate = faceplateEditor.layout.custom;",
    "shared faceplate ownership",
)
write("src/components/effects/EffectModule.tsx", effect)

layout = read("src/ui/faceplateLayout.ts")
layout = replace_once(
    layout,
    "const STORAGE_KEY = 'calcotone.faceplate-layout.v2';",
    "const STORAGE_KEY = 'calcotone.faceplate-layout.windows-recovery.v1';",
    "recovery storage namespace",
)
layout = replace_once(
    layout,
    "const LEGACY_STORAGE_KEY = 'calcotone.faceplate-layout.v1';",
    "const LEGACY_STORAGE_KEY = 'calcotone.faceplate-layout.windows-recovery.legacy-disabled';",
    "disable legacy geometry migration",
)
layout = replace_once(
    layout,
    "const FACTORY_LAYOUT_REVISION_KEY = 'calcotone.faceplate-layout.factory-revision';",
    "const FACTORY_LAYOUT_REVISION_KEY = 'calcotone.faceplate-layout.windows-recovery.factory-revision';",
    "recovery revision namespace",
)
layout = replace_once(
    layout,
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-approved-compact-native-1to1';",
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-windows-ui-recovery-v1';",
    "recovery factory revision",
)

# The control stack is roughly 129 px tall. A 292 px stage with a center at y=246 clipped the
# bottom labels. 320 px preserves the approved control centers and contains the complete stack.
if "stageHeight: 292," in layout:
    layout = layout.replace("stageHeight: 292,", "stageHeight: 320,")

layout = replace_once(
    layout,
    "    pressure: {\n      viewportHeight: 150,\n      stageHeight: 320,\n      knobs: [\n        { x: 0.14, y: 210 },\n        { x: 0.38, y: 210 },\n        { x: 0.62, y: 210 },\n        { x: 0.86, y: 210 },",
    "    pressure: {\n      viewportHeight: 168,\n      stageHeight: 320,\n      knobs: [\n        { x: 0.14, y: 240 },\n        { x: 0.38, y: 240 },\n        { x: 0.62, y: 240 },\n        { x: 0.86, y: 240 },",
    "Pressure web geometry",
)
write("src/ui/faceplateLayout.ts", layout)

# Hard assertions: this artifact must be the paired custom-layout implementation, not another
# half-restored hybrid.
checks = {
    "paired faceplate CSS": "Native faceplate geometry contract" in css,
    "76px core controls": "width: 76px;" in css and "width: 92px;" not in css[css.index("Native faceplate geometry contract"):],
    "76px Rail C controls": ".rail-c-control-surface .faceplate-knob-slot {\n  width: 76px;\n}" in rail_css,
    "shared layout state": "const customFaceplate = faceplateEditor.layout.custom;" in effect,
    "fresh storage namespace": "calcotone.faceplate-layout.windows-recovery.v1" in layout,
    "320px stage": "stageHeight: 320," in layout and "stageHeight: 292," not in layout,
    "Pressure web geometry": "viewportHeight: 168" in layout and "{ x: 0.14, y: 240 }" in layout,
}
failed = [label for label, ok in checks.items() if not ok]
if failed:
    raise RuntimeError("UI recovery invariant failure: " + ", ".join(failed))

print("Materialized stable Windows UI recovery: fresh geometry, complete labels, and original control scale.")
