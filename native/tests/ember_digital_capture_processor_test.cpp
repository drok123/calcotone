#include "calcotone/ember_digital_capture_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <vector>

int main() {
  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 8192;
  constexpr float tau = 6.2831853071795864769F;
  std::array<double, 6> signatures{};

  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    calcotone::EmberDigitalCaptureProcessor processor(rate);
    assert(processor.set_parameter("mode", static_cast<float>(mode)));
    assert(processor.set_parameter("drive", .61F));
    assert(processor.set_parameter("clock", .43F));
    assert(processor.set_parameter("character", .52F));
    assert(processor.set_parameter("filter", .67F));
    assert(processor.set_parameter("mix", 1.F));

    std::vector<float> audio(frames * 2, 0.F);
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float time = static_cast<float>(frame) / rate;
      const float left = .31F * std::sin(tau * 173.F * time)
          + .13F * std::sin(tau * 3187.F * time);
      const float right = .27F * std::sin(tau * 211.F * time)
          + .11F * std::sin(tau * 2761.F * time);
      audio[frame * 2] = left;
      audio[frame * 2 + 1] = right;
    }

    processor.process(audio.data(), frames);
    assert(std::all_of(audio.begin(), audio.end(), [](float value) {
      return std::isfinite(value) && std::abs(value) <= 1.21F;
    }));

    double signature = 0.0;
    for (std::size_t index = 0; index < audio.size(); ++index)
      signature += std::abs(static_cast<double>(audio[index]))
          * static_cast<double>((index % 43) + 1);
    signatures[mode] = signature;
  }

  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);

  calcotone::EmberDigitalCaptureProcessor processor(rate);
  assert(processor.set_parameter("mode", 5.F));
  std::vector<float> callback(128 * 2, .2F);
  processor.process(callback.data(), 128);
  assert(std::any_of(callback.begin(), callback.end(), [](float value) {
    return std::abs(value - .2F) > 1e-5F;
  }));
  assert(!processor.set_parameter("unknown", .5F));
  return 0;
}
