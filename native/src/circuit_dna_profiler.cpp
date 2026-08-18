#include "calcotone/circuit_dna_profiler.hpp"

#include <algorithm>
#include <cmath>

namespace calcotone {
namespace {
float clamp01(float value) noexcept {
  return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F);
}
}  // namespace

CircuitDnaProfiler::CircuitDnaProfiler() noexcept
    : CircuitDnaProfiler(48'000.F) {}

CircuitDnaProfiler::CircuitDnaProfiler(float sample_rate) noexcept
    : sample_rate_(std::clamp(sample_rate, 8'000.F, 384'000.F)) {}

void CircuitDnaProfiler::configure(float sample_rate) noexcept {
  sample_rate_ = std::clamp(sample_rate, 8'000.F, 384'000.F);
  reset();
}

float CircuitDnaProfiler::observe(
    const float* dry, const float* wet, std::size_t frames, bool enabled) noexcept {
  if (!enabled || dry == nullptr || wet == nullptr || frames == 0U) {
    calibration_gain_ += (1.F - calibration_gain_) * .002F;
    published_calibration_gain_.store(calibration_gain_, std::memory_order_relaxed);
    return calibration_gain_;
  }

  double input_power = 0.0;
  double output_power = 0.0;
  double input_absolute = 0.0;
  double residual_absolute = 0.0;
  double input_slew = 0.0;
  double output_slew = 0.0;
  double direct_error = 0.0;
  double lag_error = 0.0;
  float input_peak = 0.F;
  float output_peak = 0.F;
  float previous_dry = previous_dry_;
  float previous_wet = previous_wet_;

  for (std::size_t sample = 0; sample < frames * 2U; ++sample) {
    const float input = std::isfinite(dry[sample]) ? dry[sample] : 0.F;
    const float output = std::isfinite(wet[sample]) ? wet[sample] : 0.F;
    input_power += static_cast<double>(input) * input;
    output_power += static_cast<double>(output) * output;
    input_absolute += std::abs(input);
    residual_absolute += std::abs(output - input);
    input_slew += std::abs(input - previous_dry);
    output_slew += std::abs(output - previous_wet);
    direct_error += std::abs(output - input);
    lag_error += std::abs(output - previous_dry);
    input_peak = std::max(input_peak, std::abs(input));
    output_peak = std::max(output_peak, std::abs(output));
    previous_dry = input;
    previous_wet = output;
  }
  previous_dry_ = previous_dry;
  previous_wet_ = previous_wet;

  const double samples = static_cast<double>(frames * 2U);
  const float input_rms = static_cast<float>(std::sqrt(input_power / samples));
  const float output_rms = static_cast<float>(std::sqrt(output_power / samples));
  if (input_rms > 1e-4F && output_rms > 1e-6F) {
    const float unity_target = std::clamp(input_rms / output_rms, .97F, 1.03F);
    const float amount = 1.F - std::exp(
        -static_cast<float>(frames) / std::max(1.F, sample_rate_ * 1.5F));
    calibration_gain_ += (unity_target - calibration_gain_) * amount;

    const float drive = clamp01(static_cast<float>(residual_absolute)
        / static_cast<float>(input_absolute + 1e-9) * .45F);
    const float color = clamp01(static_cast<float>(output_slew / (input_slew + 1e-9)) * .35F);
    const float input_crest = input_peak / std::max(1e-6F, input_rms);
    const float output_crest = output_peak / std::max(1e-6F, output_rms);
    const float dynamics = clamp01(.5F + (input_crest - output_crest) * .18F);
    const float memory = clamp01(static_cast<float>(
        (direct_error - lag_error) / (direct_error + lag_error + 1e-9)) * .5F + .5F);
    const auto smooth_publish = [](std::atomic<float>& destination, float value) noexcept {
      const float previous = destination.load(std::memory_order_relaxed);
      destination.store(previous + (value - previous) * .08F,
                        std::memory_order_relaxed);
    };
    smooth_publish(published_drive_, drive);
    smooth_publish(published_color_, color);
    smooth_publish(published_dynamics_, dynamics);
    smooth_publish(published_memory_, memory);
    observations_.fetch_add(1U, std::memory_order_relaxed);
  }
  published_calibration_gain_.store(calibration_gain_, std::memory_order_relaxed);
  return calibration_gain_;
}

CircuitDnaSnapshot CircuitDnaProfiler::snapshot() const noexcept {
  return {
    published_drive_.load(std::memory_order_relaxed),
    published_color_.load(std::memory_order_relaxed),
    published_dynamics_.load(std::memory_order_relaxed),
    published_memory_.load(std::memory_order_relaxed),
    published_calibration_gain_.load(std::memory_order_relaxed),
    observations_.load(std::memory_order_relaxed),
  };
}

void CircuitDnaProfiler::reset() noexcept {
  calibration_gain_ = 1.F;
  previous_dry_ = 0.F;
  previous_wet_ = 0.F;
  published_drive_.store(0.F, std::memory_order_relaxed);
  published_color_.store(0.F, std::memory_order_relaxed);
  published_dynamics_.store(0.F, std::memory_order_relaxed);
  published_memory_.store(0.F, std::memory_order_relaxed);
  published_calibration_gain_.store(1.F, std::memory_order_relaxed);
  observations_.store(0U, std::memory_order_relaxed);
}

}  // namespace calcotone
