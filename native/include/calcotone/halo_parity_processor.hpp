#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>

namespace calcotone {

class HaloParityProcessor final {
 public:
  explicit HaloParityProcessor(float sample_rate = 48'000.F);
  ~HaloParityProcessor();
  HaloParityProcessor(const HaloParityProcessor&) = delete;
  HaloParityProcessor& operator=(const HaloParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void set_reference_clock(std::uint64_t position, std::uint64_t frames,
                           bool running) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
