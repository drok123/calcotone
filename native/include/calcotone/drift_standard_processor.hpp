#pragma once

#include <array>
#include <cstddef>
#include <memory>

namespace calcotone {

// Native four-voice graph for Chorus.ts modes 0-13. The processor mirrors the
// original splitter, independent delay/filter/feedback voices, stereo panners,
// CE-1/Dimension D preamps, and model-specific flanger calibration. The caller
// owns the module wet/dry mix.
class DriftStandardProcessor final {
 public:
  explicit DriftStandardProcessor(float sample_rate = 48'000.F);
  ~DriftStandardProcessor();
  DriftStandardProcessor(const DriftStandardProcessor&) = delete;
  DriftStandardProcessor& operator=(const DriftStandardProcessor&) = delete;

  void reset() noexcept;
  void set_mode(unsigned mode) noexcept;
  void nudge_reference_phase(float normalized_phase, float amount) noexcept;
  [[nodiscard]] std::array<float, 2> process_sample(
      float left,
      float right,
      float rate,
      float depth,
      float shape,
      float spread,
      float motion) noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
