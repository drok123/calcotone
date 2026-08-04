#include "calcotone/artifact_chain_processor.hpp"
#include "calcotone/artifact_chain_profiles.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
float clamp01(float v) noexcept { return std::clamp(v, 0.F, 1.F); }
float coeff(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 5.F, rate * .45F) / rate);
}
float one_pole(float x, float& s, float g) noexcept { s += (x - s) * g; return s; }
float db_gain(float db) noexcept { return std::pow(10.F, db / 20.F); }
}

struct ArtifactChainProcessor::Impl {
  float sample_rate;
  std::atomic<float> console{0.F}, tube{0.F}, order{0.F};
  std::atomic<float> drive{.25F}, character{.25F}, tone{.5F}, mix{1.F};
  std::array<float, 2> console_low{}, console_high{}, transformer{}, tube_low{}, tube_env{}, dc_in{}, dc_out{};

  explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)) {}

  float run_console(float x, unsigned ch, const ArtifactConsoleProfile& p, float amount, float color) noexcept {
    const float hp_g = coeff(p.highpass_hz, sample_rate);
    const float lp_g = coeff(p.lowpass_hz * (.72F + color * .38F), sample_rate);
    const float low = one_pole(x, console_low[ch], hp_g);
    float y = (x - low) * p.input_gain;
    transformer[ch] += (y - transformer[ch]) * (.008F + p.transformer_memory * .055F);
    y += transformer[ch] * p.transformer_memory * (.08F + amount * .18F);
    const float gain = 1.F + p.drive * (.35F + amount * 1.35F);
    const float bias = p.asymmetry * (.4F + amount * .8F);
    y = std::tanh((y + bias) * gain) - std::tanh(bias * gain);
    y *= p.output_gain;
    y = one_pole(y, console_high[ch], lp_g);
    const float shelf = db_gain((p.low_shelf_db * (1.F - color) + p.high_shelf_db * color) * .18F);
    return y * shelf;
  }

  float run_tube(float x, unsigned ch, const ArtifactTubeProfile& p, float amount, float color) noexcept {
    tube_env[ch] += (std::abs(x) - tube_env[ch]) * (std::abs(x) > tube_env[ch] ? .018F : .0007F);
    const float sag = std::clamp(1.F - tube_env[ch] * p.sag * (.25F + amount * .75F), .62F, 1.F);
    const float gain = p.input_gain * (1.F + p.drive * (.28F + amount * 1.42F)) * sag;
    const float biased = x + p.bias * (.45F + amount * .85F);
    const float base = std::tanh(biased * gain);
    const float even = (biased * biased) * (biased >= 0.F ? 1.F : -1.F) * p.even_harmonic;
    const float odd = biased * biased * biased * p.odd_harmonic;
    float y = base + even * (.12F + amount * .28F) - odd * (.04F + amount * .12F);
    const float g = coeff(p.presence_hz * (.75F + color * .5F), sample_rate);
    const float low = one_pole(y, tube_low[ch], g);
    y = low + (y - low) * db_gain(p.presence_db * (.2F + color * .5F));
    const float pre_dc = y;
    y = pre_dc - dc_in[ch] + .995F * dc_out[ch];
    dc_in[ch] = pre_dc; dc_out[ch] = y;
    return y * p.output_gain;
  }

  void process(float* data, std::size_t frames) noexcept {
    const auto ci = static_cast<std::size_t>(std::clamp(std::lround(console.load()), 0L, 5L));
    const auto ti = static_cast<std::size_t>(std::clamp(std::lround(tube.load()), 0L, 5L));
    const bool tube_first = std::lround(order.load()) != 0;
    const float amount = clamp01(drive.load());
    const float color = clamp01(tone.load());
    const float blend = clamp01(mix.load());
    const auto& cp = artifact_console_profile(ci);
    const auto& tp = artifact_tube_profile(ti);
    for (std::size_t i = 0; i < frames * 2; ++i) {
      const unsigned ch = static_cast<unsigned>(i & 1U);
      const float dry = data[i];
      float wet = dry;
      if (tube_first) {
        if (ti) wet = run_tube(wet, ch, tp, amount, color);
        if (ci) wet = run_console(wet, ch, cp, amount, color);
      } else {
        if (ci) wet = run_console(wet, ch, cp, amount, color);
        if (ti) wet = run_tube(wet, ch, tp, amount, color);
      }
      data[i] = std::clamp(dry + (wet - dry) * blend, -1.2F, 1.2F);
    }
  }
};

ArtifactChainProcessor::ArtifactChainProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
ArtifactChainProcessor::~ArtifactChainProcessor() = default;
void ArtifactChainProcessor::process(float* data, std::size_t frames) noexcept { impl_->process(data, frames); }
bool ArtifactChainProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  if (name == "console") impl_->console.store(value);
  else if (name == "tube") impl_->tube.store(value);
  else if (name == "order") impl_->order.store(value);
  else if (name == "drive") impl_->drive.store(value);
  else if (name == "character") impl_->character.store(value);
  else if (name == "tone") impl_->tone.store(value);
  else if (name == "mix") impl_->mix.store(value);
  else return false;
  return true;
}
void ArtifactChainProcessor::reset() noexcept {
  impl_->console_low = {}; impl_->console_high = {}; impl_->transformer = {};
  impl_->tube_low = {}; impl_->tube_env = {}; impl_->dc_in = {}; impl_->dc_out = {};
}

}  // namespace calcotone
