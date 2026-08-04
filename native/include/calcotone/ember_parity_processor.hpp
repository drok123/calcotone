#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

// Native migration boundary for src/audio/effects/Saturation.ts. The processor
// preserves the canonical branch architecture: generic 4x-style waveshaping,
// named tube coloration, magnetic-core transformer behavior, and digital
// capture machines. process() performs no allocation.
class EmberParityProcessor final {
 public:
  explicit EmberParityProcessor(float sample_rate = 48'000.F);
  ~EmberParityProcessor();
  EmberParityProcessor(const EmberParityProcessor&) = delete;
  EmberParityProcessor& operator=(const EmberParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
