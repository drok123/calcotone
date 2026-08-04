#include "calcotone/ember_parity_processor.hpp"

#include "calcotone/ember_parity_profiles.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float coefficient(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, rate * .45F) / rate);
}
float one_pole(float input, float& state, float amount) noexcept {
  state += (input - state) * amount;
  return state;
}
float soft_shape(float x) noexcept { return std::tanh(x); }
float quantize(float x, unsigned bits) noexcept {
  const float steps = static_cast<float>((1U << std::clamp(bits, 4U, 20U)) - 1U);
  return std::round(std::clamp(x, -1.F, 1.F) * steps) / steps;
}
}  // namespace

struct EmberParityProcessor::Impl {
  float rate;
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> value{0.F, .14F, 9500.F, .18F, .22F, .38F, .22F};
  std::array<float, 2> tone{}, presence{}, envelope{}, dc_in{}, dc_out{};
  std::array<float, 2> magnetic_memory{}, tube_memory{}, previous{};
  std::array<std::uint32_t, 2> hold_count{};
  std::array<float, 2> held{};

  explicit Impl(float sample_rate) : rate(std::clamp(sample_rate, 8000.F, 384000.F)) {
    for (std::size_t i = 0; i < value.size(); ++i) target[i].store(value[i]);
  }

  float generic(float x, unsigned mode, float drive, float heat, float character) noexcept {
    const float gain = 1.F + drive * (mode == 4 ? 9.5F : mode == 6 ? 7.2F : 3.2F) + heat * 2.F;
    switch (mode) {
      case 0: return soft_shape(x * gain) / std::max(.8F, soft_shape(gain));
      case 1: return x / (1.F + std::abs(x) * (1.4F + drive * 5.F));
      case 2: return soft_shape((x + .018F * character) * gain) - soft_shape(.018F * character * gain);
      case 4: return soft_shape(x * gain + x * x * .09F * character);
      case 5: return x + soft_shape(x * (2.F + drive * 4.F)) * (.12F + heat * .32F);
      case 6: return soft_shape(x * gain + std::sin(x * (5.F + character * 11.F)) * heat * .22F);
      default: return x;
    }
  }

  float tube(float x, const EmberParityProfile& profile, float drive, float heat,
             float character, float dynamics, unsigned ch) noexcept {
    const float family = profile.id == "mullard" ? .82F : profile.id == "telefunken" ? 1.08F
        : profile.id == "bugleboy" ? .94F : profile.id == "rcablack" ? .72F : 1.F;
    const float bias = (profile.id == "rcablack" ? .042F : profile.id == "bugleboy" ? .026F : .014F)
        * character;
    const float gain = (1.3F + drive * (4.2F + family * 2.6F)) * (1.F + heat * .65F);
    const float memory = tube_memory[ch] * (.04F + character * .12F);
    float wet = soft_shape((x + bias + memory) * gain) - soft_shape(bias * gain);
    tube_memory[ch] += (wet - tube_memory[ch]) * (.012F + heat * .04F);
    wet /= std::max(.82F, std::tanh(gain));
    wet /= 1.F + std::abs(wet) * dynamics * (.16F + family * .18F);
    return wet * (profile.tube_post.post_base + drive * profile.tube_post.post_drive);
  }

  float magnetic(float x, float drive, float heat, float character, float dynamics, unsigned ch) noexcept {
    const float memory = magnetic_memory[ch];
    const float flux = x * (1.2F + drive * 5.4F) + memory * (.08F + character * .22F);
    float wet = soft_shape(flux + flux * flux * .025F * heat);
    magnetic_memory[ch] += (wet - memory) * (.004F + heat * .018F);
    wet = wet * (.86F + character * .18F) + x * (.14F - character * .06F);
    return wet / (1.F + std::abs(wet) * dynamics * .22F);
  }

  float digital(float x, int machine, float drive, float tone_norm, float heat,
                float character, float dynamics, unsigned ch) noexcept {
    static constexpr std::array<unsigned, 6> bits{12, 12, 8, 12, 8, 8};
    static constexpr std::array<unsigned, 6> holds{3, 2, 5, 3, 4, 6};
    static constexpr std::array<float, 6> trims{.94F, .98F, .88F, .96F, .90F, .86F};
    const unsigned index = static_cast<unsigned>(std::clamp(machine, 0, 5));
    if (hold_count[ch]++ % std::max(1U, holds[index] - static_cast<unsigned>(tone_norm * 2.F)) == 0)
      held[ch] = x;
    float wet = quantize(held[ch] * (1.F + drive * .8F), bits[index]);
    const float fold = std::max(0.F, std::abs(wet) - (.82F - drive * .18F));
    wet -= std::copysign(fold * (.25F + heat * .45F), wet);
    const float cutoff = 2200.F + tone_norm * (machine == 2 || machine >= 4 ? 7200.F : 11800.F);
    wet = one_pole(wet, tone[ch], coefficient(cutoff, rate));
    wet += (wet - previous[ch]) * character * (machine == 0 ? .08F : .035F);
    previous[ch] = wet;
    return wet * trims[index] / (1.F + std::abs(wet) * dynamics * .08F);
  }

  void process(float* data, std::size_t frames) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .045F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      for (std::size_t i = 0; i < value.size(); ++i)
        value[i] += (target[i].load(std::memory_order_relaxed) - value[i]) * glide;
      const unsigned mode = std::min(17U, static_cast<unsigned>(std::round(value[0])));
      const auto& profile = ember_parity_profile(mode);
      const float drive = clamp01(value[1]), tone_hz = std::clamp(value[2], 200.F, 18000.F);
      const float heat = clamp01(value[3]), character = clamp01(value[4]);
      const float dynamics = clamp01(value[5]), mix = clamp01(value[6]);
      const float tone_norm = (tone_hz - 200.F) / 17800.F;
      for (unsigned ch = 0; ch < 2; ++ch) {
        const auto i = frame * 2 + ch;
        const float dry = data[i];
        float wet = dry;
        switch (profile.branch) {
          case EmberParityBranch::Generic: wet = generic(dry, mode, drive, heat, character); break;
          case EmberParityBranch::Tube: wet = tube(dry, profile, drive, heat, character, dynamics, ch); break;
          case EmberParityBranch::MagneticCore: wet = magnetic(dry, drive, heat, character, dynamics, ch); break;
          case EmberParityBranch::DigitalCapture:
            wet = digital(dry, profile.digital_capture_mode, drive, tone_norm, heat, character, dynamics, ch); break;
        }
        const float cutoff = tone_hz * (profile.branch == EmberParityBranch::Tube
            ? profile.tube_post.tone_scale - heat * profile.tube_post.tone_heat : 1.F);
        wet = one_pole(wet, tone[ch], coefficient(cutoff, rate));
        if (profile.branch == EmberParityBranch::Tube) {
          const float presence_hz = profile.tube_post.presence_hz + character * profile.tube_post.presence_span;
          const float high = wet - one_pole(wet, presence[ch], coefficient(presence_hz, rate));
          wet += high * (profile.tube_post.presence_base + character * profile.tube_post.presence_character) * .08F;
        }
        envelope[ch] += (std::abs(wet) - envelope[ch]) * (std::abs(wet) > envelope[ch] ? .025F : .0015F);
        wet /= 1.F + std::max(0.F, envelope[ch] - (.62F - dynamics * .28F)) * (1.F + dynamics * 3.5F);
        const float dc = wet - dc_in[ch] + .995F * dc_out[ch];
        dc_in[ch] = wet; dc_out[ch] = dc;
        const float dry_gain = std::cos(mix * kPi * .5F);
        const float wet_gain = std::sin(mix * kPi * .5F);
        data[i] = std::clamp(dry * dry_gain + dc * wet_gain, -1.2F, 1.2F);
      }
    }
  }
};

EmberParityProcessor::EmberParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
EmberParityProcessor::~EmberParityProcessor() = default;
void EmberParityProcessor::process(float* data, std::size_t frames) noexcept { impl_->process(data, frames); }
bool EmberParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "mode") index = 0; else if (name == "drive") index = 1; else if (name == "tone") index = 2;
  else if (name == "heat") index = 3; else if (name == "character") index = 4;
  else if (name == "dynamics") index = 5; else if (name == "mix") index = 6;
  if (index >= 7) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}
void EmberParityProcessor::reset() noexcept {
  impl_->tone = {}; impl_->presence = {}; impl_->envelope = {}; impl_->dc_in = {}; impl_->dc_out = {};
  impl_->magnetic_memory = {}; impl_->tube_memory = {}; impl_->previous = {}; impl_->hold_count = {}; impl_->held = {};
}

}  // namespace calcotone
