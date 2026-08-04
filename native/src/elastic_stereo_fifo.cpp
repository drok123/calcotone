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
      filtered_depth_(static_cast<double>(target_frames_)) {}

bool ElasticStereoFifo::push(float left, float right) noexcept {
  const auto write = write_.load(std::memory_order_relaxed);
  const auto read = read_.load(std::memory_order_acquire);
  if (write - read >= capacity_frames) {
    overruns_.fetch_add(1, std::memory_order_relaxed);
    return false;
  }
  const auto slot = static_cast<std::size_t>(write) & mask_;
  data_[slot * 2U] = left;
  data_[slot * 2U + 1U] = right;
  write_.store(write + 1U, std::memory_order_release);
  const auto depth = write + 1U - read;
  auto peak = high_water_.load(std::memory_order_relaxed);
  while (depth > peak && !high_water_.compare_exchange_weak(
      peak, depth, std::memory_order_relaxed, std::memory_order_relaxed)) {}
  return true;
}

bool ElasticStereoFifo::pull(float& left, float& right) noexcept {
  const auto read = read_.load(std::memory_order_relaxed);
  const auto write = write_.load(std::memory_order_acquire);
  const auto depth = write - read;
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
  const float mu = static_cast<float>(phase_);
  const float current_left = data_[current * 2U];
  const float current_right = data_[current * 2U + 1U];
  const float prior_left = history_valid_ ? previous_left_ : current_left;
  const float prior_right = history_valid_ ? previous_right_ : current_right;
  left = hermite(prior_left, current_left, data_[next * 2U], data_[next_two * 2U], mu);
  right = hermite(prior_right, current_right, data_[next * 2U + 1U], data_[next_two * 2U + 1U], mu);

  const double next_phase = phase_ + ratio_;
  auto advance = static_cast<std::uint64_t>(next_phase);
  phase_ = next_phase - static_cast<double>(advance);
  if (advance + 2U > depth) {
    advance = depth - 2U;
    phase_ = 0.0;
  }
  if (advance > 0U) {
    const auto previous = static_cast<std::size_t>(read + advance - 1U) & mask_;
    previous_left_ = data_[previous * 2U];
    previous_right_ = data_[previous * 2U + 1U];
    history_valid_ = true;
  }
  read_.store(read + advance, std::memory_order_release);
  return true;
}

void ElasticStereoFifo::trim_to_target() noexcept {
  const auto write = write_.load(std::memory_order_acquire);
  const auto read = read_.load(std::memory_order_relaxed);
  if (write - read > target_frames_)
    read_.store(write - target_frames_, std::memory_order_release);
  phase_ = 0.0;
  ratio_ = 1.0;
  filtered_depth_ = static_cast<double>(target_frames_);
  history_valid_ = false;
  published_ratio_.store(1.F, std::memory_order_relaxed);
  high_water_.store(target_frames_, std::memory_order_relaxed);
}

std::uint64_t ElasticStereoFifo::available() const noexcept {
  const auto write = write_.load(std::memory_order_acquire);
  const auto read = read_.load(std::memory_order_acquire);
  return write - read;
}

}  // namespace calcotone
