#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

inline constexpr std::size_t kPressureModeCount = 4U;
inline constexpr std::size_t kPressureStyleCount = 4U;

class PressureParityProcessor final {
 public:
  explicit PressureParityProcessor(float sample_rate = 48'000.F);
  ~PressureParityProcessor();
  PressureParityProcessor(const PressureParityProcessor&) = delete;
  PressureParityProcessor& operator=(const PressureParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void set_bypassed(bool bypassed) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
