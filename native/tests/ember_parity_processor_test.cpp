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

  calcotone::EmberParityProcessor processor(rate);
  assert(!processor.set_parameter("unknown", .5F));
  return 0;
}
