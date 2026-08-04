#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone {

enum class ArtifactConsole : unsigned {
  Bypass,
  Tascam424,
  Neve1073,
  Ssl4000E,
  Api1608,
  NeveBcm10,
};

enum class ArtifactTube : unsigned {
  Bypass,
  GoldLion,
  Mullard,
  Telefunken,
  BugleBoy,
  RcaBlack,
};

enum class ArtifactChainOrder : unsigned {
  ConsoleIntoTube,
  TubeIntoConsole,
};

struct ArtifactConsoleProfile {
  std::string_view id;
  float input_gain;
  float drive;
  float asymmetry;
  float low_shelf_db;
  float high_shelf_db;
  float highpass_hz;
  float lowpass_hz;
  float transformer_memory;
  float output_gain;
};

struct ArtifactTubeProfile {
  std::string_view id;
  float input_gain;
  float drive;
  float bias;
  float even_harmonic;
  float odd_harmonic;
  float sag;
  float presence_hz;
  float presence_db;
  float output_gain;
};

// Console and tube stages are intentionally independent. Every console can be
// combined with every tube, including bypass on either stage. Indices are native
// serialization ABI and must only be appended.
inline constexpr std::array<ArtifactConsoleProfile, 6> kArtifactConsoleProfiles{{
  {"bypass",      1.00F,0.00F, 0.000F, 0.0F, 0.0F,  8.F,24000.F,0.00F,1.00F},
  {"tascam424",   1.08F,1.55F, 0.018F, 1.7F,-1.8F, 32.F,13200.F,0.16F,0.92F},
  {"neve1073",    1.12F,1.82F, 0.022F, 1.4F, 0.8F, 28.F,18800.F,0.34F,0.91F},
  {"ssl4000e",    1.05F,1.28F,-0.006F,-0.4F, 1.2F, 24.F,21000.F,0.12F,0.96F},
  {"api1608",     1.10F,1.62F, 0.012F, 0.8F, 1.0F, 30.F,19800.F,0.23F,0.93F},
  {"nevebcm10",   1.14F,2.04F, 0.028F, 1.8F, 0.5F, 26.F,17600.F,0.41F,0.89F},
}};

inline constexpr std::array<ArtifactTubeProfile, 6> kArtifactTubeProfiles{{
  {"bypass",      1.00F,0.00F, 0.000F,0.00F,0.00F,0.00F,3200.F,0.0F,1.00F},
  {"goldlion",    1.04F,1.46F, 0.018F,0.24F,0.12F,0.12F,3600.F, 0.7F,0.98F},
  {"mullard",     1.08F,1.72F, 0.032F,0.34F,0.10F,0.22F,2100.F,-0.5F,0.95F},
  {"telefunken",  1.02F,1.32F, 0.010F,0.16F,0.18F,0.08F,4100.F, 0.3F,1.00F},
  {"bugleboy",    1.06F,1.58F, 0.026F,0.30F,0.14F,0.16F,2850.F, 1.0F,0.97F},
  {"rcablack",    1.10F,1.88F, 0.044F,0.40F,0.09F,0.28F,1450.F,-0.8F,0.93F},
}};

struct ArtifactLegacyAlias {
  std::string_view id;
  ArtifactConsole console;
  ArtifactTube tube;
};

// Existing presets remain valid. The former Neve/Gold Lion path becomes an alias
// for one matrix combination, not a hard-coded exclusive pairing.
inline constexpr std::array<ArtifactLegacyAlias, 6> kArtifactLegacyAliases{{
  {"tascam424", ArtifactConsole::Tascam424, ArtifactTube::Bypass},
  {"Neve 1073", ArtifactConsole::Neve1073, ArtifactTube::Bypass},
  {"SSL 4000E", ArtifactConsole::Ssl4000E, ArtifactTube::Bypass},
  {"API 1608", ArtifactConsole::Api1608, ArtifactTube::Bypass},
  {"Neve BCM10", ArtifactConsole::NeveBcm10, ArtifactTube::Bypass},
  {"Neve 1073 + Gold Lion", ArtifactConsole::Neve1073, ArtifactTube::GoldLion},
}};

inline constexpr const ArtifactConsoleProfile& artifact_console_profile(std::size_t index) noexcept {
  return kArtifactConsoleProfiles[index < kArtifactConsoleProfiles.size() ? index : 0];
}
inline constexpr const ArtifactTubeProfile& artifact_tube_profile(std::size_t index) noexcept {
  return kArtifactTubeProfiles[index < kArtifactTubeProfiles.size() ? index : 0];
}

}  // namespace calcotone
