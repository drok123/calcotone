import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'native/src/halo_space_echo_processor.cpp'), 'utf8');
const failures = [];
const requireText = (needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText('constexpr std::size_t kControlPeriod = 32U', 'Control-rate cadence');
requireText('glide_amount[index] = 1.F - std::exp', 'Construction-time glide coefficients');
requireText('BiquadCoefficients design_biquad', 'Cached biquad design');
requireText('input_lowpass_coefficients = design_biquad', 'Input filter control-rate design');
requireText('head_lowpass_coefficients[head] = design_biquad', 'Head filter control-rate design');
requireText('fast_tanh(asymmetric * curve.drive)', 'LUT tape nonlinearity');
requireText('advance_modulation()', 'Recursive modulation oscillator');
requireText('wow_rotation_sine = std::sin(wow_increment)', 'Control-rate wow rotation');
requireText('if (++write == record_buffer.size()) write = 0U', 'Division-free write wrap');
forbidText('std::asin(std::sin(phase))', 'Per-sample transcendental triangle wave');
forbidText('write = (write + 1) % record_buffer.size()', 'Per-sample modulo write wrap');

const processStart = source.indexOf('void process(float* data, std::size_t frames) noexcept');
const processEnd = source.indexOf('\n  }\n};', processStart);
const processBody = processStart >= 0 && processEnd > processStart
  ? source.slice(processStart, processEnd)
  : '';
if (!processBody) failures.push('Could not isolate Space Echo process() body');
for (const token of ['std::exp(', 'std::log(', 'std::pow(', 'std::sin(', 'std::cos(', 'std::tanh(', 'std::asin(']) {
  if (processBody.includes(token)) failures.push(`Sample loop must not evaluate ${token}`);
}

if (failures.length) {
  console.error(`Space Echo realtime audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Space Echo realtime audit passed · sample loop keeps state evolution while control/transcendental math is amortized.');
