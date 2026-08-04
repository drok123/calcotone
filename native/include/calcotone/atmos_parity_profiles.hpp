#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone {

struct AtmosParityProfile {
  std::string_view id;
  std::array<float, 12> line_times{};
  std::size_t line_count{};
  std::array<float, 2> predelay{};
  std::array<float, 2> size_range{};
  float decay_bias{};
  float damping_bias{};
  float diffusion_bias{};
  float modulation_depth{};
  float cross_amount{};
  float output_trim{};
  float input_trim{};
  float highpass{};
  int converter_bits{};
  float converter_lowpass{};
  float split_decay{};
  float plate_dispersion{};
};

// Exact model identity, ordering, and canonical calibration data copied from
// src/audio/effects/Reverb.ts. This table is the native migration source for
// Atmos; dropdowns must not collapse back to one generic topology.
inline constexpr std::array<AtmosParityProfile, 12> kAtmosParityProfiles{{
  {"room",       {0.0137F,0.0173F,0.0199F,0.0239F,0.0293F,0.0317F}, 6, {0.004F,0.006F}, {0.58F,1.42F}, 0.72F,1.08F,0.72F,0.00022F,0.035F,0.42F,0.82F,150.F},
  {"plate",      {0.0211F,0.0263F,0.0307F,0.0349F,0.0397F,0.0451F,0.0511F,0.0577F}, 8, {0.008F,0.011F}, {0.72F,1.72F}, 0.94F,1.28F,1.16F,0.00052F,0.062F,0.31F,0.74F,190.F},
  {"hall",       {0.0311F,0.0379F,0.0437F,0.0499F,0.0571F,0.0643F,0.0719F,0.0817F}, 8, {0.014F,0.019F}, {0.74F,2.12F}, 1.00F,0.94F,0.98F,0.00072F,0.075F,0.28F,0.70F,130.F},
  {"cinema",     {0.0413F,0.0491F,0.0577F,0.0671F,0.0787F,0.0911F,0.1049F,0.1193F,0.1349F,0.1511F}, 10, {0.024F,0.033F}, {0.82F,2.48F}, 1.22F,0.72F,1.05F,0.00105F,0.094F,0.23F,0.62F,105.F},
  {"cloud",      {0.0271F,0.0331F,0.0391F,0.0461F,0.0541F,0.0631F,0.0731F,0.0841F,0.0961F,0.1091F,0.1231F,0.1381F}, 12, {0.018F,0.027F}, {0.68F,2.28F}, 1.38F,0.84F,1.28F,0.00180F,0.110F,0.20F,0.56F,170.F},
  {"freeze",     {0.0431F,0.0523F,0.0629F,0.0749F,0.0883F,0.1031F,0.1193F,0.1373F}, 8, {0.012F,0.017F}, {0.90F,2.15F}, 4.50F,0.52F,1.35F,0.00090F,0.130F,0.22F,0.18F,210.F},
  {"celestial",  {0.0239F,0.0311F,0.0401F,0.0503F,0.0629F,0.0779F,0.0953F,0.1151F,0.1373F,0.1613F,0.1871F,0.2141F}, 12, {0.028F,0.041F}, {0.82F,2.62F}, 1.72F,1.42F,1.48F,0.00260F,0.140F,0.17F,0.48F,240.F},
  {"aurora",     {0.0197F,0.0277F,0.0367F,0.0479F,0.0613F,0.0773F,0.0961F,0.1177F,0.1423F,0.1699F}, 10, {0.016F,0.029F}, {0.70F,2.45F}, 1.46F,1.12F,1.34F,0.00380F,0.160F,0.18F,0.50F,185.F},
  {"nebula",     {0.0353F,0.0449F,0.0563F,0.0697F,0.0851F,0.1027F,0.1223F,0.1441F,0.1681F,0.1943F,0.2227F,0.2531F}, 12, {0.036F,0.050F}, {0.95F,2.85F}, 2.15F,0.76F,1.58F,0.00440F,0.180F,0.145F,0.42F,155.F},
  {"abyss",      {0.0481F,0.0593F,0.0727F,0.0883F,0.1061F,0.1261F,0.1483F,0.1727F,0.1993F,0.2281F}, 10, {0.019F,0.031F}, {1.00F,3.00F}, 1.90F,0.38F,1.18F,0.00150F,0.170F,0.15F,0.44F,58.F},
  {"emt140",     {0.0119F,0.0157F,0.0193F,0.0233F,0.0277F,0.0329F,0.0383F,0.0449F,0.0521F,0.0601F,0.0691F,0.0793F}, 12, {0.0035F,0.0052F}, {0.94F,1.08F}, 1.00F,1.34F,1.62F,0.00000F,0.105F,0.19F,0.31F,115.F,0,0.F,0.16F,1.0F},
  {"lexicon224", {0.0247F,0.0311F,0.0389F,0.0473F,0.0571F,0.0683F,0.0811F,0.0953F,0.1117F,0.1301F}, 10, {0.024F,0.031F}, {0.78F,2.20F}, 1.12F,0.72F,1.24F,0.00082F,0.120F,0.21F,0.58F,145.F,12,8800.F,0.34F,0.F},
}};

inline constexpr const AtmosParityProfile& atmos_parity_profile(std::size_t index) noexcept {
  return kAtmosParityProfiles[index < kAtmosParityProfiles.size() ? index : 0];
}

}  // namespace calcotone
