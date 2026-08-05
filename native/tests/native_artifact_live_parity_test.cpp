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
    const float pulse = frame % 3072U < 72U ? 1.F : .44F;
    audio[frame * 2U] = pulse * (.29F * std::sin(static_cast<float>(frame) * .039F)
        + .08F * std::cos(static_cast<float>(frame) * .107F));
    audio[frame * 2U + 1U] = pulse * (.25F * std::cos(static_cast<float>(frame) * .033F + .7F)
        + .10F * std::sin(static_cast<float>(frame) * .079F));
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.21F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 241U) + 1U);
  }
  return result;
}
}  // namespace

int main() {
  constexpr std::size_t frames = 72'000U;
  std::array<double, 14> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    calcotone::NativeRack rack(kRate);
    rack.set_bypassed(calcotone::RackModule::Artifact, false);
    assert(rack.set_parameter(calcotone::RackModule::Artifact, "mode", static_cast<float>(mode)));
    assert(rack.set_parameter(calcotone::RackModule::Artifact, "wear", .46F));
    assert(rack.set_parameter(calcotone::RackModule::Artifact, "wow", .37F));
    assert(rack.set_parameter(calcotone::RackModule::Artifact, "noise", .28F));
    assert(rack.set_parameter(calcotone::RackModule::Artifact, "tone", .64F));
    assert(rack.set_parameter(calcotone::RackModule::Artifact, "mix", 1.F));
    auto audio = source(frames);
    for (std::size_t offset = 0; offset < frames; offset += 128U)
      rack.process_module(calcotone::RackModule::Artifact, audio.data() + offset * 2U,
                          std::min<std::size_t>(128U, frames - offset));
    signatures[mode] = signature(audio);
  }
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);
}
