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
  std::size_t distinct = 0;
  for (std::size_t i = 0; i < signatures.size(); ++i) {
    bool unique = true;
    for (std::size_t j = 0; j < i; ++j)
      if (std::abs(signatures[i] - signatures[j]) < 1e-5) unique = false;
    if (unique) ++distinct;
  }
  assert(distinct >= 18);
}
