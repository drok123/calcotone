from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


artifact_path = Path("native/src/artifact_parity_processor.cpp")
artifact = artifact_path.read_text(encoding="utf-8")
artifact = replace_required(
    artifact,
    "    value *= point.model_output;\n"
    "    value = filters[channel][2].process(value);\n",
    "    if (!point.tascam) value *= point.model_output;\n"
    "    value = filters[channel][2].process(value);\n",
    "Tascam single output trim",
)
artifact_path.write_text(artifact, encoding="utf-8")

patch_path = Path("native/tools/apply_atmos_parity.py")
patch = patch_path.read_text(encoding="utf-8")
patch = replace_required(
    patch,
    "        '#include \"calcotone/grain_parity_processor.hpp\"\\n'\n",
    "        '#include \"calcotone/grain_parity_processor.hpp\"\\n'\n"
    "        '#include \"calcotone/artifact_parity_processor.hpp\"\\n'\n",
    "Artifact parity include",
)
start_marker = "    artifact_replacement = r'''struct Artifact {"
end_marker = "    source = replace_once(source, r\"struct Artifact \\{.*?\\n\\};\\n\\nstruct Stomp \\{\", artifact_replacement, \"Artifact\")"
start = patch.find(start_marker)
end = patch.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("missing Artifact replacement block")
wrapper = """    artifact_replacement = r'''struct Artifact {
  Params p{0.F, .162F, .16F, .10F, .62F, .26F};
  ArtifactParityProcessor processor;
  explicit Artifact(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter(\"mode\", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter(\"wear\", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter(\"wow\", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter(\"noise\", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter(\"tone\", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter(\"mix\", p.target[5].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Stomp {'''
"""
patch = patch[:start] + wrapper + patch[end:]
patch = patch.replace(
    "live Ember, Drift, Halo, Atmos, Grain, and Artifact processing",
    "live Ember, Drift, Halo, Atmos, Grain, and dedicated Artifact processing",
)
patch_path.write_text(patch, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_required(
    cmake,
    "  src/grain_parity_processor.cpp\n",
    "  src/grain_parity_processor.cpp\n  src/artifact_parity_processor.cpp\n",
    "Artifact parity library source",
)
cmake = replace_required(
    cmake,
    "add_executable(native_grain_live_parity_test tests/native_grain_live_parity_test.cpp)\n"
    "target_link_libraries(native_grain_live_parity_test PRIVATE calcotone_dsp)\n",
    "add_executable(native_grain_live_parity_test tests/native_grain_live_parity_test.cpp)\n"
    "target_link_libraries(native_grain_live_parity_test PRIVATE calcotone_dsp)\n"
    "add_executable(artifact_parity_processor_test tests/artifact_parity_processor_test.cpp)\n"
    "target_link_libraries(artifact_parity_processor_test PRIVATE calcotone_dsp)\n"
    "add_executable(native_artifact_live_parity_test tests/native_artifact_live_parity_test.cpp)\n"
    "target_link_libraries(native_artifact_live_parity_test PRIVATE calcotone_dsp)\n",
    "Artifact parity test targets",
)
cmake = replace_required(
    cmake,
    "add_test(NAME native_grain_live_parity_test COMMAND native_grain_live_parity_test)\n",
    "add_test(NAME native_grain_live_parity_test COMMAND native_grain_live_parity_test)\n"
    "add_test(NAME artifact_parity_processor_test COMMAND artifact_parity_processor_test)\n"
    "add_test(NAME native_artifact_live_parity_test COMMAND native_artifact_live_parity_test)\n",
    "Artifact parity CTest registrations",
)
cmake_path.write_text(cmake, encoding="utf-8")

windows_path = Path("scripts/windows-ui-parity-audit.mjs")
windows = windows_path.read_text(encoding="utf-8")
windows = replace_required(
    windows,
    "const grainNative = read('native/src/grain_parity_processor.cpp');\n",
    "const grainNative = read('native/src/grain_parity_processor.cpp');\n"
    "const artifactNative = read('native/src/artifact_parity_processor.cpp');\n",
    "Artifact native audit source",
)
windows = replace_required(
    windows,
    "  { id: 'media', name: 'Artifact', native: `${nativeRackTemplate}\\n${nativeRackPatch}`, needles: ['struct Artifact', 'RackModule::Artifact'] },\n",
    "  { id: 'media', name: 'Artifact', native: `${nativeRackPatch}\\n${artifactNative}`, needles: ['ArtifactParityProcessor', 'processor.set_parameter(\"mode\"', 'bcm_capture', 'atr_tape_transfer', 'point.insert'] },\n",
    "dedicated Artifact audit contract",
)
windows_path.write_text(windows, encoding="utf-8")

artifact_audit_path = Path("scripts/artifact-matrix-ui-audit.mjs")
artifact_audit = artifact_audit_path.read_text(encoding="utf-8")
artifact_audit = replace_required(
    artifact_audit,
    "const cmake = fs.readFileSync('native/CMakeLists.txt', 'utf8');\n",
    "const cmake = fs.readFileSync('native/CMakeLists.txt', 'utf8');\n"
    "const artifactNative = fs.readFileSync('native/src/artifact_parity_processor.cpp', 'utf8');\n",
    "Artifact native UI audit source",
)
artifact_audit = replace_required(
    artifact_audit,
    "  [!cmake.includes('artifact_chain_'), 'hidden Artifact chain targets removed'],\n",
    "  [!cmake.includes('artifact_chain_'), 'hidden Artifact chain targets removed'],\n"
    "  [artifactNative.includes('ArtifactParityProcessor::set_parameter'), 'dedicated Artifact processor is live'],\n"
    "  [artifactNative.includes('std::clamp(std::round(value), 0.F, 13.F)'), 'fourteen stable Artifact model indices'],\n"
    "  [artifactNative.includes('else if (name == \"mix\")') && !artifactNative.includes('name == \"console\"') && !artifactNative.includes('name == \"tube\"') && !artifactNative.includes('name == \"chainOrder\"'), 'native Artifact exposes only canonical controls'],\n",
    "Artifact native audit checks",
)
artifact_audit_path.write_text(artifact_audit, encoding="utf-8")

print("Routed all fourteen Artifact models through the dedicated canonical native processor.")
