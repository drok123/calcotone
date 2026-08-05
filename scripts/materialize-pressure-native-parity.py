from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


rack_path = Path("native/src/native_rack.cpp")
rack = rack_path.read_text(encoding="utf-8")
pressure_include = '#include "calcotone/pressure_parity_processor.hpp"\n'
if pressure_include not in rack:
    rack = replace_required(
        rack,
        '#include "calcotone/native_rack.hpp"\n',
        '#include "calcotone/native_rack.hpp"\n' + pressure_include,
        "Pressure parity include",
    )

if "PressureParityProcessor processor;" not in rack:
    start_marker = "struct NativePressure::Impl {"
    end_marker = "struct NativeDreamBuffer::Impl"
    start = rack.find(start_marker)
    end = rack.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError("missing embedded NativePressure semantic markers")
    replacement = '''struct NativePressure::Impl {
  PressureParityProcessor processor;
  explicit Impl(float sample_rate) : processor(sample_rate) {}
};

NativePressure::NativePressure(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
NativePressure::~NativePressure() = default;
void NativePressure::set_bypassed(bool bypassed) noexcept {
  impl_->processor.set_bypassed(bypassed);
}
bool NativePressure::set_parameter(std::string_view name, float value) noexcept {
  return impl_->processor.set_parameter(name, value);
}
void NativePressure::process(float* data, std::size_t frames) noexcept {
  impl_->processor.process(data, frames);
}

'''
    rack = rack[:start] + replacement + rack[end:]
rack_path.write_text(rack, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
if "src/pressure_parity_processor.cpp" not in cmake:
    cmake = replace_required(
        cmake,
        "  src/stomp_parity_processor.cpp\n",
        "  src/stomp_parity_processor.cpp\n  src/pressure_parity_processor.cpp\n",
        "Pressure parity library source",
    )
if "add_executable(pressure_parity_processor_test" not in cmake:
    cmake = replace_required(
        cmake,
        "add_executable(native_stomp_live_parity_test tests/native_stomp_live_parity_test.cpp)\n"
        "target_link_libraries(native_stomp_live_parity_test PRIVATE calcotone_dsp)\n",
        "add_executable(native_stomp_live_parity_test tests/native_stomp_live_parity_test.cpp)\n"
        "target_link_libraries(native_stomp_live_parity_test PRIVATE calcotone_dsp)\n"
        "add_executable(pressure_parity_processor_test tests/pressure_parity_processor_test.cpp)\n"
        "target_link_libraries(pressure_parity_processor_test PRIVATE calcotone_dsp)\n"
        "add_executable(native_pressure_live_parity_test tests/native_pressure_live_parity_test.cpp)\n"
        "target_link_libraries(native_pressure_live_parity_test PRIVATE calcotone_dsp)\n",
        "Pressure parity test targets",
    )
if "add_test(NAME pressure_parity_processor_test" not in cmake:
    cmake = replace_required(
        cmake,
        "add_test(NAME native_stomp_live_parity_test COMMAND native_stomp_live_parity_test)\n",
        "add_test(NAME native_stomp_live_parity_test COMMAND native_stomp_live_parity_test)\n"
        "add_test(NAME pressure_parity_processor_test COMMAND pressure_parity_processor_test)\n"
        "add_test(NAME native_pressure_live_parity_test COMMAND native_pressure_live_parity_test)\n",
        "Pressure parity CTest registrations",
    )
cmake_path.write_text(cmake, encoding="utf-8")

core_path = Path("scripts/core-contract-parity-audit.mjs")
core = core_path.read_text(encoding="utf-8")
if "const pressureNative = read('native/src/pressure_parity_processor.cpp');" not in core:
    core = replace_required(
        core,
        "const stompNative = read('native/src/stomp_parity_processor.cpp');\n",
        "const stompNative = read('native/src/stomp_parity_processor.cpp');\n"
        "const pressureNative = read('native/src/pressure_parity_processor.cpp');\n",
        "Pressure core audit source",
    )
old_pressure = '''    check(nativeRack.includes('struct NativePressure::Impl'), 'Pressure native processor exists');
    check(nativeRack.includes('Params p{0.F, 2.F, .42F, .46F, .38F, .72F}'), 'Pressure native defaults');
    check(nativeRack.includes('std::min(3U') && nativeRack.includes('name=="style"'), 'Pressure native model/style ceilings');'''
new_pressure = '''    check(pressureNative.includes('PressureParityProcessor::set_parameter'), 'Pressure dedicated native processor exists');
    check(pressureNative.includes('target{0.F, 2.F, .42F, .46F, .38F, .72F}'), 'Pressure native defaults');
    check(pressureNative.includes('std::clamp(std::round(value), 0.F, 3.F)'), 'Pressure native model/style ceilings');
    check(nativeRack.includes('PressureParityProcessor processor')
      && nativeRack.includes('impl_->processor.set_parameter(name, value)'), 'Pressure live wrapper delegates to dedicated processor');'''
if "Pressure dedicated native processor exists" not in core:
    core = replace_required(core, old_pressure, new_pressure, "Pressure core audit checks")
core_path.write_text(core, encoding="utf-8")

windows_path = Path("scripts/windows-ui-parity-audit.mjs")
windows = windows_path.read_text(encoding="utf-8")
if "const pressureNative = read('native/src/pressure_parity_processor.cpp');" not in windows:
    windows = replace_required(
        windows,
        "const stompNative = read('native/src/stomp_parity_processor.cpp');\n",
        "const stompNative = read('native/src/stomp_parity_processor.cpp');\n"
        "const pressureNative = read('native/src/pressure_parity_processor.cpp');\n"
        "const pressureWeb = read('src/audio/SignalLab.ts');\n",
        "Pressure Windows audit sources",
    )
anchor = "check(nativeRackPatch.includes('StompParityProcessor processor') && nativeRackPatch.includes('stomp(sample_rate)'), 'stomp', 'live rack constructs dedicated Stomp processor');\n"
pressure_checks = '''check(nativeRackPatch.includes('StompParityProcessor processor') && nativeRackPatch.includes('stomp(sample_rate)'), 'stomp', 'live rack constructs dedicated Stomp processor');

check(pressureWeb.includes("export const SIGNAL_LAB_MODES: readonly SignalLabMode[] = ['fet', 'opto', 'varimu', 'vca'] as const;"), 'pressure', 'four stable Pressure mode indices');
check(pressureWeb.includes("export const SIGNAL_LAB_STYLES: readonly SignalLabStyle[] = ['soft', 'punch', 'glue', 'crush'] as const;"), 'pressure', 'four stable Pressure style indices');
for (const needle of [
  'PressureParityProcessor::set_parameter', 'soft_knee_gain', 'detector[channel].highpass',
  'tone_filter[channel].lowpass', 'constexpr float correlation = .42F',
  'mode.threshold + style.threshold_offset - drive_control * 4.5F',
  'mode.saturation * (.82F + drive_control * 1.9F)',
]) {
  check(pressureNative.includes(needle), 'pressure', `${needle} canonical Pressure topology`);
}
check(nativeRackTemplate.includes('PressureParityProcessor processor')
  && nativeRackTemplate.includes('impl_->processor.set_bypassed(bypassed)')
  && nativeRackTemplate.includes('impl_->processor.set_parameter(name, value)'),
  'pressure', 'live NativePressure wrapper delegates to dedicated processor');
'''
if "four stable Pressure mode indices" not in windows:
    windows = replace_required(windows, anchor, pressure_checks, "Pressure Windows route checks")
windows_path.write_text(windows, encoding="utf-8")

print("Replaced embedded Pressure with the canonical four-mode, four-style native processor.")
