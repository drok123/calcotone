#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace calcotone {

enum class StackInputSource : unsigned { InputOne = 0, InputTwo = 1, Both = 2 };

constexpr bool stack_receives_lane(StackInputSource source, unsigned lane) noexcept {
  return source == StackInputSource::Both || static_cast<unsigned>(source) == lane;
}

inline void split_dual_mono(
    const float* capture_stereo,
    float* lane_one_stereo,
    float* lane_two_stereo,
    std::size_t frames,
    float gain) noexcept {
  for (std::size_t frame = 0; frame < frames; ++frame) {
    const float input_one = capture_stereo[frame * 2] * gain;
    const float input_two = capture_stereo[frame * 2 + 1] * gain;
    lane_one_stereo[frame * 2] = input_one;
    lane_one_stereo[frame * 2 + 1] = input_one;
    lane_two_stereo[frame * 2] = input_two;
    lane_two_stereo[frame * 2 + 1] = input_two;
  }
}

// Sum the two processed interface lanes without applying the final output gain
// or safety knee. LOOP captures this exact post-rack signal, then its return is
// mixed before one final safety/output stage.
inline void sum_dual_mono(
    const float* lane_one_stereo,
    const float* lane_two_stereo,
    float* output_stereo,
    std::size_t frames) noexcept {
  constexpr float kEqualPowerSum = 0.70710678F;
  for (std::size_t sample = 0; sample < frames * 2; ++sample)
    output_stereo[sample] = (lane_one_stereo[sample] + lane_two_stereo[sample]) * kEqualPowerSum;
}

inline void apply_output_safety(
    float* output_stereo,
    std::size_t frames,
    float gain,
    std::uint64_t* limited_samples = nullptr,
    float* pre_limit_peak = nullptr) noexcept {
  for (std::size_t sample = 0; sample < frames * 2; ++sample) {
    const float raw = output_stereo[sample] * gain;
    const float magnitude = std::abs(raw);
    if (pre_limit_peak) *pre_limit_peak = std::max(*pre_limit_peak, magnitude);
    if (magnitude <= .9F) {
      output_stereo[sample] = raw;
      continue;
    }
    if (limited_samples) ++*limited_samples;
    const float shaped = std::min(.999999F, .9F + .1F * std::tanh((magnitude - .9F) * 10.F));
    output_stereo[sample] = std::copysign(shaped, raw);
  }
}

inline void mix_dual_mono(
    const float* lane_one_stereo,
    const float* lane_two_stereo,
    float* output_stereo,
    std::size_t frames,
    float gain,
    std::uint64_t* limited_samples = nullptr,
    float* pre_limit_peak = nullptr) noexcept {
  sum_dual_mono(lane_one_stereo, lane_two_stereo, output_stereo, frames);
  apply_output_safety(output_stereo, frames, gain, limited_samples, pre_limit_peak);
}

}  // namespace calcotone
