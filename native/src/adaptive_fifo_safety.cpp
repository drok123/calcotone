#include "calcotone/adaptive_fifo_safety.hpp"

#include <algorithm>
#include <cmath>

namespace calcotone {

AdaptiveFifoSafety::AdaptiveFifoSafety(std::uint64_t base_target_frames,
                                       std::uint64_t device_period_frames,
                                       float sample_rate) noexcept
    : sample_rate_(std::clamp(sample_rate, 8'000.F, 384'000.F)) {
  step_frames_ = std::clamp<std::uint64_t>(device_period_frames, 16U, 16'384U);
  base_target_frames_ = std::max<std::uint64_t>(base_target_frames, step_frames_ * 2U);
  target_frames_ = base_target_frames_;

  const auto twenty_milliseconds = static_cast<std::uint64_t>(
      std::max(16.0, std::round(static_cast<double>(sample_rate_) * .020)));
  const auto bounded_extra = std::max(
      step_frames_, std::min(step_frames_ * 6U, twenty_milliseconds));
  maximum_target_frames_ = base_target_frames_ + bounded_extra;

  // Audible starvation gets a long proof window before latency is removed. A
  // confirmed callback-deadline warning is predictive only; if eight seconds pass
  // without a real underrun, remove exactly that predictive period and return to
  // the conservative 30-second policy for any remaining starvation cushion.
  relaxation_window_frames_ = static_cast<std::uint64_t>(
      std::round(static_cast<double>(sample_rate_) * 30.0));
  predictive_relaxation_window_frames_ = static_cast<std::uint64_t>(
      std::round(static_cast<double>(sample_rate_) * 8.0));
  adjustment_cooldown_frames_ = static_cast<std::uint64_t>(
      std::round(static_cast<double>(sample_rate_) * .5));
}

void AdaptiveFifoSafety::mark_unstable(std::uint64_t event_weight) noexcept {
  instability_events_ += event_weight;
  stable_frames_ = 0U;
}

bool AdaptiveFifoSafety::raise_target(std::uint64_t event_weight, bool predictive) noexcept {
  if (target_frames_ >= maximum_target_frames_) return false;
  const auto steps = event_weight >= 4U ? 2U : 1U;
  const auto increment = step_frames_ * steps;
  const auto next = std::min(maximum_target_frames_, target_frames_ + increment);
  if (next == target_frames_) return false;
  target_frames_ = next;
  // Only the newest added cushion can be predictive. If actual starvation adds
  // another step later, the short recovery privilege is revoked immediately.
  predictive_cushion_ = predictive;
  ++raises_;
  return true;
}

bool AdaptiveFifoSafety::lower_target() noexcept {
  if (target_frames_ <= base_target_frames_) return false;
  const auto next = target_frames_ > base_target_frames_ + step_frames_
      ? target_frames_ - step_frames_ : base_target_frames_;
  if (next == target_frames_) return false;
  target_frames_ = next;
  predictive_cushion_ = false;
  ++relaxations_;
  return true;
}

bool AdaptiveFifoSafety::observe_block(std::size_t rendered_frames,
                                       std::uint64_t underrun_events,
                                       std::uint64_t discontinuity_recoveries,
                                       std::uint64_t overrun_events) noexcept {
  const auto frames = static_cast<std::uint64_t>(rendered_frames);
  cooldown_remaining_frames_ = frames >= cooldown_remaining_frames_
      ? 0U : cooldown_remaining_frames_ - frames;

  const auto starvation_pressure = underrun_events + discontinuity_recoveries;
  if (starvation_pressure != 0U) {
    mark_unstable(starvation_pressure);
    predictive_cushion_ = false;
    deadline_pressure_ = 0U;
    deadline_quiet_frames_ = 0U;
    pending_pressure_ += starvation_pressure;
    if (cooldown_remaining_frames_ == 0U) {
      const auto pressure = pending_pressure_;
      pending_pressure_ = 0U;
      const bool changed = raise_target(pressure, false);
      cooldown_remaining_frames_ = adjustment_cooldown_frames_;
      return changed;
    }
    return false;
  }

  if (overrun_events != 0U) {
    mark_unstable(overrun_events);
    pending_pressure_ = 0U;
    deadline_pressure_ = 0U;
    deadline_quiet_frames_ = 0U;
    if (cooldown_remaining_frames_ == 0U) {
      const bool changed = lower_target();
      cooldown_remaining_frames_ = adjustment_cooldown_frames_;
      return changed;
    }
    return false;
  }

  // A single callback-budget miss is only predictive. Keep it alive for a short
  // confirmation window so a second miss can prove recurring CPU pressure, then
  // forget it before it can turn one scheduling hiccup into permanent latency.
  if (deadline_pressure_ != 0U) {
    deadline_quiet_frames_ += frames;
    if (deadline_quiet_frames_ >= adjustment_cooldown_frames_ / 2U) {
      deadline_pressure_ = 0U;
      deadline_quiet_frames_ = 0U;
    }
  }

  // Multiple starvation events inside one cooldown window represent recurring
  // instability. One isolated follow-up is absorbed by the first target raise.
  if (cooldown_remaining_frames_ == 0U && pending_pressure_ != 0U) {
    const auto pressure = pending_pressure_;
    pending_pressure_ = 0U;
    if (pressure >= 2U) {
      const bool changed = raise_target(pressure, false);
      cooldown_remaining_frames_ = adjustment_cooldown_frames_;
      return changed;
    }
  }

  const auto relaxation_window = predictive_cushion_
      ? predictive_relaxation_window_frames_
      : relaxation_window_frames_;
  stable_frames_ = std::min(relaxation_window, stable_frames_ + frames);
  if (target_frames_ > base_target_frames_
      && stable_frames_ >= relaxation_window) {
    stable_frames_ = 0U;
    return lower_target();
  }
  return false;
}

bool AdaptiveFifoSafety::observe_deadline_miss() noexcept {
  mark_unstable(1U);
  deadline_quiet_frames_ = 0U;
  ++deadline_pressure_;
  if (cooldown_remaining_frames_ != 0U || deadline_pressure_ < 2U) return false;
  const auto pressure = deadline_pressure_;
  deadline_pressure_ = 0U;
  const bool changed = raise_target(pressure, true);
  cooldown_remaining_frames_ = adjustment_cooldown_frames_;
  return changed;
}

void AdaptiveFifoSafety::reset() noexcept {
  target_frames_ = base_target_frames_;
  stable_frames_ = 0U;
  cooldown_remaining_frames_ = 0U;
  pending_pressure_ = 0U;
  deadline_pressure_ = 0U;
  deadline_quiet_frames_ = 0U;
  raises_ = 0U;
  relaxations_ = 0U;
  instability_events_ = 0U;
  predictive_cushion_ = false;
}

AdaptiveFifoSafetyState AdaptiveFifoSafety::state() const noexcept {
  return {
    base_target_frames_, target_frames_, maximum_target_frames_,
    raises_, relaxations_, instability_events_,
    static_cast<double>(stable_frames_) / static_cast<double>(sample_rate_),
    predictive_cushion_,
  };
}

}  // namespace calcotone
