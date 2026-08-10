#include "calcotone/ember_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <vector>

int main() {
  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 4096;
  std::array<double, 18> signatures{};

  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    calcotone::EmberParityProcessor processor(rate);
    assert(processor.set_parameter("mode", static_cast<float>(mode)));
    assert(processor.set_parameter("drive", .63F));
    assert(processor.set_parameter("tone", 9300.F));
    assert(processor.set_parameter("heat", .47F));
    assert(processor.set_parameter("character", .58F));
    assert(processor.set_parameter("dynamics", .41F));
    assert(processor.set_parameter("mix", 1.F));

    std::vector<float> audio(frames * 2, 0.F);
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float tone = .24F * std::sin(6.283185307F * 173.F * static_cast<float>(frame) / rate)
          + .11F * std::sin(6.283185307F * 997.F * static_cast<float>(frame) / rate);
      audio[frame * 2] = tone;
      audio[frame * 2 + 1] = tone * .83F;
    }
    processor.process(audio.data(), frames);
    assert(std::all_of(audio.begin(), audio.end(), [](float value) {
      return std::isfinite(value) && std::abs(value) <= 1.21F;
    }));

    double signature = 0.0;
    for (std::size_t i = 0; i < audio.size(); ++i)
      signature += std::abs(static_cast<double>(audio[i])) * static_cast<double>((i % 31) + 1);
    signatures[mode] = signature;
  }

  for (std::size_t i = 0; i < signatures.size(); ++i)
    for (std::size_t j = i + 1; j < signatures.size(); ++j)
      assert(std::abs(signatures[i] - signatures[j]) > 1e-3);

  {
    // Cross the radically different tube -> digital topology at an exact dry sample.
    calcotone::EmberParityProcessor transition(rate);
    assert(transition.set_parameter("mode", 7.F));
    assert(transition.set_parameter("drive", .72F));
    assert(transition.set_parameter("heat", .58F));
    assert(transition.set_parameter("character", .64F));
    assert(transition.set_parameter("mix", 1.F));
    std::vector<float> warmup(4096U * 2U);
    for (std::size_t frame = 0; frame < 4096U; ++frame) {
      const float sample = .22F * std::sin(6.283185307F * 173.F * static_cast<float>(frame) / rate);
      warmup[frame * 2U] = sample; warmup[frame * 2U + 1U] = sample;
    }
    transition.process(warmup.data(), 4096U);
    assert(transition.set_parameter("mode", 17.F));
    std::vector<float> changing(512U * 2U);
    for (std::size_t frame = 0; frame < 512U; ++frame) {
      const float sample = .22F * std::sin(6.283185307F * 173.F * static_cast<float>(frame + 4096U) / rate);
      changing[frame * 2U] = sample; changing[frame * 2U + 1U] = sample;
    }
    const auto dry = changing;
    transition.process(changing.data(), 512U);
    constexpr std::size_t crossing = 143U;
    assert(std::abs(changing[crossing * 2U] - dry[crossing * 2U]) < 1e-5F);
    assert(std::abs(changing[crossing * 2U + 1U] - dry[crossing * 2U + 1U]) < 1e-5F);
  }

  calcotone::EmberParityProcessor processor(rate);
  assert(!processor.set_parameter("unknown", .5F));
  return 0;
}
