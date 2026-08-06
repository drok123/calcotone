#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone::contract {

inline constexpr std::string_view kContractVersion = "manifest-v2";

struct ModuleContract {
  std::string_view id;
  std::string_view name;
  char rail;
  std::size_t model_count;
  std::size_t default_model_index;
  std::size_t control_count;
};

struct ControlContract {
  std::string_view id;
  float default_ui;
};

inline constexpr std::array<std::string_view, 18> kSaturationModels{{
  "velvet",
  "tube",
  "console",
  "transformer",
  "furnace",
  "exciter",
  "broken",
  "goldlion",
  "mullard",
  "telefunken",
  "bugleboy",
  "rcablack",
  "sp1200",
  "mpc60",
  "mirage",
  "s950",
  "emulator2",
  "fairlightiix",
}};
inline constexpr std::array<std::string_view, 22> kChorusModels{{
  "chorus",
  "ensemble",
  "dimension",
  "vibrato",
  "rotary",
  "doppler",
  "liquid",
  "orbit",
  "ce1",
  "dimensiond",
  "mxrflanger",
  "electricmistress",
  "adaflanger",
  "bf2",
  "biphase",
  "smallstone",
  "univibe",
  "leslie",
  "phase90",
  "instantphaser",
  "schulte",
  "pn2",
}};
inline constexpr std::array<std::string_view, 12> kDelayModels{{
  "clean",
  "tape",
  "bbd",
  "pingpong",
  "diffuse",
  "scatter",
  "constellation",
  "re201",
  "EP-3 Echoplex",
  "Binson Echorec",
  "Deluxe Memory Man",
  "AMS DMX 15-80 S",
}};
inline constexpr std::array<std::string_view, 12> kReverbModels{{
  "room",
  "plate",
  "hall",
  "cinema",
  "cloud",
  "freeze",
  "celestial",
  "aurora",
  "nebula",
  "abyss",
  "emt140",
  "lexicon224",
}};
inline constexpr std::array<std::string_view, 12> kBitcrusherModels{{
  "mosaic",
  "scatter",
  "smear",
  "prism",
  "slice",
  "freeze",
  "clouds",
  "beads",
  "morphagene",
  "arbhar",
  "particle2",
  "microcosm",
}};
inline constexpr std::array<std::string_view, 14> kMediaModels{{
  "cassette",
  "reel",
  "vinyl",
  "vhs",
  "radio",
  "wax",
  "broken",
  "archive",
  "tascam424",
  "Neve 1073",
  "SSL 4000E",
  "API 1608",
  "Ampex ATR-102",
  "Neve BCM10",
}};
inline constexpr std::array<std::string_view, 14> kStompModels{{
  "808 Overdrive",
  "RAT Distortion",
  "Big Muff",
  "Fuzz Face",
  "DS-1 Distortion",
  "Blues Driver",
  "Gold Horse",
  "Swedish Chainsaw",
  "Metal Zone",
  "Octavia",
  "Rangemaster",
  "Cry Baby Wah",
  "Whammy Octave",
  "Dyna Comp",
}};
inline constexpr std::array<std::string_view, 6> kChaosModels{{
  "blackface",
  "ac30",
  "plexi",
  "svt",
  "model-t",
  "calcotone",
}};
inline constexpr std::array<std::string_view, 4> kPressureModels{{
  "fet",
  "opto",
  "varimu",
  "vca",
}};

inline constexpr std::array<ControlContract, 6> kSaturationControls{{
  {"drive", 0.14F},
  {"tone", 0.522F},
  {"heat", 0.18F},
  {"character", 0.22F},
  {"dynamics", 0.38F},
  {"mix", 0.22F},
}};
inline constexpr std::array<ControlContract, 6> kChorusControls{{
  {"rate", 0.094F},
  {"depth", 0.275F},
  {"shape", 0.35F},
  {"spread", 0.62F},
  {"motion", 0.32F},
  {"mix", 0.14F},
}};
inline constexpr std::array<ControlContract, 6> kDelayControls{{
  {"time", 0.1692F},
  {"feedback", 0.244F},
  {"color", 0.42F},
  {"character", 0.14F},
  {"width", 0.58F},
  {"mix", 0.14F},
}};
inline constexpr std::array<ControlContract, 6> kReverbControls{{
  {"decay", 0.504F},
  {"size", 0.52F},
  {"color", 0.42F},
  {"diffusion", 0.74F},
  {"motion", 0.18F},
  {"mix", 0.13F},
}};
inline constexpr std::array<ControlContract, 6> kBitcrusherControls{{
  {"bits", 0.75F},
  {"density", 0.42F},
  {"pitch", 0.38F},
  {"chaos", 0.16F},
  {"bloom", 0.36F},
  {"mix", 0.12F},
}};
inline constexpr std::array<ControlContract, 5> kMediaControls{{
  {"wear", 0.162F},
  {"wow", 0.16F},
  {"noise", 0.1F},
  {"tone", 0.62F},
  {"mix", 0.26F},
}};
inline constexpr std::array<ControlContract, 6> kStompControls{{
  {"drive", 0.38F},
  {"tone", 0.54F},
  {"level", 0.68F},
  {"character", 0.42F},
  {"body", 0.52F},
  {"mix", 1.0F},
}};
inline constexpr std::array<ControlContract, 5> kChaosControls{{
  {"cabinet", 2.0F},
  {"drive", 0.36F},
  {"tone", 0.52F},
  {"sag", 0.34F},
  {"mix", 0.62F},
}};
inline constexpr std::array<ControlContract, 5> kPressureControls{{
  {"style", 2.0F},
  {"drive", 0.42F},
  {"time", 0.46F},
  {"character", 0.38F},
  {"mix", 0.72F},
}};

inline constexpr std::array<ModuleContract, 9> kCoreModules{{
  {"saturation", "Ember", 'A', 18, 0, 6},
  {"chorus", "Drift", 'A', 22, 0, 6},
  {"delay", "Halo", 'A', 12, 1, 6},
  {"reverb", "Atmos", 'B', 12, 2, 6},
  {"bitcrusher", "Grain", 'B', 12, 2, 6},
  {"media", "Artifact", 'B', 14, 0, 5},
  {"stomp", "Stomp", 'C', 14, 0, 6},
  {"chaos", "Stack", 'C', 6, 5, 5},
  {"pressure", "Pressure", 'C', 4, 0, 5},
}};

inline constexpr std::array<std::string_view, 3> kRailA{{
  "saturation",
  "chorus",
  "delay",
}};
inline constexpr std::array<std::string_view, 3> kRailB{{
  "reverb",
  "bitcrusher",
  "media",
}};
inline constexpr std::array<std::string_view, 3> kRailC{{
  "stomp",
  "chaos",
  "pressure",
}};

constexpr const ModuleContract* find_module(std::string_view id) noexcept {
  for (const auto& module : kCoreModules) {
    if (module.id == id) return &module;
  }
  return nullptr;
}

static_assert(kRailC.size() == 3);
static_assert(kRailC[0] == "stomp" && kRailC[1] == "chaos" && kRailC[2] == "pressure");

}  // namespace calcotone::contract
