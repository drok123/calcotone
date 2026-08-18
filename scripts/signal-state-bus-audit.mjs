import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const header = read('native/include/calcotone/signal_state_bus.hpp');
const bus = read('native/src/signal_state_bus.cpp');
const processor = read('native/src/native_processor.cpp');
const rack = read('native/src/native_rack.cpp');
const grain = read('native/src/grain_parity_processor.cpp');
const artifact = read('native/src/artifact_parity_processor.cpp');
const drift = read('native/src/drift_parity_processor.cpp');
const halo = read('native/src/halo_parity_processor.cpp');
const cmake = read('native/CMakeLists.txt');
const failures = [];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

for (const token of [
  'float input_two_transient{};',
  'float input_two_brightness{};',
  'float cross_pitch_semitones{};',
  'float grain_activity{};',
  'float loop_resynthesis_activity{};',
  'float topology_morph{};',
  'float dream_ghost{};',
  'std::uint64_t reference_position{};',
  'std::uint64_t reference_frames{};',
]) requireText(header, token, 'SignalStateBus snapshot');
for (const token of ['std::vector', 'std::mutex', 'std::string', 'new ', 'make_unique'])
  forbidText(`${header}\n${bus}`, token, 'Allocation-free SignalStateBus');

requireText(bus, 'fast_envelope_[1] - slow_envelope_[1]', 'Physical Input 2 transient detector');
requireText(bus, 'std::min(\n      .35F', 'Bounded guitar activity');
requireText(bus, 'fill * clamp01(dream.memory_intent[head])', 'Dream fill-gated intent');
requireText(bus, '12.F * std::log2(input_two_pitch_hz / 110.F)', 'Input 2 pitch descriptor');
requireText(bus, 'loop_analysis.transient', 'Loop resynthesis sideband');
requireText(processor, 'input, frames, dream.profile()', 'Bus observes raw physical stereo input');
requireText(processor, 'rack_one.set_signal_reactions(', 'Input 1/tablet reaction lane');
requireText(processor, 'rack_two.set_signal_reactions(\n        0.F', 'No Input 2 self-excitation');

requireText(rack, 'impl_->apply_reference_clock(module, offset);', 'Sub-block exact reference clock');
requireText(grain, 'external_activity * .018F', 'Grain transient excitation');
requireText(grain, 'semitones += cross_pitch * cross_strength;', 'Cross-resynthesis pitch transfer');
requireText(grain, 'loop_brightness', 'Loop timbre transfer');
requireText(grain, 'spawn_sequence = 0U;', 'Grain boundary schedule anchor');
requireText(artifact, 'external_ghost * .12F', 'Bounded Dream ghost patina');
requireText(artifact, 'mode <= 7U || mode == 12U', 'Media-only Dream reaction');
requireText(drift, 'nudge_reference_phase(0.F, .08F)', 'Drift soft phase lock');
requireText(halo, 'scatter_countdown = 0U;', 'Halo boundary event lock');

for (const source of [grain, artifact, drift, halo]) {
  forbidText(source, 'performance.now', 'Native DSP wall-clock access');
  forbidText(source, 'std::chrono', 'Native DSP wall-clock access');
}
requireText(cmake, 'src/signal_state_bus.cpp', 'SignalStateBus native build');
requireText(cmake, 'tests/signal_state_bus_test.cpp', 'SignalStateBus native regression');

if (failures.length) {
  console.error(`Signal state bus audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Signal state bus audit passed · Input 2 excites Grain, Dream ghosts Artifact, and Loop sample position anchors Grain/Halo/Drift without realtime allocation');
