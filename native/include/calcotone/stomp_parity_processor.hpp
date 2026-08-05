#pragma once

#include <cstddef>
#include <memory>
#include <string_view>

namespace calcotone {

inline constexpr std::size_t kStompModeCount = 14U;

class StompParityProcessor final {
 public:
  explicit StompParityProcessor(float sample_rate = 48'000.F);
  ~StompParityProcessor();
  StompParityProcessor(const StompParityProcessor&) = delete;
  StompParityProcessor& operator=(const StompParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
