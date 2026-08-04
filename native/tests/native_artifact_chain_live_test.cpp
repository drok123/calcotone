#include "calcotone/native_rack.hpp"

#include <array>
#include <cmath>
#include <cstdlib>

int main() {
  calcotone::NativeRack rack(48'000.F);
  rack.set_bypassed(calcotone::RackModule::Artifact, false);
  rack.set_parameter(calcotone::RackModule::Artifact, "mode", 12.F);
  rack.set_parameter(calcotone::RackModule::Artifact, "wear", .42F);
  rack.set_parameter(calcotone::RackModule::Artifact, "mix", 1.F);

  std::array<float, 4096 * 2> input{};
  std::array<float, 4096 * 2> output{};
  input[0] = input[1] = .7F;

  double signatures[2]{};
  for (int order = 0; order < 2; ++order) {
    rack.set_parameter(calcotone::RackModule::Artifact, "console", 2.F); // Neve 1073
    rack.set_parameter(calcotone::RackModule::Artifact, "tube", 3.F);    // Telefunken
    rack.set_parameter(calcotone::RackModule::Artifact, "chainOrder", static_cast<float>(order));
    output = input;
    rack.process_module(calcotone::RackModule::Artifact, output.data(), 4096);
    for (std::size_t i = 0; i < output.size(); ++i) {
      if (!std::isfinite(output[i])) return EXIT_FAILURE;
      signatures[order] += std::abs(output[i]) * static_cast<double>((i % 127) + 1);
    }
  }

  if (std::abs(signatures[0] - signatures[1]) < 1e-5) return EXIT_FAILURE;
  if (!rack.set_parameter(calcotone::RackModule::Artifact, "console", 5.F)) return EXIT_FAILURE;
  if (!rack.set_parameter(calcotone::RackModule::Artifact, "tube", 5.F)) return EXIT_FAILURE;
  return EXIT_SUCCESS;
}
