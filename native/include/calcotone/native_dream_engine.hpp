#pragma once

#include "calcotone/dream_buffer_parity_processor.hpp"
#include "calcotone/native_rack.hpp"

#include <cstddef>
#include <memory>

namespace calcotone {

// Shared post-rack Dream system. One instance serves both native input lanes,
// matching the browser's single stereo memory rather than maintaining separate
// hidden memories per input.
class NativeDreamEngine final {
 public:
  explicit NativeDreamEngine(float sample_rate = 48'000.F,
                             std::size_t max_block_frames = 2048U);
  ~NativeDreamEngine();
  NativeDreamEngine(const NativeDreamEngine&) = delete;
  NativeDreamEngine& operator=(const NativeDreamEngine&) = delete;

  void begin_block(std::size_t frames) noexcept;
  void inject_route(RackModule destination, float* lane_one, float* lane_two,
                    std::size_t frames, bool enabled) noexcept;
  void capture_module(RackModule source, const float* lane_one, const float* lane_two,
                      std::size_t frames, bool enabled) noexcept;
  void finish_block(float* lane_one, float* lane_two, std::size_t frames,
                    bool processed_path_enabled) noexcept;
  void reset() noexcept;

  [[nodiscard]] DreamBufferParityProfile profile() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
