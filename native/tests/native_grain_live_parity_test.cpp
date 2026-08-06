#include "calcotone/native_rack.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;

std::vector<float> make_source(std::size_t frames) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0; frame < std::min<std::size_t>(72'000U, frames); ++frame) {
    const float pulse = frame % 3072U < 80U ? 1.F : .38F;
    audio[frame * 2U] = pulse * .31F * std::sin(static_cast<float>(frame) * .041F);
    audio[frame * 2U + 1U] = pulse * .27F * std::cos(static_cast<float>(frame) * .033F + .4F);
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.21F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 239U) + 1U);
  }
  return result;
}
}  // namespace

int main() {
  constexpr std::size_t frames = 120'000U;
  std::array<double, 12> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    calcotone::NativeRack rack(kRate);
    rack.set_bypassed(calcotone::RackModule::Grain, false);
    assert(rack.set_parameter(calcotone::RackModule::Grain, "mode", static_cast<float>(mode)));
    assert(rack.set_parameter(calcotone::RackModule::Grain, "bits", 13.F));
    assert(rack.set_parameter(calcotone::RackModule::Grain, "density", .58F));
    assert(rack.set_parameter(calcotone::RackModule::Grain, "pitch", .46F));
    assert(rack.set_parameter(calcotone::RackModule::Grain, "chaos", .34F));
    assert(rack.set_parameter(calcotone::RackModule::Grain, "bloom", .62F));
    assert(rack.set_parameter(calcotone::RackModule::Grain, "mix", 1.F));
    auto audio = make_source(frames);
    for (std::size_t offset = 0; offset < frames; offset += 128U)
      rack.process_module(calcotone::RackModule::Grain, audio.data() + offset * 2U,
                          std::min<std::size_t>(128U, frames - offset));
    signatures[mode] = signature(audio);
  }

  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);
}
