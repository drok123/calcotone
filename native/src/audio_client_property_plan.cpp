#include "calcotone/audio_client_property_plan.hpp"

namespace calcotone {

AudioClientPropertyPlan audio_client_property_plan(bool exclusive,
                                                    bool allow_shared_raw) noexcept {
  AudioClientPropertyPlan plan{};
  if (!exclusive && allow_shared_raw) {
    plan.attempts[0] = AudioClientPropertyAttempt::Raw;
    plan.attempts[1] = AudioClientPropertyAttempt::Standard;
    plan.count = 2U;
  } else {
    plan.attempts[0] = AudioClientPropertyAttempt::Standard;
    plan.count = 1U;
  }
  return plan;
}

}  // namespace calcotone
