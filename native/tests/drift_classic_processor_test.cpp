#include "calcotone/drift_classic_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kFrames = 32'768;

std::array<double, 3> render(unsigned model) {
  calcotone::DriftClassicProcessor processor(kRate);
  processor.set_model(model);
  double signature = 0.0;
  double left_energy = 0.0;
  double right_energy = 0.0;
  for (std::size_t frame = 0; frame < kFrames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float left = .21F * std::sin(6.283185307F * 173.F * t)
        + .085F * std::sin(6.283185307F * 1091.F * t);
    const float right = .18F * std::sin(6.283185307F * 181.F * t + .21F)
        + .072F * std::sin(6.283185307F * 947.F * t);
    const auto output = processor.process_sample(left, right, .61F, .58F, .67F, .74F, .49F);
    assert(std::isfinite(output[0]) && std::isfinite(output[1]));
    assert(std::abs(output[0]) <= 1.201F && std::abs(output[1]) <= 1.201F);
    signature += std::abs(static_cast<double>(output[0])) * static_cast<double>((frame % 31U) + 1U);
    signature += std::abs(static_cast<double>(output[1])) * static_cast<double>((frame % 37U) + 1U);
    left_energy += static_cast<double>(output[0]) * output[0];
    right_energy += static_cast<double>(output[1]) * output[1];
  }
  return {signature, left_energy, right_energy};
}
}  // namespace

int main() {
  std::array<std::array<double, 3>, 8> results{};
  for (unsigned model = 1; model <= 8; ++model) results[model - 1] = render(model);

  // Every classic circuit must remain sonically distinguishable.
  for (std::size_t i = 0; i < results.size(); ++i) {
    for (std::size_t j = i + 1; j < results.size(); ++j)
      assert(std::abs(results[i][0] - results[j][0]) > 1e-2);
  }

  // Leslie and PN-2 must produce meaningful stereo motion rather than two
  // independent mono amplitude modulators.
  assert(std::abs(results[3][1] - results[3][2]) > 1e-3);
  assert(std::abs(results[7][1] - results[7][2]) > 1e-3);

  // Reset restores deterministic circuit state.
  calcotone::DriftClassicProcessor processor(kRate);
  processor.set_model(3);
  std::array<double, 2> signatures{};
  for (unsigned pass = 0; pass < 2; ++pass) {
    if (pass != 0) processor.reset();
    double signature = 0.0;
    for (std::size_t frame = 0; frame < 8192; ++frame) {
      const float input = .24F * std::sin(6.283185307F * 223.F * static_cast<float>(frame) / kRate);
      const auto output = processor.process_sample(input, input * .91F, .44F, .72F, .53F, .65F, .76F);
      signature += std::abs(static_cast<double>(output[0] + output[1])) * static_cast<double>((frame % 19U) + 1U);
    }
    signatures[pass] = signature;
  }
  assert(std::abs(signatures[0] - signatures[1]) < 1e-6);
  return 0;
}
