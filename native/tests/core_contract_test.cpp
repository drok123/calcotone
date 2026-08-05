#include "calcotone/core_contract.hpp"

#include <cstdlib>
#include <iostream>

int main() {
  using namespace calcotone::contract;

  if (kCoreModules.size() != 6) return EXIT_FAILURE;
  if (kRailA.size() != 3 || kRailB.size() != 3 || kRailC.size() != 3) return EXIT_FAILURE;

  const auto* ember = find_module("saturation");
  const auto* drift = find_module("chorus");
  const auto* halo = find_module("delay");
  const auto* atmos = find_module("reverb");
  const auto* grain = find_module("bitcrusher");
  const auto* artifact = find_module("media");

  if (!ember || ember->name != "Ember" || ember->model_count != 18 || ember->control_count != 6) return EXIT_FAILURE;
  if (!drift || drift->name != "Drift" || drift->model_count != 22 || drift->control_count != 6) return EXIT_FAILURE;
  if (!halo || halo->name != "Halo" || halo->model_count != 12 || halo->default_model_index != 1) return EXIT_FAILURE;
  if (!atmos || atmos->name != "Atmos" || atmos->model_count != 12 || atmos->default_model_index != 2) return EXIT_FAILURE;
  if (!grain || grain->name != "Grain" || grain->model_count != 12 || grain->default_model_index != 2) return EXIT_FAILURE;
  if (!artifact || artifact->name != "Artifact" || artifact->model_count != 14 || artifact->control_count != 5) return EXIT_FAILURE;

  if (kRailC[0] != "stomp" || kRailC[1] != "chaos" || kRailC[2] != "pressure") return EXIT_FAILURE;
  if (find_module("synth") != nullptr) return EXIT_FAILURE;

  std::cout << "CALCOTONE native core contract " << kContractVersion << " passed\n";
  return EXIT_SUCCESS;
}
