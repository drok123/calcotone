#include "calcotone/atmos_lexicon224_converter.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <limits>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;

std::vector<std::array<float, 2>> render(
    calcotone::AtmosLexicon224Converter& converter,
    const std::vector<std::array<float, 2>>& input) {
  std::vector<std::array<float, 2>> output;
  output.reserve(input.size());
  for (const auto& frame : input) {
    const auto processed = converter.process(frame[0], frame[1]);
    assert(std::isfinite(processed[0]) && std::isfinite(processed[1]));
    assert(std::abs(processed[0]) <= 1.1F && std::abs(processed[1]) <= 1.1F);
    output.push_back(processed);
  }
  return output;
}

void test_input_role_uses_20khz_sample_hold() {
  calcotone::AtmosLexicon224Converter converter(
      kRate, calcotone::Lexicon224ConverterRole::Input);
  const std::vector<std::array<float, 2>> input(8U, {.4F, -.3F});
  const auto output = render(converter, input);
  assert(output[0][0] == 0.F && output[1][0] == 0.F);
  assert(std::abs(output[2][0]) > 1e-5F);
  assert(output[2] == output[3]);
  assert(output[3] != output[4]);
}

void test_low_level_gain_range_improves_resolution() {
  calcotone::AtmosLexicon224Converter converter(
      kRate, calcotone::Lexicon224ConverterRole::Output);
  std::array<float, 2> result{};
  for (int sample = 0; sample < 32; ++sample) result = converter.process(.0002F, -.0002F);
  assert(std::abs(result[0]) > 0.F);
  assert(std::abs(result[0]) < 1.F / 2047.F);
}

void test_gain_range_hysteresis_has_memory() {
  calcotone::AtmosLexicon224Converter converter(
      kRate, calcotone::Lexicon224ConverterRole::Output);
  for (int sample = 0; sample < 8; ++sample) converter.process(.02F, .02F);
  const auto immediate = converter.process(.20F, .20F);

  calcotone::AtmosLexicon224Converter fresh(
      kRate, calcotone::Lexicon224ConverterRole::Output);
  const auto no_history = fresh.process(.20F, .20F);
  assert(std::abs(immediate[0] - no_history[0]) > 1e-6F);
}

void test_input_and_output_roles_are_distinct() {
  calcotone::AtmosLexicon224Converter input_converter(
      kRate, calcotone::Lexicon224ConverterRole::Input);
  calcotone::AtmosLexicon224Converter output_converter(
      kRate, calcotone::Lexicon224ConverterRole::Output);
  double input_signature = 0.0;
  double output_signature = 0.0;
  for (std::size_t sample = 0; sample < 512U; ++sample) {
    const float signal = .35F * std::sin(static_cast<float>(sample) * .173F);
    const auto input_result = input_converter.process(signal, -signal * .7F);
    const auto output_result = output_converter.process(signal, -signal * .7F);
    input_signature += std::abs(static_cast<double>(input_result[0])) * static_cast<double>((sample % 19U) + 1U);
    output_signature += std::abs(static_cast<double>(output_result[0])) * static_cast<double>((sample % 19U) + 1U);
  }
  assert(std::abs(input_signature - output_signature) > 1e-3);
}

void test_reset_is_deterministic_and_nonfinite_input_is_safe() {
  calcotone::AtmosLexicon224Converter converter(
      kRate, calcotone::Lexicon224ConverterRole::Input);
  std::vector<std::array<float, 2>> signal;
  for (std::size_t sample = 0; sample < 1024U; ++sample) {
    signal.push_back({.3F * std::sin(static_cast<float>(sample) * .11F),
                      .2F * std::cos(static_cast<float>(sample) * .07F)});
  }
  const auto first = render(converter, signal);
  converter.reset();
  const auto second = render(converter, signal);
  assert(first == second);

  const auto safe = converter.process(std::numeric_limits<float>::quiet_NaN(),
                                      std::numeric_limits<float>::infinity());
  assert(std::isfinite(safe[0]) && std::isfinite(safe[1]));
}
}  // namespace

int main() {
  test_input_role_uses_20khz_sample_hold();
  test_low_level_gain_range_improves_resolution();
  test_gain_range_hysteresis_has_memory();
  test_input_and_output_roles_are_distinct();
  test_reset_is_deterministic_and_nonfinite_input_is_safe();
}
