#include "calcotone/stack_amp.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace calcotone {
namespace {
constexpr std::size_t kLutSize = 2048;
constexpr float kPi = 3.14159265358979323846F;
using Model = std::array<float, 7>;
using Cab = std::array<float, 5>;
constexpr std::array<Model, 6> kModels{{
    {3.15F, .68F, .018F, .24F, .12F, .22F, .92F},
    {3.75F, .78F, -.012F, .36F, .08F, .32F, .88F},
    {4.85F, .61F, .028F, .48F, .16F, .44F, .82F},
    {3.55F, .39F, -.018F, .40F, .22F, .38F, .91F},
    {5.35F, .31F, .036F, .64F, .26F, .56F, .76F},
    {4.30F, .55F, -.008F, .46F, .18F, .48F, .84F},
}};
constexpr std::array<Cab, 5> kCabs{{
    {78.F, 7200.F, 118.F, .16F, 1.03F}, {70.F, 6500.F, 104.F, .20F, 1.04F},
    {66.F, 5600.F, 92.F, .26F, 1.08F}, {42.F, 4800.F, 68.F, .24F, 1.08F},
    {24.F, 18000.F, 85.F, 0.F, .94F},
}};

const std::array<float, kLutSize>& lut() noexcept {
  static const auto table = [] {
    std::array<float, kLutSize> values{};
    for (std::size_t i = 0; i < values.size(); ++i) {
      const float x = static_cast<float>(i) / static_cast<float>(values.size() - 1) * 8.F - 4.F;
      values[i] = std::tanh(x);
    }
    return values;
  }();
  return table;
}

float shape(float value) noexcept {
  const auto& table = lut();
  const float position = std::clamp((value + 4.F) * .125F, 0.F, 1.F) * static_cast<float>(kLutSize - 1);
  const auto index = static_cast<std::size_t>(position);
  const float mu = position - static_cast<float>(index);
  const auto at = [&](std::ptrdiff_t offset) {
    return table[std::clamp<std::ptrdiff_t>(static_cast<std::ptrdiff_t>(index) + offset, 0, kLutSize - 1)];
  };
  const float y0 = at(-1), y1 = at(0), y2 = at(1), y3 = at(2), mu2 = mu * mu;
  const float a0 = -.5F * y0 + 1.5F * y1 - 1.5F * y2 + .5F * y3;
  const float a1 = y0 - 2.5F * y1 + 2.F * y2 - .5F * y3;
  const float a2 = -.5F * y0 + .5F * y2;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
}

float coefficient(float frequency, float rate) noexcept {
  const float tangent = std::tan(kPi * std::min(frequency, rate * .45F) / rate);
  return tangent / (1.F + tangent);
}

float lowpass(float input, float& state, float g) noexcept {
  const float value = (input - state) * g;
  const float low = value + state;
  state = low + value;
  return low;
}
}  // namespace

StackAmp::StackAmp(float sample_rate) noexcept : sample_rate_(sample_rate) {
  std::copy(kModels[5].begin(), kModels[5].end(), coefficients_.begin());
  std::copy(kCabs[2].begin(), kCabs[2].end(), coefficients_.begin() + 7);
  (void)lut();
}
void StackAmp::set_sample_rate(float value) noexcept { sample_rate_ = std::clamp(value, 8'000.F, 384'000.F); }
void StackAmp::set_model(AmpModel value) noexcept { model_.store(std::min(static_cast<unsigned>(value), 5U)); }
void StackAmp::set_cabinet(Cabinet value) noexcept { cabinet_.store(std::min(static_cast<unsigned>(value), 4U)); }
void StackAmp::set_drive(float value) noexcept { drive_.store(std::clamp(value, 0.F, 1.F)); }
void StackAmp::set_tone(float value) noexcept { tone_.store(std::clamp(value, 0.F, 1.F)); }
void StackAmp::set_sag(float value) noexcept { sag_.store(std::clamp(value, 0.F, 1.F)); }
void StackAmp::set_mix(float value) noexcept { mix_.store(std::clamp(value, 0.F, 1.F)); }
void StackAmp::set_quality(unsigned value) noexcept { quality_.store(value >= 4 ? 4U : value >= 2 ? 2U : 1U); }

void StackAmp::process(const float* input, float* output, std::size_t frames) noexcept {
  const auto model = kModels[model_.load(std::memory_order_relaxed)];
  const auto cab = kCabs[cabinet_.load(std::memory_order_relaxed)];
  const unsigned steps = quality_.load(std::memory_order_relaxed);
  const float drive = drive_.load(std::memory_order_relaxed);
  const float tone = tone_.load(std::memory_order_relaxed);
  const float sag_control = sag_.load(std::memory_order_relaxed);
  const float mix = mix_.load(std::memory_order_relaxed);
  const float glide = 1.F - std::exp(-static_cast<float>(frames) / (sample_rate_ * .035F));
  for (std::size_t i = 0; i < model.size(); ++i) coefficients_[i] += (model[i] - coefficients_[i]) * glide;
  for (std::size_t i = 0; i < cab.size(); ++i) coefficients_[7 + i] += (cab[i] - coefficients_[7 + i]) * glide;
  const auto& c = coefficients_;
  const float internal_rate = sample_rate_ * static_cast<float>(steps);
  const float input_hp = coefficient(28.F, internal_rate);
  const float tone_low_g = coefficient(360.F, internal_rate);
  const float tone_high_g = coefficient(1800.F + c[1] * 3100.F + tone * 2600.F, internal_rate);
  const float feedback_g = coefficient(1250.F, internal_rate);
  const float cab_hp_g = coefficient(c[7], internal_rate), cab_lp_g = coefficient(c[8], internal_rate);
  const float body_g = coefficient(c[9], internal_rate);
  const float sag_attack = 1.F - std::exp(-1.F / (internal_rate * .004F));
  const float sag_release = 1.F - std::exp(-1.F / (internal_rate * .11F));
  const float input_gain = 1.F + std::pow(drive, 1.38F) * c[0];
  const float drive_makeup = 1.F / (1.F + drive * .85F);
  const float sag_depth = sag_control * c[3] * .52F;
  const float bias_zero = shape(c[2] * input_gain);
  const float dry_gain = std::cos(mix * .5F * kPi), wet_gain = std::sin(mix * .5F * kPi);

  for (std::size_t frame = 0; frame < frames; ++frame) {
    for (std::size_t channel = 0; channel < 2; ++channel) {
      auto& s = channels_[channel];
      const float dry = input[frame * 2 + channel];
      float accumulated = 0.F;
      for (unsigned step = 1; step <= steps; ++step) {
        const float x = s.previous_input + (dry - s.previous_input) * (static_cast<float>(step) / steps);
        const float highpassed = x - lowpass(x, s.input_low, input_hp);
        const float feedback_signal = lowpass(s.transformer_memory, s.feedback_low, feedback_g);
        float preamp = (shape((highpassed - feedback_signal * c[4]) * input_gain + c[2]) - bias_zero) * (.88F + drive * .32F);
        const float low = lowpass(preamp, s.tone_low, tone_low_g);
        const float high_low = lowpass(preamp, s.tone_high, tone_high_g);
        preamp = low * (1.18F - tone * .44F) + (high_low - low) * (.86F + (.5F - std::abs(tone - .5F)) * .24F)
            + (preamp - high_low) * (.56F + tone * (.74F + c[1] * .28F));
        const float magnitude = std::abs(preamp);
        s.sag_envelope += (magnitude - s.sag_envelope) * (magnitude > s.sag_envelope ? sag_attack : sag_release);
        const float power = shape(preamp / (1.F + s.sag_envelope * sag_depth) * (1.15F + drive * 1.05F));
        s.transformer_memory += (power - s.transformer_memory) * (.06F + c[5] * .11F);
        float transformed = power * (1.F - c[5] * .18F)
            + shape((power + s.transformer_memory * .22F) * (1.F + c[5])) * c[5] * .34F;
        transformed -= lowpass(transformed, s.cab_highpass_low, cab_hp_g);
        const float cab_one = lowpass(transformed, s.cab_low_one, cab_lp_g);
        const float cab_two = lowpass(cab_one, s.cab_low_two, cab_lp_g);
        const float body = lowpass(transformed, s.cab_body_low, body_g);
        accumulated += shape((cab_two + body * c[10]) * c[6] * c[11] * drive_makeup * 1.08F) * 1.04F;
      }
      s.previous_input = dry;
      float wet = accumulated / static_cast<float>(steps);
      wet = wet - s.dc_input + .995F * s.dc_value;
      s.dc_input = accumulated / static_cast<float>(steps);
      s.dc_value = wet;
      output[frame * 2 + channel] = std::clamp(dry * dry_gain + wet * wet_gain, -1.15F, 1.15F);
    }
  }
}
}  // namespace calcotone
