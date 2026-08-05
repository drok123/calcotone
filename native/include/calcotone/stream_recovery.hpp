#pragma once

#include <cstddef>

namespace calcotone {

// Restores waveform continuity when an event-driven capture stream briefly
// starves. Missing frames decay from the last rendered sample; the first live
// frames then crossfade back over a short sample-rate-scaled window instead of
// creating a discontinuous resume edge.
class StreamRecovery final {
 public:
  explicit StreamRecovery(float sample_rate = 48'000.F,
                          float recovery_seconds = .002F) noexcept;

  // Returns true only on the first missing frame of each starvation episode.
  bool process(bool input_available, float input_left, float input_right,
               float& output_left, float& output_right) noexcept;

  // Forces the next available frame through the same click-safe recovery path.
  void mark_discontinuity() noexcept;
  void reset() noexcept;

  [[nodiscard]] bool starving() const noexcept { return starving_; }
  [[nodiscard]] bool recovering() const noexcept { return recovery_remaining_ != 0U; }
  [[nodiscard]] std::size_t recovery_frames() const noexcept { return recovery_frames_; }

 private:
  float decay_{};
  std::size_t recovery_frames_{};
  std::size_t recovery_remaining_{};
  float last_left_{};
  float last_right_{};
  float recovery_start_left_{};
  float recovery_start_right_{};
  bool starving_{};
  bool discontinuity_pending_{};
};

}  // namespace calcotone
