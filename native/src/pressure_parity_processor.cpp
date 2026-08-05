#include "calcotone/pressure_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float smoothing_coefficient(float seconds, float rate) noexcept {
  return 1.F - std::exp(-1.F / std::max(1.F, seconds * rate));
}

struct Biquad {
  float b0{1.F}, b1{}, b2{}, a1{}, a2{};
  float x1{}, x2{}, y1{}, y2{};

  void reset() noexcept { x1 = x2 = y1 = y2 = 0.F; }
  float process(float input) noexcept {
    const float output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = input; y2 = y1; y1 = output;
    return std::isfinite(output) ? output : 0.F;
  }
  void normalize(float rb0, float rb1, float rb2, float ra0, float ra1, float ra2) noexcept {
    const float inverse = 1.F / std::max(1e-9F, ra0);
    b0 = rb0 * inverse; b1 = rb1 * inverse; b2 = rb2 * inverse;
    a1 = ra1 * inverse; a2 = ra2 * inverse;
  }
  void highpass(float rate, float frequency, float q) noexcept {
    frequency = std::clamp(frequency, 10.F, rate * .475F);
    const float omega = 2.F * kPi * frequency / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize((1.F + cosine) * .5F, -(1.F + cosine), (1.F + cosine) * .5F,
              1.F + alpha, -2.F * cosine, 1.F - alpha);
  }
  void lowpass(float rate, float frequency, float q) noexcept {
    frequency = std::clamp(frequency, 10.F, rate * .475F);
    const float omega = 2.F * kPi * frequency / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize((1.F - cosine) * .5F, 1.F - cosine, (1.F - cosine) * .5F,
              1.F + alpha, -2.F * cosine, 1.F - alpha);
  }
};

struct ModeProfile {
  float threshold;
  float ratio;
  float attack;
  float release;
  float knee;
  float saturation;
  float makeup;
};
constexpr std::array<ModeProfile, kPressureModeCount> kModes{{
    {-21.F, 6.F, .0012F, .08F, 3.5F, 1.45F, .93F},
    {-18.F, 3.2F, .018F, .42F, 6.5F, 1.18F, .98F},
    {-15.F, 2.4F, .028F, .31F, 8.5F, 1.62F, .90F},
    {-24.F, 8.F, .0008F, .065F, 2.F, 1.08F, .96F},
}};

struct StyleProfile {
  float threshold_offset;
  float ratio_scale;
  float attack_scale;
  float release_scale;
  float knee_scale;
  float drive_scale;
  float makeup;
};
constexpr std::array<StyleProfile, kPressureStyleCount> kStyles{{
    {1.5F, .78F, .55F, .72F, .74F, .76F, .97F},
    {-1.F, 1.08F, 1.45F, 1.55F, 1.28F, .88F, 1.01F},
    {-2.5F, .92F, 1.12F, 1.18F, 1.55F, .92F, .98F},
    {-5.F, 1.85F, .38F, .58F, .48F, 1.48F, .91F},
}};

float soft_knee_gain(float level_db, float threshold, float ratio, float knee) noexcept {
  const float safe_ratio = std::max(1.F, ratio);
  const float slope = 1.F / safe_ratio - 1.F;
  float reduction_db = 0.F;
  if (knee <= 1e-5F) {
    if (level_db > threshold) reduction_db = (level_db - threshold) * slope;
  } else {
    const float lower = threshold - knee * .5F;
    const float upper = threshold + knee * .5F;
    if (level_db > upper) {
      reduction_db = (level_db - threshold) * slope;
    } else if (level_db > lower) {
      const float distance = level_db - lower;
      reduction_db = slope * distance * distance / (2.F * knee);
    }
  }
  return std::pow(10.F, reduction_db / 20.F);
}
}  // namespace

struct PressureParityProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)) {
    update_filters();
  }

  void update_filters() noexcept {
    const float character = clamp01(smooth[4]);
    const float detector_hz = 62.F + character * 290.F;
    const float tone_hz = 1150.F + character * 9800.F;
    for (unsigned channel = 0; channel < 2U; ++channel) {
      detector[channel].highpass(rate, detector_hz, .55F);
      tone_filter[channel].lowpass(rate, tone_hz, .65F);
    }
  }

  void reset() noexcept {
    for (std::size_t index = 0; index < smooth.size(); ++index)
      smooth[index] = target[index].load(std::memory_order_relaxed);
    gain.fill(1.F);
    for (auto& filter : detector) filter.reset();
    for (auto& filter : tone_filter) filter.reset();
    active = bypassed.load(std::memory_order_relaxed) ? 0.F : 1.F;
    coefficient_countdown = 0U;
    update_filters();
  }

  void process(float* data, std::size_t frames) noexcept {
    const float parameter_glide = smoothing_coefficient(.02F, rate);
    const float bypass_glide = smoothing_coefficient(.006F, rate);
    for (std::size_t frame = 0; frame < frames; ++frame) {
      smooth[0] = target[0].load(std::memory_order_relaxed);
      smooth[1] = target[1].load(std::memory_order_relaxed);
      for (std::size_t index = 2; index < smooth.size(); ++index)
        smooth[index] += (target[index].load(std::memory_order_relaxed) - smooth[index]) * parameter_glide;

      const unsigned mode_index = std::min(3U,
          static_cast<unsigned>(std::max(0.F, std::round(smooth[0]))));
      const unsigned style_index = std::min(3U,
          static_cast<unsigned>(std::max(0.F, std::round(smooth[1]))));
      const auto& mode = kModes[mode_index];
      const auto& style = kStyles[style_index];
      const float drive_control = clamp01(smooth[2]);
      const float time = clamp01(smooth[3]);
      const float character = clamp01(smooth[4]);
      const float mix = clamp01(smooth[5]);

      if (coefficient_countdown == 0U) {
        update_filters();
        coefficient_countdown = 31U;
      } else {
        --coefficient_countdown;
      }

      const float threshold = mode.threshold + style.threshold_offset - drive_control * 4.5F;
      const float ratio = std::clamp(mode.ratio * style.ratio_scale
          * (.88F + drive_control * .5F), 1.F, 20.F);
      const float attack = std::max(.0002F, mode.attack * style.attack_scale
          * (1.35F - time * .7F) * (1.08F - character * .18F));
      const float release = std::max(.005F, mode.release * style.release_scale
          * (.62F + time * 1.06F));
      const float knee = std::clamp(mode.knee * style.knee_scale, 0.F, 40.F);
      const float attack_coefficient = smoothing_coefficient(attack, rate);
      const float release_coefficient = smoothing_coefficient(release, rate);
      const float drive_amount = mode.saturation * (.82F + drive_control * 1.9F)
          * style.drive_scale;
      const float stage_drive = 1.F + drive_amount * 2.45F;
      const float asymmetry = character * .055F;
      const float makeup = mode.makeup * style.makeup * (1.F + drive_control * .1F);

      const float dry_curve = std::cos(mix * kPi * .5F);
      const float wet_curve = std::sin(mix * kPi * .5F);
      constexpr float correlation = .42F;
      const float normalization = 1.F / std::sqrt(std::max(1e-6F,
          dry_curve * dry_curve + wet_curve * wet_curve
          + 2.F * correlation * dry_curve * wet_curve));
      const float dry_gain = dry_curve * normalization;
      const float wet_gain = wet_curve * normalization;
      const float active_target = bypassed.load(std::memory_order_relaxed) ? 0.F : 1.F;
      active += (active_target - active) * bypass_glide;

      for (unsigned channel = 0; channel < 2U; ++channel) {
        const std::size_t index = frame * 2U + channel;
        const float dry = std::isfinite(data[index]) ? data[index] : 0.F;
        const float detected_audio = detector[channel].process(dry);
        const float level_db = 20.F * std::log10(std::max(1e-8F, std::abs(detected_audio)));
        const float desired_gain = soft_knee_gain(level_db, threshold, ratio, knee);
        gain[channel] += (desired_gain - gain[channel])
            * (desired_gain < gain[channel] ? attack_coefficient : release_coefficient);
        const float compressed = detected_audio * gain[channel];
        const float asymmetric = compressed + std::max(0.F, compressed) * asymmetry;
        const float shaped = std::tanh(asymmetric * stage_drive) / stage_drive;
        const float wet = tone_filter[channel].process(shaped) * makeup;
        const float mixed = dry * dry_gain + wet * wet_gain;
        data[index] = std::clamp(dry + (mixed - dry) * active, -1.2F, 1.2F);
      }
    }
  }

  float rate;
  std::array<std::atomic<float>, 6> target{0.F, 2.F, .42F, .46F, .38F, .72F};
  std::array<float, 6> smooth{0.F, 2.F, .42F, .46F, .38F, .72F};
  std::atomic<bool> bypassed{false};
  std::array<Biquad, 2> detector{};
  std::array<Biquad, 2> tone_filter{};
  std::array<float, 2> gain{1.F, 1.F};
  float active{1.F};
  std::size_t coefficient_countdown{};
};

PressureParityProcessor::PressureParityProcessor(float rate)
    : impl_(std::make_unique<Impl>(rate)) {}
PressureParityProcessor::~PressureParityProcessor() = default;
void PressureParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}
void PressureParityProcessor::reset() noexcept { impl_->reset(); }
void PressureParityProcessor::set_bypassed(bool bypassed) noexcept {
  impl_->bypassed.store(bypassed, std::memory_order_relaxed);
}
bool PressureParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99U;
  if (name == "mode") index = 0U;
  else if (name == "style") index = 1U;
  else if (name == "drive") index = 2U;
  else if (name == "time") index = 3U;
  else if (name == "character") index = 4U;
  else if (name == "mix") index = 5U;
  if (index >= impl_->target.size()) return false;
  if (index <= 1U) value = std::clamp(std::round(value), 0.F, 3.F);
  else value = clamp01(value);
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
