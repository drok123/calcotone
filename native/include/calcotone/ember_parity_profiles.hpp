#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone {

enum class EmberParityBranch : unsigned {
  Generic,
  Tube,
  MagneticCore,
  DigitalCapture,
};

struct EmberTubePostProfile {
  float tone_scale{};
  float tone_heat{};
  float presence_hz{};
  float presence_span{};
  float presence_base{};
  float presence_character{};
  float threshold_base{};
  float threshold_dynamics{};
  float ratio_base{};
  float ratio_dynamics{};
  float post_base{};
  float post_drive{};
};

struct EmberParityProfile {
  std::string_view id;
  EmberParityBranch branch{};
  std::string_view model;
  int digital_capture_mode{-1};
  EmberTubePostProfile tube_post{};
};

// Canonical identity and branch routing copied from Saturation.ts. Existing
// indices are preset/serialization ABI and must never be reordered.
inline constexpr std::array<EmberParityProfile, 18> kEmberParityProfiles{{
  {"velvet",       EmberParityBranch::Generic,       "velvet"},
  {"tube",         EmberParityBranch::Generic,       "tube"},
  {"console",      EmberParityBranch::Generic,       "console"},
  {"transformer",  EmberParityBranch::MagneticCore,  "transformer"},
  {"furnace",      EmberParityBranch::Generic,       "furnace"},
  {"exciter",      EmberParityBranch::Generic,       "exciter"},
  {"broken",       EmberParityBranch::Generic,       "broken"},
  {"goldlion",     EmberParityBranch::Tube,          "goldlion", -1, {1.06F,.035F,3600.F,1900.F,.25F,1.35F,-.8F,1.8F,1.01F,.24F,1.F,.015F}},
  {"mullard",      EmberParityBranch::Tube,          "mullard", -1, {.88F,.095F,2100.F,900.F,-.45F,.75F,-1.9F,4.8F,1.05F,.82F,.985F,.04F}},
  {"telefunken",   EmberParityBranch::Tube,          "telefunken", -1, {1.12F,.025F,4100.F,2200.F,.10F,.85F,-.55F,1.35F,1.005F,.18F,1.005F,.01F}},
  {"bugleboy",     EmberParityBranch::Tube,          "bugleboy", -1, {1.F,.055F,2850.F,1250.F,.55F,1.7F,-1.25F,2.9F,1.025F,.48F,.995F,.026F}},
  {"rcablack",     EmberParityBranch::Tube,          "rcablack", -1, {.78F,.13F,1450.F,650.F,.10F,.55F,-2.6F,5.8F,1.08F,1.05F,.97F,.052F}},
  {"sp1200",       EmberParityBranch::DigitalCapture,"sp1200", 0},
  {"mpc60",        EmberParityBranch::DigitalCapture,"mpc60", 1},
  {"mirage",       EmberParityBranch::DigitalCapture,"mirage", 2},
  {"s950",         EmberParityBranch::DigitalCapture,"s950", 3},
  {"emulator2",    EmberParityBranch::DigitalCapture,"emulator2", 4},
  {"fairlightiix", EmberParityBranch::DigitalCapture,"fairlightiix", 5},
}};

inline constexpr const EmberParityProfile& ember_parity_profile(std::size_t index) noexcept {
  return kEmberParityProfiles[index < kEmberParityProfiles.size() ? index : 0];
}

}  // namespace calcotone
