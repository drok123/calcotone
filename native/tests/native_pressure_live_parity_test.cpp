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

void process_blocks(calcotone::NativePressure& pressure, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0U; offset < frames; offset += 128U)
    pressure.process(audio.data() + offset * 2U, std::min<std::size_t>(128U, frames - offset));
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

  // The standalone wrapper must boot with the same defaults exposed by the UI
  // and canonical full-rack manifest: FET, Glue, .42/.46/.38/.72.
  {
    calcotone::NativePressure defaults(kRate);
    calcotone::NativePressure explicit_defaults(kRate);
    explicit_defaults.set_bypassed(false);
    assert(explicit_defaults.set_parameter("mode", 0.F));
    assert(explicit_defaults.set_parameter("style", 2.F));
    assert(explicit_defaults.set_parameter("drive", .42F));
    assert(explicit_defaults.set_parameter("time", .46F));
    assert(explicit_defaults.set_parameter("character", .38F));
    assert(explicit_defaults.set_parameter("mix", .72F));
    auto default_audio = source(frames);
    auto explicit_audio = default_audio;
    process_blocks(defaults, default_audio);
    process_blocks(explicit_defaults, explicit_audio);
    assert(default_audio == explicit_audio);
  }

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
      process_blocks(pressure, audio);
      signatures[signature_index++] = signature(audio);
    }
  }
  for (std::size_t first = 0U; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
}
