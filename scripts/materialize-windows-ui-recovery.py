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


# ---------------------------------------------------------------------------
# Toolbar + native random UI synchronization
# ---------------------------------------------------------------------------
app = read("src/App.tsx")

toolbar_old = '''              <button type="button" className="profiler-toggle signal-randomizer-toggle" onClick={randomizeSignalOrder} title="Randomize the order of both three-module signal rails">SIGNAL RANDOM</button>
            </div>
            <span className={`audio-backend-badge ${audioBackend ?? 'detecting'}`} title="Active audio processing backend">
              <i aria-hidden="true" />
              {audioBackend === 'native' ? 'NATIVE WASAPI' : audioBackend === 'web' ? 'WEB AUDIO' : 'AUDIO AUTO'}
            </span>
            <button type="button" className={`profiler-toggle ${explainMode ? 'active' : ''}`} aria-pressed={explainMode} onClick={() => setExplainMode((value) => !value)}>EXPLAIN</button>
            <FaceplateLayoutEditor />
            <button type="button" className={`profiler-toggle ${profilerOpen ? 'active' : ''}`} aria-pressed={profilerOpen} onClick={() => setProfilerOpen((open) => !open)}>DSP</button>'''

toolbar_new = '''              <button type="button" className="profiler-toggle signal-randomizer-toggle" onClick={randomizeSignalOrder} title="Randomize the order of both three-module signal rails">SIGNAL RANDOM</button>
              <span className="utility-button-divider" aria-hidden="true" />
              <button type="button" className={`profiler-toggle ${explainMode ? 'active' : ''}`} aria-pressed={explainMode} onClick={() => setExplainMode((value) => !value)}>EXPLAIN</button>
              <FaceplateLayoutEditor />
              <button type="button" className={`profiler-toggle ${profilerOpen ? 'active' : ''}`} aria-pressed={profilerOpen} onClick={() => setProfilerOpen((open) => !open)}>DSP</button>
            </div>
            <span className={`audio-backend-badge ${audioBackend ?? 'detecting'}`} title="Active audio processing backend">
              <i aria-hidden="true" />
              {audioBackend === 'native' ? 'NATIVE WASAPI' : audioBackend === 'web' ? 'WEB AUDIO' : 'AUDIO AUTO'}
            </span>'''
app = replace_once(app, toolbar_old, toolbar_new, "compact toolbar grouping")

helper_anchor = "\n\n  function randomizeActiveModules(profile: RandomizationProfile = randomProfile): void {"
helper_block = '''

  function scheduleLocalRandomReveal(
    targets: Map<string, ModuleState>,
    activeRailC: readonly RailCRandomModuleId[]
  ): void {
    const orderedTargets = [
      ...RANDOM_UI_EFFECT_ORDER.filter((effectId) => targets.has(effectId)),
      ...activeRailC,
    ];
    for (const [index, effectId] of orderedTargets.entries()) {
      offlineRandomTimersRef.current.push(
        window.setTimeout(() => revealRandomUiModule(effectId), 48 + index * 96)
      );
    }
    offlineRandomTimersRef.current.push(
      window.setTimeout(() => completeRandomUiFlow(), 72 + orderedTargets.length * 96)
    );
  }

  function randomizeActiveModules(profile: RandomizationProfile = randomProfile): void {'''
app = replace_once(app, helper_anchor, helper_block, "local random reveal helper")

native_random_old = '''          for (const parameter of module.parameters)
            void nativeBridgeRef.current.commandLine(`param ${module.id} ${parameter.id} ${toDspParameterValue(module.id, parameter.id, parameter.value)}`);
        }
        return;
      }
      const engine = engineRef.current;'''
native_random_new = '''          for (const parameter of module.parameters)
            void nativeBridgeRef.current.commandLine(`param ${module.id} ${parameter.id} ${toDspParameterValue(module.id, parameter.id, parameter.value)}`);
        }
        // Native C++ receives the exact guarded targets immediately and performs its
        // own click-free smoothing. Drive the same staged UI reveal locally so the
        // visible modes and knobs always land on those exact targets.
        scheduleLocalRandomReveal(targets, activeRailC);
        return;
      }
      const engine = engineRef.current;'''
app = replace_once(app, native_random_old, native_random_new, "native random UI reveal")

for required in (
    "HARDWARE_SWEET_SPOTS",
    "RANDOM_PROFILE_RECIPES",
    "guardRandomParameter",
    "RANDOM_MUTATION_AMOUNT",
    "chooseHardwareSweetSpot",
    "scheduleLocalRandomReveal(targets, activeRailC);",
):
    if required not in app:
        raise RuntimeError(f"Random technology is missing: {required}")
write("src/App.tsx", app)


# ---------------------------------------------------------------------------
# Compact knob system and single-row utility toolbar
# ---------------------------------------------------------------------------
css = read("src/App.css")
if "Native faceplate geometry contract" not in css:
    raise RuntimeError("The recovery baseline is missing the paired faceplate geometry CSS.")

css = replace_once(
    css,
    ".faceplate-knob-slot > .knob-control {\n  width: 76px;\n}",
    ".faceplate-knob-slot > .knob-control {\n  width: 68px;\n}",
    "core faceplate slot width",
)
css = replace_once(
    css,
    "  --control-diameter: 76px;\n  --control-face: 54px;\n  --control-cell: 94px;",
    "  --control-diameter: 64px;\n  --control-face: 46px;\n  --control-cell: 80px;",
    "base compact control variables",
)

recovery_css = '''

/* Windows UI recovery v2: one compact toolbar and one final knob scale. */
.control-strip {
  display: flex !important;
  align-items: center;
  justify-content: flex-start !important;
  min-height: 54px;
  height: 54px;
  gap: 12px;
  padding: 6px 18px;
  overflow: visible;
}

.control-strip-actions {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  gap: 8px;
  white-space: nowrap;
}

.top-random-actions {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  margin: 0;
  gap: 5px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.top-random-actions .profiler-toggle,
.top-random-actions .layout-editor-toggle,
.top-random-actions .random-profile-selector select {
  flex: 0 0 auto;
  height: 28px;
  min-height: 28px;
}

.utility-button-divider {
  flex: 0 0 1px;
  width: 1px;
  height: 20px;
  margin: 0 2px;
  background: rgba(190, 202, 196, .20);
  box-shadow: 1px 0 rgba(0, 0, 0, .55);
}

.control-strip-actions > .audio-backend-badge {
  flex: 0 0 auto;
}

/* Final declarations intentionally override the older fixed-canvas 84px knobs. */
.effect-module .knob-shell,
.rail-c-module .knob-shell {
  width: 64px !important;
  height: 64px !important;
}

.effect-module .knob-face,
.rail-c-module .knob-face {
  width: 46px !important;
  height: 46px !important;
}

.effect-module .knob-control,
.rail-c-module .knob-control {
  min-height: 88px !important;
  grid-template-rows: 66px 18px !important;
  gap: 3px !important;
}

.effect-module .knob-label,
.rail-c-module .knob-label {
  font-size: .62rem !important;
  line-height: 1 !important;
}

.effect-module .knob-indicator,
.rail-c-module .knob-indicator {
  height: 13px !important;
}

.effect-module .knob-patch-jack,
.rail-c-module .knob-patch-jack {
  right: max(0px, calc(50% - 42px)) !important;
  top: 39px !important;
}
'''
if "Windows UI recovery v2: one compact toolbar" not in css:
    css += recovery_css
write("src/App.css", css)

rail_css = read("src/components/effects/RailCModules.css")
rail_css = replace_once(
    rail_css,
    ".rail-c-control-surface .faceplate-knob-slot {\n  width: 76px;\n}",
    ".rail-c-control-surface .faceplate-knob-slot {\n  width: 68px;\n}",
    "Rail C faceplate slot width",
)
write("src/components/effects/RailCModules.css", rail_css)


# Keep shared web ownership rather than forcing a second native-only layout mode.
effect = read("src/components/effects/EffectModule.tsx")
effect = replace_once(
    effect,
    "  const customFaceplate = true;",
    "  const customFaceplate = faceplateEditor.layout.custom;",
    "shared faceplate ownership",
)
write("src/components/effects/EffectModule.tsx", effect)


# ---------------------------------------------------------------------------
# Fresh compact factory geometry: never import stale WebView coordinates.
# ---------------------------------------------------------------------------
layout = read("src/ui/faceplateLayout.ts")
layout = layout.replace(
    "const STORAGE_KEY = 'calcotone.faceplate-layout.windows-recovery.v1';",
    "const STORAGE_KEY = 'calcotone.faceplate-layout.windows-recovery.v2';",
)
layout = layout.replace(
    "const LEGACY_STORAGE_KEY = 'calcotone.faceplate-layout.windows-recovery.legacy-disabled';",
    "const LEGACY_STORAGE_KEY = 'calcotone.faceplate-layout.windows-recovery.v1-disabled';",
)
layout = layout.replace(
    "const FACTORY_LAYOUT_REVISION_KEY = 'calcotone.faceplate-layout.windows-recovery.factory-revision';",
    "const FACTORY_LAYOUT_REVISION_KEY = 'calcotone.faceplate-layout.windows-recovery.v2-factory-revision';",
)
layout = layout.replace(
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-windows-ui-recovery-v1';",
    "const FACTORY_LAYOUT_REVISION = '2026-08-05-windows-ui-recovery-v2-compact';",
)
layout = layout.replace("stageHeight: 320,", "stageHeight: 304,")

# Recovery branch may be rebuilt from the older baseline; normalize it directly.
layout = layout.replace("stageHeight: 292,", "stageHeight: 304,")
layout = layout.replace("      viewportHeight: 150,\n      stageHeight: 304,", "      viewportHeight: 168,\n      stageHeight: 304,")
layout = layout.replace("{ x: 0.14, y: 210 }", "{ x: 0.14, y: 240 }")
layout = layout.replace("{ x: 0.38, y: 210 }", "{ x: 0.38, y: 240 }")
layout = layout.replace("{ x: 0.62, y: 210 }", "{ x: 0.62, y: 240 }")
layout = layout.replace("{ x: 0.86, y: 210 }", "{ x: 0.86, y: 240 }")
write("src/ui/faceplateLayout.ts", layout)


checks = {
    "paired faceplate CSS": "Native faceplate geometry contract" in css,
    "68px core slots": ".faceplate-knob-slot > .knob-control {\n  width: 68px;\n}" in css,
    "64px final knob shell": "width: 64px !important;" in css,
    "46px final knob face": "width: 46px !important;" in css,
    "68px Rail C slots": ".rail-c-control-surface .faceplate-knob-slot {\n  width: 68px;\n}" in rail_css,
    "single-row toolbar": "Windows UI recovery v2: one compact toolbar" in css,
    "toolbar grouping": "utility-button-divider" in app and toolbar_new in app,
    "shared layout state": "const customFaceplate = faceplateEditor.layout.custom;" in effect,
    "fresh storage namespace": "calcotone.faceplate-layout.windows-recovery.v2" in layout,
    "304px stage": "stageHeight: 304," in layout and "stageHeight: 320," not in layout and "stageHeight: 292," not in layout,
    "Pressure geometry": "viewportHeight: 168" in layout and "{ x: 0.14, y: 240 }" in layout,
    "native staged random": "scheduleLocalRandomReveal(targets, activeRailC);" in app,
    "sweet spots": "HARDWARE_SWEET_SPOTS" in app,
    "guarded profiles": "RANDOM_PROFILE_RECIPES" in app and "guardRandomParameter" in app,
}
failed = [label for label, ok in checks.items() if not ok]
if failed:
    raise RuntimeError("UI recovery invariant failure: " + ", ".join(failed))

print("Materialized compact toolbar, 64px knobs, fresh geometry, and native sweet-spot random UI synchronization.")
