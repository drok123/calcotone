import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const rack = read('native/src/native_rack.cpp');
const atmos = read('native/src/atmos_parity_processor.cpp');
const drift = read('native/src/drift_parity_processor.cpp');
const ember = read('native/src/ember_parity_processor.cpp');
const host = read('native/src/wasapi_host.cpp');
const parityGenerator = read('native/tools/apply_atmos_parity.py');
const emberRouteGenerator = read('native/tools/apply_ember_magnetic_route.py');
const failures = [];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

for (const token of [
  'for (std::size_t i = 1; i < value.size(); ++i)',
  'float mode_mix{1.F};',
  'unsigned mode_transition{};',
  'params.sync_mode(params.target_mode());',
  'const float mode_fade_step = 1.F / std::max(1.F, impl_->sample_rate * .003F);',
  'const std::size_t mode_fade_frames = std::max<std::size_t>(1U,',
  'blend = params.active * params.mode_mix;',
]) requireText(rack, token, 'Discrete native rack model handoff');
forbidText(rack,
  'for (std::size_t i = 0; i < value.size(); ++i)\n      value[i] += (target[i].load(std::memory_order_relaxed) - value[i]) * amount;',
  'Discrete model index must not be knob-smoothed');

for (const token of [
  'AtmosNetwork network_a;',
  'AtmosNetwork network_b;',
  'AtmosNetwork* active;',
  'AtmosNetwork* retiring{};',
  'network_a(rate, 2U), network_b(rate, 2U), active(&network_a)',
  'retiring = nullptr;',
  'next->set_model(requested);',
  'rate * .08F',
]) requireText(atmos, token, 'Allocation-free Atmos model handoff');
forbidText(atmos, 'std::make_unique<AtmosNetwork>', 'Atmos audio callback heap allocation');

for (const token of [
  'float mode_mix{1.F};',
  'float mode_fade_step{};',
  'unsigned mode_transition{};',
  'void activate_mode(std::size_t mode) noexcept',
  'void advance_mode_transition() noexcept',
  'data[frame * 2] = dry_l + (processed_l - dry_l) * mode_mix;',
]) requireText(drift, token, 'Click-safe dedicated Drift model handoff');

for (const token of [
  'int active_mode{-1};',
  'float mode_mix{1.F};',
  'void prepare_mode_transition() noexcept',
  'void advance_mode_transition() noexcept',
  'const unsigned mode = static_cast<unsigned>(std::max(0, active_mode));',
  'data[frame * 2 + channel] = dry[channel] + (processed - dry[channel]) * mode_mix;',
]) requireText(ember, token, 'Click-safe dedicated Ember model handoff');

requireText(parityGenerator, 'p.value[0]', 'Generated parity wrapper committed model state');
forbidText(parityGenerator, 'p.target[0].load(std::memory_order_relaxed)', 'Generated parity wrapper target-mode bypass');
requireText(emberRouteGenerator, 'const float mode_value = p.value[0];', 'Generated Ember specialty committed mode state');
forbidText(emberRouteGenerator, 'const float mode_value = p.target[0]', 'Generated Ember specialty target-mode bypass');

for (const token of [
  'RealtimeThreadScope realtime;',
  'ring->pull(captured_left, captured_right, &stream_discontinuity)',
  'recovery.process(valid, captured_left, captured_right, left, right)',
  'fifo_safety.observe_deadline_miss()',
]) requireText(host, token, 'WASAPI recovery contract');

if (failures.length) {
  console.error(`Native realtime safety audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Native realtime safety audit passed · rack, Ember, and Drift model changes are dry-crossed and Atmos switching performs no network heap allocation in the render callback');
