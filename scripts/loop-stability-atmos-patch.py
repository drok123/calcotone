from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor missing in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, count), encoding='utf-8')

# --- Loop transient resolution -------------------------------------------------
replace('src/components/signal/loopStore.ts',
        'export const LOOP_WAVEFORM_BINS = 64;',
        'export const LOOP_WAVEFORM_BINS = 256;')
replace('public/loop-processor.js',
        'const WAVEFORM_BINS = 64;',
        'const WAVEFORM_BINS = 256;')
replace('native/include/calcotone/loop_processor.hpp',
        'inline constexpr unsigned kLoopWaveformBins = 64U;',
        'inline constexpr unsigned kLoopWaveformBins = 256U;')

# --- Browser Loop: lazy memory + transport-bound record/dub targets ------------
replace('public/loop-processor.js',
        "    this.buffers = Array.from({ length: TRACKS }, () => new Float32Array(this.maxFrames * 2));",
        "    // Large stereo loop buffers are allocated only when a track is first armed.\n"
        "    // This avoids reserving ~184 MB up front at 48 kHz (much more at high rates).\n"
        "    this.buffers = Array.from({ length: TRACKS }, () => null);")
replace('public/loop-processor.js',
        "    this.recording = false;\n    this.recordCount = 0;\n    this.overdubbing = false;",
        "    this.recording = false;\n    this.recordTrack = 0;\n    this.recordCount = 0;\n    this.overdubbing = false;\n    this.overdubTrack = 0;")
replace('public/loop-processor.js',
        "  startRecording(track) {\n    this.occupied[track] = 0;",
        "  ensureBuffer(track) {\n"
        "    if (this.buffers[track]) return this.buffers[track];\n"
        "    try {\n"
        "      const buffer = new Float32Array(this.maxFrames * 2);\n"
        "      this.buffers[track] = buffer;\n"
        "      return buffer;\n"
        "    } catch {\n"
        "      return null;\n"
        "    }\n"
        "  }\n\n"
        "  startRecording(track) {\n"
        "    if (!this.ensureBuffer(track)) return false;\n"
        "    this.recordTrack = track;\n"
        "    this.occupied[track] = 0;")
replace('public/loop-processor.js',
        "    this.overdubbing = false;\n    this.playing = true;\n  }\n\n  finishRecording(track)",
        "    this.overdubbing = false;\n    this.playing = true;\n    return true;\n  }\n\n  finishRecording(track)")
replace('public/loop-processor.js',
        "    if (this.recording) {\n      this.recording = false;\n      this.recordCount = 0;\n    }\n    this.overdubbing = false;",
        "    if (this.recording && this.recordTrack === track) {\n      this.recording = false;\n      this.recordCount = 0;\n    }\n    if (this.overdubbing && this.overdubTrack === track) this.overdubbing = false;")
replace('public/loop-processor.js',
        "    if (command === 'record') {\n      if (this.recording) this.finishRecording(track);\n      else this.startRecording(track);\n    } else if (command === 'overdub') {\n      if (this.occupied[track] && this.activeLength(track) > 0) {\n        this.overdubbing = !this.overdubbing;\n        this.replaceEnvelopeBin = -1;\n        this.recording = false;\n        this.playing = true;\n      }",
        "    if (command === 'record') {\n"
        "      if (this.recording) this.finishRecording(this.recordTrack);\n"
        "      else this.startRecording(track);\n"
        "    } else if (command === 'overdub') {\n"
        "      if (this.overdubbing) {\n"
        "        this.overdubbing = false;\n"
        "      } else if (this.occupied[track] && this.activeLength(track) > 0) {\n"
        "        this.overdubTrack = track;\n"
        "        this.overdubbing = true;\n"
        "        this.replaceEnvelopeBin = -1;\n"
        "        this.recording = false;\n"
        "        this.playing = true;\n"
        "      }")
replace('public/loop-processor.js',
        "    const buffer = this.buffers[track];\n    const index = absolute * 2 + channel;",
        "    const buffer = this.buffers[track];\n    if (!buffer) return 0;\n    const index = absolute * 2 + channel;")
replace('public/loop-processor.js',
        "      if (!this.enabled) continue;\n      const track = this.selectedTrack;\n      const selected = this.buffers[track];\n      if (this.recording) {",
        "      if (!this.enabled) continue;\n"
        "      const track = this.recording ? this.recordTrack : this.overdubbing ? this.overdubTrack : this.selectedTrack;\n"
        "      const selected = this.buffers[track];\n"
        "      if (this.recording && selected) {")
replace('public/loop-processor.js',
        "      } else if (this.overdubbing && this.occupied[track]) {",
        "      } else if (this.overdubbing && selected && this.occupied[track]) {")

# --- Native Loop: lazy buffers + command-target latching -----------------------
replace('native/src/loop_processor.cpp',
        "    for (auto& buffer : tracks) buffer.assign(max_frames * 2U, 0.F);\n    for (auto& level : track_levels)",
        "    // Track audio is allocated on the control thread when REC is armed, not\n"
        "    // all eight tracks at host startup. The realtime process path stays allocation-free.\n"
        "    for (auto& level : track_levels)")
replace('native/src/loop_processor.cpp',
        "  bool any_occupied() const noexcept {",
        "  bool ensure_track_buffer(unsigned track) noexcept {\n"
        "    if (track >= kLoopTrackCount) return false;\n"
        "    if (tracks[track].size() == max_frames * 2U) return true;\n"
        "    try {\n"
        "      tracks[track].assign(max_frames * 2U, 0.F);\n"
        "      return true;\n"
        "    } catch (...) {\n"
        "      return false;\n"
        "    }\n"
        "  }\n\n"
        "  bool any_occupied() const noexcept {")
replace('native/src/loop_processor.cpp',
        "    const unsigned track = selected.load(std::memory_order_relaxed);",
        "    const unsigned track = pending_track.load(std::memory_order_acquire);")
replace('native/src/loop_processor.cpp',
        "    if (command == LoopCommand::Record) {\n      if (recording) finish_recording(track);\n      else start_recording(track);",
        "    if (command == LoopCommand::Record) {\n"
        "      if (recording) finish_recording(record_track);\n"
        "      else if (tracks[track].size() == max_frames * 2U) { record_track = track; start_recording(record_track); }")
replace('native/src/loop_processor.cpp',
        "    if (command == LoopCommand::Overdub) {\n      if (occupied[track] && active_length(track) > 0U) {\n        overdubbing = !overdubbing;\n        recording = false;\n        playing = true;\n      }",
        "    if (command == LoopCommand::Overdub) {\n"
        "      if (overdubbing) {\n"
        "        overdubbing = false;\n"
        "      } else if (occupied[track] && active_length(track) > 0U) {\n"
        "        overdub_track = track;\n"
        "        overdubbing = true;\n"
        "        recording = false;\n"
        "        playing = true;\n"
        "      }")
replace('native/src/loop_processor.cpp',
        "    const auto& buffer = tracks[track];\n    const auto index = absolute * 2U + channel;",
        "    const auto& buffer = tracks[track];\n    if (buffer.empty()) return 0.F;\n    const auto index = absolute * 2U + channel;")
replace('native/src/loop_processor.cpp',
        "    const unsigned selected_track = selected.load(std::memory_order_relaxed);\n    auto& selected_buffer = tracks[selected_track];\n    const float loop_level",
        "    const unsigned selected_track = selected.load(std::memory_order_relaxed);\n    const float loop_level")
replace('native/src/loop_processor.cpp',
        "      if (recording) {\n        if (record_count < max_frames) {\n          const auto write = record_count * 2U;\n          selected_buffer[write] = live_left;\n          selected_buffer[write + 1U] = live_right;\n          update_envelope(selected_track, record_count, live_left, live_right);",
        "      if (recording) {\n"
        "        auto& record_buffer = tracks[record_track];\n"
        "        if (record_count < max_frames && !record_buffer.empty()) {\n"
        "          const auto write = record_count * 2U;\n"
        "          record_buffer[write] = live_left;\n"
        "          record_buffer[write + 1U] = live_right;\n"
        "          update_envelope(record_track, record_count, live_left, live_right);")
replace('native/src/loop_processor.cpp',
        "        if (record_count >= max_frames) finish_recording(selected_track);\n      } else if (overdubbing && occupied[selected_track]) {\n        const auto length = active_length(selected_track);\n        if (length > 0U) {\n          const auto relative = std::min(positions[selected_track], length - 1U);\n          const auto absolute = trim_start_frames[selected_track] + relative;\n          const auto write = absolute * 2U;",
        "        if (record_count >= max_frames) finish_recording(record_track);\n"
        "      } else if (overdubbing && occupied[overdub_track]) {\n"
        "        auto& overdub_buffer = tracks[overdub_track];\n"
        "        const auto length = active_length(overdub_track);\n"
        "        if (length > 0U && !overdub_buffer.empty()) {\n"
        "          const auto relative = std::min(positions[overdub_track], length - 1U);\n"
        "          const auto absolute = trim_start_frames[overdub_track] + relative;\n"
        "          const auto write = absolute * 2U;")
replace('native/src/loop_processor.cpp',
        "          const float next_left = selected_buffer[write] * overdub_feedback + live_left;\n          const float next_right = selected_buffer[write + 1U] * overdub_feedback + live_right;\n          selected_buffer[write] = next_left;\n          selected_buffer[write + 1U] = next_right;\n          update_envelope(selected_track, absolute, next_left, next_right);",
        "          const float next_left = overdub_buffer[write] * overdub_feedback + live_left;\n"
        "          const float next_right = overdub_buffer[write + 1U] * overdub_feedback + live_right;\n"
        "          overdub_buffer[write] = next_left;\n"
        "          overdub_buffer[write + 1U] = next_right;\n"
        "          update_envelope(overdub_track, absolute, next_left, next_right);")
replace('native/src/loop_processor.cpp',
        "  std::atomic<unsigned> pending_command{kNoCommand};",
        "  std::atomic<unsigned> pending_command{kNoCommand};\n  std::atomic<unsigned> pending_track{0U};")
replace('native/src/loop_processor.cpp',
        "  bool recording{false};\n  bool overdubbing{false};\n  std::size_t record_count{};",
        "  bool recording{false};\n  unsigned record_track{0U};\n  bool overdubbing{false};\n  unsigned overdub_track{0U};\n  std::size_t record_count{};")
replace('native/src/loop_processor.cpp',
        "void LoopProcessor::command(LoopCommand value) noexcept { impl_->pending_command.store(static_cast<unsigned>(value), std::memory_order_release); }",
        "void LoopProcessor::command(LoopCommand value) noexcept {\n"
        "  const unsigned track = impl_->selected.load(std::memory_order_relaxed);\n"
        "  if (value == LoopCommand::Record && !impl_->ensure_track_buffer(track)) return;\n"
        "  impl_->pending_track.store(track, std::memory_order_relaxed);\n"
        "  impl_->pending_command.store(static_cast<unsigned>(value), std::memory_order_release);\n"
        "}")
replace('native/src/loop_processor.cpp',
        "  impl_->pending_trim_end.store(clamp01(end), std::memory_order_relaxed);\n  impl_->pending_command.store(kTrimCommand, std::memory_order_release);",
        "  impl_->pending_trim_end.store(clamp01(end), std::memory_order_relaxed);\n"
        "  impl_->pending_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);\n"
        "  impl_->pending_command.store(kTrimCommand, std::memory_order_release);")
replace('native/src/loop_processor.cpp',
        "void LoopProcessor::auto_trim() noexcept { impl_->pending_command.store(kAutoTrimCommand, std::memory_order_release); }\nvoid LoopProcessor::reset_trim() noexcept { impl_->pending_command.store(kResetTrimCommand, std::memory_order_release); }",
        "void LoopProcessor::auto_trim() noexcept {\n"
        "  impl_->pending_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);\n"
        "  impl_->pending_command.store(kAutoTrimCommand, std::memory_order_release);\n"
        "}\n"
        "void LoopProcessor::reset_trim() noexcept {\n"
        "  impl_->pending_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);\n"
        "  impl_->pending_command.store(kResetTrimCommand, std::memory_order_release);\n"
        "}")

# Clear only the transport that actually owns the cleared track.
replace('native/src/loop_processor.cpp',
        "    if (recording) {\n      recording = false;\n      record_count = 0U;\n    }\n    overdubbing = false;",
        "    if (recording && record_track == track) {\n"
        "      recording = false;\n"
        "      record_count = 0U;\n"
        "    }\n"
        "    if (overdubbing && overdub_track == track) overdubbing = false;")

# --- Loop UI: denser transient editor and all occupied clip orbits animate ------
replace('src/components/effects/RailCModules.tsx',
        '              value={state.selectedTrack}\n              onChange={(event) => {',
        "              value={state.selectedTrack}\n"
        "              disabled={state.transport === 'recording' || state.transport === 'overdubbing'}\n"
        "              onChange={(event) => {")
replace('src/components/ascii/RailCHardwareDisplay.tsx',
        "  const columns = highDefinition\n    ? Math.max(44, Math.min(76, Math.floor(width / 5.05)))\n    : Math.max(42, Math.min(72, Math.floor(width / 5.25)));\n  const fontSize = highDefinition\n    ? Math.max(6.2, Math.min(8.9, width / columns * 1.54))\n    : Math.max(5.8, Math.min(8.4, width / columns * 1.5));",
        "  const denseLoopTrim = props.kind === 'loop' && props.trimEditing;\n"
        "  const columns = denseLoopTrim\n"
        "    ? (highDefinition\n"
        "        ? Math.max(88, Math.min(112, Math.floor(width / 3.15)))\n"
        "        : Math.max(80, Math.min(104, Math.floor(width / 3.35))))\n"
        "    : highDefinition\n"
        "      ? Math.max(44, Math.min(76, Math.floor(width / 5.05)))\n"
        "      : Math.max(42, Math.min(72, Math.floor(width / 5.25)));\n"
        "  const fontSize = denseLoopTrim\n"
        "    ? (highDefinition\n"
        "        ? Math.max(4.4, Math.min(6.2, width / columns * 1.42))\n"
        "        : Math.max(4.2, Math.min(5.9, width / columns * 1.38)))\n"
        "    : highDefinition\n"
        "      ? Math.max(6.2, Math.min(8.9, width / columns * 1.54))\n"
        "      : Math.max(5.8, Math.min(8.4, width / columns * 1.5));")
replace('src/components/ascii/RailCHardwareDisplay.tsx',
        "          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '█' : '│') : '·';",
        "          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '┆' : '│') : '·';")
replace('src/components/ascii/RailCHardwareDisplay.tsx',
        "        const animatedWiper = recording ? ((phase / TAU) % 1) : loopSelectedProgress;",
        "        const selectedWiper = recording ? ((phase / TAU) % 1) : loopSelectedProgress;")
replace('src/components/ascii/RailCHardwareDisplay.tsx',
        "            const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;\n            const wiperDelta = Math.abs(((orbitPosition - animatedWiper + 1.5) % 1) - 0.5);",
        "            const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;\n"
        "            // Selected track follows its real transport position. Other occupied\n"
        "            // tracks keep their own subtle moving orbit so every playing loop stays alive.\n"
        "            const trackWiper = selected ? selectedWiper : ((phase / TAU + track * 0.137) % 1);\n"
        "            const wiperDelta = Math.abs(((orbitPosition - trackWiper + 1.5) % 1) - 0.5);")
replace('src/components/ascii/RailCHardwareDisplay.tsx',
        "                chars[column] = recording ? (orbitPosition <= animatedWiper ? '█' : '◦') : passed ? '●' : '○';\n              } else {\n                chars[column] = '◦';",
        "                chars[column] = recording ? (orbitPosition <= selectedWiper ? '█' : '◦') : passed ? '●' : '○';\n"
        "              } else {\n"
        "                const passed = playing && orbitPosition <= trackWiper;\n"
        "                chars[column] = passed ? '○' : '◦';")
replace('src/components/ascii/RailCHardwareDisplay.tsx',
        "            // Selected-track wiper: this is the Loopy-style idea, expressed as\n            // a tiny Calcotone ASCII playhead rather than a copied clip widget.\n            if (selectedActive && ringDistance < 0.27 && wiperDelta < 0.035) {\n              accents[column] = '●';\n              intensity = 1;\n            }",
        "            // Every occupied playing track keeps a moving clip-orbit wiper; the\n"
        "            // selected track remains the brightest Calcotone accent.\n"
        "            const orbitActive = (occupied && playing) || (selected && recording);\n"
        "            if (orbitActive && ringDistance < 0.27 && wiperDelta < 0.035) {\n"
        "              accents[column] = selected ? '●' : '○';\n"
        "              intensity = selected ? 1 : Math.max(intensity, 0.78);\n"
        "            }")

# --- Atmos: let the intended RT60 feedback survive the safety budget ------------
replace('src/audio/effects/Reverb.ts',
        '    const loopBudget = freeze ? 0.958 : 0.875;',
        '    const loopBudget = freeze ? 0.997 : 0.992;')
replace('src/audio/effects/Reverb.ts',
        '      const safeSelfFeedback = Math.min(loopBudget - crossMagnitude - 0.042, Math.max(0.18, lineDecay * spread));',
        '      const feedbackHeadroom = freeze ? 0.004 : 0.010;\n      const safeSelfFeedback = Math.min(loopBudget - crossMagnitude - feedbackHeadroom, Math.max(0.18, lineDecay * spread));')
replace('native/src/atmos_parity_processor.cpp',
        '    const float loop_budget = freeze ? .958F : .875F;',
        '    const float loop_budget = freeze ? .997F : .992F;\n    const float feedback_headroom = freeze ? .004F : .010F;')
replace('native/src/atmos_parity_processor.cpp',
        '      self_feedback[index] = std::min(loop_budget - cross_magnitude - .042F,',
        '      self_feedback[index] = std::min(loop_budget - cross_magnitude - feedback_headroom,')

# Native processor documentation: large Loop audio is control-thread lazy allocation.
replace('native/include/calcotone/native_processor.hpp',
        '// All memory is allocated at construction; process() is allocation-free.',
        '// Realtime process() is allocation-free; large Loop buffers are prepared on the control thread when first armed.')

# --- Regression coverage --------------------------------------------------------
loop_test = Path('native/tests/loop_processor_test.cpp')
text = loop_test.read_text(encoding='utf-8')
needle = "  // Auto trim uses the stored transient envelope instead of scanning a full\n"
insert = """  // Track 4 must arm reliably, and changing the selected UI track while REC is\n  // active must never steal the recording target underneath the audio thread.\n  loop.set_selected_track(3);\n  consume(loop);\n  std::vector<float> track_four_phrase(512U * 2U);\n  fill(track_four_phrase, .09F, -.07F);\n  loop.command(calcotone::LoopCommand::Record);\n  loop.process(track_four_phrase.data(), 192U);\n  loop.set_selected_track(4);\n  loop.process(track_four_phrase.data() + 192U * 2U, 320U);\n  loop.command(calcotone::LoopCommand::Record);\n  consume(loop);\n  loop.set_selected_track(3);\n  consume(loop);\n  assert(loop.raw_frames() == 512U);\n  assert((loop.track_mask() & (1U << 3U)) != 0U);\n  assert((loop.track_mask() & (1U << 4U)) == 0U);\n\n"""
if needle not in text:
    raise SystemExit('loop test insertion anchor missing')
loop_test.write_text(text.replace(needle, insert + needle, 1), encoding='utf-8')

# Audit locks: 256-bin transient, lazy memory, bound record target, and all-orbit animation.
audit = Path('scripts/loop-audit.mjs')
text = audit.read_text(encoding='utf-8')
text = text.replace("requireText(nativeHeader, 'kLoopEnvelopeBins = 16\\'384U', 'native transient envelope resolution');",
                    "requireText(nativeHeader, 'kLoopEnvelopeBins = 16\\'384U', 'native transient envelope resolution');\nrequireText(nativeHeader, 'kLoopWaveformBins = 256U', 'native high-resolution transient preview');\nrequireText(store, 'LOOP_WAVEFORM_BINS = 256', 'UI high-resolution transient preview');")
text = text.replace("requireText(worklet, 'autoTrim(track)', 'browser auto trim');",
                    "requireText(worklet, 'autoTrim(track)', 'browser auto trim');\nrequireText(worklet, 'this.buffers = Array.from({ length: TRACKS }, () => null)', 'browser lazy Loop audio allocation');\nrequireText(worklet, 'this.recordTrack = 0', 'browser REC target latch');\nrequireText(native, 'ensure_track_buffer(unsigned track)', 'native lazy Loop audio allocation');\nrequireText(native, 'pending_track{0U}', 'native command target latch');")
text = text.replace("requireText(display, \"accents[column] = '●'\", 'Loop selected-track ASCII wiper');",
                    "requireText(display, \"accents[column] = selected ? '●' : '○'\", 'Loop all-track ASCII wipers');\nrequireText(display, 'const denseLoopTrim', 'Loop dense transient editor grid');")
audit.write_text(text, encoding='utf-8')

print('Applied Loop crash/T4/transient/all-orbit pass and Atmos feedback-depth correction.')
