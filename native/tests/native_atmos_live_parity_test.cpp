#include "calcotone/native_rack.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <vector>

int main() {
  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 16'384;
  std::vector<float> impulse(frames * 2, 0.F);
  std::vector<float> output(frames * 2, 0.F);
  impulse[0] = 0.6F;
  impulse[1] = -0.4F;

  std::array<double, 12> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    calcotone::NativeRack rack(rate);
    rack.set_bypassed(calcotone::RackModule::Atmos, false);
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "algorithm", static_cast<float>(mode)));
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "decay", 2.4F));
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "size", 0.52F));
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "color", 0.42F));
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "diffusion", 0.74F));
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "motion", 0.18F));
    assert(rack.set_parameter(calcotone::RackModule::Atmos, "mix", 1.F));
    std::copy(impulse.begin(), impulse.end(), output.begin());
    rack.process_module(calcotone::RackModule::Atmos, output.data(), frames);

    assert(std::all_of(output.begin(), output.end(), [](float v) {
      return std::isfinite(v) && std::abs(v) <= 1.21F;
    }));
    double signature = 0.0;
    for (std::size_t i = 0; i < output.size(); ++i)
      signature += std::abs(static_cast<double>(output[i])) * static_cast<double>((i % 251) + 1);
    signatures[mode] = signature;
  }

  for (std::size_t a = 0; a < signatures.size(); ++a)
    for (std::size_t b = a + 1; b < signatures.size(); ++b)
      assert(std::abs(signatures[a] - signatures[b]) > 1e-3);
}
