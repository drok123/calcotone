#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone {

struct HaloParityProfile {
  std::string_view id;
  std::array<float, 2> time_ratios{};
  float cross_feedback{};
  float same_feedback{};
  float highpass{};
  std::array<float, 2> lowpass_range{};
  float saturation{};
  float quantization{};
  float flutter_depth{};
  std::array<float, 2> flutter_rates{};
  unsigned diffusion_stages{};
  float diffusion_base{};
  float output_trim{};
  float input_trim{};
  float scatter{};
  float pitch_scatter{};
  float reverse_chance{};
  float orbit_depth{};
  bool re201{};
};

// Canonical dropdown order and calibration copied from src/audio/effects/Delay.ts.
// Indices are preset/serialization ABI and must remain append-only.
inline constexpr std::array<HaloParityProfile, 12> kHaloParityProfiles{{
  {"clean", {1.F,1.006F}, .08F,.92F,55.F,{6500.F,19000.F},.08F,0.F,.00012F,{.11F,.137F},0,880.F,.78F,.92F,0.F,0.F,0.F,0.F,false},
  {"tape", {1.F,1.013F}, .18F,.82F,75.F,{1800.F,12500.F},.68F,.02F,.0028F,{.17F,.223F},1,720.F,.71F,.86F,.03F,0.F,0.F,0.F,false},
  {"bbd", {1.F,.987F}, .22F,.78F,120.F,{900.F,7200.F},.50F,.32F,.0011F,{.29F,.347F},1,1180.F,.67F,.84F,.045F,0.F,0.F,0.F,false},
  {"pingpong", {1.F,1.5F}, .94F,.06F,80.F,{2600.F,15500.F},.22F,0.F,.00035F,{.13F,.19F},0,900.F,.69F,.84F,0.F,0.F,0.F,0.F,false},
  {"diffuse", {1.F,1.271F}, .42F,.58F,130.F,{1900.F,13500.F},.28F,.01F,.0014F,{.09F,.151F},4,510.F,.56F,.72F,.055F,0.F,0.F,0.F,false},
  {"scatter", {1.F,.754F}, .55F,.45F,170.F,{1500.F,11800.F},.38F,.16F,.0022F,{.07F,.113F},2,670.F,.52F,.68F,.22F,0.F,0.F,0.F,false},
  {"constellation", {1.F,1.333F}, .68F,.32F,145.F,{2100.F,16500.F},.24F,.035F,.0017F,{.071F,.109F},3,640.F,.48F,.62F,.12F,.82F,.28F,.72F,false},
  {"re201", {1.F,1.37F}, .31F,.69F,92.F,{1600.F,9800.F},.76F,.018F,.0031F,{.19F,.271F},1,760.F,.66F,.84F,.04F,0.F,0.F,.12F,true},
  {"EP-3 Echoplex", {1.F,1.003F}, .04F,.96F,72.F,{2100.F,11800.F},.92F,.015F,.0033F,{.23F,.31F},0,760.F,.71F,.91F,.024F,0.F,0.F,0.F,false},
  {"Binson Echorec", {1.F,1.47F}, .31F,.69F,88.F,{2450.F,14200.F},.44F,.025F,.00095F,{.13F,.171F},1,970.F,.67F,.87F,.038F,0.F,0.F,.18F,false},
  {"Deluxe Memory Man", {1.F,.992F}, .16F,.84F,118.F,{780.F,6200.F},.62F,.29F,.0022F,{.42F,.53F},1,1080.F,.66F,.86F,.02F,0.F,0.F,0.F,false},
  {"AMS DMX 15-80 S", {1.F,1.031F}, .34F,.66F,42.F,{5900.F,16500.F},.12F,.085F,.00022F,{.31F,.37F},0,1200.F,.72F,.90F,.012F,.42F,0.F,.10F,false},
}};

inline constexpr const HaloParityProfile& halo_parity_profile(std::size_t index) noexcept {
  return kHaloParityProfiles[index < kHaloParityProfiles.size() ? index : 0];
}

}  // namespace calcotone
