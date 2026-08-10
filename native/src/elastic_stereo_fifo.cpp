#include "calcotone/elastic_stereo_fifo.hpp"

#include <algorithm>
#include <cmath>

namespace calcotone {
namespace {
float hermite(float y0, float y1, float y2, float y3, float mu) noexcept {
  const float mu2 = mu * mu;
  const float a0 = -.5F * y0 + 1.5F * y1 - 1.5F * y2 + .5F * y3;
  const float a1 = y0 - 2.5F * y1 + 2.F * y2 - .5F * y3;
  const float a2 = -.5F * y0 + .5F * y2;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
}
}

ElasticStereoFifo::ElasticStereoFifo(std::uint64_t target_frames) noexcept
    : target_frames_(std::clamp<std::uint64_t>(target_frames, 16U, capacity_frames / 4U)),
      published_target_frames_(target_frames_),
      filtered_depth_(static_cast<double>(target_frames_)) {}

bool ElasticStereoFifo::push(float left, float right, bool discontinuity) noexcept {
  const auto write = producer_.write.load(std::memory_order_relaxed);
  auto read = producer_.cached_read;
  // The producer only needs a fresh consumer cursor periodically. Near the full
  // boundary it always refreshes before deciding to drop a frame, so caching can
  // never cause an overwrite of unread audio.
  if ((producer_.refresh++ & 63U) == 0U || write - read >= capacity_frames - 256U) {
    read = consumer_.read.load(std::memory_order_acquire);
    producer_.cached_read = read;
  }
  if (write - read >= capacity_frames) {
    overruns_.fetch_add(1, std::memory_order_relaxed);
    return false;
  }
  const auto slot = static_cast<std::size_t>(write) & mask_;
  data_[slot * 2U] = left;
  data_[slot * 2U + 1U] = right;
  markers_[slot] = discontinuity ? 1U : 0U;
  producer_.write.store(write + 1U, std::memory_order_release);
  const auto depth = write + 1U - read;
  auto peak = high_water_.load(std::memory_order_relaxed);
  while (depth > peak && !high_water_.compare_exchange_weak(
      peak, depth, std::memory_order_relaxed, std::memory_order_relaxed)) {}
  return true;
}

bool ElasticStereoFifo::pull(float& left, float& right, bool* discontinuity) noexcept {
  if (discontinuity) *discontinuity = false;
  const auto read = consumer_.read.load(std::memory_order_relaxed);
  auto write = consumer_.cached_write;
  auto depth = write - read;
  // Refresh the producer cursor once per short burst, and immediately whenever
  // the cached view approaches starvation. This removes almost all cross-core
  // cursor traffic during healthy steady-state playback without hiding new data
  // when the FIFO is near empty.
  if ((consumer_.refresh++ & 31U) == 0U || depth < 8U) {
    write = producer_.write.load(std::memory_order_acquire);
    consumer_.cached_write = write;
    depth = write - read;
  }
  // Retain two future frames for Hermite interpolation. Startup priming makes this the
  // normal boundary condition instead of adding another full device period.
  if (depth < 3U) return false;

  // Event-driven devices deliver blocks, so raw FIFO depth has a harmless
  // period-sized sawtooth. Filter it before steering the sample clock to avoid
  // turning that scheduler cadence into pitch modulation.
  filtered_depth_ += (static_cast<double>(depth) - filtered_depth_) * 0.0002;
  const double error = filtered_depth_ - static_cast<double>(target_frames_);
  const double desired = 1.0 + std::clamp(
      error / (static_cast<double>(target_frames_) * 64.0), -0.01, 0.01);
  // About a 21 ms coefficient ramp at 48 kHz: quick enough to follow device
  // drift, slow enough that the resampling ratio itself cannot zipper.
  ratio_ += (desired - ratio_) * 0.001;
  published_ratio_.store(static_cast<float>(ratio_), std::memory_order_relaxed);
  if (std::abs(ratio_ - 1.0) > 1e-6)
    resampled_frames_.fetch_add(1, std::memory_order_relaxed);

  const auto current = static_cast<std::size_t>(read) & mask_;
  const auto next = static_cast<std::size_t>(read + 1U) & mask_;
  const auto next_two = static_cast<std::size_t>(read + 2U) & mask_;
  const bool current_crosses = markers_[current] != 0U;
  const bool next_crosses = markers_[next] != 0U;
  const bool next_two_crosses = markers_[next_two] != 0U;
  if (current_crosses) {
    // A new capture timeline cannot inherit interpolation phase or history from
    // the packet before the gap.
    phase_ = 0.0;
    history_valid_ = false;
  }
  const bool report_discontinuity = pending_discontinuity_ || current_crosses;
  pending_discontinuity_ = false;
  if (discontinuity) *discontinuity = report_discontinuity;
  markers_[current] = 0U;  // report exactly once, even when ratio_ advances by zero.

  const float current_left = data_[current * 2U];
  const float current_right = data_[current * 2U + 1U];
  const float next_left = next_crosses ? current_left : data_[next * 2U];
  const float next_right = next_crosses ? current_right : data_[next * 2U + 1U];
  const float next_two_left = next_crosses || next_two_crosses
      ? next_left : data_[next_two * 2U];
  const float next_two_right = next_crosses || next_two_crosses
      ? next_right : data_[next_two * 2U + 1U];
  const float mu = static_cast<float>(phase_);
  const float prior_left = history_valid_ ? previous_left_ : current_left;
  const float prior_right = history_valid_ ? previous_right_ : current_right;
  left = hermite(prior_left, current_left, next_left, next_two_left, mu);
  right = hermite(prior_right, current_right, next_right, next_two_right, mu);

  const double next_phase = phase_ + ratio_;
  auto advance = static_cast<std::uint64_t>(next_phase);
  phase_ = next_phase - static_cast<double>(advance);
  if (advance + 2U > depth) {
    advance = depth - 2U;
    phase_ = 0.0;
  }
  // A ratio slightly above one can skip one source frame. Preserve any marker
  // from that skipped frame and report it on the very next rendered sample.
  for (std::uint64_t skipped = 1U; skipped < advance; ++skipped) {
    const auto slot = static_cast<std::size_t>(read + skipped) & mask_;
    if (markers_[slot] != 0U) pending_discontinuity_ = true;
    markers_[slot] = 0U;
  }
  if (advance > 0U) {
    const auto previous = static_cast<std::size_t>(read + advance - 1U) & mask_;
    previous_left_ = data_[previous * 2U];
    previous_right_ = data_[previous * 2U + 1U];
    history_valid_ = true;
  }
  consumer_.read.store(read + advance, std::memory_order_release);
  return true;
}

void ElasticStereoFifo::set_target_frames(std::uint64_t target_frames) noexcept {
  target_frames_ = std::clamp<std::uint64_t>(target_frames, 16U, capacity_frames / 4U);
  published_target_frames_.store(target_frames_, std::memory_order_release);
}

void ElasticStereoFifo::trim_to_target() noexcept {
  const auto write = producer_.write.load(std::memory_order_acquire);
  const auto read = consumer_.read.load(std::memory_order_relaxed);
  if (write - read > target_frames_)
    consumer_.read.store(write - target_frames_, std::memory_order_release);
  consumer_.cached_write = write;
  consumer_.refresh = 0U;
  phase_ = 0.0;
  ratio_ = 1.0;
  filtered_depth_ = static_cast<double>(target_frames_);
  history_valid_ = false;
  pending_discontinuity_ = false;
  published_ratio_.store(1.F, std::memory_order_relaxed);
  high_water_.store(target_frames_, std::memory_order_relaxed);
}

std::uint64_t ElasticStereoFifo::available() const noexcept {
  const auto write = producer_.write.load(std::memory_order_acquire);
  const auto read = consumer_.read.load(std::memory_order_acquire);
  return write - read;
}

}  // namespace calcotone
