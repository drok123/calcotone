#include "calcotone/stream_recovery.hpp"

#include <algorithm>
#include <cmath>

namespace calcotone {
namespace {
float sanitize(float value) noexcept {
  return std::isfinite(value) ? value : 0.F;
}

float smoothstep(float value) noexcept {
  value = std::clamp(value, 0.F, 1.F);
  return value * value * (3.F - 2.F * value);
}
}  // namespace

StreamRecovery::StreamRecovery(float sample_rate, float recovery_seconds) noexcept {
  sample_rate = std::clamp(sample_rate, 8'000.F, 384'000.F);
  recovery_seconds = std::clamp(recovery_seconds, .0005F, .01F);
  recovery_frames_ = std::clamp<std::size_t>(
      static_cast<std::size_t>(std::lround(sample_rate * recovery_seconds)), 8U, 2048U);
  // Preserve the old host's approximately 30 ms fade-to-silence behavior while
  // making it sample-rate independent.
  decay_ = std::exp(std::log(.001F) / (sample_rate * .03F));
}

bool StreamRecovery::process(bool input_available, float input_left, float input_right,
                             float& output_left, float& output_right) noexcept {
  input_available = input_available
      && std::isfinite(input_left) && std::isfinite(input_right);
  if (!input_available) {
    const bool episode_started = !starving_;
    starving_ = true;
    recovery_remaining_ = 0U;
    last_left_ *= decay_;
    last_right_ *= decay_;
    output_left = last_left_;
    output_right = last_right_;
    return episode_started;
  }

  input_left = sanitize(input_left);
  input_right = sanitize(input_right);
  if (starving_ || discontinuity_pending_) {
    starving_ = false;
    discontinuity_pending_ = false;
    recovery_remaining_ = recovery_frames_;
    recovery_start_left_ = last_left_;
    recovery_start_right_ = last_right_;
  }

  if (recovery_remaining_ != 0U) {
    const auto progressed = recovery_frames_ - recovery_remaining_ + 1U;
    const float position = static_cast<float>(progressed)
        / static_cast<float>(recovery_frames_);
    const float blend = smoothstep(position);
    output_left = recovery_start_left_ + (input_left - recovery_start_left_) * blend;
    output_right = recovery_start_right_ + (input_right - recovery_start_right_) * blend;
    --recovery_remaining_;
  } else {
    output_left = input_left;
    output_right = input_right;
  }

  last_left_ = output_left;
  last_right_ = output_right;
  return false;
}

void StreamRecovery::mark_discontinuity() noexcept {
  discontinuity_pending_ = true;
}

void StreamRecovery::reset() noexcept {
  recovery_remaining_ = 0U;
  last_left_ = 0.F;
  last_right_ = 0.F;
  recovery_start_left_ = 0.F;
  recovery_start_right_ = 0.F;
  starving_ = false;
  discontinuity_pending_ = false;
}

}  // namespace calcotone
