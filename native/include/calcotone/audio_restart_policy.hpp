#pragma once

#include <cstdint>

namespace calcotone {

enum class AudioRuntimeFault : std::uint8_t {
  None,
  DeviceInvalidated,
  ResourcesInvalidated,
  ServiceStopped,
  BufferError,
  Other,
};

struct AudioRestartDecision {
  bool restart{};
  std::uint32_t consecutive_buffer_errors{};
};

// Realtime-thread-local policy. Device/resource/service invalidation requires a
// fresh WASAPI graph immediately. A single buffer error is allowed to recover;
// repeated consecutive buffer failures trigger graph recreation.
class AudioRestartPolicy final {
 public:
  explicit AudioRestartPolicy(std::uint32_t buffer_error_threshold = 3U) noexcept;

  AudioRestartDecision observe(AudioRuntimeFault fault) noexcept;
  void observe_success() noexcept;
  void reset() noexcept;

  [[nodiscard]] std::uint32_t consecutive_buffer_errors() const noexcept {
    return consecutive_buffer_errors_;
  }

 private:
  std::uint32_t threshold_{};
  std::uint32_t consecutive_buffer_errors_{};
};

}  // namespace calcotone
