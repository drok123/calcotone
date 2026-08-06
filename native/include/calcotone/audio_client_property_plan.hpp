#pragma once

#include <array>
#include <cstddef>

namespace calcotone {

enum class AudioClientPropertyAttempt {
  Raw,
  Standard,
};

struct AudioClientPropertyPlan {
  std::array<AudioClientPropertyAttempt, 2> attempts{};
  std::size_t count{};
};

// Exclusive mode bypasses the shared audio engine and therefore uses the
// standard stream option. Shared mode may try RAW first, then must retain a
// guaranteed standard fallback for endpoints that reject RAW properties or
// reject stream creation after accepting them.
AudioClientPropertyPlan audio_client_property_plan(bool exclusive,
                                                    bool allow_shared_raw) noexcept;

}  // namespace calcotone
