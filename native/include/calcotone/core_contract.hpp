#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone::contract {

inline constexpr std::string_view kContractVersion = "2026-08-05.1";

struct ModuleContract {
  std::string_view id;
  std::string_view name;
  char rail;
  std::size_t model_count;
  std::size_t default_model_index;
  std::size_t control_count;
};

inline constexpr std::array<ModuleContract, 6> kCoreModules{{
  {"saturation", "Ember", 'A', 18, 0, 6},
  {"chorus", "Drift", 'A', 22, 0, 6},
  {"delay", "Halo", 'A', 12, 1, 6},
  {"reverb", "Atmos", 'B', 12, 2, 6},
  {"bitcrusher", "Grain", 'B', 12, 2, 6},
  {"media", "Artifact", 'B', 14, 0, 5},
}};

inline constexpr std::array<std::string_view, 3> kRailA{{
  "saturation", "chorus", "delay",
}};
inline constexpr std::array<std::string_view, 3> kRailB{{
  "reverb", "bitcrusher", "media",
}};
inline constexpr std::array<std::string_view, 3> kRailC{{
  "stomp", "chaos", "pressure",
}};

constexpr const ModuleContract* find_module(std::string_view id) noexcept {
  for (const auto& module : kCoreModules) {
    if (module.id == id) return &module;
  }
  return nullptr;
}

static_assert(kCoreModules[0].model_count == 18);
static_assert(kCoreModules[1].model_count == 22);
static_assert(kCoreModules[2].default_model_index == 1);
static_assert(kCoreModules[3].default_model_index == 2);
static_assert(kCoreModules[4].default_model_index == 2);
static_assert(kCoreModules[5].control_count == 5);
static_assert(kRailC[0] == "stomp" && kRailC[1] == "chaos" && kRailC[2] == "pressure");

}  // namespace calcotone::contract
