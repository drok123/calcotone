#include "calcotone/atmos_lexicon224_converter.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;

float filter_coefficient(float cutoff, float rate) noexcept {
  const float safe_cutoff = std::clamp(cutoff, 80.F, rate * .44F);
  return 1.F - std::exp(-2.F * kPi * safe_cutoff / rate);
}

float lowpass(float value, float cutoff, std::array<float, 2>& state,
              std::size_t stage, float rate) noexcept {
  state[stage] += (value - state[stage]) * filter_coefficient(cutoff, rate);
  return state[stage];
}

float transformer(float value) noexcept {
  const float biased = value + std::max(0.F, value) * .006F;
  return std::tanh(biased * 1.035F) / std::tanh(1.035F);
}
}  // namespace

struct AtmosLexicon224Converter::Impl {
  Impl(float requested_rate, Lexicon224ConverterRole requested_role)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)), role(requested_role) {}

  void reset() noexcept {
    phase = 0.F;
    held.fill(0.F);
    input_filter.fill({});
    output_filter.fill({});
    gain_range.fill(1);
    range_hold.fill(0);
  }

  int select_gain_range(float value, unsigned channel) noexcept {
    const float magnitude = std::abs(value);
    int wanted = magnitude < .055F ? 8 : magnitude < .12F ? 4 : magnitude < .24F ? 2 : 1;
    const int current = gain_range[channel];
    const int hold = range_hold[channel];
    if (hold > 0 && wanted < current) wanted = current;
    range_hold[channel] = wanted != current ? 20 : std::max(0, hold - 1);
    gain_range[channel] = wanted;
    return wanted;
  }

  float quantize_gain_stepped(float value, unsigned channel) noexcept {
    const float range = static_cast<float>(select_gain_range(value, channel));
    constexpr float levels = 2047.F;
    const float scaled = std::clamp(value * range, -1.F, 1.F);
    return std::round(scaled * levels) / levels / range;
  }

  std::array<float, 2> process_input(float left, float right) noexcept {
    left = transformer(left);
    right = transformer(right);
    left = lowpass(lowpass(left, 8200.F, input_filter[0], 0U, rate),
                   8200.F, input_filter[0], 1U, rate);
    right = lowpass(lowpass(right, 8200.F, input_filter[1], 0U, rate),
                    8200.F, input_filter[1], 1U, rate);

    phase += 20'000.F / rate;
    if (phase >= 1.F) {
      phase -= std::floor(phase);
      held[0] = quantize_gain_stepped(left, 0U);
      held[1] = quantize_gain_stepped(right, 1U);
    }
    return held;
  }

  std::array<float, 2> process_output(float left, float right) noexcept {
    left = quantize_gain_stepped(left, 0U);
    right = quantize_gain_stepped(right, 1U);
    left = lowpass(lowpass(left, 8800.F, output_filter[0], 0U, rate),
                   8800.F, output_filter[0], 1U, rate);
    right = lowpass(lowpass(right, 8800.F, output_filter[1], 0U, rate),
                    8800.F, output_filter[1], 1U, rate);
    return {left, right};
  }

  std::array<float, 2> process(float left, float right) noexcept {
    if (!std::isfinite(left)) left = 0.F;
    if (!std::isfinite(right)) right = left;
    auto result = role == Lexicon224ConverterRole::Input
        ? process_input(left, right)
        : process_output(left, right);
    result[0] = std::clamp(result[0], -1.1F, 1.1F);
    result[1] = std::clamp(result[1], -1.1F, 1.1F);
    return result;
  }

  float rate;
  Lexicon224ConverterRole role;
  float phase{};
  std::array<float, 2> held{};
  std::array<std::array<float, 2>, 2> input_filter{};
  std::array<std::array<float, 2>, 2> output_filter{};
  std::array<int, 2> gain_range{1, 1};
  std::array<int, 2> range_hold{};
};

AtmosLexicon224Converter::AtmosLexicon224Converter(
    float rate, Lexicon224ConverterRole role)
    : impl_(std::make_unique<Impl>(rate, role)) {}
AtmosLexicon224Converter::~AtmosLexicon224Converter() = default;
std::array<float, 2> AtmosLexicon224Converter::process(float left, float right) noexcept {
  return impl_->process(left, right);
}
void AtmosLexicon224Converter::reset() noexcept { impl_->reset(); }

}  // namespace calcotone
