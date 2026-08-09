#include "calcotone/atmos_parity_profiles.hpp"

#include <array>
#include <cassert>
#include <string_view>

int main() {
  constexpr std::array<std::string_view, 17> expected{
      "room", "plate", "hall", "cinema", "cloud", "freeze",
      "celestial", "aurora", "nebula", "abyss", "emt140", "lexicon224",
      "rmx16", "quantec", "springtank", "bloom", "veil"};
  static_assert(calcotone::kAtmosParityProfiles.size() == expected.size());
  static_assert(calcotone::kAtmosEarlyProfiles.size() == expected.size());
  for (std::size_t i = 0; i < expected.size(); ++i) {
    const auto& profile = calcotone::atmos_parity_profile(i);
    const auto& early = calcotone::atmos_early_profile(i);
    assert(profile.id == expected[i]);
    assert(profile.line_count >= 6 && profile.line_count <= profile.line_times.size());
    assert(profile.predelay[0] >= 0.F && profile.predelay[1] >= profile.predelay[0]);
    assert(profile.size_range[0] > 0.F && profile.size_range[1] >= profile.size_range[0]);
    assert(profile.output_trim > 0.F && profile.input_trim > 0.F);
    assert(early.count >= 3 && early.count <= early.times.size());
    assert(early.early_level > 0.F && early.late_level > 0.F);
    for (std::size_t line = 0; line < profile.line_count; ++line)
      assert(profile.modulation_rates[line] > 0.F);
  }
  const auto& emt = calcotone::atmos_parity_profile(10);
  assert(emt.plate_dispersion == 1.F);
  assert(emt.split_decay == .16F);
  const auto& lexicon = calcotone::atmos_parity_profile(11);
  assert(lexicon.converter_bits == 12);
  assert(lexicon.converter_lowpass == 8800.F);
  assert(lexicon.split_decay == .34F);
  const auto& rmx16 = calcotone::atmos_parity_profile(12);
  assert(rmx16.converter_bits == 16);
  assert(rmx16.converter_lowpass == 18000.F);
  const auto& spring = calcotone::atmos_parity_profile(14);
  assert(spring.plate_dispersion == 1.55F);
  assert(spring.converter_lowpass == 11200.F);
  const auto& veil = calcotone::atmos_parity_profile(16);
  assert(veil.converter_lowpass == 6200.F);
}
