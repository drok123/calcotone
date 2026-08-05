from pathlib import Path

HEADER = r'''#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone {

struct AtmosParityProfile {
  std::string_view id;
  std::array<float, 12> line_times{};
  std::size_t line_count{};
  std::array<float, 12> modulation_rates{};
  std::array<float, 2> predelay{};
  std::array<float, 2> size_range{};
  float decay_bias{};
  float damping_bias{};
  float diffusion_bias{};
  float modulation_depth{};
  float cross_amount{};
  float output_trim{};
  float input_trim{};
  float highpass{};
  int converter_bits{};
  float converter_lowpass{};
  float split_decay{};
  float plate_dispersion{};
};

struct AtmosEarlyProfile {
  std::array<float, 5> times{};
  std::size_t count{};
  float early_level{};
  float late_level{};
  float lowpass{};
  float threshold{};
  float ratio{};
  float attack{};
  float release{};
};

// Exact model identity, ordering, and canonical calibration data copied from
// src/audio/effects/Reverb.ts. Native Atmos consumes this table directly.
inline constexpr std::array<AtmosParityProfile, 12> kAtmosParityProfiles{{
  {"room", {0.0137F,0.0173F,0.0199F,0.0239F,0.0293F,0.0317F}, 6,
    {0.19F,0.27F,0.31F,0.37F,0.43F,0.53F}, {0.004F,0.006F}, {0.58F,1.42F},
    0.72F,1.08F,0.72F,0.00022F,0.035F,0.42F,0.82F,150.F},
  {"plate", {0.0211F,0.0263F,0.0307F,0.0349F,0.0397F,0.0451F,0.0511F,0.0577F}, 8,
    {0.23F,0.29F,0.41F,0.47F,0.59F,0.67F,0.73F,0.83F}, {0.008F,0.011F}, {0.72F,1.72F},
    0.94F,1.28F,1.16F,0.00052F,0.062F,0.31F,0.74F,190.F},
  {"hall", {0.0311F,0.0379F,0.0437F,0.0499F,0.0571F,0.0643F,0.0719F,0.0817F}, 8,
    {0.13F,0.17F,0.23F,0.29F,0.37F,0.43F,0.53F,0.61F}, {0.014F,0.019F}, {0.74F,2.12F},
    1.00F,0.94F,0.98F,0.00072F,0.075F,0.28F,0.70F,130.F},
  {"cinema", {0.0413F,0.0491F,0.0577F,0.0671F,0.0787F,0.0911F,0.1049F,0.1193F,0.1349F,0.1511F}, 10,
    {0.07F,0.11F,0.13F,0.17F,0.19F,0.23F,0.29F,0.31F,0.37F,0.41F}, {0.024F,0.033F}, {0.82F,2.48F},
    1.22F,0.72F,1.05F,0.00105F,0.094F,0.23F,0.62F,105.F},
  {"cloud", {0.0271F,0.0331F,0.0391F,0.0461F,0.0541F,0.0631F,0.0731F,0.0841F,0.0961F,0.1091F,0.1231F,0.1381F}, 12,
    {0.09F,0.12F,0.16F,0.21F,0.26F,0.32F,0.39F,0.47F,0.56F,0.66F,0.77F,0.89F}, {0.018F,0.027F}, {0.68F,2.28F},
    1.38F,0.84F,1.28F,0.00180F,0.110F,0.20F,0.56F,170.F},
  {"freeze", {0.0431F,0.0523F,0.0629F,0.0749F,0.0883F,0.1031F,0.1193F,0.1373F}, 8,
    {0.05F,0.07F,0.09F,0.11F,0.13F,0.17F,0.19F,0.23F}, {0.012F,0.017F}, {0.90F,2.15F},
    4.50F,0.52F,1.35F,0.00090F,0.130F,0.22F,0.18F,210.F},
  {"celestial", {0.0239F,0.0311F,0.0401F,0.0503F,0.0629F,0.0779F,0.0953F,0.1151F,0.1373F,0.1613F,0.1871F,0.2141F}, 12,
    {0.047F,0.061F,0.079F,0.101F,0.127F,0.157F,0.193F,0.233F,0.277F,0.331F,0.389F,0.457F}, {0.028F,0.041F}, {0.82F,2.62F},
    1.72F,1.42F,1.48F,0.00260F,0.140F,0.17F,0.48F,240.F},
  {"aurora", {0.0197F,0.0277F,0.0367F,0.0479F,0.0613F,0.0773F,0.0961F,0.1177F,0.1423F,0.1699F}, 10,
    {0.071F,0.097F,0.131F,0.173F,0.223F,0.281F,0.347F,0.421F,0.503F,0.593F}, {0.016F,0.029F}, {0.70F,2.45F},
    1.46F,1.12F,1.34F,0.00380F,0.160F,0.18F,0.50F,185.F},
  {"nebula", {0.0353F,0.0449F,0.0563F,0.0697F,0.0851F,0.1027F,0.1223F,0.1441F,0.1681F,0.1943F,0.2227F,0.2531F}, 12,
    {0.031F,0.043F,0.059F,0.077F,0.101F,0.131F,0.167F,0.211F,0.263F,0.323F,0.391F,0.467F}, {0.036F,0.050F}, {0.95F,2.85F},
    2.15F,0.76F,1.58F,0.00440F,0.180F,0.145F,0.42F,155.F},
  {"abyss", {0.0481F,0.0593F,0.0727F,0.0883F,0.1061F,0.1261F,0.1483F,0.1727F,0.1993F,0.2281F}, 10,
    {0.029F,0.037F,0.047F,0.061F,0.079F,0.101F,0.127F,0.157F,0.193F,0.233F}, {0.019F,0.031F}, {1.00F,3.00F},
    1.90F,0.38F,1.18F,0.00150F,0.170F,0.15F,0.44F,58.F},
  {"emt140", {0.0119F,0.0157F,0.0193F,0.0233F,0.0277F,0.0329F,0.0383F,0.0449F,0.0521F,0.0601F,0.0691F,0.0793F}, 12,
    {0.031F,0.037F,0.043F,0.047F,0.053F,0.059F,0.067F,0.071F,0.079F,0.083F,0.089F,0.097F}, {0.0035F,0.0052F}, {0.94F,1.08F},
    1.00F,1.34F,1.62F,0.00000F,0.105F,0.19F,0.31F,115.F,0,0.F,0.16F,1.0F},
  {"lexicon224", {0.0247F,0.0311F,0.0389F,0.0473F,0.0571F,0.0683F,0.0811F,0.0953F,0.1117F,0.1301F}, 10,
    {0.071F,0.089F,0.113F,0.137F,0.173F,0.211F,0.257F,0.307F,0.367F,0.433F}, {0.024F,0.031F}, {0.78F,2.20F},
    1.12F,0.72F,1.24F,0.00082F,0.120F,0.21F,0.58F,145.F,12,8800.F,0.34F,0.F},
}};

inline constexpr std::array<AtmosEarlyProfile, 12> kAtmosEarlyProfiles{{
  {{0.0032F,0.0068F,0.0114F,0.0179F,0.0256F},5,0.76F,0.63F,13200.F,-25.F,3.4F,0.002F,0.13F},
  {{0.0048F,0.0097F,0.0163F,0.0248F},4,0.42F,0.76F,11800.F,-21.F,2.6F,0.0015F,0.16F},
  {{0.0065F,0.0138F,0.0229F,0.0344F,0.0481F},5,0.58F,0.67F,12400.F,-24.F,3.8F,0.0025F,0.19F},
  {{0.009F,0.019F,0.032F,0.049F,0.071F},5,0.48F,0.65F,11200.F,-23.F,4.2F,0.003F,0.24F},
  {{0.008F,0.017F,0.029F,0.045F},4,0.34F,0.69F,10500.F,-25.F,4.4F,0.0025F,0.27F},
  {{0.011F,0.024F,0.041F},3,0.18F,0.80F,9200.F,-28.F,5.0F,0.004F,0.34F},
  {{0.010F,0.021F,0.036F,0.055F},4,0.30F,0.68F,11600.F,-25.F,4.8F,0.003F,0.29F},
  {{0.007F,0.015F,0.026F,0.040F,0.059F},5,0.38F,0.68F,12800.F,-24.F,4.4F,0.0025F,0.25F},
  {{0.012F,0.026F,0.044F,0.067F},4,0.27F,0.67F,9800.F,-26.F,5.1F,0.0035F,0.31F},
  {{0.014F,0.030F,0.051F,0.076F},4,0.24F,0.66F,7600.F,-26.F,5.2F,0.004F,0.33F},
  {{0.0037F,0.0076F,0.0128F,0.0196F},4,0.31F,0.79F,10600.F,-20.F,2.4F,0.0012F,0.15F},
  {{0.007F,0.0148F,0.0245F,0.037F,0.052F},5,0.45F,0.72F,8400.F,-23.F,3.4F,0.002F,0.22F},
}};

inline constexpr const AtmosParityProfile& atmos_parity_profile(std::size_t index) noexcept {
  return kAtmosParityProfiles[index < kAtmosParityProfiles.size() ? index : 0];
}
inline constexpr const AtmosEarlyProfile& atmos_early_profile(std::size_t index) noexcept {
  return kAtmosEarlyProfiles[index < kAtmosEarlyProfiles.size() ? index : 0];
}

}  // namespace calcotone
'''

PROCESSOR = r'''#include "calcotone/atmos_parity_processor.hpp"
#include "calcotone/atmos_parity_profiles.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <memory>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kMaxLines = 12;
constexpr std::size_t kMaxEarly = 5;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float smooth_coefficient(float seconds, float rate) noexcept {
  return 1.F - std::exp(-1.F / std::max(1.F, seconds * rate));
}
float filter_coefficient(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, rate * .45F) / rate);
}
float one_pole(float input, float& state, float coefficient) noexcept {
  state += (input - state) * coefficient;
  return state;
}
float highpass(float input, float& low_state, float coefficient) noexcept {
  return input - one_pole(input, low_state, coefficient);
}
float read_linear(const std::vector<float>& buffer, std::size_t write, float delay_samples) noexcept {
  float position = static_cast<float>(write) - std::max(1.F, delay_samples);
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto first = static_cast<std::size_t>(position) % buffer.size();
  const auto second = (first + 1U) % buffer.size();
  const float fraction = position - std::floor(position);
  return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}
float triangle_wave(float phase) noexcept {
  return (2.F / kPi) * std::asin(std::sin(phase));
}
float output_polarity(std::size_t index) noexcept {
  return index % 4U == 1U || index % 4U == 2U ? -1.F : 1.F;
}
float loop_saturate(float input) noexcept {
  return input - .035F * input * input * input;
}
float converter_texture(float input, int bits) noexcept {
  if (bits <= 0) return input;
  const float x = std::clamp(input, -1.F, 1.F);
  const float levels = std::pow(2.F, static_cast<float>(std::max(4, bits) - 1));
  const float stepped = std::round(x * levels) / levels;
  const float gain_step = std::round(std::abs(x) * 15.F) / 15.F;
  return std::clamp(stepped * (.998F - gain_step * .0045F), -1.F, 1.F);
}

struct AllpassState { float x1{}, x2{}, y1{}, y2{}; };
float allpass(float input, float frequency, float q, float rate, AllpassState& state) noexcept {
  const float safe_frequency = std::clamp(frequency, 20.F, rate * .42F);
  const float omega = 2.F * kPi * safe_frequency / rate;
  const float cosine = std::cos(omega);
  const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
  const float inverse_a0 = 1.F / (1.F + alpha);
  const float b0 = (1.F - alpha) * inverse_a0;
  const float b1 = (-2.F * cosine) * inverse_a0;
  const float b2 = 1.F;
  const float a1 = b1;
  const float a2 = b0;
  const float output = b0 * input + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
  state.x2 = state.x1; state.x1 = input; state.y2 = state.y1; state.y1 = output;
  return output;
}

struct CompressorState { float gain{1.F}; };
float compress_sample(
    float input, float threshold, float ratio, float attack, float release,
    float rate, CompressorState& state) noexcept {
  const float level_db = 20.F * std::log10(std::max(1e-8F, std::abs(input)));
  constexpr float knee = 12.F;
  float output_db = level_db;
  if (level_db > threshold + knee * .5F) {
    output_db = threshold + (level_db - threshold) / std::max(1.F, ratio);
  } else if (level_db > threshold - knee * .5F) {
    const float distance = level_db - (threshold - knee * .5F);
    output_db = level_db + (1.F / std::max(1.F, ratio) - 1.F) * distance * distance / (2.F * knee);
  }
  const float target_gain = std::pow(10.F, (output_db - level_db) / 20.F);
  const float time = target_gain < state.gain ? attack : release;
  state.gain += (target_gain - state.gain) * smooth_coefficient(std::max(.0002F, time), rate);
  return input * state.gain;
}

struct AtmosControls {
  float decay{2.4F};
  float size{.52F};
  float color{.42F};
  float diffusion{.74F};
  float motion{.18F};
};

class AtmosNetwork {
 public:
  AtmosNetwork(float rate, std::size_t model)
      : rate_(rate), model_(std::min<std::size_t>(11U, model)) {
    const auto line_capacity = static_cast<std::size_t>(rate_ * .90F) + 64U;
    for (auto& line : lines_) line.assign(line_capacity, 0.F);
    const auto predelay_capacity = static_cast<std::size_t>(rate_ * .075F) + 16U;
    for (auto& buffer : predelay_) buffer.assign(predelay_capacity, 0.F);
    const auto early_capacity = static_cast<std::size_t>(rate_ * .22F) + 16U;
    for (auto& buffer : early_history_) buffer.assign(early_capacity, 0.F);
  }

  void reset() noexcept {
    for (auto& line : lines_) std::fill(line.begin(), line.end(), 0.F);
    for (auto& buffer : predelay_) std::fill(buffer.begin(), buffer.end(), 0.F);
    for (auto& buffer : early_history_) std::fill(buffer.begin(), buffer.end(), 0.F);
    write_.fill(0U); predelay_write_ = 0U; early_write_ = 0U;
    diffuser_state_.fill({}); damping_state_.fill(0.F); loop_hp_low_.fill(0.F); phase_.fill(0.F);
    input_hp_low_.fill(0.F); input_lp_state_.fill(0.F); early_filter_state_.fill(0.F);
    early_bus_state_.fill(0.F); late_converter_state_.fill(0.F); compressor_state_.fill({});
  }

  std::array<float, 2> process_frame(const std::array<float, 2>& input, const AtmosControls& controls) noexcept {
    const auto& profile = atmos_parity_profile(model_);
    const auto& early_profile = atmos_early_profile(model_);
    const float size = clamp01(controls.size);
    const float color = clamp01(controls.color);
    const float diffusion = clamp01(controls.diffusion);
    const float motion = clamp01(controls.motion);
    const float decay = std::clamp(controls.decay, .35F, 16.F);
    const float shaped_size = std::pow(size, 1.35F);
    const float size_scale = profile.size_range[0] + shaped_size * (profile.size_range[1] - profile.size_range[0]);
    const float normalized_decay = clamp01(std::log(std::max(.35F, decay) / .35F) / std::log(16.F / .35F));
    const float effective_decay = model_ == 10U ? .5F + normalized_decay * 5.F
                                                : std::max(.25F, decay * profile.decay_bias);
    const float color_cutoff = 1700.F * std::pow(10.2F, color) * profile.damping_bias;
    const bool freeze = model_ == 5U;
    const float loop_budget = freeze ? .958F : .875F;
    const float cross_magnitude = std::min(freeze ? .016F : .034F,
        profile.cross_amount * (.14F + diffusion * .22F));

    std::array<float, 2> converted{};
    for (unsigned channel = 0; channel < 2; ++channel) {
      converted[channel] = converter_texture(input[channel] * profile.input_trim, profile.converter_bits);
    }

    std::array<float, 2> predelayed{};
    const float input_lowpass_hz = profile.converter_lowpass > 0.F ? profile.converter_lowpass : 16'000.F;
    const float input_hp_coefficient = filter_coefficient(profile.highpass, rate_);
    const float input_lp_coefficient = filter_coefficient(input_lowpass_hz, rate_);
    for (unsigned channel = 0; channel < 2; ++channel) {
      const float source = model_ == 10U ? converted[0] + converted[1] : converted[channel];
      const float filtered = one_pole(highpass(source, input_hp_low_[channel], input_hp_coefficient),
                                      input_lp_state_[channel], input_lp_coefficient);
      predelay_[channel][predelay_write_] = filtered;
      const float predelay_seconds = std::min(.05F, profile.predelay[channel] * (1.F + size * .72F));
      predelayed[channel] = read_linear(predelay_[channel], predelay_write_, predelay_seconds * rate_);
      early_history_[channel][early_write_] = predelayed[channel];
    }

    const float threshold_base = early_profile.threshold + diffusion * 2.5F - motion * 1.5F;
    const float ratio = early_profile.ratio + diffusion * 1.15F + motion * .45F;
    const float attack = std::max(.001F, early_profile.attack * (1.05F - motion * .35F));
    const float release = early_profile.release * (.82F + normalized_decay * .52F + size * .18F);
    std::array<float, 2> compressed{};
    for (unsigned channel = 0; channel < 2; ++channel) {
      compressed[channel] = compress_sample(predelayed[channel], threshold_base + static_cast<float>(channel) * .35F,
          ratio, attack, release, rate_, compressor_state_[channel]);
    }

    std::array<float, 2> early{};
    for (std::size_t index = 0; index < early_profile.count; ++index) {
      const unsigned source_channel = static_cast<unsigned>(index % 2U);
      const unsigned destination_channel = index < 2U ? source_channel : 1U - source_channel;
      const float delay_seconds = early_profile.times[index] * (.72F + size * .82F);
      float tap = read_linear(early_history_[source_channel], early_write_, delay_seconds * rate_);
      const float cutoff = std::clamp(early_profile.lowpass * (.52F + color * .62F)
          * (1.F - static_cast<float>(index) * .045F), 2800.F, 18'000.F);
      tap = one_pole(tap, early_filter_state_[index], filter_coefficient(cutoff, rate_));
      const float contour = (1.F - static_cast<float>(index) * .085F) * (.92F + diffusion * .08F)
          / std::sqrt(static_cast<float>(early_profile.count));
      early[destination_channel] += tap * contour;
    }
    const float early_bus_cutoff = std::clamp(early_profile.lowpass * (.58F + color * .58F), 3400.F, 18'000.F);
    for (unsigned channel = 0; channel < 2; ++channel) {
      early[channel] = one_pole(early[channel], early_bus_state_[channel], filter_coefficient(early_bus_cutoff, rate_));
    }

    std::array<float, kMaxLines> raw{};
    std::array<float, kMaxLines> loop_signal{};
    std::array<float, kMaxLines> excitation{};
    std::array<float, kMaxLines> self_feedback{};
    std::array<float, kMaxLines> cross_gain{};
    std::array<float, kMaxLines> cross_injection{};
    std::array<float, 2> late{};
    const float density_scale = .9F + diffusion * .1F;
    const float diffusion_amount = std::min(1.5F, diffusion * profile.diffusion_bias);
    const float decay_norm = std::min(1.F, std::log2(1.F + effective_decay) / std::log2(17.F));
    const float energy_trim = 1.F / std::sqrt(1.F + decay_norm * .58F + diffusion * .25F + size * .18F);
    const float base_output = profile.output_trim / std::sqrt(static_cast<float>(std::max<std::size_t>(1U, profile.line_count / 2U)));

    for (std::size_t index = 0; index < profile.line_count; ++index) {
      const float line_time = profile.line_times[index] * size_scale * density_scale;
      const float base_rate = profile.modulation_rates[index];
      const float lfo_rate = base_rate * (.9F + size * .18F)
          * (1.F + motion * (.028F + static_cast<float>(index % 5U) * .008F));
      phase_[index] += 2.F * kPi * lfo_rate / rate_;
      if (phase_[index] >= 2.F * kPi) phase_[index] -= 2.F * kPi;
      const float waveform = index % 3U == 0U ? std::sin(phase_[index]) : triangle_wave(phase_[index]);
      const float requested_modulation = profile.modulation_depth * motion * (.56F + static_cast<float>(index) * .04F);
      const float modulation_amount = std::min(requested_modulation, std::max(.00002F, line_time * .015F));
      const float delay_seconds = std::clamp(line_time + waveform * modulation_amount, .001F, .86F);
      raw[index] = read_linear(lines_[index], write_[index], delay_seconds * rate_);

      const float diffuser_frequency = (profile.plate_dispersion > 0.F ? 720.F : 460.F)
          + diffusion_amount * (profile.plate_dispersion > 0.F ? 2200.F : 1550.F)
          + static_cast<float>(index) * (profile.plate_dispersion > 0.F ? 113.F : 91.F);
      const float diffuser_q = (profile.plate_dispersion > 0.F ? .5F : .25F)
          + diffusion_amount * (1.02F + static_cast<float>(index) * .03F);
      excitation[index] = allpass(compressed[index % 2U], diffuser_frequency, diffuser_q,
                                  rate_, diffuser_state_[index]);

      const float plate_tilt = profile.plate_dispersion > 0.F
          ? 1.F - static_cast<float>(index) / static_cast<float>(std::max<std::size_t>(1U, profile.line_count - 1U)) * .18F
          : 1.F;
      const float damping_hz = std::clamp(color_cutoff * (1.F - static_cast<float>(index) * .014F) * plate_tilt,
          1000.F, profile.converter_lowpass > 0.F ? profile.converter_lowpass : 19'000.F);
      const float damped = one_pole(raw[index], damping_state_[index], filter_coefficient(damping_hz, rate_));
      const float loop_highpass_hz = std::clamp(profile.highpass * (.48F + (1.F - size) * .3F)
          + static_cast<float>(index) * 1.9F, 36.F, 340.F);
      loop_signal[index] = loop_saturate(highpass(damped, loop_hp_low_[index],
          filter_coefficient(loop_highpass_hz, rate_)));

      const float split_position = static_cast<float>(index)
          / static_cast<float>(std::max<std::size_t>(1U, profile.line_count - 1U));
      const float spectral_decay_scale = 1.F + profile.split_decay * (split_position - .5F)
          * (.7F + (1.F - color) * .6F);
      const float line_decay = std::pow(.001F, line_time / std::max(.18F, effective_decay * spectral_decay_scale));
      const float spread = .988F - static_cast<float>(index) * .0019F;
      self_feedback[index] = std::min(loop_budget - cross_magnitude - .042F,
          std::max(.18F, line_decay * spread));
      cross_gain[index] = cross_magnitude * (index % 4U < 2U ? 1.F : -1.F);
      late[index % 2U] += raw[index] * output_polarity(index) * base_output * energy_trim;
    }

    const std::size_t cross_offset = std::max<std::size_t>(3U, profile.line_count / 2U);
    for (std::size_t index = 0; index < profile.line_count; ++index) {
      const std::size_t destination = (index + cross_offset) % profile.line_count;
      cross_injection[destination] += raw[index] * cross_gain[index];
    }
    for (std::size_t index = 0; index < profile.line_count; ++index) {
      const float write_value = excitation[index] + loop_signal[index] * self_feedback[index]
          + cross_injection[index];
      lines_[index][write_[index]] = std::clamp(write_value, -1.35F, 1.35F);
      write_[index] = (write_[index] + 1U) % lines_[index].size();
    }

    const float converter_cutoff = profile.converter_lowpass > 0.F
        ? profile.converter_lowpass * (.80F + color * .20F) : 19'000.F;
    for (unsigned channel = 0; channel < 2; ++channel) {
      late[channel] = one_pole(late[channel], late_converter_state_[channel],
                               filter_coefficient(converter_cutoff, rate_));
      late[channel] = converter_texture(late[channel], profile.converter_bits);
    }

    const float early_presence = early_profile.early_level * (1.12F - size * .24F)
        * (1.08F - diffusion * .18F);
    const float late_presence = early_profile.late_level * (.88F + diffusion * .16F)
        / std::sqrt(1.F + normalized_decay * .58F + size * .24F);
    predelay_write_ = (predelay_write_ + 1U) % predelay_[0].size();
    early_write_ = (early_write_ + 1U) % early_history_[0].size();
    return {early[0] * early_presence + late[0] * late_presence,
            early[1] * early_presence + late[1] * late_presence};
  }

 private:
  float rate_;
  std::size_t model_;
  std::array<std::vector<float>, kMaxLines> lines_;
  std::array<std::vector<float>, 2> predelay_;
  std::array<std::vector<float>, 2> early_history_;
  std::array<std::size_t, kMaxLines> write_{};
  std::size_t predelay_write_{};
  std::size_t early_write_{};
  std::array<AllpassState, kMaxLines> diffuser_state_{};
  std::array<float, kMaxLines> damping_state_{};
  std::array<float, kMaxLines> loop_hp_low_{};
  std::array<float, kMaxLines> phase_{};
  std::array<float, 2> input_hp_low_{};
  std::array<float, 2> input_lp_state_{};
  std::array<float, kMaxEarly> early_filter_state_{};
  std::array<float, 2> early_bus_state_{};
  std::array<float, 2> late_converter_state_{};
  std::array<CompressorState, 2> compressor_state_{};
};
}  // namespace

struct AtmosParityProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        active(std::make_unique<AtmosNetwork>(rate, 2U)),
        fade_total(std::max<std::size_t>(1U, static_cast<std::size_t>(std::lround(rate * .82F)))) {}

  AtmosControls controls() const noexcept {
    return {smooth[1], smooth[2], smooth[3], smooth[4], smooth[5]};
  }

  void reset() noexcept {
    for (std::size_t index = 0; index < smooth.size(); ++index)
      smooth[index] = target[index].load(std::memory_order_relaxed);
    active_model = std::min<std::size_t>(11U, static_cast<std::size_t>(std::max(0.F, std::round(smooth[0]))));
    active = std::make_unique<AtmosNetwork>(rate, active_model);
    retiring.reset();
    fade_position = 0U;
    processed_frames = 0U;
  }

  void switch_model(std::size_t requested, const AtmosControls& current) {
    requested = std::min<std::size_t>(11U, requested);
    if (requested == active_model) return;
    if (processed_frames == 0U) {
      active = std::make_unique<AtmosNetwork>(rate, requested);
      retiring.reset();
    } else {
      retiring = std::move(active);
      retiring_controls = current;
      active = std::make_unique<AtmosNetwork>(rate, requested);
      fade_position = 0U;
    }
    active_model = requested;
  }

  void process(float* data, std::size_t frames) noexcept {
    static constexpr std::array<float, 7> smoothing_seconds{0.F,.06F,.06F,.05F,.05F,.08F,.025F};
    for (std::size_t frame = 0; frame < frames; ++frame) {
      smooth[0] = target[0].load(std::memory_order_relaxed);
      for (std::size_t index = 1; index < smooth.size(); ++index) {
        const float coefficient = smooth_coefficient(smoothing_seconds[index], rate);
        smooth[index] += (target[index].load(std::memory_order_relaxed) - smooth[index]) * coefficient;
      }
      const auto requested_model = std::min<std::size_t>(11U,
          static_cast<std::size_t>(std::max(0.F, std::round(smooth[0]))));
      const AtmosControls current = controls();
      switch_model(requested_model, current);

      const std::array<float, 2> dry{data[frame * 2], data[frame * 2 + 1]};
      const auto active_wet = active->process_frame(dry, current);
      std::array<float, 2> wet = active_wet;
      if (retiring) {
        const float t = std::min(1.F, static_cast<float>(fade_position + 1U) / static_cast<float>(fade_total));
        const float active_gain = std::sin(t * kPi * .5F);
        const float retiring_gain = std::cos(t * kPi * .5F);
        const auto retiring_wet = retiring->process_frame(dry, retiring_controls);
        wet[0] = active_wet[0] * active_gain + retiring_wet[0] * retiring_gain;
        wet[1] = active_wet[1] * active_gain + retiring_wet[1] * retiring_gain;
        if (++fade_position >= fade_total) retiring.reset();
      }

      const float mix = clamp01(smooth[6]);
      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      data[frame * 2] = std::clamp(dry[0] * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry[1] * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
      ++processed_frames;
    }
  }

  float rate;
  std::array<std::atomic<float>, 7> target{2.F,2.4F,.52F,.42F,.74F,.18F,.13F};
  std::array<float, 7> smooth{2.F,2.4F,.52F,.42F,.74F,.18F,.13F};
  std::unique_ptr<AtmosNetwork> active;
  std::unique_ptr<AtmosNetwork> retiring;
  AtmosControls retiring_controls{};
  std::size_t active_model{2U};
  std::size_t fade_position{};
  std::size_t fade_total{};
  std::size_t processed_frames{};
};

AtmosParityProcessor::AtmosParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
AtmosParityProcessor::~AtmosParityProcessor() = default;
void AtmosParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}
void AtmosParityProcessor::reset() noexcept { impl_->reset(); }
bool AtmosParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99U;
  if (name == "algorithm") index = 0U;
  else if (name == "decay") index = 1U;
  else if (name == "size") index = 2U;
  else if (name == "color") index = 3U;
  else if (name == "diffusion") index = 4U;
  else if (name == "motion") index = 5U;
  else if (name == "mix") index = 6U;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
'''

PROFILE_TEST = r'''#include "calcotone/atmos_parity_profiles.hpp"

#include <array>
#include <cassert>
#include <string_view>

int main() {
  constexpr std::array<std::string_view, 12> expected{
      "room", "plate", "hall", "cinema", "cloud", "freeze",
      "celestial", "aurora", "nebula", "abyss", "emt140", "lexicon224"};
  static_assert(calcotone::kAtmosParityProfiles.size() == expected.size());
  static_assert(calcotone::kAtmosEarlyProfiles.size() == expected.size());
  for (std::size_t i = 0; i < expected.size(); ++i) {
    const auto& profile = calcotone::atmos_parity_profile(i);
    const auto& early = calcotone::atmos_early_profile(i);
    assert(profile.id == expected[i]);
    assert(profile.line_count >= 6 && profile.line_count <= profile.line_times.size());
    assert(profile.predelay[0] >= 0.F && profile.predelay[1] >= profile.predelay[0]);
    assert(profile.size_range[0] > 0.F && profile.size_range[1] >= profile.size_range[0]);
    assert(profile.output_trim > 0.F && profile.input_trim > 0.F);
    assert(early.count >= 3 && early.count <= early.times.size());
    assert(early.early_level > 0.F && early.late_level > 0.F);
    for (std::size_t line = 0; line < profile.line_count; ++line)
      assert(profile.modulation_rates[line] > 0.F);
  }
  const auto& emt = calcotone::atmos_parity_profile(10);
  assert(emt.plate_dispersion == 1.F);
  assert(emt.split_decay == .16F);
  const auto& lexicon = calcotone::atmos_parity_profile(11);
  assert(lexicon.converter_bits == 12);
  assert(lexicon.converter_lowpass == 8800.F);
  assert(lexicon.split_decay == .34F);
}
'''

PROCESSOR_TEST = r'''#include "calcotone/atmos_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kBlock = 128U;

void process_blocks(calcotone::AtmosParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0; offset < frames; offset += kBlock)
    processor.process(audio.data() + offset * 2U, std::min(kBlock, frames - offset));
}

void configure(calcotone::AtmosParityProcessor& processor, unsigned mode, float decay = 2.4F) {
  assert(processor.set_parameter("algorithm", static_cast<float>(mode)));
  assert(processor.set_parameter("decay", decay));
  assert(processor.set_parameter("size", .52F));
  assert(processor.set_parameter("color", .42F));
  assert(processor.set_parameter("diffusion", .74F));
  assert(processor.set_parameter("motion", .18F));
  assert(processor.set_parameter("mix", 1.F));
}

std::vector<float> render(unsigned mode, float decay, std::size_t frames = 96'000U, bool left_only = false) {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, mode, decay);
  std::vector<float> audio(frames * 2U, 0.F);
  audio[0] = .5F;
  audio[1] = left_only ? 0.F : .5F;
  process_blocks(processor, audio);
  for (float sample : audio) assert(std::isfinite(sample) && std::abs(sample) <= 1.2F);
  return audio;
}

double energy(const std::vector<float>& audio, std::size_t first, std::size_t last, unsigned channel = 2U) {
  double result = 0.0;
  last = std::min(last, audio.size() / 2U);
  for (std::size_t frame = first; frame < last; ++frame) {
    if (channel == 2U) result += std::abs(static_cast<double>(audio[frame * 2U]))
                                  + std::abs(static_cast<double>(audio[frame * 2U + 1U]));
    else result += std::abs(static_cast<double>(audio[frame * 2U + channel]));
  }
  return result;
}

void test_model_identities() {
  std::array<double, 12> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    const auto audio = render(mode, mode == 5U ? 12.F : 2.4F, 48'000U);
    double signature = 0.0;
    for (std::size_t index = 0; index < audio.size(); ++index)
      signature += std::abs(static_cast<double>(audio[index])) * static_cast<double>((index % 251U) + 1U);
    assert(signature > 1e-6);
    signatures[mode] = signature;
  }
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
}

void test_early_reflections_precede_tail() {
  const auto room = render(0U, 1.2F, 24'000U);
  assert(energy(room, 250U, 950U) > 1e-5);
}

void test_decay_extends_tail() {
  const auto short_decay = render(2U, .55F);
  const auto long_decay = render(2U, 9.F);
  const double short_tail = energy(short_decay, 30'000U, 90'000U);
  const double long_tail = energy(long_decay, 30'000U, 90'000U);
  assert(long_tail > short_tail * 1.35 + 1e-7);
}

void test_emt_mono_excitation_reaches_both_pickups() {
  const auto emt = render(10U, 3.F, 48'000U, true);
  const double left = energy(emt, 0U, 48'000U, 0U);
  const double right = energy(emt, 0U, 48'000U, 1U);
  assert(left > 1e-5 && right > left * .18);
}

void test_live_algorithm_switch_preserves_outgoing_tail() {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, 2U, 5.F);
  std::vector<float> first(24'000U * 2U, 0.F);
  first[0] = .6F; first[1] = -.35F;
  process_blocks(processor, first);
  assert(processor.set_parameter("algorithm", 1.F));
  std::vector<float> transition(48'000U * 2U, 0.F);
  process_blocks(processor, transition);
  assert(energy(transition, 0U, 8'000U) > 1e-5);
}

void test_reset_is_deterministic() {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, 8U, 6.F);
  auto render_once = [&processor]() {
    std::vector<float> audio(48'000U * 2U, 0.F);
    audio[0] = .41F; audio[1] = -.27F;
    process_blocks(processor, audio);
    return audio;
  };
  const auto first = render_once();
  processor.reset();
  const auto second = render_once();
  assert(first.size() == second.size());
  for (std::size_t index = 0; index < first.size(); ++index)
    assert(std::abs(first[index] - second[index]) < 1e-6F);
}
}  // namespace

int main() {
  test_model_identities();
  test_early_reflections_precede_tail();
  test_decay_extends_tail();
  test_emt_mono_excitation_reaches_both_pickups();
  test_live_algorithm_switch_preserves_outgoing_tail();
  test_reset_is_deterministic();

  calcotone::AtmosParityProcessor processor(kRate);
  assert(!processor.set_parameter("not-a-parameter", .5F));
}
'''

Path("native/include/calcotone/atmos_parity_profiles.hpp").write_text(HEADER, encoding="utf-8")
Path("native/src/atmos_parity_processor.cpp").write_text(PROCESSOR, encoding="utf-8")
Path("native/tests/atmos_parity_profile_test.cpp").write_text(PROFILE_TEST, encoding="utf-8")
Path("native/tests/atmos_parity_processor_test.cpp").write_text(PROCESSOR_TEST, encoding="utf-8")
print("Materialized Atmos early/late FDN topology and live algorithm crossfade parity.")
