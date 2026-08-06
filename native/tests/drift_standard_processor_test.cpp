#include "calcotone/drift_standard_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kFrames = 32'768;

std::array<double, 3> render(unsigned mode) {
  calcotone::DriftStandardProcessor processor(kRate);
  processor.set_mode(mode);
  double signature = 0.0;
  double left_energy = 0.0;
  double right_energy = 0.0;
  for (std::size_t frame = 0; frame < kFrames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float left = .23F * std::sin(6.283185307F * 167.F * t)
        + .07F * std::sin(6.283185307F * 1217.F * t);
    const float right = .19F * std::sin(6.283185307F * 191.F * t + .17F)
        + .06F * std::sin(6.283185307F * 983.F * t);
    const auto output = processor.process_sample(left, right, .73F, .0047F, .64F, .71F, .46F);
    assert(std::isfinite(output[0]) && std::isfinite(output[1]));
    assert(std::abs(output[0]) <= 1.201F && std::abs(output[1]) <= 1.201F);
    signature += std::abs(static_cast<double>(output[0])) * static_cast<double>((frame % 29U) + 1U);
    signature += std::abs(static_cast<double>(output[1])) * static_cast<double>((frame % 43U) + 1U);
    left_energy += static_cast<double>(output[0]) * output[0];
    right_energy += static_cast<double>(output[1]) * output[1];
  }
  return {signature, left_energy, right_energy};
}
}  // namespace

int main() {
  std::array<std::array<double, 3>, 14> results{};
  for (unsigned mode = 0; mode < results.size(); ++mode) results[mode] = render(mode);

  // Every standard, CE-1, Dimension D, and flanger identity must remain
  // observably distinct under the same source and controls.
  for (std::size_t i = 0; i < results.size(); ++i)
    for (std::size_t j = i + 1; j < results.size(); ++j)
      assert(std::abs(results[i][0] - results[j][0]) > 1e-2);

  // Stereo voice panning must produce a real two-channel image.
  for (const auto& result : results)
    assert(std::abs(result[1] - result[2]) > 1e-4);

  // Reset restores deterministic delay, filter, and LFO state.
  calcotone::DriftStandardProcessor processor(kRate);
  processor.set_mode(10);
  std::array<double, 2> signatures{};
  for (unsigned pass = 0; pass < 2; ++pass) {
    if (pass != 0) processor.reset();
    double signature = 0.0;
    for (std::size_t frame = 0; frame < 12'288; ++frame) {
      const float input = .22F * std::sin(6.283185307F * 211.F * static_cast<float>(frame) / kRate);
      const auto output = processor.process_sample(input, input * .87F, .82F, .0061F, .72F, .68F, .57F);
      signature += std::abs(static_cast<double>(output[0] - output[1])) * static_cast<double>((frame % 23U) + 1U);
    }
    signatures[pass] = signature;
  }
  assert(std::abs(signatures[0] - signatures[1]) < 1e-6);
  return 0;
}
