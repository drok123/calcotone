#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone {

enum class DriftParityBranch : unsigned {
  Standard,
  Ce1,
  DimensionD,
  Flanger,
  Classic,
};

struct DriftParityProfile {
  std::string_view id;
  DriftParityBranch branch{};
  std::size_t voice_count{4};
  float base_delay{};
  float delay_step{};
  float rate_scale{1.F};
  float depth_scale{1.F};
  float feedback{};
  float highpass{55.F};
  float lowpass{12000.F};
  float output_trim{1.F};
  unsigned classic_model{};
};

// Canonical dropdown identity and topology routing copied from Chorus.ts and
// DriftClassicStage.ts. Indices are preset/serialization ABI and append-only.
inline constexpr std::array<DriftParityProfile, 22> kDriftParityProfiles{{
  {"chorus",          DriftParityBranch::Standard,   2, .0118F,.0031F,1.00F,1.00F,.00F,55.F,12000.F,.82F},
  {"ensemble",        DriftParityBranch::Standard,   4, .0104F,.0033F,.82F,1.18F,.00F,48.F,10800.F,.64F},
  {"dimension",       DriftParityBranch::Standard,   4, .0089F,.0027F,.74F,.72F,.00F,62.F,13200.F,.68F},
  {"vibrato",         DriftParityBranch::Standard,   1, .0085F,.0000F,1.12F,1.32F,.00F,45.F,14500.F,1.00F},
  {"rotary",          DriftParityBranch::Standard,   2, .0048F,.0018F,.58F,.84F,.00F,70.F,9200.F,.76F},
  {"doppler",         DriftParityBranch::Standard,   2, .0066F,.0024F,.44F,1.55F,.00F,42.F,15000.F,.72F},
  {"liquid",          DriftParityBranch::Standard,   4, .0126F,.0037F,.66F,1.38F,.00F,58.F,9800.F,.61F},
  {"orbit",           DriftParityBranch::Standard,   4, .0142F,.0041F,.39F,1.12F,.00F,52.F,11600.F,.60F},
  {"ce1",             DriftParityBranch::Ce1,        2, .0120F,.0019F,.72F,1.06F,.08F,70.F,9800.F,.78F},
  {"dimensiond",      DriftParityBranch::DimensionD, 4, .0081F,.0022F,.68F,.62F,.00F,75.F,12600.F,.66F},
  {"mxrflanger",      DriftParityBranch::Flanger,    2, .00135F,.00024F,.92F,.60F,.58F,45.F,13500.F,.69F},
  {"electricmistress",DriftParityBranch::Flanger,    2, .00180F,.00024F,.63F,.46F,.34F,70.F,10800.F,.69F},
  {"adaflanger",      DriftParityBranch::Flanger,    2, .00075F,.00024F,1.12F,.85F,.72F,38.F,15800.F,.69F},
  {"bf2",             DriftParityBranch::Flanger,    2, .00155F,.00024F,.78F,.53F,.48F,82.F,11700.F,.69F},
  {"biphase",         DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,1},
  {"smallstone",      DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,2},
  {"univibe",         DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,3},
  {"leslie",          DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,4},
  {"phase90",         DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,5},
  {"instantphaser",   DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,6},
  {"schulte",         DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,7},
  {"pn2",             DriftParityBranch::Classic,    0, 0.F,0.F,1.F,1.F,0.F,0.F,0.F,1.F,8},
}};

inline constexpr const DriftParityProfile& drift_parity_profile(std::size_t index) noexcept {
  return kDriftParityProfiles[index < kDriftParityProfiles.size() ? index : 0];
}

}  // namespace calcotone
