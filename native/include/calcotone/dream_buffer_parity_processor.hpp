#pragma once

#include <array>
#include <cstddef>
#include <memory>

namespace calcotone {

struct DreamBufferParityProfile {
  float fill_ratio{};
  float history_seconds{8.F};
  float input_peak{};
  std::size_t captures{};
  std::array<float, 3> memory_age_seconds{};
  std::array<float, 3> memory_intent{};
};

// Allocation-free realtime core for the shared V12 Dream memory. The caller
// renders the three historical heads before processing the current rack block,
// then captures the weighted module sends into the same timeline afterward.
class DreamBufferParityProcessor final {
 public:
  explicit DreamBufferParityProcessor(float sample_rate = 48'000.F);
  ~DreamBufferParityProcessor();
  DreamBufferParityProcessor(const DreamBufferParityProcessor&) = delete;
  DreamBufferParityProcessor& operator=(const DreamBufferParityProcessor&) = delete;

  void render_heads(float* now, float* echo, float* ghost,
                    std::size_t frames) noexcept;
  void capture(const float* interleaved_stereo, std::size_t frames) noexcept;
  void reset() noexcept;

  [[nodiscard]] DreamBufferParityProfile profile() const noexcept;
  [[nodiscard]] std::size_t samples_written() const noexcept;
  [[nodiscard]] float sample_rate() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
