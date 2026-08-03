#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>

namespace calcotone {

// Low-cost hysteretic period tracker for the live guitar lane. One writer
// (capture thread), lock-free readers (control/tuner UI), no allocations.
class PitchTracker final {
 public:
  explicit PitchTracker(float sample_rate) noexcept : sample_rate_(std::clamp(sample_rate, 8'000.F, 384'000.F)) {}

  void push(float sample) noexcept {
    envelope_ += (std::abs(sample) - envelope_) * .0025F;
    level_.store(envelope_, std::memory_order_relaxed);
    ++frames_since_crossing_;
    const float threshold = std::max(.0035F, envelope_ * .28F);
    if (sample < -threshold) armed_ = true;
    if (armed_ && sample > threshold) {
      const float candidate = sample_rate_ / static_cast<float>(std::max(1U, frames_since_crossing_));
      if (candidate >= 38.F && candidate <= 1'400.F) {
        smoothed_ = smoothed_ <= 0.F ? candidate : smoothed_ + (candidate - smoothed_) * .24F;
        frequency_.store(smoothed_, std::memory_order_relaxed);
      }
      frames_since_crossing_ = 0; armed_ = false;
    }
    if (envelope_ < .0025F && frames_since_crossing_ > static_cast<unsigned>(sample_rate_ * .25F)) {
      smoothed_ = 0.F; frequency_.store(0.F, std::memory_order_relaxed);
    }
  }

  float frequency() const noexcept { return frequency_.load(std::memory_order_relaxed); }
  float level() const noexcept { return level_.load(std::memory_order_relaxed); }

 private:
  float sample_rate_, envelope_{}, smoothed_{};
  unsigned frames_since_crossing_{};
  bool armed_{};
  std::atomic<float> frequency_{};
  std::atomic<float> level_{};
};

}  // namespace calcotone
