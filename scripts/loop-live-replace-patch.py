from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'{label} anchor missing in {path}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')

# Browser/store: make true live replacement the fresh/default behavior while
# migrating existing v1 settings without carrying the old 100% feedback default.
replace_once(
    'src/components/signal/loopStore.ts',
    "const STORAGE_KEY = 'calcotone.loop-state.v1';",
    "const STORAGE_KEY = 'calcotone.loop-state.v2';\nconst LEGACY_STORAGE_KEY = 'calcotone.loop-state.v1';",
    'Loop storage revision',
)
replace_once(
    'src/components/signal/loopStore.ts',
    "  overdub: 1,",
    "  // Internally retained as `overdub` for command/schema compatibility.\n  // Semantically this is old-loop RETAIN: 0 = live replace, 1 = classic additive dub.\n  overdub: 0,",
    'Loop default retain',
)
replace_once(
    'src/components/signal/loopStore.ts',
    "    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<LoopSettings> | null;\n    if (!saved) return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };",
    "    const currentRaw = window.localStorage.getItem(STORAGE_KEY);\n    const legacyRaw = currentRaw === null ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null;\n    const saved = JSON.parse(currentRaw ?? legacyRaw ?? 'null') as Partial<LoopSettings> | null;\n    if (!saved) return { ...DEFAULT_SETTINGS, trackLevels: [...DEFAULT_SETTINGS.trackLevels] };\n    const migratedLegacy = currentRaw === null && legacyRaw !== null;",
    'Loop legacy migration parse',
)
replace_once(
    'src/components/signal/loopStore.ts',
    "      overdub: clamp01(saved.overdub ?? DEFAULT_SETTINGS.overdub),",
    "      // v1 shipped with 100% feedback as its default. Migrating that value\n      // would defeat the new live-replace workflow, so legacy sessions start at 0% RETAIN.\n      overdub: migratedLegacy ? DEFAULT_SETTINGS.overdub : clamp01(saved.overdub ?? DEFAULT_SETTINGS.overdub),",
    'Loop legacy retain migration',
)

# UI: expose the actual meaning instead of a misleading additive-only label.
replace_once(
    'src/components/effects/RailCModules.tsx',
    "  const knobLabels = trimEditing ? ['IN', 'OUT', 'Track', 'Fade'] as const : ['Track', 'Loop', 'Overdub', 'Fade'] as const;",
    "  const knobLabels = trimEditing ? ['IN', 'OUT', 'Track', 'Fade'] as const : ['Track', 'Loop', 'RETAIN', 'Fade'] as const;",
    'Loop RETAIN label',
)
replace_once(
    'src/components/effects/RailCModules.tsx',
    "    else if (index === 2) setLoopState({ overdub: 1 });",
    "    else if (index === 2) setLoopState({ overdub: 0 });",
    'Loop RETAIN reset',
)
replace_once(
    'src/components/effects/RailCModules.tsx',
    "              modeLabel={trimEditing ? 'TRIM EDIT' : state.transport}",
    "              modeLabel={trimEditing\n                ? 'TRIM EDIT'\n                : state.transport === 'overdubbing'\n                  ? (state.overdub <= 0.001 ? 'LIVE REPLACE' : 'LIVE DUB')\n                  : state.transport}",
    'Loop live mode display',
)

# Browser AudioWorklet: default to overwrite, keep feedback available through RETAIN,
# and let the transient envelope follow replacement passes instead of permanently
# preserving peaks from an older performance.
replace_once(
    'public/loop-processor.js',
    "    this.overdub = 1;\n    this.fade = 0.18;",
    "    // RETAIN feedback: 0 = rolling live replace, 1 = classic additive overdub.\n    this.overdub = 0;\n    this.replaceEnvelopeBin = -1;\n    this.fade = 0.18;",
    'Browser live replace default',
)
replace_once(
    'public/loop-processor.js',
    "  updateEnvelope(track, frameIndex, left, right) {\n    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));\n    const peak = Math.max(Math.abs(left), Math.abs(right));\n    if (peak > this.envelopes[track][bin]) this.envelopes[track][bin] = peak;\n  }",
    "  updateEnvelope(track, frameIndex, left, right) {\n    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));\n    const peak = Math.max(Math.abs(left), Math.abs(right));\n    if (peak > this.envelopes[track][bin]) this.envelopes[track][bin] = peak;\n  }\n\n  updateReplaceEnvelope(track, frameIndex, left, right) {\n    const bin = Math.min(ENVELOPE_BINS - 1, Math.floor(frameIndex * this.envelopeScale));\n    const peak = Math.max(Math.abs(left), Math.abs(right));\n    if (bin !== this.replaceEnvelopeBin) {\n      this.envelopes[track][bin] = peak;\n      this.replaceEnvelopeBin = bin;\n    } else if (peak > this.envelopes[track][bin]) {\n      this.envelopes[track][bin] = peak;\n    }\n  }",
    'Browser replacement envelope',
)
replace_once(
    'public/loop-processor.js',
    "        this.overdubbing = !this.overdubbing;\n        this.recording = false;\n        this.playing = true;",
    "        this.overdubbing = !this.overdubbing;\n        this.replaceEnvelopeBin = -1;\n        this.recording = false;\n        this.playing = true;",
    'Browser DUB latch envelope reset',
)
replace_once(
    'public/loop-processor.js',
    "          const nextL = selected[write] * this.overdub + liveL;\n          const nextR = selected[write + 1] * this.overdub + liveR;\n          selected[write] = nextL;\n          selected[write + 1] = nextR;\n          this.updateEnvelope(track, absolute, nextL, nextR);",
    "          // Continuous DUB is a rolling tape-style replacement pass. RETAIN=0\n          // overwrites the previous take sample-for-sample; higher RETAIN values\n          // intentionally preserve old material for conventional feedback overdub.\n          const nextL = selected[write] * this.overdub + liveL;\n          const nextR = selected[write + 1] * this.overdub + liveR;\n          selected[write] = nextL;\n          selected[write + 1] = nextR;\n          if (this.overdub <= 0.001) this.updateReplaceEnvelope(track, absolute, nextL, nextR);\n          else this.updateEnvelope(track, absolute, nextL, nextR);",
    'Browser rolling replace write',
)

# Native engine parity.
replace_once(
    'native/src/loop_processor.cpp',
    "          const float next_left = selected_buffer[write] * overdub_feedback + live_left;\n          const float next_right = selected_buffer[write + 1U] * overdub_feedback + live_right;\n          selected_buffer[write] = next_left;\n          selected_buffer[write + 1U] = next_right;\n          update_envelope(selected_track, absolute, next_left, next_right);",
    "          // DUB is a continuous rolling replacement pass. At RETAIN=0 the\n          // previous performance is completely gone after one full orbit; raising\n          // RETAIN restores classic feedback overdubbing without changing transport.\n          const float next_left = selected_buffer[write] * overdub_feedback + live_left;\n          const float next_right = selected_buffer[write + 1U] * overdub_feedback + live_right;\n          selected_buffer[write] = next_left;\n          selected_buffer[write + 1U] = next_right;\n          update_envelope(selected_track, absolute, next_left, next_right);",
    'Native rolling replace write',
)
replace_once(
    'native/src/loop_processor.cpp',
    "  std::atomic<float> overdub{1.F};",
    "  // RETAIN feedback: 0 = live replace, 1 = classic additive overdub.\n  std::atomic<float> overdub{0.F};",
    'Native live replace default',
)

# Manifest contract follows the new default while retaining the stable internal id.
replace_once(
    'contracts/calcotone-core-manifest.json',
    '          "id": "overdub",\n          "defaultUi": 1',
    '          "id": "overdub",\n          "defaultUi": 0',
    'Loop manifest live replace default',
)

# Native regression: a complete RETAIN=0 DUB pass must erase the prior take.
test = Path('native/tests/loop_processor_test.cpp')
test_text = test.read_text(encoding='utf-8')
anchor = """  loop.set_selected_track(1);\n  consume(loop);\n  assert(loop.loop_frames() == 768U);\n\n  // Manual trim is non-destructive: active loop length changes but the raw take remains.\n"""
addition = """  loop.set_selected_track(1);\n  consume(loop);\n  assert(loop.loop_frames() == 768U);\n\n  // DUB is a latched live-replace pass. With RETAIN=0, exactly one full pass\n  // must erase the previous Track 1 performance without changing its loop length.\n  loop.set_selected_track(0);\n  consume(loop);\n  loop.set_overdub(0.F);\n  loop.command(calcotone::LoopCommand::Overdub);\n  consume(loop);\n  assert(loop.transport() == calcotone::LoopTransport::Overdubbing);\n  std::vector<float> replacement(256U * 2U);\n  fill(replacement, .05F, -.04F);\n  loop.process(replacement.data(), 256U);\n  loop.command(calcotone::LoopCommand::Overdub);\n  consume(loop);\n  assert(loop.transport() == calcotone::LoopTransport::Playing);\n  assert(loop.loop_frames() == 256U);\n  std::vector<float> replaced_playback(256U * 2U, 0.F);\n  loop.process(replaced_playback.data(), 256U);\n  float replaced_peak = 0.F;\n  for (const auto sample : replaced_playback) replaced_peak = std::max(replaced_peak, std::abs(sample));\n  assert(replaced_peak > .02F);\n  assert(replaced_peak < .05F);\n\n  loop.set_selected_track(1);\n  consume(loop);\n\n  // Manual trim is non-destructive: active loop length changes but the raw take remains.\n"""
if anchor not in test_text:
    raise SystemExit('Native live replace test anchor missing')
test.write_text(test_text.replace(anchor, addition, 1), encoding='utf-8')

# Audit the semantic contract so the default cannot silently drift back to additive.
audit = Path('scripts/loop-audit.mjs')
audit_text = audit.read_text(encoding='utf-8')
anchor = "requireText(worklet, 'autoTrim(track)', 'browser auto trim');\n"
addition = anchor + "requireText(store, 'overdub: 0', 'Loop live-replace default');\nrequireText(rail, \"['Track', 'Loop', 'RETAIN', 'Fade']\", 'Loop RETAIN hardware label');\nrequireText(rail, \"'LIVE REPLACE'\", 'Loop live-replace transport display');\nrequireText(worklet, 'rolling tape-style replacement pass', 'browser continuous live replace');\nrequireText(native, 'previous performance is completely gone after one full orbit', 'native continuous live replace');\n"
if anchor not in audit_text:
    raise SystemExit('Loop live replace audit anchor missing')
audit_text = audit_text.replace(anchor, addition, 1)
audit_text = audit_text.replace(
    "console.log('CALCOTONE Loop audit passed · 8 independent track lengths, non-destructive trim, auto trim, and transient ASCII editor locked');",
    "console.log('CALCOTONE Loop audit passed · 8 independent timelines, live-replace DUB, trim/auto-trim, and orbital ASCII editor locked');",
)
audit.write_text(audit_text, encoding='utf-8')

print('Applied Loop continuous live-replace DUB pass.')
