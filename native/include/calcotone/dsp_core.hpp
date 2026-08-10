#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <utility>

namespace calcotone::dsp {

constexpr float kPi = 3.14159265358979323846F;
constexpr float kHalfPi = kPi * .5F;

inline float sanitize_audio(float value, float ceiling = 8.F) noexcept {
  if (!std::isfinite(value) || std::abs(value) < 1e-30F) return 0.F;
  return std::clamp(value, -ceiling, ceiling);
}

inline float tpt_coefficient(float frequency, float sample_rate) noexcept {
  const float safe_rate = std::max(1.F, sample_rate);
  const float tangent = std::tan(kPi * std::clamp(frequency, 2.F, safe_rate * .475F) / safe_rate);
  return tangent / (1.F + tangent);
}

inline float tpt_lowpass(float input, float& state, float coefficient) noexcept {
  const float value = (input - state) * coefficient;
  const float low = value + state;
  state = low + value;
  return sanitize_audio(low);
}

struct TptLowpass2 final {
  float first{};
  float second{};

  float process(float input, float coefficient) noexcept {
    return tpt_lowpass(tpt_lowpass(input, first, coefficient), second, coefficient);
  }

  void reset() noexcept { first = second = 0.F; }
};

struct ControlRateDivider final {
  explicit ControlRateDivider(unsigned requested_period = 1U) noexcept
      : period(std::max(1U, requested_period)) {}

  bool tick() noexcept {
    if (countdown == 0U) {
      countdown = period - 1U;
      return true;
    }
    --countdown;
    return false;
  }

  void reset() noexcept { countdown = 0U; }
  void set_period(unsigned requested_period) noexcept {
    period = std::max(1U, requested_period);
    countdown = std::min(countdown, period - 1U);
  }

  unsigned period{1U};
  unsigned countdown{};
};

struct OnePoleSmoother final {
  float value{};
  float coefficient{1.F};

  void configure(float seconds, float sample_rate) noexcept {
    coefficient = 1.F - std::exp(-1.F / std::max(1.F, seconds * sample_rate));
  }

  float process(float target) noexcept {
    value += (target - value) * coefficient;
    return value;
  }

  void reset(float next = 0.F) noexcept { value = next; }
};

namespace detail {
constexpr std::size_t kAdaaTableSize = 4097U;
constexpr float kAdaaRange = 8.F;
constexpr float kLogTwo = .69314718055994530942F;

inline float exact_tanh_antiderivative(float value) noexcept {
  const float magnitude = std::abs(value);
  return magnitude + std::log1p(std::exp(-2.F * magnitude)) - kLogTwo;
}

inline const std::array<float, kAdaaTableSize>& tanh_antiderivative_table() noexcept {
  static const auto table = [] {
    std::array<float, kAdaaTableSize> result{};
    for (std::size_t index = 0; index < result.size(); ++index) {
      const float normalized = static_cast<float>(index) / static_cast<float>(result.size() - 1U);
      const float value = normalized * (kAdaaRange * 2.F) - kAdaaRange;
      result[index] = exact_tanh_antiderivative(value);
    }
    return result;
  }();
  return table;
}

inline float tanh_antiderivative(float value) noexcept {
  const float magnitude = std::abs(value);
  if (magnitude >= kAdaaRange) return magnitude - kLogTwo;
  const auto& table = tanh_antiderivative_table();
  const float position = (value + kAdaaRange) *
      (static_cast<float>(kAdaaTableSize - 1U) / (kAdaaRange * 2.F));
  const auto first = static_cast<std::size_t>(std::max(0.F, std::floor(position)));
  const auto second = std::min(first + 1U, kAdaaTableSize - 1U);
  const float fraction = position - static_cast<float>(first);
  return table[first] + (table[second] - table[first]) * fraction;
}
}  // namespace detail

struct AdaaTanh final {
  float previous{};

  float process(float input) noexcept {
    input = sanitize_audio(input, 12.F);
    const float delta = input - previous;
    const float output = std::abs(delta) > 1e-5F
        ? (detail::tanh_antiderivative(input) - detail::tanh_antiderivative(previous)) / delta
        : std::tanh((input + previous) * .5F);
    previous = input;
    return sanitize_audio(output, 1.0001F);
  }

  void reset(float input = 0.F) noexcept { previous = sanitize_audio(input, 12.F); }
};

inline std::pair<float, float> equal_power_gains(float mix) noexcept {
  const float bounded = std::clamp(mix, 0.F, 1.F);
  return {std::cos(bounded * kHalfPi), std::sin(bounded * kHalfPi)};
}

inline float db_to_gain(float decibels) noexcept {
  return std::exp2(decibels * .1660964047443681F);
}

}  // namespace calcotone::dsp
