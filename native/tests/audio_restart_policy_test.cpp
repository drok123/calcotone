#include "calcotone/audio_restart_policy.hpp"

#include <cassert>

int main() {
  using calcotone::AudioRestartPolicy;
  using calcotone::AudioRuntimeFault;

  AudioRestartPolicy policy(3U);
  assert(policy.observe(AudioRuntimeFault::DeviceInvalidated).restart);
  assert(policy.observe(AudioRuntimeFault::ResourcesInvalidated).restart);
  assert(policy.observe(AudioRuntimeFault::ServiceStopped).restart);

  policy.reset();
  auto decision = policy.observe(AudioRuntimeFault::BufferError);
  assert(!decision.restart && decision.consecutive_buffer_errors == 1U);
  decision = policy.observe(AudioRuntimeFault::BufferError);
  assert(!decision.restart && decision.consecutive_buffer_errors == 2U);
  decision = policy.observe(AudioRuntimeFault::BufferError);
  assert(decision.restart && decision.consecutive_buffer_errors == 3U);

  policy.reset();
  policy.observe(AudioRuntimeFault::BufferError);
  policy.observe_success();
  assert(policy.consecutive_buffer_errors() == 0U);
  assert(!policy.observe(AudioRuntimeFault::BufferError).restart);

  policy.reset();
  policy.observe(AudioRuntimeFault::BufferError);
  policy.observe(AudioRuntimeFault::BufferError);
  decision = policy.observe(AudioRuntimeFault::None);
  assert(!decision.restart && decision.consecutive_buffer_errors == 0U);
  assert(!policy.observe(AudioRuntimeFault::BufferError).restart);

  policy.reset();
  policy.observe(AudioRuntimeFault::BufferError);
  policy.observe(AudioRuntimeFault::BufferError);
  decision = policy.observe(AudioRuntimeFault::Other);
  assert(!decision.restart && decision.consecutive_buffer_errors == 0U);
  assert(!policy.observe(AudioRuntimeFault::BufferError).restart);

  AudioRestartPolicy immediate(0U);
  decision = immediate.observe(AudioRuntimeFault::BufferError);
  assert(decision.restart && decision.consecutive_buffer_errors == 1U);
}
