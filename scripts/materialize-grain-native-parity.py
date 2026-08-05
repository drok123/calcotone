from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


patch_path = Path("native/tools/apply_atmos_parity.py")
patch = patch_path.read_text(encoding="utf-8")
patch = replace_required(
    patch,
    "        '#include \"calcotone/halo_parity_processor.hpp\"\\n'\n",
    "        '#include \"calcotone/halo_parity_processor.hpp\"\\n'\n"
    "        '#include \"calcotone/grain_parity_processor.hpp\"\\n'\n",
    "Grain parity include",
)
marker = "    artifact_replacement = r'''struct Artifact {"
grain_route = """    grain_replacement = r'''struct Grain {
  Params p{2.F, 13.F, .42F, .38F, .16F, .36F, .12F};
  GrainParityProcessor processor;
  explicit Grain(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter(\"mode\", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter(\"bits\", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter(\"density\", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter(\"pitch\", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter(\"chaos\", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter(\"bloom\", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter(\"mix\", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Artifact {'''
    source = replace_once(source, r\"struct Grain \\{.*?\\n\\};\\n\\nstruct Artifact \\{\", grain_replacement, \"Grain\")

"""
patch = replace_required(patch, marker, grain_route + marker, "Grain route insertion")
patch = patch.replace(
    "live Ember, Drift, Halo, Atmos, and Artifact matrix processing",
    "live Ember, Drift, Halo, Atmos, Grain, and Artifact processing",
)
patch_path.write_text(patch, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_required(
    cmake,
    "  src/halo_space_echo_processor.cpp\n",
    "  src/halo_space_echo_processor.cpp\n  src/grain_parity_processor.cpp\n",
    "Grain parity library source",
)
cmake = replace_required(
    cmake,
    "add_executable(halo_space_echo_processor_test tests/halo_space_echo_processor_test.cpp)\n"
    "target_link_libraries(halo_space_echo_processor_test PRIVATE calcotone_dsp)\n",
    "add_executable(halo_space_echo_processor_test tests/halo_space_echo_processor_test.cpp)\n"
    "target_link_libraries(halo_space_echo_processor_test PRIVATE calcotone_dsp)\n"
    "add_executable(grain_parity_processor_test tests/grain_parity_processor_test.cpp)\n"
    "target_link_libraries(grain_parity_processor_test PRIVATE calcotone_dsp)\n"
    "add_executable(native_grain_live_parity_test tests/native_grain_live_parity_test.cpp)\n"
    "target_link_libraries(native_grain_live_parity_test PRIVATE calcotone_dsp)\n",
    "Grain parity test targets",
)
cmake = replace_required(
    cmake,
    "add_test(NAME halo_space_echo_processor_test COMMAND halo_space_echo_processor_test)\n",
    "add_test(NAME halo_space_echo_processor_test COMMAND halo_space_echo_processor_test)\n"
    "add_test(NAME grain_parity_processor_test COMMAND grain_parity_processor_test)\n"
    "add_test(NAME native_grain_live_parity_test COMMAND native_grain_live_parity_test)\n",
    "Grain parity CTest registrations",
)
cmake_path.write_text(cmake, encoding="utf-8")

audit_path = Path("scripts/windows-ui-parity-audit.mjs")
audit = audit_path.read_text(encoding="utf-8")
audit = replace_required(
    audit,
    "const atmosNative = read('native/src/atmos_parity_processor.cpp');\n",
    "const atmosNative = read('native/src/atmos_parity_processor.cpp');\n"
    "const grainNative = read('native/src/grain_parity_processor.cpp');\n",
    "Grain native audit source",
)
audit = replace_required(
    audit,
    "  { id: 'bitcrusher', name: 'Grain', native: `${nativeRackTemplate}\\n${nativeRackPatch}`, needles: ['struct Grain', 'RackModule::Grain'] },\n",
    "  { id: 'bitcrusher', name: 'Grain', native: `${nativeRackPatch}\\n${grainNative}`, needles: ['GrainParityProcessor', 'processor.set_parameter(\"mode\"', 'capture_freeze', 'spawn_voice'] },\n",
    "dedicated Grain audit contract",
)
audit_path.write_text(audit, encoding="utf-8")

print("Routed all twelve Grain modes through the canonical native live-memory engine.")
