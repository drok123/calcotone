import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const rack = read('native/src/native_rack.cpp');
const atmos = read('native/src/atmos_parity_processor.cpp');
const halo = read('native/src/halo_parity_processor.cpp');
const stomp = read('native/src/stomp_parity_processor.cpp');
const drift = read('native/src/drift_parity_processor.cpp');
const ember = read('native/src/ember_parity_processor.cpp');
const emberDigital = read('native/src/ember_digital_capture_processor.cpp');
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
  'constexpr std::array<float, 7> kControlSmoothingSeconds',
  'refresh_model_coefficients();',
  'input_hp_coefficient_ = filter_coefficient(profile.highpass, rate_);',
  'input_lp_coefficient_ = filter_coefficient(input_lowpass_hz, rate_);',
  'float input_hp_coefficient_{};',
  'float input_lp_coefficient_{};',
  'std::array<float, 7> smoothing_coefficients{};',
  'smoothing_coefficients[index] = smooth_coefficient(kControlSmoothingSeconds[index], rate);',
  '* smoothing_coefficients[index];',
]) requireText(atmos, token, 'Atmos constant-coefficient hoist');

const atmosFrameStart = atmos.indexOf('  std::array<float, 2> process_frame(');
const atmosFrameEnd = atmos.indexOf('\n private:', atmosFrameStart);
if (atmosFrameStart < 0 || atmosFrameEnd < 0) {
  failures.push('Atmos frame processor boundaries missing');
} else {
  const frameBody = atmos.slice(atmosFrameStart, atmosFrameEnd);
  forbidText(frameBody, 'filter_coefficient(profile.highpass, rate_)', 'Atmos per-sample input highpass coefficient');
  forbidText(frameBody, 'filter_coefficient(input_lowpass_hz, rate_)', 'Atmos per-sample input lowpass coefficient');
  requireText(frameBody, 'input_hp_coefficient_', 'Atmos cached input highpass use');
  requireText(frameBody, 'input_lp_coefficient_', 'Atmos cached input lowpass use');
}

const atmosImplStart = atmos.indexOf('struct AtmosParityProcessor::Impl');
const atmosProcessStart = atmos.indexOf('  void process(float* data, std::size_t frames) noexcept {', atmosImplStart);
const atmosProcessEnd = atmos.indexOf('\n  float rate;', atmosProcessStart);
if (atmosImplStart < 0 || atmosProcessStart < 0 || atmosProcessEnd < 0) {
  failures.push('Atmos processor hot-loop boundaries missing');
} else {
  const processBody = atmos.slice(atmosProcessStart, atmosProcessEnd);
  forbidText(processBody, 'smooth_coefficient(', 'Atmos per-sample control smoothing exponential');
  forbidText(processBody, 'smoothing_seconds', 'Atmos per-sample smoothing-time table');
  requireText(processBody, 'smoothing_coefficients[index]', 'Atmos cached smoothing coefficient use');
}

for (const token of [
  'float glide_smoothing{};',
  'float jitter_smoothing{};',
  'float direct_smoothing{};',
  'float cross_smoothing{};',
  'std::size_t scatter_interval{};',
  'glide_smoothing = 1.F - std::exp(-1.F / (sample_rate * .055F));',
  'jitter_smoothing = 1.F - std::exp(-1.F / (sample_rate * .12F));',
  'direct_smoothing = 1.F - std::exp(-1.F / (sample_rate * .08F));',
  'cross_smoothing = 1.F - std::exp(-1.F / (sample_rate * .10F));',
  'scatter_interval = std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(sample_rate * .42F))) - 1;',
  '* glide_smoothing;',
  '* jitter_smoothing;',
  '* direct_smoothing;',
  '* cross_smoothing;',
  'scatter_countdown = scatter_interval;',
]) requireText(halo, token, 'Halo constant smoothing/timing hoist');
for (const retired of [
  'const float amount = 1.F - std::exp(-1.F / (sample_rate * .055F));',
  'const float jitter_smoothing = 1.F - std::exp(-1.F / (sample_rate * .12F));',
  'const float direct_smoothing = 1.F - std::exp(-1.F / (sample_rate * .08F));',
  'const float cross_smoothing = 1.F - std::exp(-1.F / (sample_rate * .10F));',
]) forbidText(halo, retired, 'Halo retired per-sample constant exponential');
for (const dynamicToken of [
  'one_pole_coefficient(highpass_hz, sample_rate)',
  'one_pole_coefficient(channel_lowpass_hz, sample_rate)',
  'logarithmic_cutoff(profile.lowpass_range, color)',
  'std::pow(normalized_feedback, 1.45F)',
  'std::pow(character, 1.55F)',
]) requireText(halo, dynamicToken, 'Halo sample-varying DSP remains live');

for (const token of [
  'std::array<float, 11> input_hp_coefficients{};',
  'input_hp_coefficients[index] = filter_coefficient(profiles[index].input_hz, rate * 2.F);',
  'const Profile* analog_profile = nullptr;',
  'if (mode <= 10U) {',
  'hp_g = input_hp_coefficients[mode];',
  'const Profile& profile = *analog_profile;',
  'process_wah(channel, dry, drive, tone, level, character, body)',
  'process_whammy(channel, dry, drive, tone, level, character)',
  'process_compressor(channel, dry, drive, tone, level, character, body)',
]) requireText(stomp, token, 'Stomp analog-only filter setup');
for (const retired of [
  'const float hp_g = filter_coefficient(profile.input_hz, rate * 2.F);',
  'const float tone_g = filter_coefficient(profile.tone_low + tone * (profile.tone_high - profile.tone_low), rate * 2.F);',
  "const float body_g = filter_coefficient(120.F + body * (900.F + profile.body * 1'500.F), rate * 2.F);",
]) forbidText(stomp, retired, 'Stomp retired unconditional analog filter setup');
for (const dynamicToken of [
  'tone_g = filter_coefficient(',
  'body_g = filter_coefficient(',
  'const float attack_coefficient = 1.F - std::exp(-1.F / (rate * attack));',
  'const float release_coefficient = 1.F - std::exp(-1.F / (rate * release));',
  'const float tone_coefficient = filter_coefficient(900.F + tone * 9\'500.F, rate);',
  'const float g = std::tan(kPi * cutoff / rate);',
]) requireText(stomp, dynamicToken, 'Stomp sample-varying specialty/analog DSP remains live');

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

for (const token of [
  'float input_hp_coefficient{};',
  'float compressor_attack_coefficient{};',
  'float compressor_release_coefficient{};',
  'input_hp_coefficient = coefficient(22.F, rate);',
  'compressor_attack_coefficient = 1.F - std::exp(-1.F / (rate * .004F));',
  'compressor_release_coefficient = 1.F - std::exp(-1.F / (rate * .09F));',
  '(1.F - input_hp_coefficient) * input_hp_out[channel]',
  '? compressor_attack_coefficient : compressor_release_coefficient',
]) requireText(ember, token, 'Ember fixed coefficient hoist');
for (const retired of [
  'const float g = coefficient(22.F, rate);',
  'const float attack = 1.F - std::exp(-1.F / (rate * .004F));',
  'const float release = 1.F - std::exp(-1.F / (rate * .09F));',
]) forbidText(ember, retired, 'Ember retired per-sample constant coefficient');
for (const dynamicToken of [
  'one_pole(wet, tone[ch], coefficient(cutoff, rate))',
  'one_pole(wet, tone[channel], coefficient(cutoff, rate))',
  'one_pole(wet, presence[channel], coefficient(presence_hz, rate))',
  'const float glide = 1.F - std::exp(-1.F / (rate * .045F));',
]) requireText(ember, dynamicToken, 'Ember sample-varying/block DSP remains live');

for (const token of [
  'std::array<float, 6> glide_amount{};',
  'float dc_coefficient{};',
  'float limiter_attack_coefficient{};',
  'float limiter_release_coefficient{};',
  'glide_amount[index] = 1.F - std::exp(-1.F / (rate * time_constants[index]));',
  'dc_coefficient = std::exp(-2.F * kPi * 18.F / rate);',
  'limiter_attack_coefficient = 1.F - std::exp(-1.F / (rate * .001F));',
  'limiter_release_coefficient = 1.F - std::exp(-1.F / (rate * .06F));',
  '* glide_amount[index];',
  'blocked, channel, limiter_attack_coefficient, limiter_release_coefficient,',
]) requireText(emberDigital, token, 'Ember Digital fixed coefficient hoist');
for (const retired of [
  'const float attack = 1.F - std::exp(-1.F / (rate * attack_seconds));',
  'const float release = 1.F - std::exp(-1.F / (rate * release_seconds));',
  'const float glide = 1.F - std::exp(-1.F / (rate * time_constants[index]));',
  'const float dc_coefficient = std::exp(-2.F * kPi * 18.F / rate);',
]) forbidText(emberDigital, retired, 'Ember Digital retired hot-path fixed coefficient');
for (const token of [
  'float filter_coefficient(float cutoff) const noexcept {',
  'return one_pole_with_coefficient(input, filter_coefficient(cutoff), channel, index);',
  'const float coefficient = filter_coefficient(cutoff);',
  'output = one_pole_with_coefficient(output, coefficient, channel, stage);',
]) requireText(emberDigital, token, 'Ember Digital four-pole coefficient reuse');
forbidText(emberDigital,
  'output = one_pole(output, cutoff, channel, stage);',
  'Ember Digital repeated four-pole coefficient design');
for (const dynamicToken of [
  'return 1.F - std::exp(-2.F * kPi * safe_cutoff / rate);',
  'std::log1p(mu * magnitude)',
  'std::expm1(quantized * std::log1p(mu))',
]) requireText(emberDigital, dynamicToken, 'Ember Digital sample-varying converter DSP remains live');

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
console.log('Native realtime safety audit passed · rack, Ember, and Drift model changes are dry-crossed; Atmos, Halo, Stomp, Ember, and Ember Digital keep constant/dead setup and repeated four-pole coefficient design off sample hot paths while model handoffs remain allocation-safe');
