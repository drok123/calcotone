import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const adaptive = read('native/src/adaptive_fidelity.cpp');
const adaptiveHeader = read('native/include/calcotone/adaptive_fidelity.hpp');
const circuit = read('native/src/circuit_dna_profiler.cpp');
const circuitHeader = read('native/include/calcotone/circuit_dna_profiler.hpp');
const loop = read('native/src/loop_processor.cpp');
const processor = read('native/src/native_processor.cpp');
const rack = read('native/src/native_rack.cpp');
const grain = read('native/src/grain_parity_processor.cpp');
const host = read('native/src/wasapi_host.cpp');
const cmake = read('native/CMakeLists.txt');
const failures = [];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

for (const token of ['std::vector', 'std::mutex', 'std::string', 'new ', 'make_unique'])
  forbidText(`${adaptiveHeader}\n${adaptive}\n${circuitHeader}\n${circuit}`, token,
    'Fixed-memory science controllers');
for (const token of ['std::chrono', 'performance.now', 'steady_clock'])
  forbidText(`${adaptive}\n${circuit}\n${grain}\n${loop}`, token,
    'DSP wall-clock access');

for (const token of [
  'std::clamp(input_rms / output_rms, .97F, 1.03F)',
  'sample_rate_ * 1.5F',
  'published_drive_',
  'published_color_',
  'published_dynamics_',
  'published_memory_',
]) requireText(circuit, token, 'Bounded Circuit DNA profiler');
requireText(rack, 'impl_->circuit_dna[static_cast<std::size_t>(module)].observe(',
  'Per-module gray-box observation');

for (const token of [
  'if (instantaneous >= 1.F)',
  'render_load_ > .74F',
  'sustained_high_ >= 12U',
  'render_load_ < .46F',
  'sustained_low_ >= 1000U',
]) requireText(adaptive, token, 'Adaptive fidelity hysteresis');
requireText(host, 'processor.observe_render_timing(render_micros, render_deadline_micros);',
  'Host-fed render timing');
requireText(processor, 'const unsigned effective = std::min(requested, ceiling);',
  'Stack quality ceiling');
requireText(rack, 'set_voice_limit(level >= 2U ? 8U : level == 1U ? 6U : 4U)',
  'Grain voice budget');

for (const token of [
  'data[frame * 2U] = live_left + loop_left * loop_level;',
  'data[frame * 2U + 1U] = live_right + loop_right * loop_level;',
  'analysis_energy_sum += magnitude;',
  'published_analysis_energy.store(',
]) requireText(loop, token, 'Direct Loop playback plus read-only analysis');
requireText(processor, 'loop.analysis()', 'Previous-block Loop sideband');
requireText(processor, 'if (host_active) loop.process(output, frames);',
  'Standalone post-rack Loop return');

for (const token of [
  'const float direct = std::cos(angle);',
  'const float cross = std::sin(angle);',
  'one * direct + two * cross',
  'two * direct - one * cross',
  'std::clamp(amount, 0.F, .10F)',
]) requireText(processor, token, 'Energy-preserving topology morph');
requireText(processor, 'rack_module == RackModule::Grain && enabled',
  'Bypassed Grain leaves lane topology untouched');

for (const token of [
  'scienceFidelity',
  'grainDnaDrive',
  'loopAnalysisEnergy',
]) requireText(host, token, 'Control-only science telemetry');

for (const token of [
  'src/circuit_dna_profiler.cpp',
  'src/adaptive_fidelity.cpp',
  'tests/science_engine_test.cpp',
]) requireText(cmake, token, 'Native science build/test registration');

if (failures.length) {
  console.error(`Native science engine audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Native science engine audit passed · Circuit DNA, dual-input/Loop resynthesis, topology morphing, and adaptive fidelity remain bounded, fixed-memory, and Loop-direct');
