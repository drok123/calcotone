from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str,
                    replacement: str, label: str) -> str:
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError(f"missing {label}")
    return text[:start] + replacement + text[end:]


processor_path = Path("native/src/native_processor.cpp")
processor = processor_path.read_text(encoding="utf-8")
processor = replace_once(
    processor,
    '#include "calcotone/input_router.hpp"\n',
    '#include "calcotone/input_router.hpp"\n#include "calcotone/native_dream_engine.hpp"\n',
    "Dream include",
)
processor = replace_once(
    processor,
    "        pressure_one(rate), pressure_two(rate), dream_one(rate), dream_two(rate) {",
    "        pressure_one(rate), pressure_two(rate), dream(rate, kBlockFrames) {",
    "shared Dream construction",
)
processor = replace_once(
    processor,
    "      rack_two.set_bypassed(static_cast<RackModule>(module), true);\n",
    "      rack_two.set_bypassed(static_cast<RackModule>(module), true);\n"
    "      module_bypassed[module].store(true, std::memory_order_relaxed);\n",
    "module bypass initialization",
)
new_block = '''  void process_block(const float* input, float* output, std::size_t frames) noexcept {
    for (std::size_t frame = 0; frame < frames; ++frame) tuner.push(input[frame * 2 + 1]);
    split_dual_mono(input, lane_one_input.data(), lane_two_input.data(), frames,
                    input_gain.load(std::memory_order_relaxed));
    std::copy_n(lane_one_input.data(), frames * 2, lane_one_output.data());
    std::copy_n(lane_two_input.data(), frames * 2, lane_two_output.data());
    dream.begin_block(frames);
    const bool stack_off = stack_bypassed.load(std::memory_order_relaxed);
    const auto stack_source = static_cast<StackInputSource>(stack_input.load(std::memory_order_relaxed));
    const auto order_snapshot = packed_order.load(std::memory_order_acquire);
    bool any_rack_active = false;
    for (unsigned slot = 0; slot < kOrderSlots; ++slot) {
      const unsigned module = static_cast<unsigned>((order_snapshot >> (slot * 4U)) & 0xFU);
      if (module == kStackToken) {
        if (!stack_off && stack_receives_lane(stack_source, 0))
          stack_one.process(lane_one_output.data(), lane_one_output.data(), frames);
        if (!stack_off && stack_receives_lane(stack_source, 1))
          stack_two.process(lane_two_output.data(), lane_two_output.data(), frames);
      } else if (module < kStackToken) {
        const auto rack_module = static_cast<RackModule>(module);
        const bool enabled = !module_bypassed[module].load(std::memory_order_relaxed);
        any_rack_active = any_rack_active || enabled;
        dream.inject_route(rack_module, lane_one_output.data(), lane_two_output.data(), frames, enabled);
        rack_one.process_module(rack_module, lane_one_output.data(), frames);
        rack_two.process_module(rack_module, lane_two_output.data(), frames);
        dream.capture_module(rack_module, lane_one_output.data(), lane_two_output.data(), frames, enabled);
      }
    }
    pressure_one.process(lane_one_output.data(), frames);
    pressure_two.process(lane_two_output.data(), frames);
    const bool pressure_active = !pressure_bypassed.load(std::memory_order_relaxed);
    dream.finish_block(lane_one_output.data(), lane_two_output.data(), frames,
                       any_rack_active || !stack_off || pressure_active);
    const float gain = active.load(std::memory_order_relaxed)
        ? output_gain.load(std::memory_order_relaxed) : 0.F;
    std::uint64_t limited = 0;
    float peak = 0.F;
    mix_dual_mono(lane_one_output.data(), lane_two_output.data(), output, frames, gain, &limited, &peak);
    output_limited_samples.fetch_add(limited, std::memory_order_relaxed);
    publish_peak(pre_limiter_peak, peak);
  }
'''
processor = replace_between(
    processor,
    "  void process_block(const float* input, float* output, std::size_t frames) noexcept {",
    "\n\n  float rate;",
    new_block,
    "native process block",
)
processor = replace_once(
    processor,
    "  NativePressure pressure_one, pressure_two;\n  NativeDreamBuffer dream_one, dream_two;\n",
    "  NativePressure pressure_one, pressure_two;\n  NativeDreamEngine dream;\n",
    "shared Dream member",
)
processor = replace_once(
    processor,
    "  std::atomic<bool> active{false}, stack_bypassed{true}, stomp_bypassed{true};\n",
    "  std::array<std::atomic<bool>, kStackToken> module_bypassed{};\n"
    "  std::atomic<bool> active{false}, stack_bypassed{true}, stomp_bypassed{true}, pressure_bypassed{true};\n",
    "Dream bypass state",
)
processor = replace_once(
    processor,
    "void NativeProcessor::set_module_bypassed(RackModule module, bool bypassed) noexcept {\n  if (module == RackModule::Stomp) {",
    "void NativeProcessor::set_module_bypassed(RackModule module, bool bypassed) noexcept {\n"
    "  if (module < RackModule::Count)\n"
    "    impl_->module_bypassed[static_cast<unsigned>(module)].store(bypassed, std::memory_order_relaxed);\n"
    "  if (module == RackModule::Stomp) {",
    "module bypass publication",
)
processor = replace_once(
    processor,
    "void NativeProcessor::set_pressure_bypassed(bool bypassed) noexcept {\n"
    "  impl_->pressure_one.set_bypassed(bypassed); impl_->pressure_two.set_bypassed(bypassed);\n}",
    "void NativeProcessor::set_pressure_bypassed(bool bypassed) noexcept {\n"
    "  impl_->pressure_bypassed.store(bypassed, std::memory_order_relaxed);\n"
    "  impl_->pressure_one.set_bypassed(bypassed); impl_->pressure_two.set_bypassed(bypassed);\n}",
    "Pressure bypass publication",
)
processor_path.write_text(processor, encoding="utf-8")

header_path = Path("native/include/calcotone/native_rack.hpp")
header = header_path.read_text(encoding="utf-8")
start = header.find("// Always-on, very-low-level acoustic memory return")
end = header.find("\n\n}  // namespace calcotone", start)
if start < 0 or end < 0:
    raise RuntimeError("missing retired NativeDreamBuffer declaration")
header_path.write_text(header[:start] + header[end + 2:], encoding="utf-8")

rack_path = Path("native/src/native_rack.cpp")
rack = rack_path.read_text(encoding="utf-8")
start = rack.find("struct NativeDreamBuffer::Impl")
end = rack.find("}  // namespace calcotone", start)
if start < 0 or end < 0:
    raise RuntimeError("missing retired NativeDreamBuffer implementation")
rack_path.write_text(rack[:start] + rack[end:], encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_once(
    cmake,
    "  src/pressure_parity_processor.cpp\n",
    "  src/pressure_parity_processor.cpp\n"
    "  src/dream_buffer_parity_processor.cpp\n"
    "  src/native_dream_engine.cpp\n",
    "Dream sources",
)
cmake = replace_once(
    cmake,
    "add_executable(native_pressure_live_parity_test tests/native_pressure_live_parity_test.cpp)\n"
    "target_link_libraries(native_pressure_live_parity_test PRIVATE calcotone_dsp)\n",
    "add_executable(native_pressure_live_parity_test tests/native_pressure_live_parity_test.cpp)\n"
    "target_link_libraries(native_pressure_live_parity_test PRIVATE calcotone_dsp)\n"
    "add_executable(dream_buffer_parity_processor_test tests/dream_buffer_parity_processor_test.cpp)\n"
    "target_link_libraries(dream_buffer_parity_processor_test PRIVATE calcotone_dsp)\n"
    "add_executable(native_dream_engine_test tests/native_dream_engine_test.cpp)\n"
    "target_link_libraries(native_dream_engine_test PRIVATE calcotone_dsp)\n"
    "add_executable(native_dream_live_parity_test tests/native_dream_live_parity_test.cpp)\n"
    "target_link_libraries(native_dream_live_parity_test PRIVATE calcotone_dsp)\n",
    "Dream test targets",
)
cmake = replace_once(
    cmake,
    "add_test(NAME native_pressure_live_parity_test COMMAND native_pressure_live_parity_test)\n",
    "add_test(NAME native_pressure_live_parity_test COMMAND native_pressure_live_parity_test)\n"
    "add_test(NAME dream_buffer_parity_processor_test COMMAND dream_buffer_parity_processor_test)\n"
    "add_test(NAME native_dream_engine_test COMMAND native_dream_engine_test)\n"
    "add_test(NAME native_dream_live_parity_test COMMAND native_dream_live_parity_test)\n",
    "Dream tests",
)
cmake_path.write_text(cmake, encoding="utf-8")
print("Materialized shared native Dream parity.")
