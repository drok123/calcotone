#include "calcotone/artifact_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kBlock = 128U;

void process_blocks(calcotone::ArtifactParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0; offset < frames; offset += kBlock)
    processor.process(audio.data() + offset * 2U, std::min(kBlock, frames - offset));
}

void configure(calcotone::ArtifactParityProcessor& processor, unsigned mode,
               float wear = .46F, float wow = .37F, float noise = .28F,
               float tone = .64F, float mix = 1.F) {
  assert(processor.set_parameter("mode", static_cast<float>(mode)));
  assert(processor.set_parameter("wear", wear));
  assert(processor.set_parameter("wow", wow));
  assert(processor.set_parameter("noise", noise));
  assert(processor.set_parameter("tone", tone));
  assert(processor.set_parameter("mix", mix));
  processor.reset();
}

std::vector<float> source(std::size_t frames, bool impulse = false) {
  std::vector<float> audio(frames * 2U, 0.F);
  if (impulse) {
    audio[0] = .55F;
    audio[1] = -.31F;
    return audio;
  }
  for (std::size_t frame = 0; frame < frames; ++frame) {
    const float pulse = frame % 4096U < 64U ? 1.F : .47F;
    audio[frame * 2U] = pulse * (.27F * std::sin(static_cast<float>(frame) * .037F)
        + .09F * std::cos(static_cast<float>(frame) * .093F));
    audio[frame * 2U + 1U] = pulse * (.23F * std::cos(static_cast<float>(frame) * .031F + .6F)
        + .11F * std::sin(static_cast<float>(frame) * .081F));
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.21F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 251U) + 1U);
  }
  return result;
}

std::vector<float> render(unsigned mode, float wear = .46F, float wow = .37F,
                          float noise = .28F, float tone = .64F,
                          float mix = 1.F, std::size_t frames = 72'000U) {
  calcotone::ArtifactParityProcessor processor(kRate);
  configure(processor, mode, wear, wow, noise, tone, mix);
  auto audio = source(frames);
  process_blocks(processor, audio);
  signature(audio);
  return audio;
}

void test_all_fourteen_models_have_distinct_signatures() {
  std::array<double, 14> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode)
    signatures[mode] = signature(render(mode));
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);
}

std::size_t first_nonzero(const std::vector<float>& audio) {
  for (std::size_t frame = 0; frame < audio.size() / 2U; ++frame) {
    if (std::abs(audio[frame * 2U]) > 1e-8F || std::abs(audio[frame * 2U + 1U]) > 1e-8F)
      return frame;
  }
  return audio.size() / 2U;
}

void test_console_paths_disable_transport_while_media_paths_keep_it() {
  calcotone::ArtifactParityProcessor cassette(kRate);
  configure(cassette, 0U, .2F, .16F, 0.F, .62F, 1.F);
  auto cassette_impulse = source(4096U, true);
  process_blocks(cassette, cassette_impulse);

  calcotone::ArtifactParityProcessor neve(kRate);
  configure(neve, 9U, .2F, .16F, .10F, .62F, 1.F);
  auto neve_impulse = source(4096U, true);
  process_blocks(neve, neve_impulse);

  assert(first_nonzero(cassette_impulse) > 120U);
  assert(first_nonzero(neve_impulse) < 16U);
}

void test_insert_mix_is_linear_not_equal_power() {
  const auto dry = render(9U, .38F, .16F, .10F, .68F, 0.F, 24'000U);
  const auto wet = render(9U, .38F, .16F, .10F, .68F, 1.F, 24'000U);
  const auto half = render(9U, .38F, .16F, .10F, .68F, .5F, 24'000U);
  for (std::size_t index = 0; index < half.size(); ++index) {
    const float expected = (dry[index] + wet[index]) * .5F;
    assert(std::abs(half[index] - expected) < 2e-5F);
  }
}

void test_media_mix_uses_equal_power_routing() {
  const auto dry = render(0U, .38F, .16F, 0.F, .68F, 0.F, 24'000U);
  const auto wet = render(0U, .38F, .16F, 0.F, .68F, 1.F, 24'000U);
  const auto half = render(0U, .38F, .16F, 0.F, .68F, .5F, 24'000U);
  constexpr float equal_power = .7071067811865475F;
  for (std::size_t index = 0; index < half.size(); ++index) {
    const float expected = (dry[index] + wet[index]) * equal_power;
    assert(std::abs(half[index] - expected) < 2e-5F);
  }
}

void test_atr_speed_selects_distinct_transport_operating_points() {
  const auto slow = render(12U, .72F, .04F, .22F, .57F, 1.F, 96'000U);
  const auto fast = render(12U, .72F, .86F, .22F, .57F, 1.F, 96'000U);
  assert(std::abs(signature(slow) - signature(fast)) > 1e-3);
}

void test_noise_controls_actual_media_noise_without_polluting_console_paths() {
  calcotone::ArtifactParityProcessor vinyl_noise(kRate);
  configure(vinyl_noise, 2U, .2F, .16F, 1.F, .62F, 1.F);
  std::vector<float> noisy_silence(48'000U * 2U, 0.F);
  process_blocks(vinyl_noise, noisy_silence);
  assert(signature(noisy_silence) > 1e-3);

  for (const unsigned mode : {0U, 2U, 8U, 9U, 10U, 11U, 13U}) {
    calcotone::ArtifactParityProcessor processor(kRate);
    configure(processor, mode, .2F, .16F, 0.F, .62F, 1.F);
    std::vector<float> silence(16'384U * 2U, 0.F);
    process_blocks(processor, silence);
    for (float sample : silence) assert(sample == 0.F);
  }
}

void test_bcm10_capture_and_1073_summing_remain_distinct() {
  const auto neve = render(9U, .67F, .42F, .35F, .78F, 1.F, 48'000U);
  const auto bcm = render(13U, .67F, .42F, .35F, .78F, 1.F, 48'000U);
  assert(std::abs(signature(neve) - signature(bcm)) > 1e-3);
}

void test_reset_is_deterministic() {
  calcotone::ArtifactParityProcessor processor(kRate);
  configure(processor, 6U, .82F, .74F, .53F, .31F, .84F);
  auto render_once = [&processor]() {
    auto audio = source(72'000U);
    process_blocks(processor, audio);
    return audio;
  };
  const auto first = render_once();
  processor.reset();
  const auto second = render_once();
  assert(first.size() == second.size());
  for (std::size_t index = 0; index < first.size(); ++index)
    assert(std::abs(first[index] - second[index]) < 1e-6F);
}
}  // namespace

int main() {
  test_all_fourteen_models_have_distinct_signatures();
  test_console_paths_disable_transport_while_media_paths_keep_it();
  test_insert_mix_is_linear_not_equal_power();
  test_media_mix_uses_equal_power_routing();
  test_atr_speed_selects_distinct_transport_operating_points();
  test_noise_controls_actual_media_noise_without_polluting_console_paths();
  test_bcm10_capture_and_1073_summing_remain_distinct();
  test_reset_is_deterministic();

  calcotone::ArtifactParityProcessor processor(kRate);
  assert(!processor.set_parameter("console", 1.F));
  assert(!processor.set_parameter("tube", 1.F));
  assert(!processor.set_parameter("chainOrder", 1.F));
  assert(!processor.set_parameter("not-a-parameter", .5F));
}
