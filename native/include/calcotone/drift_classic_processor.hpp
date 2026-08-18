#pragma once

#include <array>
#include <cstddef>
#include <memory>

namespace calcotone {

// Allocation-free native port of public/drift-classic-processor.js. Parameters
// are normalized exactly as DriftClassicStage supplies them. The caller owns
// wet/dry routing so this processor returns the fully-wet stereo model output.
class DriftClassicProcessor final {
 public:
  explicit DriftClassicProcessor(float sample_rate = 48'000.F);
  ~DriftClassicProcessor();
  DriftClassicProcessor(const DriftClassicProcessor&) = delete;
  DriftClassicProcessor& operator=(const DriftClassicProcessor&) = delete;

  void reset() noexcept;
  void set_model(unsigned model) noexcept;
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
