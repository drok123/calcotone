#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

// Native port of public/ember-digital-capture-processor.js with Ember's
// canonical digital branch gain, linear wet/dry mix, DC block, and limiter.
class EmberDigitalCaptureProcessor final {
 public:
  explicit EmberDigitalCaptureProcessor(float sample_rate = 48'000.F);
  ~EmberDigitalCaptureProcessor();
  EmberDigitalCaptureProcessor(const EmberDigitalCaptureProcessor&) = delete;
  EmberDigitalCaptureProcessor& operator=(const EmberDigitalCaptureProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
