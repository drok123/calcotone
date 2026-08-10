#include "calcotone/drift_parity_processor.hpp"
#include "calcotone/drift_parity_profiles.hpp"
#include "calcotone/drift_classic_processor.hpp"
#include "calcotone/drift_standard_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <limits>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kControlPeriod = 32U;
float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
}  // namespace

struct DriftParityProcessor::Impl {
  float sample_rate;
  DriftClassicProcessor classic;
  DriftStandardProcessor standard;
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> target_snapshot{};
  std::array<float, 7> value{0.F,.28F,.0022F,.35F,.62F,.32F,.14F};
  float glide_amount{};
  std::size_t control_countdown{};
  std::size_t active_mode{std::numeric_limits<std::size_t>::max()};
  std::size_t pending_mode{};
  const DriftParityProfile* active_profile{&kDriftParityProfiles[0]};
  float dry_gain{1.F};
  float wet_gain{};
  float mode_mix{1.F};
  float mode_fade_step{};
  unsigned mode_transition{};

  explicit Impl(float rate)
      : sample_rate(std::clamp(rate, 8000.F, 384000.F)),
        classic(sample_rate),
        standard(sample_rate) {
    glide_amount = 1.F - std::exp(-1.F / (sample_rate * .035F));
    mode_fade_step = 1.F / std::max(1.F, sample_rate * .003F);
    for (std::size_t i = 0; i < target.size(); ++i) {
      target[i].store(value[i], std::memory_order_relaxed);
      target_snapshot[i] = value[i];
    }
    refresh_routing_and_mix();
  }

  void reset() noexcept {
    classic.set_model(0);
    classic.reset();
    standard.reset();
    active_mode = std::numeric_limits<std::size_t>::max();
    pending_mode = 0U;
    mode_mix = 1.F;
    mode_transition = 0U;
    control_countdown = 0U;
  }

  void snapshot_targets() noexcept {
    for (std::size_t i = 0; i < target.size(); ++i)
      target_snapshot[i] = target[i].load(std::memory_order_relaxed);
  }

  void glide() noexcept {
    // Model identity is discrete and refreshes at the 32-sample control boundary.
    // Continuous values still glide every sample, but their atomic targets do not
    // need to be reloaded seven times for every audio frame.
    value[0] = target_snapshot[0];
    for (std::size_t i = 1; i < value.size(); ++i)
      value[i] += (target_snapshot[i] - value[i]) * glide_amount;
  }

  void activate_mode(std::size_t mode) noexcept {
    mode = std::min<std::size_t>(21, mode);
    active_mode = mode;
    active_profile = &drift_parity_profile(mode);
    if (active_profile->branch == DriftParityBranch::Classic) {
      classic.set_model(active_profile->classic_model);
    } else {
      classic.set_model(0);
      standard.set_mode(static_cast<unsigned>(mode));
    }
  }

  void refresh_routing_and_mix() noexcept {
    const auto requested = std::min<std::size_t>(21, static_cast<std::size_t>(std::lround(value[0])));
    if (active_mode == std::numeric_limits<std::size_t>::max()) {
      activate_mode(requested);
      pending_mode = requested;
      mode_mix = 1.F;
      mode_transition = 0U;
    } else if (requested != active_mode) {
      pending_mode = requested;
      if (mode_transition == 0U || mode_transition == 2U) mode_transition = 1U;
    }
    const float mix = clamp01(value[6]);
    dry_gain = std::cos(mix * kPi * .5F);
    wet_gain = std::sin(mix * kPi * .5F);
  }

  void advance_mode_transition() noexcept {
    if (mode_transition == 1U) {
      mode_mix = std::max(0.F, mode_mix - mode_fade_step);
      if (mode_mix <= 0.F) {
        mode_mix = 0.F;
        activate_mode(pending_mode);
        mode_transition = 2U;
      }
    } else if (mode_transition == 2U) {
      mode_mix = std::min(1.F, mode_mix + mode_fade_step);
      if (mode_mix >= 1.F) {
        mode_mix = 1.F;
        mode_transition = 0U;
      }
    }
  }

  void process(float* data, std::size_t frames) noexcept {
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const bool refresh_control = control_countdown == 0U;
      if (refresh_control) {
        snapshot_targets();
        control_countdown = kControlPeriod - 1U;
      } else {
        --control_countdown;
      }
      glide();
      if (refresh_control) refresh_routing_and_mix();
      advance_mode_transition();

      const float rate = std::clamp(value[1], .05F, 2.5F);
      const float depth = std::clamp(value[2], 0.F, .008F);
      const float shape = clamp01(value[3]);
      const float spread = clamp01(value[4]);
      const float motion = clamp01(value[5]);
      const float dry_l = data[frame * 2];
      const float dry_r = data[frame * 2 + 1];
      std::array<float, 2> wet{};

      if (active_profile->branch == DriftParityBranch::Classic) {
        const float normalized_rate = std::clamp((rate - .05F) / 2.45F, 0.F, 1.F);
        const float normalized_depth = std::clamp(depth / .008F, 0.F, 1.F);
        wet = classic.process_sample(
            dry_l, dry_r, normalized_rate, normalized_depth, shape, spread, motion);
      } else {
        wet = standard.process_sample(dry_l, dry_r, rate, depth, shape, spread, motion);
      }

      const float processed_l = std::clamp(dry_l * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
      const float processed_r = std::clamp(dry_r * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
      data[frame * 2] = dry_l + (processed_l - dry_l) * mode_mix;
      data[frame * 2 + 1] = dry_r + (processed_r - dry_r) * mode_mix;
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
  else if(name=="shape") index=3; else if(name=="spread") index=4; else if(name=="motion") index=5;
  else if(name=="mix") index=6;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
