#include "calcotone/atmos_lexicon224_converter.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kTanhTableSize = 4097U;
constexpr float kTanhRange = 4.F;

float filter_coefficient(float cutoff, float rate) noexcept {
  const float safe_cutoff = std::clamp(cutoff, 80.F, rate * .44F);
  return 1.F - std::exp(-2.F * kPi * safe_cutoff / rate);
}

const std::array<float, kTanhTableSize>& tanh_table() noexcept {
  static const auto table = [] {
    std::array<float, kTanhTableSize> result{};
    for (std::size_t index = 0; index < result.size(); ++index) {
      const float normalized = static_cast<float>(index)
          / static_cast<float>(result.size() - 1U);
      result[index] = std::tanh(normalized * (kTanhRange * 2.F) - kTanhRange);
    }
    return result;
  }();
  return table;
}

float fast_tanh(float value) noexcept {
  if (value <= -kTanhRange) return -1.F;
  if (value >= kTanhRange) return 1.F;
  const auto& table = tanh_table();
  const float position = (value + kTanhRange)
      * (static_cast<float>(kTanhTableSize - 1U) / (kTanhRange * 2.F));
  const auto first = static_cast<std::size_t>(position);
  const auto second = std::min(first + 1U, kTanhTableSize - 1U);
  const float fraction = position - static_cast<float>(first);
  return table[first] + (table[second] - table[first]) * fraction;
}

float lowpass(float value, float coefficient,
              std::array<float, 2>& state, std::size_t stage) noexcept {
  state[stage] += (value - state[stage]) * coefficient;
  return state[stage];
}

float transformer(float value, float normalization) noexcept {
  // Very restrained transformer/input-amplifier rounding. The 224 identity should
  // come from the converter/algorithm, not from obvious saturation.
  const float biased = value + std::max(0.F, value) * .006F;
  return fast_tanh(biased * 1.035F) * normalization;
}
}  // namespace

struct AtmosLexicon224Converter::Impl {
  Impl(float requested_rate, Lexicon224ConverterRole requested_role)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)), role(requested_role),
        input_coefficient(filter_coefficient(8200.F, rate)),
        output_coefficient(filter_coefficient(8800.F, rate)),
        transformer_normalization(1.F / fast_tanh(1.035F)) {
    // Force the LUT's one-time initialization onto construction/control time,
    // never the first realtime sample.
    (void)tanh_table();
  }

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
    left = transformer(left, transformer_normalization);
    right = transformer(right, transformer_normalization);
    left = lowpass(lowpass(left, input_coefficient, input_filter[0], 0U),
                   input_coefficient, input_filter[0], 1U);
    right = lowpass(lowpass(right, input_coefficient, input_filter[1], 0U),
                    input_coefficient, input_filter[1], 1U);

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
    left = lowpass(lowpass(left, output_coefficient, output_filter[0], 0U),
                   output_coefficient, output_filter[0], 1U);
    right = lowpass(lowpass(right, output_coefficient, output_filter[1], 0U),
                    output_coefficient, output_filter[1], 1U);
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
  float input_coefficient{};
  float output_coefficient{};
  float transformer_normalization{1.F};
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
