#include "calcotone/artifact_chain_profiles.hpp"

#include <cassert>
#include <set>
#include <string>

int main() {
  using namespace calcotone;
  static_assert(kArtifactConsoleProfiles.size() == 6);
  static_assert(kArtifactTubeProfiles.size() == 6);

  std::set<std::string> console_ids;
  for (const auto& profile : kArtifactConsoleProfiles) {
    assert(!profile.id.empty());
    assert(profile.output_gain > 0.F);
    assert(profile.lowpass_hz > profile.highpass_hz);
    console_ids.emplace(profile.id);
  }
  assert(console_ids.size() == kArtifactConsoleProfiles.size());

  std::set<std::string> tube_ids;
  for (const auto& profile : kArtifactTubeProfiles) {
    assert(!profile.id.empty());
    assert(profile.output_gain > 0.F);
    tube_ids.emplace(profile.id);
  }
  assert(tube_ids.size() == kArtifactTubeProfiles.size());

  std::size_t combinations = 0;
  for (std::size_t console = 0; console < kArtifactConsoleProfiles.size(); ++console) {
    for (std::size_t tube = 0; tube < kArtifactTubeProfiles.size(); ++tube) {
      for (unsigned order = 0; order < 2; ++order) {
        (void)artifact_console_profile(console);
        (void)artifact_tube_profile(tube);
        ++combinations;
      }
    }
  }
  assert(combinations == 72);

  const auto& legacy = kArtifactLegacyAliases.back();
  assert(legacy.console == ArtifactConsole::Neve1073);
  assert(legacy.tube == ArtifactTube::GoldLion);
  return 0;
}
