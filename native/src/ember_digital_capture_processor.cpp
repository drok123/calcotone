#include "calcotone/ember_digital_capture_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float db_to_gain(float db) noexcept { return std::pow(10.F, db / 20.F); }

float limiter_sample(float input, unsigned channel, float attack, float release,
                     std::array<float, 2>& envelope,
                     std::array<float, 2>& gain_state) noexcept {
  constexpr float threshold_db = -.5F;
  constexpr float ratio = 20.F;
  constexpr float knee_db = .5F;

  const float magnitude = std::abs(input);
  envelope[channel] += (magnitude - envelope[channel])
      * (magnitude > envelope[channel] ? attack : release);

  const float level_db = 20.F * std::log10(std::max(envelope[channel], 1e-9F));
  const float over = level_db - threshold_db;
  float reduction_db = 0.F;
  if (over > knee_db * .5F) {
    reduction_db = -(over - over / ratio);
  } else if (over > -knee_db * .5F) {
    const float knee_position = over + knee_db * .5F;
    reduction_db = -(1.F - 1.F / ratio) * knee_position * knee_position / (2.F * knee_db);
  }

  const float target_gain = db_to_gain(reduction_db);
  const float coefficient = target_gain < gain_state[channel] ? attack : release;
  gain_state[channel] += (target_gain - gain_state[channel]) * coefficient;
  return input * gain_state[channel];
}
}  // namespace

struct EmberDigitalCaptureProcessor::Impl {
  float rate;
  std::array<std::atomic<float>, 6> target{};
  std::array<float, 6> value{0.F, .42F, .5F, .2F, .62F, .22F};
  std::array<float, 6> glide_amount{};
  float dc_coefficient{};
  float limiter_attack_coefficient{};
  float limiter_release_coefficient{};

  float phase{};
  std::array<float, 2> held{};
  float envelope{};
  std::array<std::array<float, 4>, 2> filter_state{};
  int previous_mode{-1};
  float clock_memory{};
  std::array<float, 2> aperture{};
  std::uint64_t sample_counter{};

  std::array<float, 2> dc_input{}, dc_output{};
  std::array<float, 2> limiter_envelope{};
  std::array<float, 2> limiter_gain{1.F, 1.F};

  explicit Impl(float sample_rate) : rate(std::clamp(sample_rate, 8000.F, 384000.F)) {
    constexpr std::array<float, 6> time_constants{0.F, .012F, .012F, .012F, .012F, .025F};
    for (std::size_t i = 0; i < value.size(); ++i) target[i].store(value[i]);
    for (std::size_t index = 1; index < glide_amount.size(); ++index)
      glide_amount[index] = 1.F - std::exp(-1.F / (rate * time_constants[index]));
    dc_coefficient = std::exp(-2.F * kPi * 18.F / rate);
    limiter_attack_coefficient = 1.F - std::exp(-1.F / (rate * .001F));
    limiter_release_coefficient = 1.F - std::exp(-1.F / (rate * .06F));
  }

  void reset_model_state() noexcept {
    phase = 0.F;
    held = {};
    envelope = 0.F;
    filter_state = {};
    clock_memory = 0.F;
    aperture = {};
    sample_counter = 0;
  }

  void reset() noexcept {
    reset_model_state();
    previous_mode = -1;
    dc_input = {};
    dc_output = {};
    limiter_envelope = {};
    limiter_gain = {1.F, 1.F};
  }

  void reset_mode(int mode) noexcept {
    if (previous_mode == mode) return;
    previous_mode = mode;
    reset_model_state();
  }

  float quantize(float value_in, int bits) const noexcept {
    const float levels = std::pow(2.F, static_cast<float>(bits - 1));
    return std::round(std::clamp(value_in, -1.F, 1.F) * levels) / levels;
  }

  float quantize_nonlinear_12(float value_in) const noexcept {
    const float sign = value_in < 0.F ? -1.F : 1.F;
    const float magnitude = std::min(1.F, std::abs(value_in));
    constexpr float mu = 7.5F;
    const float encoded = std::log1p(mu * magnitude) / std::log1p(mu);
    const float quantized = std::round(encoded * 2047.F) / 2047.F;
    return sign * std::expm1(quantized * std::log1p(mu)) / mu;
  }

  float quantize_companded_8(float value_in, float strength) const noexcept {
    const float sign = value_in < 0.F ? -1.F : 1.F;
    const float magnitude = std::min(1.F, std::abs(value_in));
    const float mu = 15.F + strength * 24.F;
    const float encoded = std::log1p(mu * magnitude) / std::log1p(mu);
    const float quantized = std::round(encoded * 127.F) / 127.F;
    return sign * std::expm1(quantized * std::log1p(mu)) / mu;
  }

  float filter_coefficient(float cutoff) const noexcept {
    const float safe_cutoff = std::clamp(cutoff, 60.F, rate * .46F);
    return 1.F - std::exp(-2.F * kPi * safe_cutoff / rate);
  }

  float one_pole_with_coefficient(float input, float coefficient,
                                  unsigned channel, unsigned index) noexcept {
    auto& state = filter_state[channel][index];
    state += (input - state) * coefficient;
    return state;
  }

  float one_pole(float input, float cutoff, unsigned channel, unsigned index) noexcept {
    return one_pole_with_coefficient(input, filter_coefficient(cutoff), channel, index);
  }

  float two_pole(float input, float cutoff, unsigned channel) noexcept {
    const float coefficient = filter_coefficient(cutoff);
    input = one_pole_with_coefficient(input, coefficient, channel, 0);
    return one_pole_with_coefficient(input, coefficient, channel, 1);
  }

  float four_pole(float input, float cutoff, float resonance, unsigned channel) noexcept {
    const float feedback = filter_state[channel][3] * std::clamp(resonance, 0.F, .88F);
    const float coefficient = filter_coefficient(cutoff);
    float output = input - feedback;
    for (unsigned stage = 0; stage < 4; ++stage)
      output = one_pole_with_coefficient(output, coefficient, channel, stage);
    return output;
  }

  std::array<float, 2> process_model(float dry_l, float dry_r, int mode,
                                     float drive, float clock, float character,
                                     float filter) noexcept {
    reset_mode(mode);
    const float input_peak = std::max(std::abs(dry_l), std::abs(dry_r));
    envelope += (input_peak - envelope) * (input_peak > envelope ? .018F : .0018F);

    float target_rate = 26040.F;
    int bit_depth = 12;
    float input_drive = .9F + drive * 1.2F;
    if (mode == 1) {
      target_rate = 40000.F;
      input_drive = .88F + drive * .52F;
    } else if (mode == 2) {
      target_rate = clock <= .005F ? 32000.F : 10000.F + clock * 23000.F;
      bit_depth = 8;
      input_drive = .8F + drive * 1.45F;
    } else if (mode == 3) {
      target_rate = 7500.F + clock * 40500.F;
      input_drive = .84F + drive * .82F;
    } else if (mode == 4) {
      target_rate = 27000.F;
      bit_depth = 8;
      input_drive = .86F + drive * .74F;
    } else if (mode == 5) {
      target_rate = 24000.F + clock * 8000.F;
      bit_depth = 8;
      input_drive = .82F + drive * .66F;
    }

    clock_memory += (target_rate - clock_memory) * .00035F;
    const float effective_rate = std::max(6000.F, clock_memory != 0.F ? clock_memory : target_rate);
    phase += effective_rate / rate;
    if (phase >= 1.F) {
      phase -= std::floor(phase);
      const float headroom = mode == 1 ? .98F - drive * .12F : 1.F;
      const float shaped_l = std::tanh((dry_l / headroom) * input_drive)
          / std::max(1.F, input_drive * .72F);
      const float shaped_r = std::tanh((dry_r / headroom) * input_drive)
          / std::max(1.F, input_drive * .72F);
      const float aperture_coefficient = .82F - character * .12F;
      aperture[0] += (shaped_l - aperture[0]) * aperture_coefficient;
      aperture[1] += (shaped_r - aperture[1]) * aperture_coefficient;
      if (mode == 1) {
        held[0] = quantize_nonlinear_12(aperture[0]);
        held[1] = quantize_nonlinear_12(aperture[1]);
      } else if (mode == 4 || mode == 5) {
        const float strength = mode == 4 ? .7F : .35F;
        held[0] = quantize_companded_8(aperture[0], strength);
        held[1] = quantize_companded_8(aperture[1], strength);
      } else {
        held[0] = quantize(aperture[0], bit_depth);
        held[1] = quantize(aperture[1], bit_depth);
      }
    }

    float out_l = held[0];
    float out_r = held[1];
    if (mode == 0) {
      const int pair = std::clamp(static_cast<int>(std::floor(clock * 4.F)), 0, 3);
      if (pair == 0) {
        const float cutoff = 3600.F + filter * 5600.F + envelope * (1800.F + character * 3200.F);
        out_l = four_pole(out_l, cutoff, .08F + character * .30F, 0);
        out_r = four_pole(out_r, cutoff * .985F, .08F + character * .30F, 1);
      } else if (pair == 1) {
        const float cutoff = 7200.F + filter * 2200.F;
        out_l = two_pole(out_l, cutoff, 0);
        out_r = two_pole(out_r, cutoff, 1);
      } else if (pair == 2) {
        const float cutoff = 9800.F + filter * 2300.F;
        out_l = one_pole(out_l, cutoff, 0, 0);
        out_r = one_pole(out_r, cutoff, 1, 0);
      }
      const float imaging = std::sin(static_cast<double>(sample_counter)
          * (26040.0 / static_cast<double>(rate)) * static_cast<double>(kPi) * 2.0)
          * (.0015F + character * .0035F);
      out_l += imaging;
      out_r -= imaging * .82F;
    } else if (mode == 1) {
      const float cutoff = 15500.F + filter * 2600.F;
      out_l = two_pole(out_l, cutoff, 0);
      out_r = two_pole(out_r, cutoff, 1);
      const float converter_texture = (character - .5F) * .006F;
      out_l = std::tanh(out_l * (1.F + converter_texture));
      out_r = std::tanh(out_r * (1.F + converter_texture));
    } else if (mode == 2) {
      const float cutoff = 700.F + filter * 13500.F;
      const float resonance = .05F + character * .72F;
      out_l = four_pole(out_l, cutoff, resonance, 0);
      out_r = four_pole(out_r, cutoff * .992F, resonance, 1);
    } else if (mode == 3) {
      const float bandwidth = std::min(19200.F, effective_rate * .40F);
      const float cutoff = std::max(1600.F, bandwidth * (.74F + filter * .24F));
      out_l = two_pole(out_l, cutoff, 0);
      out_r = two_pole(out_r, cutoff * .994F, 1);
    } else if (mode == 4) {
      const float cutoff = 1800.F + filter * 10600.F + envelope * 900.F;
      const float resonance = .10F + character * .56F;
      out_l = four_pole(out_l, cutoff, resonance, 0);
      out_r = four_pole(out_r, cutoff * .987F, resonance, 1);
    } else {
      const float cutoff = 3900.F + filter * 8200.F;
      out_l = one_pole(one_pole(out_l, cutoff, 0, 0), cutoff * .86F, 0, 1);
      out_r = one_pole(one_pole(out_r, cutoff * .991F, 1, 0), cutoff * .85F, 1, 1);
      const float edge = (out_l - out_r) * character * .018F;
      out_l += edge;
      out_r -= edge;
    }

    ++sample_counter;
    return {std::clamp(out_l, -1.15F, 1.15F), std::clamp(out_r, -1.15F, 1.15F)};
  }

  void process(float* data, std::size_t frames) noexcept {
    if (!data || frames == 0) return;
    const int mode = std::clamp(static_cast<int>(std::lround(
        target[0].load(std::memory_order_relaxed))), 0, 5);
    reset_mode(mode);

    for (std::size_t frame = 0; frame < frames; ++frame) {
      value[0] = static_cast<float>(mode);
      for (std::size_t index = 1; index < value.size(); ++index)
        value[index] += (target[index].load(std::memory_order_relaxed) - value[index]) * glide_amount[index];

      const float drive = clamp01(value[1]);
      const float clock = clamp01(value[2]);
      const float character = clamp01(value[3]);
      const float filter = clamp01(value[4]);
      const float mix = clamp01(value[5]);
      const float dry[2]{data[frame * 2], data[frame * 2 + 1]};
      auto wet = process_model(
          std::isfinite(dry[0]) && std::abs(dry[0]) >= 1e-20F ? dry[0] : 0.F,
          std::isfinite(dry[1]) && std::abs(dry[1]) >= 1e-20F ? dry[1] : 0.F,
          mode, drive, clock, character, filter);

      for (unsigned channel = 0; channel < 2; ++channel) {
        wet[channel] *= 1.04F;
        const float blocked = wet[channel] - dc_input[channel] + dc_coefficient * dc_output[channel];
        dc_input[channel] = wet[channel];
        dc_output[channel] = blocked;
        wet[channel] = limiter_sample(
            blocked, channel, limiter_attack_coefficient, limiter_release_coefficient,
            limiter_envelope, limiter_gain);
        data[frame * 2 + channel] = std::clamp(
            dry[channel] * (1.F - mix) + wet[channel] * mix, -1.2F, 1.2F);
      }
    }
  }
};

EmberDigitalCaptureProcessor::EmberDigitalCaptureProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
EmberDigitalCaptureProcessor::~EmberDigitalCaptureProcessor() = default;
void EmberDigitalCaptureProcessor::process(float* data, std::size_t frames) noexcept {
  impl_->process(data, frames);
}
void EmberDigitalCaptureProcessor::reset() noexcept { impl_->reset(); }
bool EmberDigitalCaptureProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "mode") index = 0;
  else if (name == "drive") index = 1;
  else if (name == "clock") index = 2;
  else if (name == "character") index = 3;
  else if (name == "filter") index = 4;
  else if (name == "mix") index = 5;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
