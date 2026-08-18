#include "calcotone/halo_space_echo_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr float kTau = kPi * 2.F;
constexpr float kCenterPanGain = .7071067811865475244F;
constexpr std::size_t kControlPeriod = 32U;
constexpr std::size_t kTanhTableSize = 4097U;
constexpr float kTanhRange = 5.F;
constexpr std::array<float, 3> kHeadRatios{1.F, 1.90F, 2.76F};
constexpr std::array<float, 3> kHeadBase{.72F, .62F, .54F};
constexpr std::array<float, 3> kFeedbackBase{.38F, .34F, .28F};
constexpr std::array<std::array<float, 3>, 7> kModeHeads{{
  {{1.F, 0.F, 0.F}}, {{0.F, 1.F, 0.F}}, {{0.F, 0.F, 1.F}},
  {{1.F, 1.F, 0.F}}, {{0.F, 1.F, 1.F}}, {{1.F, 0.F, 1.F}},
  {{1.F, 1.F, 1.F}},
}};

float clamp01(float value) noexcept {
  return std::clamp(value, 0.F, 1.F);
}

float triangle_wave(float phase) noexcept {
  // Exact (2/pi)*asin(sin(phase)) shape for an already wrapped [0, 2pi) phase,
  // expressed piecewise so flutter does not pay for sin+asin every sample.
  constexpr float scale = 2.F / kPi;
  if (phase < kPi * .5F) return phase * scale;
  if (phase < kPi * 1.5F) return 2.F - phase * scale;
  return -4.F + phase * scale;
}

float read_delay(const std::vector<float>& buffer, std::size_t write, float delay_samples) noexcept {
  float position = static_cast<float>(write) - delay_samples;
  const float size = static_cast<float>(buffer.size());
  if (position < 0.F) position += size;
  if (position >= size) position -= size;
  const auto first = static_cast<std::size_t>(position);
  auto second = first + 1U;
  if (second == buffer.size()) second = 0U;
  const float fraction = position - static_cast<float>(first);
  return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}

const std::array<float, kTanhTableSize>& tanh_table() noexcept {
  static const auto table = [] {
    std::array<float, kTanhTableSize> result{};
    for (std::size_t index = 0; index < result.size(); ++index) {
      const float normalized = static_cast<float>(index)
          / static_cast<float>(result.size() - 1U);
      result[index] = std::tanh(normalized * (kTanhRange * 2.F) - kTanhRange);
    }
    return result;
  }();
  return table;
}

float fast_tanh(float value) noexcept {
  if (value <= -kTanhRange) return -1.F;
  if (value >= kTanhRange) return 1.F;
  const auto& table = tanh_table();
  const float position = (value + kTanhRange)
      * (static_cast<float>(kTanhTableSize - 1U) / (kTanhRange * 2.F));
  const auto first = static_cast<std::size_t>(position);
  const auto second = std::min(first + 1U, kTanhTableSize - 1U);
  const float fraction = position - static_cast<float>(first);
  return table[first] + (table[second] - table[first]) * fraction;
}

struct TapeCurveControl {
  float drive{1.F};
  float positive_bias{};
  float normalization{1.F};
  float output_gain{1.F};
};

TapeCurveControl tape_curve_control(float age) noexcept {
  const float normalized = clamp01(age);
  TapeCurveControl result;
  result.drive = 1.08F + normalized * 3.1F;
  result.positive_bias = .025F + normalized * .055F;
  result.normalization = 1.F / std::max(1e-6F, fast_tanh(result.drive));
  result.output_gain = .99F - normalized * .035F;
  return result;
}

float space_echo_curve(float input, const TapeCurveControl& curve) noexcept {
  const float asymmetric = input + std::max(0.F, input) * curve.positive_bias;
  return fast_tanh(asymmetric * curve.drive) * curve.normalization * curve.output_gain;
}

struct BiquadState {
  float x1{};
  float x2{};
  float y1{};
  float y2{};
};

struct BiquadCoefficients {
  float b0{1.F};
  float b1{};
  float b2{};
  float a1{};
  float a2{};
};

enum class FilterType { Lowpass, Highpass };

BiquadCoefficients design_biquad(
    FilterType type, float frequency, float q, float sample_rate) noexcept {
  const float safe_frequency = std::clamp(frequency, 20.F, sample_rate * .45F);
  const float omega = kTau * safe_frequency / sample_rate;
  const float cosine = std::cos(omega);
  const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
  const float inverse_a0 = 1.F / (1.F + alpha);

  BiquadCoefficients coefficients;
  if (type == FilterType::Lowpass) {
    coefficients.b0 = (1.F - cosine) * .5F;
    coefficients.b1 = 1.F - cosine;
    coefficients.b2 = coefficients.b0;
  } else {
    coefficients.b0 = (1.F + cosine) * .5F;
    coefficients.b1 = -(1.F + cosine);
    coefficients.b2 = coefficients.b0;
  }
  coefficients.b0 *= inverse_a0;
  coefficients.b1 *= inverse_a0;
  coefficients.b2 *= inverse_a0;
  coefficients.a1 = (-2.F * cosine) * inverse_a0;
  coefficients.a2 = (1.F - alpha) * inverse_a0;
  return coefficients;
}

float biquad(float input, const BiquadCoefficients& coefficients,
             BiquadState& state) noexcept {
  const float output = coefficients.b0 * input
      + coefficients.b1 * state.x1 + coefficients.b2 * state.x2
      - coefficients.a1 * state.y1 - coefficients.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

}  // namespace

struct HaloSpaceEchoProcessor::Impl {
  float sample_rate;
  std::array<std::atomic<float>, 6> target{};
  std::array<float, 6> value{.36F, .22F, .42F, .14F, .58F, .14F};
  std::array<float, 6> glide_amount{};
  std::vector<float> record_buffer;
  std::size_t write{};
  std::size_t control_countdown{};
  std::size_t oscillator_renormalize{};
  float wow_sine{};
  float wow_cosine{1.F};
  float wow_rotation_sine{};
  float wow_rotation_cosine{1.F};
  float flutter_phase{.043F * kTau * 5.1F};
  float flutter_increment{};
  float first_head_seconds{.1F};
  float feedback_gain{};
  float dry_gain{1.F};
  float wet_gain{};
  TapeCurveControl curve{};
  std::array<float, 3> active_heads{};
  std::array<float, 3> wow_depth{};
  std::array<float, 3> flutter_depth{};
  BiquadCoefficients input_lowpass_coefficients{};
  BiquadCoefficients feedback_highpass_coefficients{};
  BiquadCoefficients feedback_lowpass_coefficients{};
  std::array<BiquadCoefficients, 3> head_highpass_coefficients{};
  std::array<BiquadCoefficients, 3> head_lowpass_coefficients{};
  BiquadState input_lowpass{};
  BiquadState feedback_highpass{};
  BiquadState feedback_lowpass{};
  std::array<BiquadState, 3> head_highpass{};
  std::array<BiquadState, 3> head_lowpass{};
  std::atomic<std::uint64_t> reference_position_target{0U};
  std::atomic<std::uint64_t> reference_frames_target{0U};
  std::atomic<bool> reference_running_target{false};

  explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)) {
    constexpr std::array<float, 6> seconds{.065F, .05F, .06F, .06F, .06F, .025F};
    for (std::size_t index = 0; index < value.size(); ++index) {
      target[index].store(value[index], std::memory_order_relaxed);
      glide_amount[index] = 1.F - std::exp(-1.F / (sample_rate * seconds[index]));
    }
    record_buffer.assign(static_cast<std::size_t>(sample_rate * .75F) + 64U, 0.F);
    (void)tanh_table();
    update_control();
  }

  void glide() noexcept {
    for (std::size_t index = 0; index < value.size(); ++index) {
      value[index] += (target[index].load(std::memory_order_relaxed) - value[index])
          * glide_amount[index];
    }
  }

  void update_control() noexcept {
    const float time = std::clamp(value[0], .03F, 6.2F);
    const float feedback = std::clamp(value[1], 0.F, .9F);
    const float color = clamp01(value[2]);
    const float age = clamp01(value[3]);
    const float width = clamp01(value[4]);
    const float mix = clamp01(value[5]);

    const float time_normalized = clamp01(
        std::log(std::max(.03F, time) / .03F) / std::log(6.2F / .03F));
    first_head_seconds = .069F + time_normalized * (.177F - .069F);
    const float tone = 2100.F * std::pow(4.4F, color);
    const float input_cutoff = 8900.F + color * 3600.F - age * 1600.F;
    const float feedback_highpass_hz = 65.F + (1.F - color) * 105.F;
    const float feedback_lowpass_hz = std::max(1800.F, tone * (1.F - age * .22F));
    const float feedback_normalized = clamp01(feedback / .9F);
    feedback_gain = std::min(.93F,
        std::pow(feedback_normalized, 1.14F) * (.76F + age * .16F));

    const float wow_increment = kTau * (.22F + age * .30F) / sample_rate;
    wow_rotation_sine = std::sin(wow_increment);
    wow_rotation_cosine = std::cos(wow_increment);
    flutter_increment = kTau * (4.2F + age * 3.8F) / sample_rate;

    const unsigned mode_index = std::min(6U, static_cast<unsigned>(std::floor(width * 7.F)));
    active_heads = kModeHeads[mode_index];
    curve = tape_curve_control(age);
    dry_gain = std::cos(mix * kPi * .5F);
    wet_gain = std::sin(mix * kPi * .5F);

    input_lowpass_coefficients = design_biquad(
        FilterType::Lowpass, input_cutoff, .45F, sample_rate);
    feedback_highpass_coefficients = design_biquad(
        FilterType::Highpass, feedback_highpass_hz, .5F, sample_rate);
    feedback_lowpass_coefficients = design_biquad(
        FilterType::Lowpass, feedback_lowpass_hz, .5F, sample_rate);

    const float age_squared = age * age;
    for (unsigned head = 0; head < 3; ++head) {
      wow_depth[head] = (.00006F + age_squared * .00165F) * (1.F + head * .17F);
      const float flutter = (.00002F + age_squared * .00036F) * (1.F + head * .12F);
      flutter_depth[head] = (head & 1U) ? -flutter : flutter;
      head_highpass_coefficients[head] = design_biquad(
          FilterType::Highpass, 62.F + age * 45.F + head * 8.F,
          .5F, sample_rate);
      head_lowpass_coefficients[head] = design_biquad(
          FilterType::Lowpass,
          std::max(1700.F, tone * (1.F - head * .055F) * (1.F - age * .12F)),
          .48F, sample_rate);
    }
  }

  void clear_state() noexcept {
    std::fill(record_buffer.begin(), record_buffer.end(), 0.F);
    write = 0U;
    control_countdown = 0U;
    oscillator_renormalize = 0U;
    wow_sine = 0.F;
    wow_cosine = 1.F;
    flutter_phase = .043F * kTau * 5.1F;
    input_lowpass = {};
    feedback_highpass = {};
    feedback_lowpass = {};
    head_highpass.fill({});
    head_lowpass.fill({});
    update_control();
  }

  void advance_modulation() noexcept {
    const float next_sine = wow_sine * wow_rotation_cosine + wow_cosine * wow_rotation_sine;
    const float next_cosine = wow_cosine * wow_rotation_cosine - wow_sine * wow_rotation_sine;
    wow_sine = next_sine;
    wow_cosine = next_cosine;
    if ((++oscillator_renormalize & 4095U) == 0U) {
      const float inverse_length = 1.F / std::max(
          1e-9F, std::sqrt(wow_sine * wow_sine + wow_cosine * wow_cosine));
      wow_sine *= inverse_length;
      wow_cosine *= inverse_length;
    }

    flutter_phase += flutter_increment;
    if (flutter_phase >= kTau) flutter_phase -= kTau;
  }

  void nudge_reference_phase() noexcept {
    constexpr float pull = .08F;
    wow_sine += (0.F - wow_sine) * pull;
    wow_cosine += (1.F - wow_cosine) * pull;
    const float inverse_length = 1.F / std::max(
        1e-9F, std::sqrt(wow_sine * wow_sine + wow_cosine * wow_cosine));
    wow_sine *= inverse_length;
    wow_cosine *= inverse_length;
    const float target = .043F * kTau * 5.1F;
    flutter_phase += std::remainder(target - flutter_phase, kTau) * pull;
    if (flutter_phase < 0.F) flutter_phase += kTau;
    else if (flutter_phase >= kTau) flutter_phase -= kTau;
  }

  void process(float* data, std::size_t frames) noexcept {
    const bool reference_running = reference_running_target.load(std::memory_order_relaxed);
    const std::uint64_t reference_frames = reference_frames_target.load(std::memory_order_relaxed);
    const std::uint64_t reference_position = reference_frames > 0U
        ? reference_position_target.load(std::memory_order_relaxed) % reference_frames : 0U;
    std::uint64_t reference_countdown = reference_running && reference_frames > 0U
        ? (reference_position == 0U ? 0U : reference_frames - reference_position)
        : std::numeric_limits<std::uint64_t>::max();
    for (std::size_t frame = 0; frame < frames; ++frame) {
      if (reference_countdown == 0U) {
        nudge_reference_phase();
        reference_countdown = reference_frames;
      }
      if (reference_countdown != std::numeric_limits<std::uint64_t>::max())
        --reference_countdown;
      glide();
      if (control_countdown == 0U) {
        update_control();
        control_countdown = kControlPeriod - 1U;
      } else {
        --control_countdown;
      }
      advance_modulation();
      const float flutter = triangle_wave(flutter_phase);

      const float dry_left = data[frame * 2];
      const float dry_right = data[frame * 2 + 1];
      const float mono_input = (dry_left + dry_right) * .5F;
      const float preamplified = space_echo_curve(mono_input, curve);
      const float filtered_input = biquad(
          preamplified, input_lowpass_coefficients, input_lowpass);

      float wet_mono = 0.F;
      float feedback_bus = 0.F;
      for (unsigned head = 0; head < 3; ++head) {
        const float delay_seconds = first_head_seconds * kHeadRatios[head]
            + wow_sine * wow_depth[head]
            + flutter * flutter_depth[head];
        float head_sample = read_delay(
            record_buffer, write, std::max(1.F, delay_seconds * sample_rate));
        head_sample = biquad(
            head_sample, head_highpass_coefficients[head], head_highpass[head]);
        head_sample = biquad(
            head_sample, head_lowpass_coefficients[head], head_lowpass[head]);
        head_sample = space_echo_curve(head_sample, curve);
        wet_mono += head_sample * active_heads[head] * kHeadBase[head];
        feedback_bus += head_sample * active_heads[head] * kFeedbackBase[head];
      }

      float feedback_sample = biquad(
          feedback_bus, feedback_highpass_coefficients, feedback_highpass);
      feedback_sample = biquad(
          feedback_sample, feedback_lowpass_coefficients, feedback_lowpass);
      feedback_sample = space_echo_curve(feedback_sample, curve) * feedback_gain;
      record_buffer[write] = std::clamp(filtered_input + feedback_sample, -1.25F, 1.25F);
      if (++write == record_buffer.size()) write = 0U;

      const float wet = wet_mono * kCenterPanGain;
      data[frame * 2] = std::clamp(dry_left * dry_gain + wet * wet_gain, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry_right * dry_gain + wet * wet_gain, -1.2F, 1.2F);
    }
  }
};

HaloSpaceEchoProcessor::HaloSpaceEchoProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
HaloSpaceEchoProcessor::~HaloSpaceEchoProcessor() = default;

void HaloSpaceEchoProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}

void HaloSpaceEchoProcessor::set_reference_clock(
    std::uint64_t position, std::uint64_t frames, bool running) noexcept {
  impl_->reference_position_target.store(position, std::memory_order_relaxed);
  impl_->reference_frames_target.store(frames, std::memory_order_relaxed);
  impl_->reference_running_target.store(running && frames > 0U, std::memory_order_relaxed);
}

bool HaloSpaceEchoProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "time") index = 0;
  else if (name == "feedback") index = 1;
  else if (name == "color") index = 2;
  else if (name == "character") index = 3;
  else if (name == "width") index = 4;
  else if (name == "mix") index = 5;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

void HaloSpaceEchoProcessor::reset() noexcept {
  impl_->clear_state();
}

}  // namespace calcotone
