#include "calcotone/ember_parity_profiles.hpp"

#include <array>
#include <cassert>
#include <string_view>

int main() {
  using calcotone::EmberParityBranch;
  constexpr std::array<std::string_view, 18> expected{
      "velvet","tube","console","transformer","furnace","exciter","broken",
      "goldlion","mullard","telefunken","bugleboy","rcablack",
      "sp1200","mpc60","mirage","s950","emulator2","fairlightiix"};

  static_assert(calcotone::kEmberParityProfiles.size() == expected.size());
  for (std::size_t i = 0; i < expected.size(); ++i)
    assert(calcotone::ember_parity_profile(i).id == expected[i]);

  assert(calcotone::ember_parity_profile(3).branch == EmberParityBranch::MagneticCore);
  for (std::size_t i = 7; i <= 11; ++i) {
    const auto& profile = calcotone::ember_parity_profile(i);
    assert(profile.branch == EmberParityBranch::Tube);
    assert(profile.tube_post.presence_hz > 1000.F);
    assert(profile.tube_post.ratio_base >= 1.F);
  }
  for (std::size_t i = 12; i < expected.size(); ++i) {
    const auto& profile = calcotone::ember_parity_profile(i);
    assert(profile.branch == EmberParityBranch::DigitalCapture);
    assert(profile.digital_capture_mode == static_cast<int>(i - 12));
  }
  assert(calcotone::ember_parity_profile(999).id == "velvet");
}
