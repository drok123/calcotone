#include "calcotone/halo_space_echo_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr float kCenterPanGain = .7071067811865475244F;

float clamp01(float value) noexcept {
  return std::clamp(value, 0.F, 1.F);
}

float triangle_wave(float phase) noexcept {
  return (2.F / kPi) * std::asin(std::sin(phase));
}

float read_delay(const std::vector<float>& buffer, std::size_t write, float delay_samples) noexcept {
  float position = static_cast<float>(write) - delay_samples;
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto first = static_cast<std::size_t>(position);
  const auto second = (first + 1) % buffer.size();
  const float fraction = position - static_cast<float>(first);
  return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}

float space_echo_curve(float input, float age) noexcept {
  const float normalized = clamp01(age);
  const float drive = 1.08F + normalized * 3.1F;
  const float asymmetric = input + std::max(0.F, input) * (.025F + normalized * .055F);
  const float compressed = std::tanh(asymmetric * drive) / std::max(1e-6F, std::tanh(drive));
  return compressed * (.99F - normalized * .035F);
}

struct BiquadState {
  float x1{};
  float x2{};
  float y1{};
  float y2{};
};

enum class FilterType { Lowpass, Highpass };

float biquad(
    float input,
    FilterType type,
    float frequency,
    float q,
    float sample_rate,
    BiquadState& state) noexcept {
  const float safe_frequency = std::clamp(frequency, 20.F, sample_rate * .45F);
  const float omega = 2.F * kPi * safe_frequency / sample_rate;
  const float cosine = std::cos(omega);
  const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
  const float inverse_a0 = 1.F / (1.F + alpha);

  float b0{};
  float b1{};
  float b2{};
  if (type == FilterType::Lowpass) {
    b0 = (1.F - cosine) * .5F;
    b1 = 1.F - cosine;
    b2 = b0;
  } else {
    b0 = (1.F + cosine) * .5F;
    b1 = -(1.F + cosine);
    b2 = b0;
  }
  b0 *= inverse_a0;
  b1 *= inverse_a0;
  b2 *= inverse_a0;
  const float a1 = (-2.F * cosine) * inverse_a0;
  const float a2 = (1.F - alpha) * inverse_a0;

  const float output = b0 * input + b1 * state.x1 + b2 * state.x2
      - a1 * state.y1 - a2 * state.y2;
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
  std::vector<float> record_buffer;
  std::size_t write{};
  float wow_phase{};
  float flutter_phase{.043F * 2.F * kPi * 5.1F};
  BiquadState input_lowpass{};
  BiquadState feedback_highpass{};
  BiquadState feedback_lowpass{};
  std::array<BiquadState, 3> head_highpass{};
  std::array<BiquadState, 3> head_lowpass{};

  explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)) {
    for (std::size_t index = 0; index < value.size(); ++index) {
      target[index].store(value[index], std::memory_order_relaxed);
    }
    record_buffer.assign(static_cast<std::size_t>(sample_rate * .75F) + 64, 0.F);
  }

  void glide() noexcept {
    constexpr std::array<float, 6> seconds{.065F, .05F, .06F, .06F, .06F, .025F};
    for (std::size_t index = 0; index < value.size(); ++index) {
      const float amount = 1.F - std::exp(-1.F / (sample_rate * seconds[index]));
      value[index] += (target[index].load(std::memory_order_relaxed) - value[index]) * amount;
    }
  }

  void clear_state() noexcept {
    std::fill(record_buffer.begin(), record_buffer.end(), 0.F);
    write = 0;
    wow_phase = 0.F;
    flutter_phase = .043F * 2.F * kPi * 5.1F;
    input_lowpass = {};
    feedback_highpass = {};
    feedback_lowpass = {};
    head_highpass.fill({});
    head_lowpass.fill({});
  }

  void process(float* data, std::size_t frames) noexcept {
    constexpr std::array<float, 3> ratios{1.F, 1.90F, 2.76F};
    constexpr std::array<float, 3> head_base{.72F, .62F, .54F};
    constexpr std::array<float, 3> feedback_base{.38F, .34F, .28F};
    constexpr std::array<std::array<float, 3>, 7> mode_heads{{
      {{1.F, 0.F, 0.F}}, {{0.F, 1.F, 0.F}}, {{0.F, 0.F, 1.F}},
      {{1.F, 1.F, 0.F}}, {{0.F, 1.F, 1.F}}, {{1.F, 0.F, 1.F}},
      {{1.F, 1.F, 1.F}},
    }};

    for (std::size_t frame = 0; frame < frames; ++frame) {
      glide();
      const float time = std::clamp(value[0], .03F, 6.2F);
      const float feedback = std::clamp(value[1], 0.F, .9F);
      const float color = clamp01(value[2]);
      const float age = clamp01(value[3]);
      const float width = clamp01(value[4]);
      const float mix = clamp01(value[5]);

      const float time_normalized = clamp01(
          std::log(std::max(.03F, time) / .03F) / std::log(6.2F / .03F));
      const float first_head_seconds = .069F + time_normalized * (.177F - .069F);
      const float tone = 2100.F * std::pow(4.4F, color);
      const float input_cutoff = 8900.F + color * 3600.F - age * 1600.F;
      const float feedback_highpass_hz = 65.F + (1.F - color) * 105.F;
      const float feedback_lowpass_hz = std::max(1800.F, tone * (1.F - age * .22F));
      const float feedback_normalized = clamp01(feedback / .9F);
      const float feedback_gain = std::min(.93F,
          std::pow(feedback_normalized, 1.14F) * (.76F + age * .16F));
      const float wow_rate = .22F + age * .30F;
      const float flutter_rate = 4.2F + age * 3.8F;
      wow_phase += 2.F * kPi * wow_rate / sample_rate;
      flutter_phase += 2.F * kPi * flutter_rate / sample_rate;
      if (wow_phase >= 2.F * kPi) wow_phase -= 2.F * kPi;
      if (flutter_phase >= 2.F * kPi) flutter_phase -= 2.F * kPi;

      const unsigned mode_index = std::min(6U, static_cast<unsigned>(std::floor(width * 7.F)));
      const auto& active_heads = mode_heads[mode_index];
      const float dry_left = data[frame * 2];
      const float dry_right = data[frame * 2 + 1];
      const float mono_input = (dry_left + dry_right) * .5F;
      const float preamplified = space_echo_curve(mono_input, age);
      const float filtered_input = biquad(
          preamplified, FilterType::Lowpass, input_cutoff, .45F, sample_rate, input_lowpass);

      float wet_mono = 0.F;
      float feedback_bus = 0.F;
      for (unsigned head = 0; head < 3; ++head) {
        const float wow_depth = (.00006F + age * age * .00165F) * (1.F + head * .17F);
        const float flutter_depth = (.00002F + age * age * .00036F) * (1.F + head * .12F);
        const float signed_flutter = (head & 1U) ? -flutter_depth : flutter_depth;
        const float delay_seconds = first_head_seconds * ratios[head]
            + std::sin(wow_phase) * wow_depth
            + triangle_wave(flutter_phase) * signed_flutter;
        float head_sample = read_delay(
            record_buffer, write, std::max(1.F, delay_seconds * sample_rate));
        head_sample = biquad(
            head_sample,
            FilterType::Highpass,
            62.F + age * 45.F + head * 8.F,
            .5F,
            sample_rate,
            head_highpass[head]);
        head_sample = biquad(
            head_sample,
            FilterType::Lowpass,
            std::max(1700.F, tone * (1.F - head * .055F) * (1.F - age * .12F)),
            .48F,
            sample_rate,
            head_lowpass[head]);
        head_sample = space_echo_curve(head_sample, age);
        wet_mono += head_sample * active_heads[head] * head_base[head];
        feedback_bus += head_sample * active_heads[head] * feedback_base[head];
      }

      float feedback_sample = biquad(
          feedback_bus,
          FilterType::Highpass,
          feedback_highpass_hz,
          .5F,
          sample_rate,
          feedback_highpass);
      feedback_sample = biquad(
          feedback_sample,
          FilterType::Lowpass,
          feedback_lowpass_hz,
          .5F,
          sample_rate,
          feedback_lowpass);
      feedback_sample = space_echo_curve(feedback_sample, age) * feedback_gain;
      record_buffer[write] = std::clamp(filtered_input + feedback_sample, -1.25F, 1.25F);
      write = (write + 1) % record_buffer.size();

      const float wet = wet_mono * kCenterPanGain;
      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
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
