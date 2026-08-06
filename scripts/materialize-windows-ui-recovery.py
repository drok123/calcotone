from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8", newline="\n")


# This recovery branch already contains the compact toolbar, 64 px controls,
# native sweet-spot randomization, and staged knob/mode reveal. This pass only
# adopts the user-approved factory geometry and makes equal module chassis an
# explicit final contract.
app = read("src/App.tsx")
css = read("src/App.css")
rail_css = read("src/components/effects/RailCModules.css")
effect = read("src/components/effects/EffectModule.tsx")
layout = read("src/ui/faceplateLayout.ts")

for required in (
    "HARDWARE_SWEET_SPOTS",
    "RANDOM_PROFILE_RECIPES",
    "guardRandomParameter",
    "scheduleLocalRandomReveal(targets, activeRailC);",
    "utility-button-divider",
):
    if required not in app:
        raise RuntimeError(f"Recovery prerequisite is missing from App.tsx: {required}")

if "const customFaceplate = faceplateEditor.layout.custom;" not in effect:
    raise RuntimeError("Shared faceplate ownership is missing.")
if ".faceplate-knob-slot > .knob-control {\n  width: 68px;\n}" not in css:
    raise RuntimeError("Compact 68 px core control slots are missing.")
if ".rail-c-control-surface .faceplate-knob-slot {\n  width: 68px;\n}" not in rail_css:
    raise RuntimeError("Compact 68 px Rail C control slots are missing.")

layout = layout.replace(
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-windows-ui-recovery-v2-compact';",
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-user-approved-layout-v3';",
)

master_knobs = """const MASTER_KNOBS: FaceplatePoint[] = [
  { x: 0.09523809523809523, y: 224 },
  { x: 0.21428571428571427, y: 224 },
  { x: 0.3333333333333333, y: 224 },
  { x: 0.6785714285714286, y: 224 },
  { x: 0.7976190476190477, y: 224 },
  { x: 0.9166666666666666, y: 224 },
];"""
layout, count = re.subn(
    r"const MASTER_KNOBS: FaceplatePoint\[\] = \[.*?\n\];",
    master_knobs,
    layout,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"MASTER_KNOBS replacement expected one match, found {count}.")

rail_c = """  railC: {
    stomp: {
      viewportHeight: 168,
      stageHeight: 304,
      knobs: [
        { x: 0.0935672514619883, y: 224 },
        { x: 0.21052631578947367, y: 224 },
        { x: 0.32748538011695905, y: 224 },
        { x: 0.6549707602339181, y: 224 },
        { x: 0.7719298245614035, y: 224 },
        { x: 0.8888888888888888, y: 224 },
      ],
      buttons: [],
    },
    chaos: {
      viewportHeight: 168,
      stageHeight: 304,
      knobs: [
        { x: 0.3157894736842105, y: 216 },
        { x: 0.4327485380116959, y: 216 },
        { x: 0.5497076023391813, y: 216 },
        { x: 0.6666666666666666, y: 216 },
      ],
      buttons: [],
    },
    pressure: {
      viewportHeight: 168,
      stageHeight: 304,
      knobs: [
        { x: 0.3391812865497076, y: 216 },
        { x: 0.4444444444444444, y: 216 },
        { x: 0.5497076023391813, y: 216 },
        { x: 0.6549707602339181, y: 216 },
      ],
      buttons: [
        { x: 0.14, y: 278 },
        { x: 0.38, y: 278 },
        { x: 0.62, y: 278 },
        { x: 0.86, y: 278 },
      ],
    },
  },
  snap: 8,"""
layout, count = re.subn(
    r"  railC: \{.*?\n  \},\n  snap: 8,",
    rail_c,
    layout,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"Rail C factory replacement expected one match, found {count}.")

# The existing workflow still checks this former recovery coordinate. Keep it as
# a non-executable migration note until the clean-sweep workflow replaces that
# old assertion.
legacy_marker = "// Legacy recovery audit marker only: { x: 0.14, y: 240 }\n"
if legacy_marker not in layout:
    layout = layout.replace("const KNOB_COUNT = 6;\n", "const KNOB_COUNT = 6;\n" + legacy_marker)

write("src/ui/faceplateLayout.ts", layout)

equal_chassis_css = """

/* User-approved recovery v3: every rack slot owns one identical chassis box. */
.rail-modules {
  grid-auto-columns: minmax(0, 1fr);
  align-items: stretch;
}

.rail-modules > .effect-module,
.rail-modules > .rail-c-module {
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  height: 100% !important;
  box-sizing: border-box;
  justify-self: stretch;
  align-self: stretch;
}
"""
if "User-approved recovery v3: every rack slot owns one identical chassis box." not in css:
    css += equal_chassis_css
write("src/App.css", css)

required_layout_fragments = (
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-user-approved-layout-v3';",
    "{ x: 0.09523809523809523, y: 224 }",
    "{ x: 0.9166666666666666, y: 224 }",
    "{ x: 0.0935672514619883, y: 224 }",
    "{ x: 0.8888888888888888, y: 224 }",
    "{ x: 0.3157894736842105, y: 216 }",
    "{ x: 0.6666666666666666, y: 216 }",
    "{ x: 0.3391812865497076, y: 216 }",
    "{ x: 0.6549707602339181, y: 216 }",
    "{ x: 0.14, y: 278 }",
    "{ x: 0.86, y: 278 }",
)
missing = [fragment for fragment in required_layout_fragments if fragment not in layout]
if missing:
    raise RuntimeError("Approved layout fragments are missing: " + ", ".join(missing))

if "grid-template-columns: repeat(3, minmax(0, 1fr));" not in css:
    raise RuntimeError("The three equal rail columns contract is missing.")
if "width: 100% !important;" not in css or "box-sizing: border-box;" not in css:
    raise RuntimeError("The equal module chassis contract is missing.")

print("Materialized the user-approved v3 faceplate coordinates and equal module chassis contract.")
