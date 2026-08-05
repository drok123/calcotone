#include "calcotone/native_rack.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;

std::vector<float> source(std::size_t frames) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0; frame < frames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float burst = frame % 6144U < 1200U ? 1.F : .18F;
    audio[frame * 2U] = burst * .31F * std::sin(t * 2.F * 3.14159265358979323846F * 181.F);
    audio[frame * 2U + 1U] = burst * .27F * std::sin(t * 2.F * 3.14159265358979323846F * 187.F + .4F);
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.201F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 239U) + 1U);
  }
  return result;
}
}  // namespace

int main() {
  constexpr std::size_t frames = 72'000U;
  std::array<double, 16> signatures{};
  std::size_t signature_index = 0U;
  for (unsigned mode = 0U; mode < 4U; ++mode) {
    for (unsigned style = 0U; style < 4U; ++style) {
      calcotone::NativePressure pressure(kRate);
      pressure.set_bypassed(false);
      assert(pressure.set_parameter("mode", static_cast<float>(mode)));
      assert(pressure.set_parameter("style", static_cast<float>(style)));
      assert(pressure.set_parameter("drive", .42F));
      assert(pressure.set_parameter("time", .46F));
      assert(pressure.set_parameter("character", .38F));
      assert(pressure.set_parameter("mix", .72F));
      auto audio = source(frames);
      for (std::size_t offset = 0U; offset < frames; offset += 128U)
        pressure.process(audio.data() + offset * 2U, std::min<std::size_t>(128U, frames - offset));
      signatures[signature_index++] = signature(audio);
    }
  }
  for (std::size_t first = 0U; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
}
