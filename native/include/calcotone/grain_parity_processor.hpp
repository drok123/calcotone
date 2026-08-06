#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

class GrainParityProcessor final {
 public:
  explicit GrainParityProcessor(float sample_rate = 48'000.F);
  ~GrainParityProcessor();
  GrainParityProcessor(const GrainParityProcessor&) = delete;
  GrainParityProcessor& operator=(const GrainParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
