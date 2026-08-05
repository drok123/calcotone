#include "calcotone/core_contract.hpp"

#include <cmath>
#include <cstdlib>
#include <iostream>

namespace {
bool near(float left, float right, float tolerance = 1.0e-6F) {
  return std::abs(left - right) <= tolerance;
}
}  // namespace

int main() {
  using namespace calcotone::contract;

  if (kContractVersion != "manifest-v2") return EXIT_FAILURE;
  if (kCoreModules.size() != 9) return EXIT_FAILURE;
  if (kRailA.size() != 3 || kRailB.size() != 3 || kRailC.size() != 3) return EXIT_FAILURE;

  const auto* ember = find_module("saturation");
  const auto* drift = find_module("chorus");
  const auto* halo = find_module("delay");
  const auto* atmos = find_module("reverb");
  const auto* grain = find_module("bitcrusher");
  const auto* artifact = find_module("media");
  const auto* stomp = find_module("stomp");
  const auto* stack = find_module("chaos");
  const auto* pressure = find_module("pressure");

  if (!ember || ember->name != "Ember" || ember->model_count != 18 || ember->control_count != 6) return EXIT_FAILURE;
  if (!drift || drift->name != "Drift" || drift->model_count != 22 || drift->control_count != 6) return EXIT_FAILURE;
  if (!halo || halo->name != "Halo" || halo->model_count != 12 || halo->default_model_index != 1) return EXIT_FAILURE;
  if (!atmos || atmos->name != "Atmos" || atmos->model_count != 12 || atmos->default_model_index != 2) return EXIT_FAILURE;
  if (!grain || grain->name != "Grain" || grain->model_count != 12 || grain->default_model_index != 2) return EXIT_FAILURE;
  if (!artifact || artifact->name != "Artifact" || artifact->model_count != 14 || artifact->control_count != 5) return EXIT_FAILURE;
  if (!stomp || stomp->name != "Stomp" || stomp->rail != 'C' || stomp->model_count != 14 || stomp->default_model_index != 0) return EXIT_FAILURE;
  if (!stack || stack->name != "Stack" || stack->rail != 'C' || stack->model_count != 6 || stack->default_model_index != 5) return EXIT_FAILURE;
  if (!pressure || pressure->name != "Pressure" || pressure->rail != 'C' || pressure->model_count != 4 || pressure->default_model_index != 0) return EXIT_FAILURE;

  if (kSaturationModels.front() != "velvet" || kSaturationModels.back() != "fairlightiix") return EXIT_FAILURE;
  if (kChorusModels[8] != "ce1" || kChorusModels.back() != "pn2") return EXIT_FAILURE;
  if (kDelayModels[1] != "tape" || kDelayModels.back() != "AMS DMX 15-80 S") return EXIT_FAILURE;
  if (kReverbModels[2] != "hall" || kReverbModels.back() != "lexicon224") return EXIT_FAILURE;
  if (kBitcrusherModels[2] != "smear" || kBitcrusherModels.back() != "microcosm") return EXIT_FAILURE;
  if (kMediaModels.front() != "cassette" || kMediaModels.back() != "Neve BCM10") return EXIT_FAILURE;
  if (kStompModels.front() != "808 Overdrive" || kStompModels.back() != "Dyna Comp") return EXIT_FAILURE;
  if (kChaosModels.front() != "blackface" || kChaosModels.back() != "calcotone") return EXIT_FAILURE;
  if (kPressureModels.front() != "fet" || kPressureModels.back() != "vca") return EXIT_FAILURE;

  if (kSaturationControls[0].id != "drive" || !near(kSaturationControls[0].default_ui, .14F)) return EXIT_FAILURE;
  if (kMediaControls.size() != 5 || kMediaControls.back().id != "mix" || !near(kMediaControls.back().default_ui, .26F)) return EXIT_FAILURE;
  if (kStompControls.size() != 6 || kStompControls[0].id != "drive" || !near(kStompControls[0].default_ui, .38F)) return EXIT_FAILURE;
  if (kChaosControls.size() != 5 || kChaosControls[0].id != "cabinet" || !near(kChaosControls[0].default_ui, 2.F)) return EXIT_FAILURE;
  if (kPressureControls.size() != 5 || kPressureControls[0].id != "style" || !near(kPressureControls[0].default_ui, 2.F)) return EXIT_FAILURE;

  if (kRailC[0] != "stomp" || kRailC[1] != "chaos" || kRailC[2] != "pressure") return EXIT_FAILURE;
  if (find_module("synth") != nullptr) return EXIT_FAILURE;

  std::cout << "CALCOTONE generated native full-rack contract " << kContractVersion << " passed\n";
  return EXIT_SUCCESS;
}
