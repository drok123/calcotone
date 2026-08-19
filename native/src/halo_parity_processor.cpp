#include "calcotone/halo_parity_processor.hpp"
#include "calcotone/halo_dual_grain_pitch_processor.hpp"
#include "calcotone/halo_parity_profiles.hpp"
#include "calcotone/halo_space_echo_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;

float clamp01(float value) noexcept {
  return std::clamp(value, 0.F, 1.F);
}

float one_pole_coefficient(float hz, float sample_rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, sample_rate * .45F) / sample_rate);
}

float one_pole(float input, float& state, float coefficient) noexcept {
  state += (input - state) * coefficient;
  return state;
}

float read_delay(const std::vector<float>& buffer, std::size_t write, float delay_samples) noexcept {
  float position = static_cast<float>(write) - delay_samples;
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto index0 = static_cast<std::size_t>(position);
  const auto index1 = (index0 + 1) % buffer.size();
  const float fraction = position - static_cast<float>(index0);
  return buffer[index0] + (buffer[index1] - buffer[index0]) * fraction;
}

float triangle_wave(float phase) noexcept {
  return (2.F / kPi) * std::asin(std::sin(phase));
}

float seeded_noise(double seed) noexcept {
  const double value = std::sin(seed * 12.9898) * 43758.5453;
  return static_cast<float>(value - std::floor(value));
}

float feedback_ceiling(unsigned mode) noexcept {
  switch (mode) {
    case 0: return .86F;
    case 3: return .82F;
    case 6: return .68F;
    case 8: return .88F;
    case 9: return .86F;
    case 10: return .82F;
    case 11: return .80F;
    default: return .79F;
  }
}

float logarithmic_cutoff(const std::array<float, 2>& range, float color) noexcept {
  const float low = std::max(10.F, range[0]);
  const float high = std::max(low, range[1]);
  return low * std::pow(high / low, clamp01(color));
}

float character_curve(float input, float character, const HaloParityProfile& profile, unsigned mode) noexcept {
  const float drive = 1.F + character * profile.saturation * 2.2F;
  const float saturated = std::tanh(input * drive) / std::max(1e-6F, drive);
  const float quantization_mix = character * profile.quantization;
  if (quantization_mix <= 1e-7F) return saturated;
  const float levels = mode == 11
      ? 32767.F
      : std::max(48.F, std::round(65536.F / (1.F + character * character * 240.F)));
  const float quantized = std::round(saturated * levels) / levels;
  return saturated * (1.F - quantization_mix) + quantized * quantization_mix;
}

float choose_constellation_pitch(float random, float character) noexcept {
  if (character < .12F) return 0.F;
  const float spread = std::pow(character, 1.4F);
  if (random < .24F + (1.F - spread) * .36F) return 0.F;
  if (random < .49F) return 7.F;
  if (random < .69F) return 12.F;
  if (random < .84F) return -5.F;
  return -12.F;
}

struct AllpassState {
  float x1{};
  float x2{};
  float y1{};
  float y2{};
};

float biquad_allpass(float input, float frequency, float q, float sample_rate, AllpassState& state) noexcept {
  const float safe_frequency = std::clamp(frequency, 20.F, sample_rate * .42F);
  const float omega = 2.F * kPi * safe_frequency / sample_rate;
  const float cosine = std::cos(omega);
  const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
  const float inverse_a0 = 1.F / (1.F + alpha);
  const float b0 = (1.F - alpha) * inverse_a0;
  const float b1 = (-2.F * cosine) * inverse_a0;
  const float b2 = 1.F;
  const float a1 = b1;
  const float a2 = b0;
  const float output = b0 * input + b1 * state.x1 + b2 * state.x2
      - a1 * state.y1 - a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

}  // namespace

struct HaloParityProcessor::Impl {
  float sample_rate;
  HaloSpaceEchoProcessor space_echo;
  HaloDualGrainPitchProcessor pitch;
  float glide_smoothing{};
  float jitter_smoothing{};
  float direct_smoothing{};
  float cross_smoothing{};
  std::size_t scatter_interval{};
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> value{1.F, .36F, .22F, .42F, .14F, .58F, .14F};
  std::array<std::vector<float>, 2> delay;
  std::array<float, 2> highpass_low{};
  std::array<float, 2> lowpass_low{};
  std::array<std::array<AllpassState, 4>, 2> diffusion{};
  std::array<float, 2> phase{};
  std::array<float, 2> jitter_target{1.F, 1.F};
  std::array<float, 2> jitter_value{1.F, 1.F};
  std::array<float, 2> fragment_target{1.F, 1.F};
  std::array<float, 2> orbit_target{};
  std::array<float, 2> direct_gain{};
  std::array<float, 2> cross_gain{};
  std::array<float, 2> pitch_semitones{};
  std::size_t write{};
  std::size_t scatter_countdown{};
  std::uint64_t sample_clock{};
  int active_mode{-1};
  bool pitch_scattered{};

  explicit Impl(float rate)
      : sample_rate(std::clamp(rate, 8000.F, 384000.F)),
        space_echo(sample_rate),
        pitch(sample_rate) {
    glide_smoothing = 1.F - std::exp(-1.F / (sample_rate * .055F));
    jitter_smoothing = 1.F - std::exp(-1.F / (sample_rate * .12F));
    direct_smoothing = 1.F - std::exp(-1.F / (sample_rate * .08F));
    cross_smoothing = 1.F - std::exp(-1.F / (sample_rate * .10F));
    scatter_interval = std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(sample_rate * .42F))) - 1;
    for (std::size_t index = 0; index < value.size(); ++index) {
      target[index].store(value[index], std::memory_order_relaxed);
    }
    const auto size = static_cast<std::size_t>(sample_rate * 6.6F) + 32;
    delay[0].assign(size, 0.F);
    delay[1].assign(size, 0.F);
    scatter_countdown = scatter_interval;
    reset_scatter_mode(1);
  }

  void reset_scatter_mode(unsigned mode) noexcept {
    const auto& profile = halo_parity_profile(std::min(11U, mode));
    const float width = clamp01(target[5].load(std::memory_order_relaxed));
    jitter_target.fill(1.F);
    jitter_value.fill(1.F);
    fragment_target.fill(1.F);
    orbit_target.fill(0.F);
    direct_gain.fill(profile.output_trim * (.52F + width * .46F));
    cross_gain.fill(profile.output_trim * ((1.F - width) * .34F));
    scatter_countdown = scatter_interval;
  }

  void run_scatter_tick(
      unsigned mode,
      const HaloParityProfile& profile,
      float seconds,
      float character) noexcept {
    if (profile.scatter <= 0.F || character < .02F) {
      jitter_target.fill(1.F);
      fragment_target.fill(1.F);
      orbit_target.fill(0.F);
      return;
    }
    const double now = static_cast<double>(sample_clock) / static_cast<double>(sample_rate);
    const float amount = profile.scatter * character;
    for (unsigned channel = 0; channel < 2; ++channel) {
      const double channel_offset = static_cast<double>(channel);
      const float jitter = 1.F + (seeded_noise(now * 2.7 + channel_offset * 31.7) - .5F) * amount;
      const float dropout = seeded_noise(now * .91 + channel_offset * 17.3);
      jitter_target[channel] = std::clamp(jitter, .25F, 1.75F);
      fragment_target[channel] = dropout < amount * (.16F + profile.reverse_chance * .22F) ? .16F : 1.F;
      orbit_target[channel] = profile.orbit_depth * character
          * std::sin(static_cast<float>(now * .73 + channel_offset * static_cast<double>(kPi)));
      if (mode == 6 || mode == 11) {
        const float choice = choose_constellation_pitch(
            seeded_noise(now * 1.37 + channel_offset * 43.1), character);
        pitch_semitones[channel] = channel == 0 ? choice : -choice * .72F;
        pitch_scattered = true;
      }
    }
    (void)seconds;
  }

  void glide() noexcept {
    value[0] = target[0].load(std::memory_order_relaxed);
    for (std::size_t index = 1; index < value.size(); ++index) {
      value[index] += (target[index].load(std::memory_order_relaxed) - value[index]) * glide_smoothing;
    }
  }

  void reset_pitch_mode(unsigned mode) noexcept {
    pitch.reset();
    pitch_semitones[0] = mode == 11 ? 5.F : 7.F;
    pitch_semitones[1] = -5.F;
    pitch_scattered = false;
  }

  void clear_general_state() noexcept {
    for (auto& channel : delay) std::fill(channel.begin(), channel.end(), 0.F);
    highpass_low.fill(0.F);
    lowpass_low.fill(0.F);
    for (auto& channel : diffusion) channel.fill({});
    phase.fill(0.F);
    jitter_target.fill(1.F);
    jitter_value.fill(1.F);
    fragment_target.fill(1.F);
    orbit_target.fill(0.F);
    direct_gain.fill(0.F);
    cross_gain.fill(0.F);
    write = 0;
    sample_clock = 0;
    pitch.reset();
    scatter_countdown = scatter_interval;
    pitch_scattered = false;
  }

  void process(float* data, std::size_t frames) noexcept {
    const int requested_mode = std::clamp(
        static_cast<int>(std::lround(target[0].load(std::memory_order_relaxed))), 0, 11);
    if (requested_mode != active_mode) {
      if (requested_mode == 7) {
        space_echo.reset();
      } else if (active_mode == 7) {
        clear_general_state();
        for (std::size_t index = 1; index < value.size(); ++index) {
          value[index] = target[index].load(std::memory_order_relaxed);
        }
      }
      if (requested_mode != 7) {
        reset_scatter_mode(static_cast<unsigned>(requested_mode));
        if (requested_mode == 6 || requested_mode == 11) {
          reset_pitch_mode(static_cast<unsigned>(requested_mode));
        } else {
          pitch.reset();
          pitch_scattered = false;
        }
      }
      active_mode = requested_mode;
    }

    if (requested_mode == 7) {
      space_echo.set_parameter("time", target[1].load(std::memory_order_relaxed));
      space_echo.set_parameter("feedback", target[2].load(std::memory_order_relaxed));
      space_echo.set_parameter("color", target[3].load(std::memory_order_relaxed));
      space_echo.set_parameter("character", target[4].load(std::memory_order_relaxed));
      space_echo.set_parameter("width", target[5].load(std::memory_order_relaxed));
      space_echo.set_parameter("mix", target[6].load(std::memory_order_relaxed));
      space_echo.process(data, frames);
      return;
    }

    for (std::size_t frame = 0; frame < frames; ++frame) {
      glide();
      const unsigned mode = std::min(11U, static_cast<unsigned>(std::lround(value[0])));
      const auto& profile = halo_parity_profile(mode);
      const float seconds = std::clamp(value[1], .03F, 6.2F);
      const float feedback = std::clamp(value[2], 0.F, .9F);
      const float color = clamp01(value[3]);
      const float character = clamp01(value[4]);
      const float width = clamp01(value[5]);
      const float mix = clamp01(value[6]);

      const float normalized_feedback = clamp01(feedback / .9F);
      const float loop = feedback_ceiling(mode) * std::pow(normalized_feedback, 1.45F);
      const float highpass_hz = profile.highpass + (1.F - color) * 95.F;
      const float base_lowpass_hz = logarithmic_cutoff(profile.lowpass_range, color);
      const float highpass_coefficient = one_pole_coefficient(highpass_hz, sample_rate);
      const float direct_width = .52F + width * .46F;
      const float cross_width = (1.F - width) * .34F;
      const float modulation_character = std::pow(character, 1.55F);
      const float hardware_modulation = mode == 10 ? .35F + width * .95F : 1.F;

      if (profile.scatter > 0.F) {
        if (scatter_countdown == 0) {
          run_scatter_tick(mode, profile, seconds, character);
          scatter_countdown = scatter_interval;
        } else {
          --scatter_countdown;
        }
      } else {
        jitter_target.fill(1.F);
        fragment_target.fill(1.F);
        orbit_target.fill(0.F);
      }
      if (character < .02F) {
        jitter_target.fill(1.F);
        fragment_target.fill(1.F);
        orbit_target.fill(0.F);
      }
      for (unsigned channel = 0; channel < 2; ++channel) {
        jitter_value[channel] += (jitter_target[channel] - jitter_value[channel]) * jitter_smoothing;
        const float positive_orbit = std::max(0.F, orbit_target[channel]);
        const float desired_direct = profile.output_trim * direct_width * fragment_target[channel]
            * (1.F - positive_orbit * .36F);
        const float desired_cross = profile.output_trim * (cross_width + positive_orbit * .31F);
        direct_gain[channel] += (desired_direct - direct_gain[channel]) * direct_smoothing;
        cross_gain[channel] += (desired_cross - cross_gain[channel]) * cross_smoothing;
      }

      const std::array<float, 2> dry{data[frame * 2], data[frame * 2 + 1]};
      std::array<float, 2> precolor{};
      std::array<float, 2> tap{};

      for (unsigned channel = 0; channel < 2; ++channel) {
        phase[channel] += 2.F * kPi * profile.flutter_rates[channel] / sample_rate;
        if (phase[channel] >= 2.F * kPi) phase[channel] -= 2.F * kPi;
        const float waveform = channel == 0 ? std::sin(phase[channel]) : triangle_wave(phase[channel]);
        const float polarity = channel == 0 ? 1.F : -.82F;
        const float modulation_seconds = waveform * profile.flutter_depth * hardware_modulation
            * modulation_character * polarity;
        const float delay_seconds = std::clamp(
            seconds * profile.time_ratios[channel] * jitter_value[channel] + modulation_seconds, .015F, 6.35F);
        const float delay_samples = delay_seconds * sample_rate;
        float wet = read_delay(delay[channel], write, delay_samples);

        const float high = wet - one_pole(wet, highpass_low[channel], highpass_coefficient);
        const float channel_lowpass_hz = base_lowpass_hz * (channel == 0 ? 1.F : .94F);
        wet = one_pole(high, lowpass_low[channel], one_pole_coefficient(channel_lowpass_hz, sample_rate));
        for (unsigned stage = 0; stage < profile.diffusion_stages && stage < 4; ++stage) {
          const float frequency = profile.diffusion_base + static_cast<float>(stage) * 390.F
              + character * 1450.F + static_cast<float>(channel) * 83.F;
          const float q = .45F + character * (.8F + static_cast<float>(stage) * .13F);
          wet = biquad_allpass(wet, frequency, q, sample_rate, diffusion[channel][stage]);
        }
        precolor[channel] = wet;
      }

      if (mode == 6 || mode == 11) {
        const float exponent = pitch_scattered ? 1.28F : 1.35F;
        const float pitch_amount = profile.pitch_scatter * std::pow(character, exponent);
        pitch.set_pitch(0, pitch_semitones[0], pitch_amount);
        pitch.set_pitch(1, pitch_semitones[1], pitch_amount);
        pitch.process_frame(precolor[0], precolor[1], precolor[0], precolor[1]);
      }

      for (unsigned channel = 0; channel < 2; ++channel) {
        tap[channel] = character_curve(precolor[channel], character, profile, mode);
      }

      for (unsigned channel = 0; channel < 2; ++channel) {
        const unsigned other = 1U - channel;
        const float feedback_sample = loop * (
            tap[channel] * profile.same_feedback + tap[other] * profile.cross_feedback);
        delay[channel][write] = std::clamp(dry[channel] * profile.input_trim + feedback_sample, -1.25F, 1.25F);
      }

      const float wet_left = tap[0] * direct_gain[0] + tap[1] * cross_gain[1];
      const float wet_right = tap[1] * direct_gain[1] + tap[0] * cross_gain[0];

      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      data[frame * 2] = std::clamp(dry[0] * dry_gain + wet_left * wet_gain, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry[1] * dry_gain + wet_right * wet_gain, -1.2F, 1.2F);
      write = (write + 1) % delay[0].size();
      ++sample_clock;
    }
  }
};

HaloParityProcessor::HaloParityProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
HaloParityProcessor::~HaloParityProcessor() = default;

void HaloParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}

bool HaloParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "algorithm") index = 0;
  else if (name == "time") index = 1;
  else if (name == "feedback") index = 2;
  else if (name == "color") index = 3;
  else if (name == "character") index = 4;
  else if (name == "width") index = 5;
  else if (name == "mix") index = 6;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

void HaloParityProcessor::reset() noexcept {
  impl_->clear_general_state();
  impl_->space_echo.reset();
}

}  // namespace calcotone
