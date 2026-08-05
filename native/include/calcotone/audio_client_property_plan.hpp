#pragma once

#include <array>
#include <cstddef>

namespace calcotone {

enum class AudioClientPropertyAttempt {
  ProAudioRaw,
  ProAudio,
};

struct AudioClientPropertyPlan {
  std::array<AudioClientPropertyAttempt, 2> attempts{};
  std::size_t count{};
};

// Exclusive mode already bypasses the shared audio engine, so it requests only
// the Pro Audio category. Shared mode may try RAW first, then must retain a
// guaranteed Pro Audio/non-RAW fallback for endpoints that reject RAW.
AudioClientPropertyPlan audio_client_property_plan(bool exclusive,
                                                    bool allow_shared_raw) noexcept;

}  // namespace calcotone
