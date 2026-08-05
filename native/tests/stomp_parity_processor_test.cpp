#include "calcotone/stomp_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kBlock = 128U;

void process_blocks(calcotone::StompParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0; offset < frames; offset += kBlock)
    processor.process(audio.data() + offset * 2U, std::min(kBlock, frames - offset));
}

void configure(calcotone::StompParityProcessor& processor, unsigned mode,
               float drive = .38F, float tone = .54F, float level = .68F,
               float character = .42F, float body = .52F, float mix = 1.F) {
  assert(processor.set_parameter("mode", static_cast<float>(mode)));
  assert(processor.set_parameter("drive", drive));
  assert(processor.set_parameter("tone", tone));
  assert(processor.set_parameter("level", level));
  assert(processor.set_parameter("character", character));
  assert(processor.set_parameter("body", body));
  assert(processor.set_parameter("mix", mix));
  processor.reset();
}

std::vector<float> source(std::size_t frames, float frequency = 173.F) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0; frame < frames; ++frame) {
    const float pulse = frame % 4096U < 96U ? 1.F : .46F;
    const float phase = 2.F * 3.14159265358979323846F * frequency * static_cast<float>(frame) / kRate;
    audio[frame * 2U] = pulse * (.29F * std::sin(phase) + .07F * std::sin(phase * 2.37F));
    audio[frame * 2U + 1U] = pulse * (.24F * std::sin(phase * 1.03F + .5F) + .09F * std::cos(phase * 2.11F));
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.21F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 257U) + 1U);
  }
  return result;
}

std::vector<float> render(unsigned mode, float drive = .38F, float tone = .54F,
                          float level = .68F, float character = .42F,
                          float body = .52F, float mix = 1.F,
                          std::size_t frames = 48'000U, float frequency = 173.F) {
  calcotone::StompParityProcessor processor(kRate);
  configure(processor, mode, drive, tone, level, character, body, mix);
  auto audio = source(frames, frequency);
  process_blocks(processor, audio);
  signature(audio);
  return audio;
}

void test_all_fourteen_models_have_distinct_signatures() {
  std::array<double, calcotone::kStompModeCount> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode)
    signatures[mode] = signature(render(mode));
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);
}

void test_constructor_defaults_match_the_ui_contract() {
  calcotone::StompParityProcessor defaults(kRate);
  defaults.reset();
  auto default_audio = source(24'000U);
  process_blocks(defaults, default_audio);

  calcotone::StompParityProcessor explicit_defaults(kRate);
  configure(explicit_defaults, 0U, .38F, .54F, .68F, .42F, .52F, 1.F);
  auto explicit_audio = source(24'000U);
  process_blocks(explicit_defaults, explicit_audio);
  assert(default_audio == explicit_audio);
}

void test_linear_mix_contract() {
  const auto dry = render(2U, .72F, .48F, .62F, .66F, .58F, 0.F, 24'000U);
  const auto wet = render(2U, .72F, .48F, .62F, .66F, .58F, 1.F, 24'000U);
  const auto half = render(2U, .72F, .48F, .62F, .66F, .58F, .5F, 24'000U);
  for (std::size_t index = 0; index < half.size(); ++index)
    assert(std::abs(half[index] - (dry[index] + wet[index]) * .5F) < 2e-5F);
}

std::size_t positive_zero_crossings(const std::vector<float>& audio, std::size_t first_frame) {
  std::size_t crossings = 0U;
  float previous = audio[first_frame * 2U];
  for (std::size_t frame = first_frame + 1U; frame < audio.size() / 2U; ++frame) {
    const float current = audio[frame * 2U];
    if (previous <= 0.F && current > 0.F) ++crossings;
    previous = current;
  }
  return crossings;
}

void test_whammy_is_an_actual_octave_shifter() {
  const auto dry = render(12U, .15F, .48F, .72F, 0.F, .5F, 0.F, 48'000U, 220.F);
  const auto octave = render(12U, .15F, .48F, .72F, 1.F, .5F, 1.F, 48'000U, 220.F);
  const auto dry_crossings = positive_zero_crossings(dry, 4096U);
  const auto octave_crossings = positive_zero_crossings(octave, 4096U);
  assert(octave_crossings > dry_crossings * 3U / 2U);
}

void test_cry_baby_q_control_changes_resonance() {
  const auto low_q = render(11U, .58F, .52F, .72F, .64F, .05F, 1.F, 48'000U);
  const auto high_q = render(11U, .58F, .52F, .72F, .64F, .95F, 1.F, 48'000U);
  assert(std::abs(signature(low_q) - signature(high_q)) > 1e-3);
}

void test_dyna_attack_and_release_controls_are_live() {
  const auto fast = render(13U, .82F, .52F, .62F, .02F, .08F, 1.F, 72'000U);
  const auto slow = render(13U, .82F, .52F, .62F, .94F, .92F, 1.F, 72'000U);
  assert(std::abs(signature(fast) - signature(slow)) > 1e-3);
}

void test_silence_remains_silent_and_reset_is_deterministic() {
  for (unsigned mode = 0; mode < calcotone::kStompModeCount; ++mode) {
    calcotone::StompParityProcessor processor(kRate);
    configure(processor, mode, .8F, .7F, .7F, .9F, .8F, 1.F);
    std::vector<float> silence(8192U * 2U, 0.F);
    process_blocks(processor, silence);
    for (float sample : silence) assert(sample == 0.F);
  }

  calcotone::StompParityProcessor processor(kRate);
  configure(processor, 3U, .82F, .38F, .68F, .77F, .72F, .91F);
  auto first = source(48'000U);
  process_blocks(processor, first);
  processor.reset();
  auto second = source(48'000U);
  process_blocks(processor, second);
  assert(first == second);
}
}  // namespace

int main() {
  test_all_fourteen_models_have_distinct_signatures();
  test_constructor_defaults_match_the_ui_contract();
  test_linear_mix_contract();
  test_whammy_is_an_actual_octave_shifter();
  test_cry_baby_q_control_changes_resonance();
  test_dyna_attack_and_release_controls_are_live();
  test_silence_remains_silent_and_reset_is_deterministic();

  calcotone::StompParityProcessor processor(kRate);
  assert(!processor.set_parameter("not-a-parameter", .5F));
}
