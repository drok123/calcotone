#include "calcotone/adaptive_fidelity.hpp"

#include <algorithm>

namespace calcotone {

bool AdaptiveFidelity::observe(
    std::uint64_t render_micros, std::uint64_t deadline_micros) noexcept {
  if (deadline_micros == 0U) return false;
  const float instantaneous = std::clamp(
      static_cast<float>(render_micros) / static_cast<float>(deadline_micros), 0.F, 4.F);
  render_load_ += (instantaneous - render_load_) * .08F;
  const auto previous = level_;

  if (instantaneous >= 1.F) {
    sustained_high_ = 0U;
    sustained_low_ = 0U;
    if (level_ != FidelityLevel::Safe)
      level_ = static_cast<FidelityLevel>(static_cast<unsigned>(level_) - 1U);
  } else if (render_load_ > .74F) {
    sustained_low_ = 0U;
    if (++sustained_high_ >= 12U && level_ != FidelityLevel::Safe) {
      level_ = static_cast<FidelityLevel>(static_cast<unsigned>(level_) - 1U);
      sustained_high_ = 0U;
    }
  } else if (render_load_ < .46F) {
    sustained_high_ = 0U;
    if (++sustained_low_ >= 1000U && level_ != FidelityLevel::Full) {
      level_ = static_cast<FidelityLevel>(static_cast<unsigned>(level_) + 1U);
      sustained_low_ = 0U;
    }
  } else {
    sustained_high_ = 0U;
    sustained_low_ = 0U;
  }

  const bool changed = level_ != previous;
  if (changed) ++transitions_;
  publish();
  return changed;
}

AdaptiveFidelityState AdaptiveFidelity::state() const noexcept {
  return {
    static_cast<FidelityLevel>(published_level_.load(std::memory_order_relaxed)),
    published_load_.load(std::memory_order_relaxed),
    published_transitions_.load(std::memory_order_relaxed),
  };
}

void AdaptiveFidelity::reset() noexcept {
  level_ = FidelityLevel::Balanced;
  render_load_ = 0.F;
  sustained_high_ = 0U;
  sustained_low_ = 0U;
  transitions_ = 0U;
  publish();
}

void AdaptiveFidelity::publish() noexcept {
  published_level_.store(static_cast<unsigned>(level_), std::memory_order_relaxed);
  published_load_.store(render_load_, std::memory_order_relaxed);
  published_transitions_.store(transitions_, std::memory_order_relaxed);
}

}  // namespace calcotone
