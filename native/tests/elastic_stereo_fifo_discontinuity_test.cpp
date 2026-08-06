#include "calcotone/elastic_stereo_fifo.hpp"
#include "calcotone/stream_recovery.hpp"

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>

namespace {
void fill_step(calcotone::ElasticStereoFifo& fifo) {
  for (std::uint64_t frame = 0U; frame < 96U; ++frame) {
    // The marker at 16 belongs to history that startup trim discards. The marker
    // at 64 remains inside the retained 64-frame live timeline and must survive.
    const bool discontinuity = frame == 16U || frame == 64U;
    const float sample = frame < 64U ? .8F : -.8F;
    assert(fifo.push(sample, -sample, discontinuity));
  }
  fifo.trim_to_target();
}

void test_marker_arrives_once_at_the_new_timeline() {
  auto fifo = std::make_unique<calcotone::ElasticStereoFifo>(64U);
  fill_step(*fifo);

  unsigned marker_count = 0U;
  bool saw_marker = false;
  for (unsigned frame = 0U; frame < 56U; ++frame) {
    float left = 0.F, right = 0.F;
    bool discontinuity = false;
    assert(fifo->pull(left, right, &discontinuity));
    if (!saw_marker) {
      if (discontinuity) {
        saw_marker = true;
        ++marker_count;
        assert(left == -.8F);
        assert(right == .8F);
      } else {
        // Hermite must not pre-ring across the step before the marker arrives.
        assert(left > .799F);
        assert(right < -.799F);
      }
    } else {
      marker_count += discontinuity ? 1U : 0U;
      assert(left < -.799F);
      assert(right > .799F);
    }
  }
  assert(saw_marker);
  assert(marker_count == 1U);
}

void test_marker_starts_the_click_safe_resume_bridge() {
  auto fifo = std::make_unique<calcotone::ElasticStereoFifo>(64U);
  fill_step(*fifo);
  calcotone::StreamRecovery recovery(48'000.F);

  float output_left = 0.F, output_right = 0.F;
  float previous_left = 0.F;
  float maximum_step = 0.F;
  bool marker_seen = false;
  for (unsigned frame = 0U; frame < 56U; ++frame) {
    float input_left = 0.F, input_right = 0.F;
    bool discontinuity = false;
    assert(fifo->pull(input_left, input_right, &discontinuity));
    if (discontinuity) {
      marker_seen = true;
      recovery.mark_discontinuity();
    }
    recovery.process(true, input_left, input_right, output_left, output_right);
    if (frame != 0U)
      maximum_step = std::max(maximum_step, std::abs(output_left - previous_left));
    previous_left = output_left;
  }
  assert(marker_seen);
  assert(maximum_step < .04F);
}

void test_legacy_callers_default_to_no_marker() {
  auto fifo = std::make_unique<calcotone::ElasticStereoFifo>(32U);
  for (unsigned frame = 0U; frame < 48U; ++frame)
    assert(fifo->push(.1F, -.1F));
  fifo->trim_to_target();
  for (unsigned frame = 0U; frame < 20U; ++frame) {
    float left = 0.F, right = 0.F;
    bool discontinuity = true;
    assert(fifo->pull(left, right, &discontinuity));
    assert(!discontinuity);
  }
}
}  // namespace

int main() {
  test_marker_arrives_once_at_the_new_timeline();
  test_marker_starts_the_click_safe_resume_bridge();
  test_legacy_callers_default_to_no_marker();
}
