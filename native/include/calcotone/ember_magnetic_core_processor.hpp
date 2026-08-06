#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

// Native port of public/magnetic-core-processor.js plus Ember's canonical
// post-stage calibration from Saturation.ts. Processing is allocation-free.
class EmberMagneticCoreProcessor final {
 public:
  explicit EmberMagneticCoreProcessor(float sample_rate = 48'000.F);
  ~EmberMagneticCoreProcessor();
  EmberMagneticCoreProcessor(const EmberMagneticCoreProcessor&) = delete;
  EmberMagneticCoreProcessor& operator=(const EmberMagneticCoreProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
