#include "calcotone/drift_parity_processor.hpp"
#include "calcotone/drift_parity_profiles.hpp"
#include "calcotone/drift_classic_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

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
float read_delay(const std::vector<float>& buffer, std::size_t write, float delay) noexcept {
  float position = static_cast<float>(write) - delay;
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto i0 = static_cast<std::size_t>(position);
  const auto i1 = (i0 + 1) % buffer.size();
  const float fraction = position - static_cast<float>(i0);
  return buffer[i0] + (buffer[i1] - buffer[i0]) * fraction;
}
}  // namespace

struct DriftParityProcessor::Impl {
  float sample_rate;
  DriftClassicProcessor classic;
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> value{0.F,.28F,.0022F,.35F,.62F,.32F,.14F};
  std::array<std::vector<float>, 2> delay;
  std::size_t write{};
  std::array<float, 4> phase{};
  std::array<float, 2> low{}, highpass_low{}, preamp_memory{};

  explicit Impl(float rate)
      : sample_rate(std::clamp(rate, 8000.F, 384000.F)), classic(sample_rate) {
    for (std::size_t i = 0; i < target.size(); ++i) target[i].store(value[i]);
    const auto size = static_cast<std::size_t>(sample_rate * .12F) + 32;
    delay[0].assign(size, 0.F); delay[1].assign(size, 0.F);
    phase = {0.F, .71F, 1.93F, 3.17F};
  }

  void reset() noexcept {
    for (auto& channel : delay) std::fill(channel.begin(), channel.end(), 0.F);
    low.fill(0.F); highpass_low.fill(0.F); preamp_memory.fill(0.F);
    write = 0;
    phase = {0.F, .71F, 1.93F, 3.17F};
    classic.set_model(0);
    classic.reset();
  }

  void glide() noexcept {
    // Model identity is discrete in WebAudio and must switch at a callback
    // boundary. Continuous controls retain sample-rate smoothing.
    value[0] = target[0].load(std::memory_order_relaxed);
    const float amount = 1.F - std::exp(-1.F / (sample_rate * .035F));
    for (std::size_t i = 1; i < value.size(); ++i)
      value[i] += (target[i].load(std::memory_order_relaxed) - value[i]) * amount;
  }

  void process(float* data, std::size_t frames) noexcept {
    for (std::size_t frame = 0; frame < frames; ++frame) {
      glide();
      const auto mode = std::min<std::size_t>(21, static_cast<std::size_t>(std::lround(value[0])));
      const auto& profile = drift_parity_profile(mode);
      const float rate = std::clamp(value[1], .05F, 2.5F);
      const float depth = std::clamp(value[2], 0.F, .008F);
      const float shape = clamp01(value[3]), spread = clamp01(value[4]);
      const float motion = clamp01(value[5]), mix = clamp01(value[6]);
      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      const float dry_l = data[frame * 2];
      const float dry_r = data[frame * 2 + 1];

      if (profile.branch == DriftParityBranch::Classic) {
        classic.set_model(profile.classic_model);
        const float normalized_rate = std::clamp((rate - .05F) / 2.45F, 0.F, 1.F);
        const float normalized_depth = std::clamp(depth / .008F, 0.F, 1.F);
        const auto wet = classic.process_sample(
            dry_l, dry_r, normalized_rate, normalized_depth, shape, spread, motion);
        data[frame * 2] = std::clamp(dry_l * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
        data[frame * 2 + 1] = std::clamp(dry_r * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
        continue;
      }

      classic.set_model(0);
      for (unsigned ch = 0; ch < 2; ++ch) delay[ch][write] = data[frame * 2 + ch];

      for (unsigned ch = 0; ch < 2; ++ch) {
        const auto i = frame * 2 + ch;
        const float dry = data[i];
        const float hp_g = coefficient(profile.highpass, sample_rate);
        const float lp_g = coefficient(profile.lowpass, sample_rate);
        const float preamp = profile.branch == DriftParityBranch::Ce1
            ? std::tanh((dry + preamp_memory[ch] * .03F) * (1.02F + motion * .24F))
            : profile.branch == DriftParityBranch::DimensionD
                ? std::tanh(dry * 1.018F)
                : profile.branch == DriftParityBranch::Flanger
                    ? std::tanh(dry * (1.02F + shape * .08F)) : dry;
        preamp_memory[ch] += (preamp - preamp_memory[ch]) * .035F;
        float sum = 0.F;
        const auto voices = std::max<std::size_t>(1, profile.voice_count);
        for (std::size_t voice = 0; voice < voices; ++voice) {
          const float phase_offset = static_cast<float>(voice) * (kPi * .5F + spread * .38F)
              + (ch ? kPi * spread : 0.F);
          phase[voice] += 2.F * kPi * rate * profile.rate_scale * (1.F + voice * .013F) / sample_rate;
          if (phase[voice] >= 2.F * kPi) phase[voice] -= 2.F * kPi;
          float lfo = std::sin(phase[voice] + phase_offset);
          lfo = lfo * (1.F - shape * .42F)
              + std::sin(2.F * (phase[voice] + phase_offset)) * shape * .21F;
          const float sweep = profile.branch == DriftParityBranch::Flanger
              ? profile.depth_scale * (.0012F + depth * 1.15F)
              : profile.depth_scale * depth;
          const float delay_seconds = profile.base_delay
              + profile.delay_step * static_cast<float>(voice) + sweep * lfo;
          float voice_sample = read_delay(delay[ch], write,
              std::max(1.F, delay_seconds * sample_rate));
          const float high = voice_sample - one_pole(voice_sample, highpass_low[ch], hp_g);
          voice_sample = one_pole(high, low[ch], lp_g);
          sum += voice_sample * ((voice & 1U) ? .94F : 1.F);
        }
        float wet = sum / static_cast<float>(voices);
        if (profile.feedback != 0.F) {
          const float feedback = std::clamp(profile.feedback * (.5F + shape * .72F), -.82F, .82F);
          delay[ch][write] = std::clamp(preamp + wet * feedback * (ch ? -.965F : 1.F), -1.25F, 1.25F);
        }
        wet *= profile.output_trim;
        data[i] = std::clamp(dry * dry_gain + wet * wet_gain, -1.2F, 1.2F);
      }
      write = (write + 1) % delay[0].size();
    }
  }
};

DriftParityProcessor::DriftParityProcessor(float sample_rate) : impl_(std::make_unique<Impl>(sample_rate)) {}
DriftParityProcessor::~DriftParityProcessor() = default;
void DriftParityProcessor::process(float* data, std::size_t frames) noexcept { impl_->process(data, frames); }
void DriftParityProcessor::reset() noexcept { impl_->reset(); }
bool DriftParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "mode") index=0; else if(name=="rate") index=1; else if(name=="depth") index=2;
  else if(name=="shape") index=3; else if(name=="spread") index=4; else if(name=="motion") index=5; else if(name=="mix") index=6;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
