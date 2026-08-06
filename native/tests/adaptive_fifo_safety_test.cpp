#include "calcotone/adaptive_fifo_safety.hpp"
#include "calcotone/elastic_stereo_fifo.hpp"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <memory>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::uint64_t kPeriod = 64U;
constexpr std::uint64_t kBase = 128U;

void advance(calcotone::AdaptiveFifoSafety& policy, double seconds) {
  std::uint64_t remaining = static_cast<std::uint64_t>(seconds * kRate);
  while (remaining != 0U) {
    const auto block = static_cast<std::size_t>(remaining > 1024U ? 1024U : remaining);
    policy.observe_block(block, 0U, 0U, 0U);
    remaining -= block;
  }
}

void test_clean_playback_stays_at_user_baseline() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  advance(policy, 180.0);
  const auto state = policy.state();
  assert(state.base_target_frames == kBase);
  assert(state.target_frames == kBase);
  assert(state.raises == 0U);
  assert(state.relaxations == 0U);
  assert(state.instability_events == 0U);
}

void test_first_starvation_adds_one_period() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  assert(policy.observe_block(128U, 1U, 0U, 0U));
  assert(policy.target_frames() == kBase + kPeriod);
  assert(policy.state().raises == 1U);
  assert(policy.state().instability_events == 1U);
}

void test_repeated_faults_are_bounded() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  for (unsigned episode = 0U; episode < 100U; ++episode) {
    policy.observe_block(128U, 1U, 1U, 0U);
    advance(policy, .55);
  }
  const auto state = policy.state();
  assert(state.target_frames == state.maximum_target_frames);
  assert(state.maximum_target_frames == kBase + kPeriod * 6U);
  assert(state.target_frames - state.base_target_frames <= 384U);  // 8 ms at 48 kHz.
}

void test_burst_inside_cooldown_requires_recurrence() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  assert(policy.observe_block(128U, 1U, 0U, 0U));
  const auto first_target = policy.target_frames();
  assert(!policy.observe_block(128U, 1U, 0U, 0U));
  advance(policy, .55);
  // One follow-up inside the cooldown is absorbed by the first raise.
  assert(policy.target_frames() == first_target);

  assert(policy.observe_block(128U, 1U, 0U, 0U));
  assert(!policy.observe_block(128U, 2U, 0U, 0U));
  advance(policy, .55);
  assert(policy.target_frames() > first_target + kPeriod);
}

void test_stable_playback_relaxes_to_baseline() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  for (unsigned episode = 0U; episode < 4U; ++episode) {
    policy.observe_block(128U, 1U, 0U, 0U);
    advance(policy, .55);
  }
  assert(policy.target_frames() > kBase);
  const auto raised = policy.target_frames();
  advance(policy, 31.0);
  assert(policy.target_frames() == raised - kPeriod);
  advance(policy, 180.0);
  assert(policy.target_frames() == kBase);
  assert(policy.state().relaxations > 0U);
}

void test_overrun_drains_an_elevated_target() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  assert(policy.observe_block(128U, 1U, 0U, 0U));
  advance(policy, .55);
  assert(policy.observe_block(128U, 1U, 0U, 0U));
  const auto raised = policy.target_frames();
  advance(policy, .55);
  assert(policy.observe_block(128U, 0U, 0U, 1U));
  assert(policy.target_frames() == raised - kPeriod);
}

void test_deadline_miss_preemptively_adds_safety() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  assert(policy.observe_deadline_miss());
  assert(policy.target_frames() == kBase + kPeriod);
  assert(policy.state().instability_events == 1U);
}

void test_large_period_keeps_added_latency_bounded_to_one_period() {
  constexpr std::uint64_t period = 2048U;
  calcotone::AdaptiveFifoSafety policy(period * 2U, period, kRate);
  assert(policy.maximum_target_frames() == period * 3U);
  for (unsigned episode = 0U; episode < 8U; ++episode) {
    policy.observe_block(256U, 8U, 0U, 0U);
    advance(policy, .55);
  }
  assert(policy.target_frames() == period * 3U);
}

void test_policy_target_reaches_live_fifo_and_trim() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  auto fifo = std::make_unique<calcotone::ElasticStereoFifo>(kBase);
  assert(fifo->target_frames() == kBase);

  assert(policy.observe_block(128U, 1U, 0U, 0U));
  fifo->set_target_frames(policy.target_frames());
  assert(fifo->target_frames() == kBase + kPeriod);

  for (unsigned frame = 0U; frame < 512U; ++frame)
    assert(fifo->push(.1F, -.1F));
  fifo->trim_to_target();
  assert(fifo->available() == fifo->target_frames());

  advance(policy, 31.0);
  fifo->set_target_frames(policy.target_frames());
  assert(fifo->target_frames() == kBase);
  fifo->trim_to_target();
  assert(fifo->available() == kBase);
}

void test_reset_restores_baseline_and_telemetry() {
  calcotone::AdaptiveFifoSafety policy(kBase, kPeriod, kRate);
  policy.observe_block(128U, 1U, 1U, 0U);
  policy.reset();
  const auto state = policy.state();
  assert(state.target_frames == kBase);
  assert(state.raises == 0U);
  assert(state.relaxations == 0U);
  assert(state.instability_events == 0U);
  assert(state.stable_seconds == 0.0);
}
}  // namespace

int main() {
  test_clean_playback_stays_at_user_baseline();
  test_first_starvation_adds_one_period();
  test_repeated_faults_are_bounded();
  test_burst_inside_cooldown_requires_recurrence();
  test_stable_playback_relaxes_to_baseline();
  test_overrun_drains_an_elevated_target();
  test_deadline_miss_preemptively_adds_safety();
  test_large_period_keeps_added_latency_bounded_to_one_period();
  test_policy_target_reaches_live_fifo_and_trim();
  test_reset_restores_baseline_and_telemetry();
}
