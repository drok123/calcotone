#include "calcotone/audio_restart_policy.hpp"

#include <algorithm>
#include <limits>

namespace calcotone {

AudioRestartPolicy::AudioRestartPolicy(std::uint32_t buffer_error_threshold) noexcept
    : threshold_(std::max(1U, buffer_error_threshold)) {}

AudioRestartDecision AudioRestartPolicy::observe(AudioRuntimeFault fault) noexcept {
  switch (fault) {
    case AudioRuntimeFault::None:
      observe_success();
      return {false, consecutive_buffer_errors_};
    case AudioRuntimeFault::DeviceInvalidated:
    case AudioRuntimeFault::ResourcesInvalidated:
    case AudioRuntimeFault::ServiceStopped:
      consecutive_buffer_errors_ = 0U;
      return {true, 0U};
    case AudioRuntimeFault::BufferError:
      if (consecutive_buffer_errors_ != std::numeric_limits<std::uint32_t>::max())
        ++consecutive_buffer_errors_;
      return {consecutive_buffer_errors_ >= threshold_, consecutive_buffer_errors_};
    case AudioRuntimeFault::Other:
      consecutive_buffer_errors_ = 0U;
      return {false, 0U};
  }
  return {false, consecutive_buffer_errors_};
}

void AudioRestartPolicy::observe_success() noexcept {
  consecutive_buffer_errors_ = 0U;
}

void AudioRestartPolicy::reset() noexcept {
  consecutive_buffer_errors_ = 0U;
}

}  // namespace calcotone
