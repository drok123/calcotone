#include "calcotone/stomp_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float filter_coefficient(float cutoff, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(cutoff, 10.F, rate * .45F) / rate);
}
float one_pole(float input, float& state, float coefficient) noexcept {
  state += (input - state) * coefficient;
  return state;
}
float fast_shape(float input) noexcept {
  const float x = std::clamp(input, -3.F, 3.F);
  return x * (27.F + x * x) / (27.F + 9.F * x * x);
}
float read_linear(const std::vector<float>& buffer, std::size_t write, float delay) noexcept {
  float position = static_cast<float>(write) - std::max(1.F, delay);
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto first = static_cast<std::size_t>(position) % buffer.size();
  const auto second = (first + 1U) % buffer.size();
  const float fraction = position - std::floor(position);
  return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}

struct WahState { float band{}, low{}, envelope{}; };
float state_variable_bandpass(float input, float cutoff, float q, float rate, WahState& state) noexcept {
  cutoff = std::clamp(cutoff, 70.F, rate * .35F);
  q = std::clamp(q, .35F, 10.F);
  const float g = std::tan(kPi * cutoff / rate);
  const float k = 1.F / q;
  const float a1 = 1.F / (1.F + g * (g + k));
  const float v3 = input - state.low;
  const float v1 = a1 * state.band + a1 * g * v3;
  const float v2 = state.low + g * v1;
  state.band = 2.F * v1 - state.band;
  state.low = 2.F * v2 - state.low;
  return v1;
}

struct CompressorState { float envelope{}, gain{1.F}, tone_low{}; };
}  // namespace

struct StompParityProcessor::Impl {
  struct Profile {
    float input_hz, tone_low, tone_high, gain, asymmetry, body, output, sag;
  };
  static constexpr std::array<Profile, 11> profiles{{
    {690.F,900.F,4'800.F,4.8F,.02F,.42F,.78F,.10F},
    {38.F,620.F,7'200.F,7.8F,.01F,.34F,.72F,.16F},
    {26.F,540.F,5'600.F,11.F,.04F,.72F,.64F,.24F},
    {34.F,760.F,7'800.F,8.4F,.16F,.64F,.69F,.34F},
    {42.F,720.F,6'400.F,6.7F,.06F,.38F,.70F,.14F},
    {30.F,900.F,9'600.F,4.2F,.09F,.48F,.82F,.12F},
    {72.F,820.F,8'800.F,3.8F,.03F,.54F,.86F,.08F},
    {22.F,380.F,3'900.F,12.F,.08F,.88F,.58F,.28F},
    {54.F,680.F,8'200.F,13.F,.02F,.44F,.56F,.18F},
    {48.F,840.F,8'600.F,7.2F,.18F,.42F,.66F,.20F},
    {820.F,1'200.F,11'000.F,3.2F,.12F,.24F,.90F,.18F},
  }};

  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)) {
    const auto pitch_size = static_cast<std::size_t>(rate * .065F) + 64U;
    for (auto& buffer : pitch_buffer) buffer.assign(pitch_size, 0.F);
    for (std::size_t index = 0; index < profiles.size(); ++index) {
      input_hp_coefficients[index] = filter_coefficient(profiles[index].input_hz, rate * 2.F);
    }
  }

  float clip(float x, unsigned mode, float drive, float character) noexcept {
    switch (mode) {
      case 0: return fast_shape(x * (1.7F + drive * 4.8F)) * .82F;
      case 1: return std::atan(x * (2.4F + drive * 9.F)) * .62F;
      case 2: return fast_shape(x * (4.F + drive * 14.F)) * (1.F - character * .12F);
      case 3: return fast_shape((x + .08F * character) * (3.F + drive * 12.F)) - .08F;
      case 4: return fast_shape(x * (2.6F + drive * 8.F) + x * x * .12F) * .88F;
      case 5: return x / (1.F + std::abs(x) * (1.2F + drive * 5.F));
      case 6: return fast_shape(x * (1.4F + drive * 5.F)) * .74F + x * .18F;
      case 7: return fast_shape(x * (5.F + drive * 16.F)) * .92F;
      case 8: return fast_shape(x * (4.F + drive * 18.F) + std::sin(x * 3.F) * .08F);
      case 9: return fast_shape(x * (3.F + drive * 10.F)) + std::abs(x) * character * .34F;
      case 10:return fast_shape(x * (1.2F + drive * 3.8F)) * .84F;
      default:return x;
    }
  }

  float process_wah(unsigned channel, float dry, float drive, float tone,
                    float level, float character, float body) noexcept {
    auto& state = wah[channel];
    const float magnitude = std::abs(dry);
    const float envelope_coefficient = magnitude > state.envelope
        ? .002F + character * .025F : .0004F + character * .0012F;
    state.envelope += (magnitude - state.envelope) * envelope_coefficient;
    const float sweep = .12F + drive * .82F;
    const float envelope_sweep = state.envelope * character * .78F;
    const float cutoff = 310.F + clamp01(sweep + envelope_sweep) * 2'050.F;
    const float q = .55F + body * 8.2F;
    const float band = state_variable_bandpass(dry, cutoff, q, rate, state);
    const float warm = state.low * (.10F + tone * .24F);
    return std::clamp((band * (1.45F + q * .18F) + warm) * (.42F + level * 1.24F), -1.2F, 1.2F);
  }

  float process_whammy(unsigned channel, float dry, float drive, float tone,
                       float level, float character) noexcept {
    auto& buffer = pitch_buffer[channel];
    buffer[pitch_write] = dry;
    const float grain_samples = rate * (.024F + tone * .030F);
    pitch_phase[channel] += 1.F / std::max(32.F, grain_samples);
    if (pitch_phase[channel] >= 1.F) pitch_phase[channel] -= 1.F;
    const float phase_a = pitch_phase[channel];
    float phase_b = phase_a + .5F;
    if (phase_b >= 1.F) phase_b -= 1.F;
    const float delay_a = 4.F + (1.F - phase_a) * grain_samples;
    const float delay_b = 4.F + (1.F - phase_b) * grain_samples;
    const float window_a = std::sin(phase_a * kPi);
    const float window_b = std::sin(phase_b * kPi);
    const float denominator = std::max(.15F, window_a + window_b);
    const float shifted = (read_linear(buffer, pitch_write, delay_a) * window_a
        + read_linear(buffer, pitch_write, delay_b) * window_b) / denominator;
    const float octave_amount = clamp01(character);
    const float textured = dry + (shifted - dry) * octave_amount;
    return std::clamp(fast_shape(textured * (1.F + drive * 1.6F)) * (.42F + level * 1.12F), -1.2F, 1.2F);
  }

  float process_compressor(unsigned channel, float dry, float sustain, float tone,
                           float output, float attack_control, float release_control) noexcept {
    auto& state = compressor[channel];
    const float attack = .0008F + attack_control * .032F;
    const float release = .045F + release_control * .78F;
    const float attack_coefficient = 1.F - std::exp(-1.F / (rate * attack));
    const float release_coefficient = 1.F - std::exp(-1.F / (rate * release));
    const float magnitude = std::abs(dry);
    state.envelope += (magnitude - state.envelope)
        * (magnitude > state.envelope ? attack_coefficient : release_coefficient);
    const float threshold_db = -14.F - sustain * 26.F;
    const float ratio = 3.F + sustain * 13.F;
    const float level_db = 20.F * std::log10(std::max(1e-7F, state.envelope));
    const float reduction_db = level_db > threshold_db
        ? -(level_db - threshold_db) * (1.F - 1.F / ratio) : 0.F;
    const float target_gain = std::pow(10.F, reduction_db / 20.F);
    state.gain += (target_gain - state.gain) * (target_gain < state.gain ? attack_coefficient : release_coefficient);
    const float makeup = std::pow(10.F, (sustain * 9.F + (output - .5F) * 12.F) / 20.F);
    float compressed = dry * state.gain * makeup;
    const float tone_coefficient = filter_coefficient(900.F + tone * 9'500.F, rate);
    const float low = one_pole(compressed, state.tone_low, tone_coefficient);
    compressed = low + (compressed - low) * (.62F + tone * .62F);
    return std::clamp(compressed, -1.2F, 1.2F);
  }

  void reset() noexcept {
    for (std::size_t index = 0; index < smooth.size(); ++index)
      smooth[index] = target[index].load(std::memory_order_relaxed);
    input_low.fill(0.F); tone_low_state.fill(0.F); body_low.fill(0.F);
    dc_in.fill(0.F); dc_out.fill(0.F); previous.fill(0.F); device_memory.fill(0.F);
    supply.fill(1.F); wah.fill({}); compressor.fill({});
    for (auto& buffer : pitch_buffer) std::fill(buffer.begin(), buffer.end(), 0.F);
    pitch_write = 0U; pitch_phase.fill(0.F);
  }

  void process(float* data, std::size_t frames) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .035F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      smooth[0] = target[0].load(std::memory_order_relaxed);
      for (std::size_t index = 1; index < smooth.size(); ++index)
        smooth[index] += (target[index].load(std::memory_order_relaxed) - smooth[index]) * glide;
      const unsigned mode = std::min(13U, static_cast<unsigned>(std::max(0.F, std::round(smooth[0]))));
      const float drive = clamp01(smooth[1]);
      const float tone = clamp01(smooth[2]);
      const float level = clamp01(smooth[3]);
      const float character = clamp01(smooth[4]);
      const float body = clamp01(smooth[5]);
      const float mix = clamp01(smooth[6]);

      const Profile* analog_profile = nullptr;
      float hp_g = 0.F;
      float tone_g = 0.F;
      float body_g = 0.F;
      if (mode <= 10U) {
        analog_profile = &profiles[mode];
        hp_g = input_hp_coefficients[mode];
        tone_g = filter_coefficient(
            analog_profile->tone_low + tone * (analog_profile->tone_high - analog_profile->tone_low), rate * 2.F);
        body_g = filter_coefficient(
            120.F + body * (900.F + analog_profile->body * 1'500.F), rate * 2.F);
      }

      for (unsigned channel = 0; channel < 2U; ++channel) {
        const auto index = frame * 2U + channel;
        const float dry = std::isfinite(data[index]) ? data[index] : 0.F;
        float wet = dry;
        if (mode == 11U) {
          wet = process_wah(channel, dry, drive, tone, level, character, body);
        } else if (mode == 12U) {
          wet = process_whammy(channel, dry, drive, tone, level, character);
        } else if (mode == 13U) {
          wet = process_compressor(channel, dry, drive, tone, level, character, body);
        } else {
          const Profile& profile = *analog_profile;
          const float midpoint = (previous[channel] + dry) * .5F;
          previous[channel] = dry;
          const float demand = std::abs(dry) * drive;
          supply[channel] += ((1.F - demand * profile.sag) - supply[channel])
              * (demand > .2F ? .012F : .0008F);
          const float hybrid_gain = profile.gain * (.18F + drive * .82F)
              * std::clamp(supply[channel], .58F, 1.F);
          const float bias_zero = clip(profile.asymmetry * hybrid_gain, mode, drive, character);
          const float high_mid = midpoint - one_pole(midpoint, input_low[channel], hp_g);
          const float transistor_mid = high_mid + device_memory[channel] * character * .12F + profile.asymmetry;
          const float shaped_mid = clip(transistor_mid * hybrid_gain, mode, drive, character) - bias_zero;
          const float high = dry - one_pole(dry, input_low[channel], hp_g);
          const float transistor = high + device_memory[channel] * character * .12F + profile.asymmetry;
          float shaped = (shaped_mid + clip(transistor * hybrid_gain, mode, drive, character) - bias_zero) * .5F;
          device_memory[channel] += (shaped - device_memory[channel]) * (.025F + character * .055F);
          const float low = one_pole(shaped, body_low[channel], body_g);
          shaped = low * (.68F + body * .48F) + (shaped - low) * (.72F + tone * .44F);
          wet = one_pole(shaped, tone_low_state[channel], tone_g);
          const float pre_dc = wet;
          wet = pre_dc - dc_in[channel] + .995F * dc_out[channel];
          dc_in[channel] = pre_dc;
          dc_out[channel] = wet;
          wet *= profile.output * (.48F + level * .9F);
        }
        data[index] = std::clamp(dry + (wet - dry) * mix, -1.2F, 1.2F);
      }
      pitch_write = (pitch_write + 1U) % pitch_buffer[0].size();
    }
  }

  float rate;
  std::array<float, 11> input_hp_coefficients{};
  std::array<float, 2> input_low{}, tone_low_state{}, body_low{}, dc_in{}, dc_out{};
  std::array<float, 2> previous{}, device_memory{}, supply{1.F, 1.F};
  std::array<WahState, 2> wah{};
  std::array<CompressorState, 2> compressor{};
  std::array<std::vector<float>, 2> pitch_buffer;
  std::size_t pitch_write{};
  std::array<float, 2> pitch_phase{};
  std::array<std::atomic<float>, 7> target{0.F,.38F,.54F,.68F,.42F,.52F,1.F};
  std::array<float, 7> smooth{0.F,.38F,.54F,.68F,.42F,.52F,1.F};
};

StompParityProcessor::StompParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
StompParityProcessor::~StompParityProcessor() = default;
void StompParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}
void StompParityProcessor::reset() noexcept { impl_->reset(); }
bool StompParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99U;
  if (name == "mode") index = 0U;
  else if (name == "drive") index = 1U;
  else if (name == "tone") index = 2U;
  else if (name == "level") index = 3U;
  else if (name == "character") index = 4U;
  else if (name == "body") index = 5U;
  else if (name == "mix") index = 6U;
  if (index >= impl_->target.size()) return false;
  if (index == 0U) value = std::clamp(std::round(value), 0.F, 13.F);
  else value = clamp01(value);
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
