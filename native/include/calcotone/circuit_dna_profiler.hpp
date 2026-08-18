#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace calcotone {

struct CircuitDnaSnapshot {
  float drive{};
  float color{};
  float dynamics{};
  float memory{};
  float calibration_gain{1.F};
  std::uint64_t observations{};
};

// Online gray-box characterization for one rack module. It observes the dry and
// wet block already present in NativeRack, estimates a compact transfer DNA, and
// returns a deliberately tiny unity correction. No samples are retained and no
// allocation, lock, FFT, or wall clock is used in observe().
class CircuitDnaProfiler final {
 public:
  CircuitDnaProfiler() noexcept;
  explicit CircuitDnaProfiler(float sample_rate) noexcept;

  void configure(float sample_rate) noexcept;
  [[nodiscard]] float observe(const float* dry_stereo, const float* wet_stereo,
                              std::size_t frames, bool enabled) noexcept;
  [[nodiscard]] CircuitDnaSnapshot snapshot() const noexcept;
  void reset() noexcept;

 private:
  float sample_rate_;
  float calibration_gain_{1.F};
  float previous_dry_{};
  float previous_wet_{};
  std::atomic<float> published_drive_{};
  std::atomic<float> published_color_{};
  std::atomic<float> published_dynamics_{};
  std::atomic<float> published_memory_{};
  std::atomic<float> published_calibration_gain_{1.F};
  std::atomic<std::uint64_t> observations_{};
};

}  // namespace calcotone
