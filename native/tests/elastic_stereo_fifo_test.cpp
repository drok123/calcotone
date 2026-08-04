#include "calcotone/elastic_stereo_fifo.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <memory>

namespace {
void run_drift(double producer_ratio) {
  constexpr double rate = 48'000.0;
  constexpr std::uint64_t target = 256;
  // ElasticStereoFifo owns a 1 MiB fixed sample ring. Keep the test instance on
  // the heap so Windows' default 1 MiB executable stack is not exhausted before
  // the first assertion runs.
  auto fifo = std::make_unique<calcotone::ElasticStereoFifo>(target);
  std::uint64_t produced = 0;
  for (; produced < target; ++produced) {
    const float sample = .4F * std::sin(static_cast<float>(6.283185307 * 997.0 * produced / rate));
    assert(fifo->push(sample, -sample));
  }
  fifo->trim_to_target();

  double producer_phase = 0.0;
  float previous = 0.F;
  float maximum_step = 0.F;
  for (std::uint64_t output_frame = 0; output_frame < 480'000; ++output_frame) {
    producer_phase += producer_ratio;
    while (producer_phase >= 1.0) {
      const float sample = .4F * std::sin(static_cast<float>(6.283185307 * 997.0 * produced / rate));
      assert(fifo->push(sample, -sample));
      ++produced;
      producer_phase -= 1.0;
    }
    float left = 0.F, right = 0.F;
    assert(fifo->pull(left, right));
    assert(std::isfinite(left) && std::isfinite(right));
    assert(std::abs(left + right) < 1e-6F);
    maximum_step = std::max(maximum_step, std::abs(left - previous));
    previous = left;
  }
  assert(fifo->available() > 64U && fifo->available() < 512U);
  assert(fifo->overruns() == 0U);
  assert(fifo->resampled_frames() > 0U);
  assert(maximum_step < .08F);
}

void run_periodic_blocks() {
  constexpr double rate = 44'100.0;
  constexpr std::uint64_t target = 264;
  constexpr std::uint64_t period = 132;
  auto fifo = std::make_unique<calcotone::ElasticStereoFifo>(target);
  std::uint64_t produced = 0;
  for (; produced < target; ++produced) {
    const float sample = .35F * std::sin(static_cast<float>(6.283185307 * 3'700.0 * produced / rate));
    assert(fifo->push(sample, sample));
  }
  fifo->trim_to_target();
  double drift_phase = 0.0;
  float previous = 0.F;
  float maximum_step = 0.F;
  for (unsigned block = 0; block < 4'000; ++block) {
    std::uint64_t capture_frames = period;
    drift_phase += .003 * period;
    if (drift_phase >= 1.0) { ++capture_frames; drift_phase -= 1.0; }
    for (std::uint64_t frame = 0; frame < capture_frames; ++frame, ++produced) {
      const float sample = .35F * std::sin(static_cast<float>(6.283185307 * 3'700.0 * produced / rate));
      assert(fifo->push(sample, sample));
    }
    for (std::uint64_t frame = 0; frame < period; ++frame) {
      float left = 0.F, right = 0.F;
      assert(fifo->pull(left, right));
      maximum_step = std::max(maximum_step, std::abs(left - previous));
      previous = left;
    }
  }
  assert(fifo->available() > 64U && fifo->available() < 512U);
  assert(maximum_step < .2F);
}
}  // namespace

int main() {
  run_drift(1.003);
  run_drift(.997);
  run_periodic_blocks();
  std::cout << "elastic stereo FIFO drift bridge passed\n";
}
