#include "calcotone/atmos_parity_profiles.hpp"

#include <array>
#include <cassert>
#include <string_view>

int main() {
  constexpr std::array<std::string_view, 12> expected{
      "room", "plate", "hall", "cinema", "cloud", "freeze",
      "celestial", "aurora", "nebula", "abyss", "emt140", "lexicon224"};
  static_assert(calcotone::kAtmosParityProfiles.size() == expected.size());
  for (std::size_t i = 0; i < expected.size(); ++i) {
    const auto& profile = calcotone::atmos_parity_profile(i);
    assert(profile.id == expected[i]);
    assert(profile.line_count >= 6 && profile.line_count <= profile.line_times.size());
    assert(profile.predelay[0] >= 0.F && profile.predelay[1] >= profile.predelay[0]);
    assert(profile.size_range[0] > 0.F && profile.size_range[1] >= profile.size_range[0]);
    assert(profile.output_trim > 0.F && profile.input_trim > 0.F);
  }
  const auto& emt = calcotone::atmos_parity_profile(10);
  assert(emt.plate_dispersion == 1.F);
  assert(emt.split_decay == .16F);
  const auto& lexicon = calcotone::atmos_parity_profile(11);
  assert(lexicon.converter_bits == 12);
  assert(lexicon.converter_lowpass == 8800.F);
  assert(lexicon.split_decay == .34F);
}
