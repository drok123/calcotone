#include "calcotone/halo_parity_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

int main() {
  constexpr std::size_t frames = 32768;
  std::array<double, 12> signatures{};
  for (std::size_t mode = 0; mode < signatures.size(); ++mode) {
    calcotone::HaloParityProcessor processor(48'000.F);
    processor.set_parameter("algorithm", static_cast<float>(mode));
    processor.set_parameter("time", .11F);
    processor.set_parameter("feedback", .47F);
    processor.set_parameter("color", .58F);
    processor.set_parameter("character", .63F);
    processor.set_parameter("width", .71F);
    processor.set_parameter("mix", 1.F);
    std::array<float, frames * 2> audio{};
    audio[0] = 1.F;
    audio[1] = .73F;
    for (std::size_t offset = 0; offset < frames; offset += 128)
      processor.process(audio.data() + offset * 2, std::min<std::size_t>(128, frames - offset));
    double signature = 0.0;
    for (std::size_t i = 0; i < audio.size(); ++i) {
      assert(std::isfinite(audio[i]));
      signature += std::abs(static_cast<double>(audio[i])) * static_cast<double>((i % 257) + 1);
    }
    assert(signature > 1e-6);
    signatures[mode] = signature;
  }
  for (std::size_t a = 0; a < signatures.size(); ++a)
    for (std::size_t b = a + 1; b < signatures.size(); ++b)
      assert(std::abs(signatures[a] - signatures[b]) > 1e-5);
}
