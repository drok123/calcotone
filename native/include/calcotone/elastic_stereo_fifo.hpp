#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

namespace calcotone {

// Single-producer/single-consumer clock-domain bridge. The reader continuously
// varies its fractional phase by a few thousandths instead of periodically
// deleting whole samples, which keeps independent device clocks inaudible.
class ElasticStereoFifo final {
 public:
  static constexpr std::size_t capacity_frames = 1U << 17U;

  explicit ElasticStereoFifo(std::uint64_t target_frames) noexcept;
  bool push(float left, float right, bool discontinuity = false) noexcept;
  bool pull(float& left, float& right, bool* discontinuity = nullptr) noexcept;
  void trim_to_target() noexcept;
  // Consumer-thread-only. The producer never reads the target.
  void set_target_frames(std::uint64_t target_frames) noexcept;

  std::uint64_t available() const noexcept;
  std::uint64_t target_frames() const noexcept { return published_target_frames_.load(std::memory_order_relaxed); }
  std::uint64_t overruns() const noexcept { return overruns_.load(std::memory_order_relaxed); }
  std::uint64_t high_water_frames() const noexcept { return high_water_.load(std::memory_order_relaxed); }
  std::uint64_t resampled_frames() const noexcept { return resampled_frames_.load(std::memory_order_relaxed); }
  float read_ratio() const noexcept { return published_ratio_.load(std::memory_order_relaxed); }

 private:
  static constexpr std::size_t mask_ = capacity_frames - 1U;

  // Capture and render run on separate MMCSS threads. Keep their cursor state on
  // separate cache lines so advancing one side cannot invalidate the other
  // thread's hot cursor line. Each side also caches the opposite cursor briefly;
  // boundary checks force an immediate refresh before empty/full decisions.
  struct alignas(64) ProducerCursor {
    std::atomic<std::uint64_t> write{};
    std::uint64_t cached_read{};
    std::uint32_t refresh{};
  };
  struct alignas(64) ConsumerCursor {
    std::atomic<std::uint64_t> read{};
    std::uint64_t cached_write{};
    std::uint32_t refresh{};
  };

  std::array<float, capacity_frames * 2U> data_{};
  std::array<std::uint8_t, capacity_frames> markers_{};
  ProducerCursor producer_{};
  ConsumerCursor consumer_{};
  std::atomic<std::uint64_t> overruns_{};
  std::atomic<std::uint64_t> high_water_{};
  std::atomic<std::uint64_t> resampled_frames_{};
  std::atomic<float> published_ratio_{1.F};
  std::uint64_t target_frames_{};
  std::atomic<std::uint64_t> published_target_frames_{};
  double phase_{};
  double ratio_{1.0};
  double filtered_depth_{};
  float previous_left_{};
  float previous_right_{};
  bool history_valid_{};
  bool pending_discontinuity_{};
};

}  // namespace calcotone
