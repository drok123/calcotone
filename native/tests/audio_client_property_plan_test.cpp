#include "calcotone/audio_client_property_plan.hpp"

#include <cassert>

int main() {
  using calcotone::AudioClientPropertyAttempt;

  const auto exclusive = calcotone::audio_client_property_plan(true, true);
  assert(exclusive.count == 1U);
  assert(exclusive.attempts[0] == AudioClientPropertyAttempt::ProAudio);

  const auto shared_raw = calcotone::audio_client_property_plan(false, true);
  assert(shared_raw.count == 2U);
  assert(shared_raw.attempts[0] == AudioClientPropertyAttempt::ProAudioRaw);
  assert(shared_raw.attempts[1] == AudioClientPropertyAttempt::ProAudio);

  const auto shared_standard = calcotone::audio_client_property_plan(false, false);
  assert(shared_standard.count == 1U);
  assert(shared_standard.attempts[0] == AudioClientPropertyAttempt::ProAudio);
}
