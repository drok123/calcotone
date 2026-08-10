#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace calcotone {

enum class StackInputSource : unsigned { InputOne = 0, InputTwo = 1, Both = 2 };
enum class InputRoutingMode : unsigned {
  Stereo = 0,
  MonoToStereo = 1,
  Left = 2,
  Right = 3,
  SumMono = 4,
  Swap = 5,
};

struct InputRouteMatrix {
  float lane_one_left{1.F};
  float lane_one_right{0.F};
  float lane_two_left{0.F};
  float lane_two_right{1.F};
};

constexpr bool stack_receives_lane(StackInputSource source, unsigned lane) noexcept {
  return source == StackInputSource::Both || static_cast<unsigned>(source) == lane;
}

inline InputRouteMatrix input_route_target(
    InputRoutingMode mode,
    float width,
    bool invert_left,
    bool invert_right) noexcept {
  width = std::clamp(std::isfinite(width) ? width : 1.F, 0.F, 2.F);
  const float left_sign = invert_left ? -1.F : 1.F;
  const float right_sign = invert_right ? -1.F : 1.F;

  InputRouteMatrix route{};
  switch (mode) {
    case InputRoutingMode::MonoToStereo:
    case InputRoutingMode::Left:
      // A native lane is internally stereo. Feeding only lane one is the native
      // equivalent of duplicating interface input 1 to a stereo effects rack,
      // without double-processing and boosting the source by 3 dB.
      route = {left_sign, 0.F, 0.F, 0.F};
      break;
    case InputRoutingMode::Right:
      route = {0.F, 0.F, 0.F, right_sign};
      break;
    case InputRoutingMode::SumMono:
      route = {.5F * left_sign, .5F * right_sign, 0.F, 0.F};
      break;
    case InputRoutingMode::Swap: {
      const float direct = (1.F + width) * .5F;
      const float cross = (1.F - width) * .5F;
      route = {cross * left_sign, direct * right_sign,
               direct * left_sign, cross * right_sign};
      break;
    }
    case InputRoutingMode::Stereo:
    default: {
      const float direct = (1.F + width) * .5F;
      const float cross = (1.F - width) * .5F;
      route = {direct * left_sign, cross * right_sign,
               cross * left_sign, direct * right_sign};
      break;
    }
  }
  return route;
}

inline void route_dual_mono(
    const float* capture_stereo,
    float* lane_one_stereo,
    float* lane_two_stereo,
    std::size_t frames,
    float gain,
    const InputRouteMatrix& target,
    InputRouteMatrix& current,
    float smoothing_alpha) noexcept {
  const float alpha = std::clamp(smoothing_alpha, 0.F, 1.F);
  for (std::size_t frame = 0; frame < frames; ++frame) {
    current.lane_one_left += (target.lane_one_left - current.lane_one_left) * alpha;
    current.lane_one_right += (target.lane_one_right - current.lane_one_right) * alpha;
    current.lane_two_left += (target.lane_two_left - current.lane_two_left) * alpha;
    current.lane_two_right += (target.lane_two_right - current.lane_two_right) * alpha;

    const float left = capture_stereo[frame * 2];
    const float right = capture_stereo[frame * 2 + 1];
    const float input_one = (left * current.lane_one_left + right * current.lane_one_right) * gain;
    const float input_two = (left * current.lane_two_left + right * current.lane_two_right) * gain;
    lane_one_stereo[frame * 2] = input_one;
    lane_one_stereo[frame * 2 + 1] = input_one;
    lane_two_stereo[frame * 2] = input_two;
    lane_two_stereo[frame * 2 + 1] = input_two;
  }
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
