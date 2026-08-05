from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


stomp_path = Path("native/src/stomp_parity_processor.cpp")
stomp = stomp_path.read_text(encoding="utf-8")
stomp = replace_required(
    stomp,
    "    pitch_phase += 1.F / std::max(32.F, grain_samples);\n"
    "    if (pitch_phase >= 1.F) pitch_phase -= 1.F;\n"
    "    const float phase_a = pitch_phase;\n",
    "    pitch_phase[channel] += 1.F / std::max(32.F, grain_samples);\n"
    "    if (pitch_phase[channel] >= 1.F) pitch_phase[channel] -= 1.F;\n"
    "    const float phase_a = pitch_phase[channel];\n",
    "independent stereo Whammy phase",
)
stomp = replace_required(
    stomp,
    "    pitch_write = 0U; pitch_phase = 0.F;\n",
    "    pitch_write = 0U; pitch_phase.fill(0.F);\n",
    "Whammy phase reset",
)
stomp = replace_required(
    stomp,
    "  float pitch_phase{};\n",
    "  std::array<float, 2> pitch_phase{};\n",
    "Whammy phase state",
)
stomp_path.write_text(stomp, encoding="utf-8")

patch_path = Path("native/tools/apply_atmos_parity.py")
patch = patch_path.read_text(encoding="utf-8")
patch = replace_required(
    patch,
    "        '#include \"calcotone/artifact_parity_processor.hpp\"\\n'\n",
    "        '#include \"calcotone/artifact_parity_processor.hpp\"\\n'\n"
    "        '#include \"calcotone/stomp_parity_processor.hpp\"\\n'\n",
    "Stomp parity include",
)
artifact_route = "    source = replace_once(source, r\"struct Artifact \\{.*?\\n\\};\\n\\nstruct Stomp \\{\", artifact_replacement, \"Artifact\")\n"
stomp_route = """    source = replace_once(source, r\"struct Artifact \\{.*?\\n\\};\\n\\nstruct Stomp \\{\", artifact_replacement, \"Artifact\")

    stomp_replacement = r'''struct Stomp {
  Params p{0.F, .38F, .54F, .68F, .42F, .52F, 1.F};
  StompParityProcessor processor;
  explicit Stomp(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter(\"mode\", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter(\"drive\", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter(\"tone\", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter(\"level\", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter(\"character\", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter(\"body\", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter(\"mix\", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};'''
    source = replace_once(source, r\"struct Stomp \\{.*?\\n\\};\\n\\}  // namespace\", stomp_replacement + \"\\n}  // namespace\", \"Stomp\")
    source = source.replace(\"artifact(sample_rate) {\", \"artifact(sample_rate), stomp(sample_rate) {\", 1)
"""
patch = replace_required(patch, artifact_route, stomp_route, "Stomp route insertion")
patch = patch.replace(
    "dedicated Artifact processing",
    "dedicated Artifact and Stomp processing",
)
patch_path.write_text(patch, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_required(
    cmake,
    "  src/artifact_parity_processor.cpp\n",
    "  src/artifact_parity_processor.cpp\n  src/stomp_parity_processor.cpp\n",
    "Stomp parity library source",
)
cmake = replace_required(
    cmake,
    "add_executable(native_artifact_live_parity_test tests/native_artifact_live_parity_test.cpp)\n"
    "target_link_libraries(native_artifact_live_parity_test PRIVATE calcotone_dsp)\n",
    "add_executable(native_artifact_live_parity_test tests/native_artifact_live_parity_test.cpp)\n"
    "target_link_libraries(native_artifact_live_parity_test PRIVATE calcotone_dsp)\n"
    "add_executable(stomp_parity_processor_test tests/stomp_parity_processor_test.cpp)\n"
    "target_link_libraries(stomp_parity_processor_test PRIVATE calcotone_dsp)\n"
    "add_executable(native_stomp_live_parity_test tests/native_stomp_live_parity_test.cpp)\n"
    "target_link_libraries(native_stomp_live_parity_test PRIVATE calcotone_dsp)\n",
    "Stomp parity test targets",
)
cmake = replace_required(
    cmake,
    "add_test(NAME native_artifact_live_parity_test COMMAND native_artifact_live_parity_test)\n",
    "add_test(NAME native_artifact_live_parity_test COMMAND native_artifact_live_parity_test)\n"
    "add_test(NAME stomp_parity_processor_test COMMAND stomp_parity_processor_test)\n"
    "add_test(NAME native_stomp_live_parity_test COMMAND native_stomp_live_parity_test)\n",
    "Stomp parity CTest registrations",
)
cmake_path.write_text(cmake, encoding="utf-8")

windows_path = Path("scripts/windows-ui-parity-audit.mjs")
windows = windows_path.read_text(encoding="utf-8")
windows = replace_required(
    windows,
    "const artifactNative = read('native/src/artifact_parity_processor.cpp');\n",
    "const artifactNative = read('native/src/artifact_parity_processor.cpp');\n"
    "const stompNative = read('native/src/stomp_parity_processor.cpp');\n",
    "Stomp native audit source",
)
stomp_anchor = "check(!app.includes('motionPadProps={{'), 'stack', 'Stack MotionPad App wiring removed');\n"
stomp_checks = """check(!app.includes('motionPadProps={{'), 'stack', 'Stack MotionPad App wiring removed');

check((railC.match(/'[^']+'/g) ?? []).filter((token) => [
  "'808 Overdrive'", "'RAT Distortion'", "'Big Muff'", "'Fuzz Face'", "'DS-1 Distortion'",
  "'Blues Driver'", "'Gold Horse'", "'Swedish Chainsaw'", "'Metal Zone'", "'Octavia'",
  "'Rangemaster'", "'Cry Baby Wah'", "'Whammy Octave'", "'Dyna Comp'",
].includes(token)).length === 14, 'stomp', 'fourteen stable Stomp UI labels');
check(stompNative.includes('kStompModeCount = 14U') || read('native/include/calcotone/stomp_parity_processor.hpp').includes('kStompModeCount = 14U'), 'stomp', 'fourteen stable native Stomp indices');
for (const needle of ['StompParityProcessor::set_parameter', 'process_wah', 'process_whammy', 'process_compressor']) {
  check(stompNative.includes(needle), 'stomp', `${needle} dedicated Stomp route`);
}
check(nativeRackPatch.includes('StompParityProcessor processor') && nativeRackPatch.includes('stomp(sample_rate)'), 'stomp', 'live rack constructs dedicated Stomp processor');
"""
windows = replace_required(windows, stomp_anchor, stomp_checks, "Stomp Windows audit contract")
windows_path.write_text(windows, encoding="utf-8")

print("Routed all fourteen Stomp models through the isolated native processor.")
