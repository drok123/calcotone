#include "calcotone/core_contract.hpp"

#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string_view>

namespace {
bool near(float left, float right, float tolerance = 1.0e-6F) {
  return std::abs(left - right) <= tolerance;
}

template <std::size_t Size>
bool ordered_equals(
    const std::array<std::string_view, Size>& actual,
    const std::array<std::string_view, Size>& expected) {
  for (std::size_t index = 0; index < Size; ++index)
    if (actual[index] != expected[index]) return false;
  return true;
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

  constexpr std::array<std::string_view, 6> stomp_control_ids{
      "drive", "tone", "level", "character", "body", "mix"};
  constexpr std::array<float, 6> stomp_defaults{.38F,.54F,.68F,.42F,.52F,1.F};
  if (kStompControls.size() != stomp_control_ids.size()) return EXIT_FAILURE;
  for (std::size_t index = 0; index < stomp_control_ids.size(); ++index)
    if (kStompControls[index].id != stomp_control_ids[index]
        || !near(kStompControls[index].default_ui, stomp_defaults[index])) return EXIT_FAILURE;

  constexpr std::array<std::string_view, 5> stack_control_ids{
      "cabinet", "drive", "tone", "sag", "mix"};
  constexpr std::array<float, 5> stack_defaults{2.F,.36F,.52F,.34F,.62F};
  if (kChaosControls.size() != stack_control_ids.size()) return EXIT_FAILURE;
  for (std::size_t index = 0; index < stack_control_ids.size(); ++index)
    if (kChaosControls[index].id != stack_control_ids[index]
        || !near(kChaosControls[index].default_ui, stack_defaults[index])) return EXIT_FAILURE;

  constexpr std::array<std::string_view, 5> pressure_control_ids{
      "style", "drive", "time", "character", "mix"};
  constexpr std::array<float, 5> pressure_defaults{2.F,.42F,.46F,.38F,.72F};
  if (kPressureControls.size() != pressure_control_ids.size()) return EXIT_FAILURE;
  for (std::size_t index = 0; index < pressure_control_ids.size(); ++index)
    if (kPressureControls[index].id != pressure_control_ids[index]
        || !near(kPressureControls[index].default_ui, pressure_defaults[index])) return EXIT_FAILURE;

  constexpr std::array<std::string_view, 3> expected_rail_a{"saturation", "chorus", "delay"};
  constexpr std::array<std::string_view, 3> expected_rail_b{"reverb", "bitcrusher", "media"};
  constexpr std::array<std::string_view, 3> expected_rail_c{"stomp", "chaos", "pressure"};
  if (!ordered_equals(kRailA, expected_rail_a)
      || !ordered_equals(kRailB, expected_rail_b)
      || !ordered_equals(kRailC, expected_rail_c)) return EXIT_FAILURE;

  if (find_module("synth") != nullptr || find_module("unknown") != nullptr) return EXIT_FAILURE;

  std::cout << "CALCOTONE generated native full-rack contract " << kContractVersion << " passed\n";
  return EXIT_SUCCESS;
}
