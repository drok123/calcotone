#include "calcotone/native_rack.hpp"

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
    calcotone::NativeRack rack(rate);
    rack.set_bypassed(calcotone::RackModule::Ember, false);
    assert(rack.set_parameter(calcotone::RackModule::Ember, "mode", static_cast<float>(mode)));
    assert(rack.set_parameter(calcotone::RackModule::Ember, "drive", .61F));
    assert(rack.set_parameter(calcotone::RackModule::Ember, "tone", 9200.F));
    assert(rack.set_parameter(calcotone::RackModule::Ember, "heat", .44F));
    assert(rack.set_parameter(calcotone::RackModule::Ember, "character", .57F));
    assert(rack.set_parameter(calcotone::RackModule::Ember, "dynamics", .39F));
    assert(rack.set_parameter(calcotone::RackModule::Ember, "mix", 1.F));

    std::vector<float> input(frames * 2), output(frames * 2);
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float signal = .22F * std::sin(6.283185307F * 181.F * static_cast<float>(frame) / rate)
          + .10F * std::sin(6.283185307F * 1163.F * static_cast<float>(frame) / rate);
      input[frame * 2] = signal;
      input[frame * 2 + 1] = signal * .79F;
    }
    rack.process_module(calcotone::RackModule::Ember, input.data(), frames);
    output = input;

    assert(std::all_of(output.begin(), output.end(), [](float value) {
      return std::isfinite(value) && std::abs(value) <= 1.21F;
    }));
    double signature = 0.0;
    for (std::size_t i = 0; i < output.size(); ++i)
      signature += std::abs(static_cast<double>(output[i])) * static_cast<double>((i % 37) + 1);
    signatures[mode] = signature;
  }

  for (std::size_t i = 0; i < signatures.size(); ++i)
    for (std::size_t j = i + 1; j < signatures.size(); ++j)
      assert(std::abs(signatures[i] - signatures[j]) > 1e-3);

  return 0;
}
