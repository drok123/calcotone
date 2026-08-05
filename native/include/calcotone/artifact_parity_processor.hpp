#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

class ArtifactParityProcessor final {
 public:
  explicit ArtifactParityProcessor(float sample_rate = 48'000.F);
  ~ArtifactParityProcessor();
  ArtifactParityProcessor(const ArtifactParityProcessor&) = delete;
  ArtifactParityProcessor& operator=(const ArtifactParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
