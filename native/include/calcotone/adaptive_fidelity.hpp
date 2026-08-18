#pragma once

#include <atomic>
#include <cstdint>

namespace calcotone {

enum class FidelityLevel : unsigned { Safe = 0U, Balanced = 1U, Full = 2U };

struct AdaptiveFidelityState {
  FidelityLevel level{FidelityLevel::Balanced};
  float render_load{};
  std::uint64_t transitions{};
};

// Host-fed load controller. Timing stays in the WASAPI transport; the DSP only
// receives a discrete quality tier at block boundaries and never reads a clock.
class AdaptiveFidelity final {
 public:
  AdaptiveFidelity() noexcept = default;

  [[nodiscard]] bool observe(std::uint64_t render_micros,
                             std::uint64_t deadline_micros) noexcept;
  [[nodiscard]] AdaptiveFidelityState state() const noexcept;
  void reset() noexcept;

 private:
  void publish() noexcept;

  FidelityLevel level_{FidelityLevel::Balanced};
  float render_load_{};
  unsigned sustained_high_{};
  unsigned sustained_low_{};
  std::uint64_t transitions_{};
  std::atomic<unsigned> published_level_{static_cast<unsigned>(FidelityLevel::Balanced)};
  std::atomic<float> published_load_{};
  std::atomic<std::uint64_t> published_transitions_{};
};

}  // namespace calcotone
