#include "calcotone/native_rack.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kFrames = 48'000;
std::vector<float> signal() {
  std::vector<float> data(kFrames * 2);
  for (std::size_t i = 0; i < kFrames; ++i) {
    const float sample = .24F * std::sin(static_cast<float>(i) * 6.283185307F * 173.F / kRate);
    data[i * 2] = sample; data[i * 2 + 1] = sample * .83F;
  }
  return data;
}
void require_safe(const std::vector<float>& data) {
  for (float sample : data) { assert(std::isfinite(sample)); assert(std::abs(sample) <= 1.201F); }
}
}  // namespace

int main() {
  const auto input = signal(); std::vector<float> output(input.size());
  calcotone::NativeRack bypassed(kRate);
  bypassed.process(input.data(), output.data(), kFrames);
  assert(input == output);

  constexpr std::array modules{calcotone::RackModule::Ember, calcotone::RackModule::Drift,
      calcotone::RackModule::Halo, calcotone::RackModule::Atmos};
  for (const auto module : modules) {
    calcotone::NativeRack rack(kRate); rack.set_bypassed(module, false);
    if (module == calcotone::RackModule::Ember) { assert(rack.set_parameter(module, "drive", 1.F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Drift) { assert(rack.set_parameter(module, "depth", .008F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Halo) { assert(rack.set_parameter(module, "time", .03F)); assert(rack.set_parameter(module, "feedback", .86F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else { assert(rack.set_parameter(module, "decay", 16.F)); assert(rack.set_parameter(module, "mix", .8F)); }
    rack.process(input.data(), output.data(), kFrames); require_safe(output); assert(output != input);
  }

  calcotone::NativeRack silence_rack(kRate);
  for (auto module : modules) silence_rack.set_bypassed(module, false);
  std::vector<float> silence(input.size(), 0.F);
  for (int pass = 0; pass < 4; ++pass) silence_rack.process(silence.data(), silence.data(), kFrames);
  require_safe(silence);
  assert(std::all_of(silence.begin(), silence.end(), [](float x) { return x == 0.F; }));
  assert(calcotone::rack_module_from_name("saturation") == calcotone::RackModule::Ember);
  assert(calcotone::rack_module_from_name("garbage") == calcotone::RackModule::Count);
  std::cout << "native rack tests passed\n";
}
