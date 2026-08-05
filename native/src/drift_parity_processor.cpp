#include "calcotone/drift_parity_processor.hpp"
#include "calcotone/drift_parity_profiles.hpp"
#include "calcotone/drift_classic_processor.hpp"
#include "calcotone/drift_standard_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
}  // namespace

struct DriftParityProcessor::Impl {
  float sample_rate;
  DriftClassicProcessor classic;
  DriftStandardProcessor standard;
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> value{0.F,.28F,.0022F,.35F,.62F,.32F,.14F};

  explicit Impl(float rate)
      : sample_rate(std::clamp(rate, 8000.F, 384000.F)),
        classic(sample_rate),
        standard(sample_rate) {
    for (std::size_t i = 0; i < target.size(); ++i) target[i].store(value[i]);
  }

  void reset() noexcept {
    classic.set_model(0);
    classic.reset();
    standard.reset();
  }

  void glide() noexcept {
    // Model identity is discrete in WebAudio and switches at a callback
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
      const float shape = clamp01(value[3]);
      const float spread = clamp01(value[4]);
      const float motion = clamp01(value[5]);
      const float mix = clamp01(value[6]);
      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      const float dry_l = data[frame * 2];
      const float dry_r = data[frame * 2 + 1];
      std::array<float, 2> wet{};

      if (profile.branch == DriftParityBranch::Classic) {
        classic.set_model(profile.classic_model);
        const float normalized_rate = std::clamp((rate - .05F) / 2.45F, 0.F, 1.F);
        const float normalized_depth = std::clamp(depth / .008F, 0.F, 1.F);
        wet = classic.process_sample(
            dry_l, dry_r, normalized_rate, normalized_depth, shape, spread, motion);
      } else {
        classic.set_model(0);
        standard.set_mode(static_cast<unsigned>(mode));
        wet = standard.process_sample(dry_l, dry_r, rate, depth, shape, spread, motion);
      }

      data[frame * 2] = std::clamp(dry_l * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry_r * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
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
