#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

// Dedicated native migration of src/audio/effects/Reverb.ts. The processor owns
// fixed-capacity storage for every canonical Atmos delay line and performs no
// allocation from process().
class AtmosParityProcessor final {
 public:
  explicit AtmosParityProcessor(float sample_rate = 48'000.F);
  ~AtmosParityProcessor();
  AtmosParityProcessor(const AtmosParityProcessor&) = delete;
  AtmosParityProcessor& operator=(const AtmosParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
