from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return source.replace(old, new, 1)


def remove_css_rules(source: str, forbidden_headers: tuple[str, ...]) -> str:
    output: list[str] = []
    cursor = 0
    while cursor < len(source):
        opening = source.find("{", cursor)
        if opening < 0:
            output.append(source[cursor:])
            break
        depth = 1
        index = opening + 1
        while index < len(source) and depth:
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
            index += 1
        if depth:
            raise RuntimeError("unbalanced Rail C CSS")
        header = source[cursor:opening].strip()
        if not any(token in header for token in forbidden_headers):
            output.append(source[cursor:index])
        cursor = index
    return "".join(output)


audit_path = Path("scripts/audit.mjs")
audit = audit_path.read_text(encoding="utf-8")
audit = replace_once(
    audit,
    r"\\]\\s*,?\\n\\s*}`));",
    r"\\]\\s*,?\\r?\\n\\s*}`));",
    "CRLF-safe UI parameter parser",
)
audit_path.write_text(audit, encoding="utf-8")

visual_path = Path("scripts/visual-audit.mjs")
visual = visual_path.read_text(encoding="utf-8")
visual = replace_once(
    visual,
    "const motionPad = read('src/components/motion/MotionPad.tsx');\n",
    "",
    "retired Rail C MotionPad audit source",
)
visual = replace_once(
    visual,
    "const FACTORY_LAYOUT_REVISION = '2026-07-30-banked-knob-faceplate'",
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-approved-compact-native-1to1'",
    "approved factory layout revision",
)
visual = replace_once(
    visual,
    "requireText(faceplate, 'viewportHeight: 168', 'Pressure factory viewport integration');",
    "requireText(faceplate, 'pressure: {\\n      viewportHeight: 150', 'Pressure factory viewport integration');",
    "Pressure viewport audit",
)
visual = replace_once(
    visual,
    "requireText(faceplate, '{ x: 0.14, y: 240 }', 'Pressure factory knob integration');",
    "requireText(faceplate, '{ x: 0.14, y: 210 }', 'Pressure factory knob integration');",
    "Pressure knob audit",
)
visual = replace_once(
    visual,
    "// Rail C deliberately mixes the six existing ASCII worlds with a functional\n// piano-roll screen, the existing XY signal field, and a conventional Pressure logo.",
    "// Rail C is definitively Stomp → Stack → Pressure. Synth and the old Chaos XY\n// surface are retired from this rack and must not return through stale source or CSS.",
    "Rail C audit description",
)
visual = replace_once(
    visual,
    "requireText(motionPad, 'signalLab={signalLab}', 'Existing Signal state forwarded to XY');",
    "forbidText(railC, '<MotionPad', 'Retired Chaos XY surface');",
    "retired MotionPad route assertion",
)
visual = replace_once(
    visual,
    "requireText(railC, 'aria-label=\"16-step piano roll\"', 'Functional Synth piano roll');",
    "forbidText(railC, '16-step piano roll', 'Retired Synth piano roll');",
    "retired Synth piano-roll assertion",
)
visual = replace_once(
    visual,
    "requireText(railC, 'toggleCell(step, pitchIndex)', 'Editable Synth notes');",
    "forbidText(railC, 'toggleCell(step, pitchIndex)', 'Retired Synth note editor');",
    "retired Synth note assertion",
)
visual = replace_once(
    visual,
    "requireText(railC, 'setChain((current)', 'Synth pattern chaining');",
    "forbidText(railC, 'setChain((current)', 'Retired Synth pattern chaining');",
    "retired Synth chain assertion",
)
visual = replace_once(
    visual,
    "requireText(railC, '<MotionPad {...motionPadProps}', 'Chaos owns the XY surface');",
    "requireText(railC, 'aria-label=\"STACK amplifier\"', 'Stack amplifier selector');\nrequireText(railC, 'aria-label=\"STACK cabinet\"', 'Stack cabinet selector');",
    "Stack selector assertions",
)
visual = replace_once(
    visual,
    "requireText(railCCss, '.piano-roll-grid', 'Piano-roll screen geometry');",
    "forbidText(railCCss, '.module-synth', 'Retired Synth module CSS');\nforbidText(railCCss, '.synth-', 'Retired Synth control CSS');\nforbidText(railCCss, '.piano-roll-', 'Retired piano-roll CSS');",
    "retired Synth CSS assertions",
)
visual = replace_once(
    visual,
    "console.log('CALCOTONE visual audit passed (six ASCII effects plus functional Rail C displays).');",
    "console.log('CALCOTONE visual audit passed (six ASCII effects plus Stomp, Stack, and Pressure).');",
    "visual audit completion text",
)
visual_path.write_text(visual, encoding="utf-8")

css_path = Path("src/components/effects/RailCModules.css")
css = css_path.read_text(encoding="utf-8").replace("\r\n", "\n")
css = replace_once(
    css,
    ".rail-c-module.faceplate-layout-custom .faceplate-viewport-shell > .synth-roll,\n.rail-c-module.faceplate-layout-custom .faceplate-viewport-shell > .chaos-pad-shell,\n.rail-c-module.faceplate-layout-custom .faceplate-viewport-shell > .pressure-ascii {",
    ".rail-c-module.faceplate-layout-custom .faceplate-viewport-shell > .chaos-pad-shell,\n.rail-c-module.faceplate-layout-custom .faceplate-viewport-shell > .pressure-ascii {",
    "shared faceplate viewport selector",
)
css = replace_once(
    css,
    ".synth-roll button,\n.pressure-style-strip button {",
    ".pressure-style-strip button {",
    "shared Pressure button selector",
)
css = replace_once(
    css,
    ".synth-roll button.active,\n.pressure-style-strip button.active {",
    ".pressure-style-strip button.active {",
    "shared active Pressure button selector",
)
css = replace_once(
    css,
    "@media (max-width: 760px) {\n  .synth-knob-row { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; }\n}\n",
    "",
    "retired Synth mobile rule",
)
css = remove_css_rules(
    css,
    (
        ".module-synth",
        ".synth-",
        ".piano-roll-",
        ".chaos-pad-shell .xy-pad",
        ".chaos-pad-shell .xy-patch-bay",
        ".chaos-pad-shell .motion-route-inspector",
    ),
)
for forbidden in (
    ".module-synth",
    ".synth-",
    ".piano-roll-",
    ".chaos-pad-shell .xy-pad",
    ".chaos-pad-shell .xy-patch-bay",
    ".chaos-pad-shell .motion-route-inspector",
):
    if forbidden in css:
        raise RuntimeError(f"retired Rail C CSS remains: {forbidden}")
css_path.write_text(css.strip() + "\n", encoding="utf-8")

print("Repaired final parity audits and removed retired Synth/Chaos XY CSS.")
