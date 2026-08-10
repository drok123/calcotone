#include "calcotone/drift_parity_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

int main() {
  constexpr std::size_t frames = 8192;
  std::array<double, 22> signatures{};
  for (std::size_t mode = 0; mode < signatures.size(); ++mode) {
    calcotone::DriftParityProcessor processor(48'000.F);
    processor.set_parameter("mode", static_cast<float>(mode));
    processor.set_parameter("rate", .83F);
    processor.set_parameter("depth", .0051F);
    processor.set_parameter("shape", .61F);
    processor.set_parameter("spread", .79F);
    processor.set_parameter("motion", .66F);
    processor.set_parameter("mix", .72F);
    std::array<float, frames * 2> audio{};
    audio[0] = 1.F; audio[1] = .73F;
    processor.process(audio.data(), frames);
    double signature = 0.0;
    for (std::size_t i = 0; i < audio.size(); ++i) {
      assert(std::isfinite(audio[i]));
      signature += std::abs(static_cast<double>(audio[i])) * static_cast<double>((i % 113) + 1);
    }
    assert(signature > .0001);
    signatures[mode] = signature;
  }
  // Live mode changes are dry-crossed before a classic/standard topology reset.
  // This locks out the single-sample state reset that previously produced clicks.
  {
    calcotone::DriftParityProcessor processor(48'000.F);
    processor.set_parameter("mode", 1.F);
    processor.set_parameter("rate", .83F);
    processor.set_parameter("depth", .0051F);
    processor.set_parameter("shape", .61F);
    processor.set_parameter("spread", .79F);
    processor.set_parameter("motion", .66F);
    processor.set_parameter("mix", 1.F);
    std::array<float, 4096U * 2U> warmup{};
    for (std::size_t frame = 0; frame < 4096U; ++frame) {
      const float sample = .22F * std::sin(static_cast<float>(frame) * 6.283185307F * 173.F / 48'000.F);
      warmup[frame * 2U] = sample;
      warmup[frame * 2U + 1U] = sample;
    }
    processor.process(warmup.data(), 4096U);
    processor.set_parameter("mode", 21.F);
    std::array<float, 512U * 2U> changing{};
    for (std::size_t frame = 0; frame < 512U; ++frame) {
      const float sample = .22F * std::sin(static_cast<float>(frame + 4096U) * 6.283185307F * 173.F / 48'000.F);
      changing[frame * 2U] = sample;
      changing[frame * 2U + 1U] = sample;
    }
    const auto dry = changing;
    processor.process(changing.data(), 512U);
    constexpr std::size_t crossing = 143U;
    assert(std::abs(changing[crossing * 2U] - dry[crossing * 2U]) < 1e-5F);
    assert(std::abs(changing[crossing * 2U + 1U] - dry[crossing * 2U + 1U]) < 1e-5F);
  }

  std::size_t distinct = 0;
  for (std::size_t i = 0; i < signatures.size(); ++i) {
    bool unique = true;
    for (std::size_t j = 0; j < i; ++j)
      if (std::abs(signatures[i] - signatures[j]) < 1e-5) unique = false;
    if (unique) ++distinct;
  }
  assert(distinct >= 18);
}
