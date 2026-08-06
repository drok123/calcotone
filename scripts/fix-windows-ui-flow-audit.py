from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/windows-ui-parity-audit.mjs"
source = PATH.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")

old = """check(effectModule.includes('const customFaceplate = true;'), 'layout', 'native core faceplate is enforced');
check(effectModule.includes('faceplate-layout-stage'), 'layout', 'core faceplate stage markup');
check(effectModule.includes('faceplate-viewport-shell'), 'layout', 'core viewport shell markup');
check(effectModule.includes('faceplate-control-surface'), 'layout', 'core control surface markup');
check(effectModule.includes('faceplate-knob-slot'), 'layout', 'core absolute control slot markup');
check(css.includes('.faceplate-layout-stage {') && css.includes('position: relative;'), 'layout', 'faceplate stage establishes containing block');
check(css.includes('.faceplate-viewport-shell {') && css.includes('width: 100%;'), 'layout', 'faceplate viewport remains full width');
check(css.includes('.faceplate-viewport-shell > .dsp-viewport {') && css.includes('height: 100% !important;'), 'layout', 'ASCII viewport fills saved shell');
check(css.includes('.faceplate-control-surface {') && css.includes('position: absolute !important;'), 'layout', 'control surface is absolute');
check(css.includes('.faceplate-knob-slot {') && css.includes('left: var(--faceplate-x);') && css.includes('top: var(--faceplate-y);'), 'layout', 'knobs use saved coordinates');
check(!css.includes('.faceplate-viewport-shell {\\n  position: relative;'), 'layout', 'viewport shell cannot collapse into normal flow');
"""

new = """check(effectModule.includes('const customFaceplate = faceplateEditor.layout.custom;'), 'layout', 'Windows follows shared web faceplate state');
check(effectModule.includes('faceplate-layout-stage'), 'layout', 'core faceplate stage markup');
check(effectModule.includes('faceplate-viewport-shell'), 'layout', 'core viewport shell markup');
check(effectModule.includes('faceplate-control-surface'), 'layout', 'core control surface markup');
check(effectModule.includes('faceplate-knob-slot'), 'layout', 'core control slot markup');
check(effectModule.includes("'--faceplate-x': `${point.x * 100}%`") && effectModule.includes("'--faceplate-y': `${point.y}px`"), 'layout', 'saved coordinate metadata is preserved');
check(!css.includes('Native faceplate geometry contract'), 'layout', 'native-only faceplate override is absent');
check(!/\\.faceplate-layout-stage\\s*\\{[^}]*overflow:\\s*hidden/s.test(css), 'layout', 'faceplate stage does not clip labels');
check(!/\\.faceplate-control-surface\\s*\\{[^}]*position:\\s*absolute/s.test(css), 'layout', 'controls remain in canonical web flow');
check(!/\\.faceplate-knob-slot\\s*>\\s*\\.knob-control\\s*\\{[^}]*width:\\s*92px/s.test(css), 'layout', 'core knobs inherit canonical web sizing');
check(css.includes('.knob-control {') && css.includes('grid-template-rows:'), 'layout', 'web knob label/value rows remain present');
"""

if new in source:
    print("Windows UI audit already uses the shared web layout contract.")
elif source.count(old) != 1:
    raise RuntimeError(f"expected one legacy Windows layout audit block, found {source.count(old)}")
else:
    source = source.replace(old, new, 1)
    PATH.write_text(source, encoding="utf-8", newline="\n")
    print("Replaced native-only Windows layout requirements with shared web 1:1 contracts.")
