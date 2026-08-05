#include "calcotone/stream_recovery.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <limits>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kPi = 3.14159265358979323846F;

void test_uninterrupted_input_is_bit_exact() {
  calcotone::StreamRecovery recovery(kRate);
  for (std::size_t frame = 0U; frame < 48'000U; ++frame) {
    const float left = .37F * std::sin(2.F * kPi * 997.F * static_cast<float>(frame) / kRate);
    const float right = -.81F * left;
    float output_left = 0.F, output_right = 0.F;
    assert(!recovery.process(true, left, right, output_left, output_right));
    assert(output_left == left);
    assert(output_right == right);
  }
}

void test_one_event_per_starvation_episode() {
  calcotone::StreamRecovery recovery(kRate);
  float left = 0.F, right = 0.F;
  recovery.process(true, .4F, -.2F, left, right);
  unsigned events = 0U;
  for (unsigned frame = 0U; frame < 96U; ++frame)
    events += recovery.process(false, 0.F, 0.F, left, right) ? 1U : 0U;
  assert(events == 1U);
  assert(recovery.starving());
  assert(std::abs(left) < .4F);
  assert(std::abs(right) < .2F);

  for (std::size_t frame = 0U; frame < recovery.recovery_frames(); ++frame)
    recovery.process(true, -.35F, .18F, left, right);
  assert(!recovery.starving());
  assert(!recovery.recovering());
  assert(left == -.35F);
  assert(right == .18F);

  assert(recovery.process(false, 0.F, 0.F, left, right));
}

void test_resume_edge_is_smoothed() {
  calcotone::StreamRecovery recovery(kRate);
  float left = 0.F, right = 0.F;
  recovery.process(true, .72F, -.58F, left, right);
  for (unsigned frame = 0U; frame < 48U; ++frame)
    recovery.process(false, 0.F, 0.F, left, right);

  float previous_left = left;
  float maximum_step = 0.F;
  for (std::size_t frame = 0U; frame < recovery.recovery_frames(); ++frame) {
    recovery.process(true, -.72F, .58F, left, right);
    maximum_step = std::max(maximum_step, std::abs(left - previous_left));
    previous_left = left;
  }
  assert(maximum_step < .035F);
  assert(left == -.72F);
  assert(right == .58F);
}

void test_nonfinite_input_enters_safe_starvation() {
  calcotone::StreamRecovery recovery(kRate);
  float left = 0.F, right = 0.F;
  recovery.process(true, .2F, -.2F, left, right);
  assert(recovery.process(true, std::numeric_limits<float>::quiet_NaN(),
                          std::numeric_limits<float>::infinity(), left, right));
  assert(std::isfinite(left));
  assert(std::isfinite(right));
  assert(recovery.starving());
}

void test_marked_discontinuity_uses_recovery_without_false_underrun() {
  calcotone::StreamRecovery recovery(kRate);
  float left = 0.F, right = 0.F;
  recovery.process(true, .6F, .6F, left, right);
  recovery.mark_discontinuity();
  assert(!recovery.process(true, -.6F, -.6F, left, right));
  assert(recovery.recovering());
  assert(left > -.6F && left < .6F);
  for (std::size_t frame = 1U; frame < recovery.recovery_frames(); ++frame)
    recovery.process(true, -.6F, -.6F, left, right);
  assert(left == -.6F && right == -.6F);
}

void test_sample_rate_scales_recovery_window() {
  calcotone::StreamRecovery low(48'000.F);
  calcotone::StreamRecovery high(96'000.F);
  assert(high.recovery_frames() == low.recovery_frames() * 2U);
}
}  // namespace

int main() {
  test_uninterrupted_input_is_bit_exact();
  test_one_event_per_starvation_episode();
  test_resume_edge_is_smoothed();
  test_nonfinite_input_enters_safe_starvation();
  test_marked_discontinuity_uses_recovery_without_false_underrun();
  test_sample_rate_scales_recovery_window();
}
