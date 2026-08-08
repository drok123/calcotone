#include "calcotone/dsp_core.hpp"

#include <cassert>
#include <cmath>
#include <cstddef>

int main() {
  using namespace calcotone::dsp;

  ControlRateDivider divider(4U);
  for (unsigned index = 0; index < 16U; ++index)
    assert(divider.tick() == (index % 4U == 0U));
  divider.reset();
  assert(divider.tick());

  for (unsigned index = 0; index <= 100U; ++index) {
    const float mix = static_cast<float>(index) / 100.F;
    const auto [dry, wet] = equal_power_gains(mix);
    assert(std::abs(dry * dry + wet * wet - 1.F) < 2e-5F);
  }

  TptLowpass2 lowpass;
  const float coefficient = tpt_coefficient(2'000.F, 48'000.F);
  double input_energy = 0.0;
  double output_energy = 0.0;
  for (std::size_t sample = 0; sample < 16'384U; ++sample) {
    const float input = sample & 1U ? 1.F : -1.F;
    const float output = lowpass.process(input, coefficient);
    assert(std::isfinite(output));
    input_energy += static_cast<double>(input) * input;
    output_energy += static_cast<double>(output) * output;
  }
  assert(output_energy < input_energy * .08);

  AdaaTanh shaper;
  assert(shaper.process(0.F) == 0.F);
  float previous = 0.F;
  for (std::size_t sample = 0; sample < 48'000U; ++sample) {
    const float phase = static_cast<float>(sample) * .071F;
    const float input = std::sin(phase) * 7.5F;
    const float output = shaper.process(input);
    assert(std::isfinite(output));
    assert(std::abs(output) <= 1.001F);
    assert(std::abs(output - previous) < 2.01F);
    previous = output;
  }

  assert(sanitize_audio(1e-35F) == 0.F);
  assert(sanitize_audio(99.F, 2.F) == 2.F);
  assert(sanitize_audio(-99.F, 2.F) == -2.F);
  assert(std::abs(db_to_gain(6.F) - 1.995262F) < 1e-4F);
  return 0;
}
