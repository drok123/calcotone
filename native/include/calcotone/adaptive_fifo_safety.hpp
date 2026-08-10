#pragma once

#include <cstddef>
#include <cstdint>

namespace calcotone {

struct AdaptiveFifoSafetyState {
  std::uint64_t base_target_frames{};
  std::uint64_t target_frames{};
  std::uint64_t maximum_target_frames{};
  std::uint64_t raises{};
  std::uint64_t relaxations{};
  std::uint64_t instability_events{};
  double stable_seconds{};
};

// Consumer-thread-only latency safety policy. The user-selected device period
// remains the immutable base. Realtime faults may add a small bounded FIFO
// cushion; sustained stable playback slowly removes that cushion again.
class AdaptiveFifoSafety final {
 public:
  AdaptiveFifoSafety(std::uint64_t base_target_frames,
                     std::uint64_t device_period_frames,
                     float sample_rate) noexcept;

  // Returns true when the target changed.
  bool observe_block(std::size_t rendered_frames,
                     std::uint64_t underrun_events,
                     std::uint64_t discontinuity_recoveries,
                     std::uint64_t overrun_events) noexcept;

  // Deadline misses are early warnings, not audible starvation by themselves.
  // Require recurrence inside a short confirmation window before adding latency.
  bool observe_deadline_miss() noexcept;

  void reset() noexcept;

  [[nodiscard]] std::uint64_t target_frames() const noexcept { return target_frames_; }
  [[nodiscard]] std::uint64_t base_target_frames() const noexcept { return base_target_frames_; }
  [[nodiscard]] std::uint64_t maximum_target_frames() const noexcept { return maximum_target_frames_; }
  [[nodiscard]] AdaptiveFifoSafetyState state() const noexcept;

 private:
  bool raise_target(std::uint64_t event_weight = 1U) noexcept;
  bool lower_target() noexcept;
  void mark_unstable(std::uint64_t event_weight) noexcept;

  std::uint64_t base_target_frames_{};
  std::uint64_t target_frames_{};
  std::uint64_t maximum_target_frames_{};
  std::uint64_t step_frames_{};
  std::uint64_t stable_frames_{};
  std::uint64_t relaxation_window_frames_{};
  std::uint64_t adjustment_cooldown_frames_{};
  std::uint64_t cooldown_remaining_frames_{};
  std::uint64_t pending_pressure_{};
  std::uint64_t deadline_pressure_{};
  std::uint64_t deadline_quiet_frames_{};
  std::uint64_t raises_{};
  std::uint64_t relaxations_{};
  std::uint64_t instability_events_{};
  float sample_rate_{};
};

}  // namespace calcotone
