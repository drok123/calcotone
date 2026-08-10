#include "calcotone/native_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <cmath>
#include <iostream>
#include <string_view>
#include <thread>
#include <vector>

namespace {
float tail_mean(const std::vector<float>& stereo, std::size_t frames) {
  const std::size_t start = frames * 3U / 4U;
  double sum = 0.0;
  for (std::size_t frame = start; frame < frames; ++frame)
    sum += stereo[frame * 2U];
  return static_cast<float>(sum / static_cast<double>(frames - start));
}
}

int main() {
  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 4096;

  // Input routing is a real native control surface, not UI-only state. Validate
  // the exact route targets independently from the processor smoothing path.
  {
    const auto stereo = calcotone::input_route_target(calcotone::InputRoutingMode::Stereo, 1.F, false, false);
    assert(std::abs(stereo.lane_one_left - 1.F) < 1e-6F);
    assert(std::abs(stereo.lane_one_right) < 1e-6F);
    assert(std::abs(stereo.lane_two_left) < 1e-6F);
    assert(std::abs(stereo.lane_two_right - 1.F) < 1e-6F);

    const auto narrow = calcotone::input_route_target(calcotone::InputRoutingMode::Stereo, 0.F, false, false);
    assert(std::abs(narrow.lane_one_left - .5F) < 1e-6F);
    assert(std::abs(narrow.lane_one_right - .5F) < 1e-6F);
    assert(std::abs(narrow.lane_two_left - .5F) < 1e-6F);
    assert(std::abs(narrow.lane_two_right - .5F) < 1e-6F);

    const auto wide = calcotone::input_route_target(calcotone::InputRoutingMode::Stereo, 2.F, false, false);
    assert(std::abs(wide.lane_one_left - 1.5F) < 1e-6F);
    assert(std::abs(wide.lane_one_right + .5F) < 1e-6F);
    assert(std::abs(wide.lane_two_left + .5F) < 1e-6F);
    assert(std::abs(wide.lane_two_right - 1.5F) < 1e-6F);

    const auto swapped = calcotone::input_route_target(calcotone::InputRoutingMode::Swap, 1.F, false, false);
    assert(std::abs(swapped.lane_one_left) < 1e-6F);
    assert(std::abs(swapped.lane_one_right - 1.F) < 1e-6F);
    assert(std::abs(swapped.lane_two_left - 1.F) < 1e-6F);
    assert(std::abs(swapped.lane_two_right) < 1e-6F);

    const auto mono = calcotone::input_route_target(calcotone::InputRoutingMode::SumMono, 1.F, true, false);
    assert(std::abs(mono.lane_one_left + .5F) < 1e-6F);
    assert(std::abs(mono.lane_one_right - .5F) < 1e-6F);
    assert(std::abs(mono.lane_two_left) < 1e-6F);
    assert(std::abs(mono.lane_two_right) < 1e-6F);
  }

  calcotone::NativeProcessor processor(rate);
  std::vector<float> input(frames * 2), output(frames * 2);
  for (std::size_t frame = 0; frame < frames; ++frame) {
    input[frame * 2] = .22F * std::sin(6.2831853F * 220.F * frame / rate);
    input[frame * 2 + 1] = .18F * std::sin(6.2831853F * 440.F * frame / rate);
  }

  // Construction is intentionally silent until the faceplate publishes a
  // coherent state and explicitly arms the engine.
  processor.process(input.data(), output.data(), frames);
  assert(std::all_of(output.begin(), output.end(), [](float value) { return value == 0.F; }));
  processor.set_active(true);

  processor.process(input.data(), output.data(), frames);
  assert(std::all_of(output.begin(), output.end(), [](float value) { return std::isfinite(value) && std::abs(value) <= 1.F; }));
  assert(std::any_of(output.begin(), output.end(), [](float value) { return std::abs(value) > 1e-5F; }));

  // Exercise click-safe native mode/polarity transitions on a deterministic DC
  // source. The 18 ms route smoother must settle without non-finite samples.
  std::fill(input.begin(), input.end(), 0.F);
  for (std::size_t frame = 0; frame < frames; ++frame) input[frame * 2] = .2F;
  processor.set_input_gain(1.F);
  processor.set_output_gain(.72F);
  processor.set_input_mode(calcotone::InputRoutingMode::Right);
  processor.process(input.data(), output.data(), frames);
  assert(std::all_of(output.begin(), output.end(), [](float value) { return std::isfinite(value); }));
  const float right_only_from_left = std::abs(tail_mean(output, frames));
  assert(right_only_from_left < .003F);

  processor.set_input_mode(calcotone::InputRoutingMode::Left);
  processor.process(input.data(), output.data(), frames);
  const float left_only = tail_mean(output, frames);
  assert(left_only > .08F);

  processor.set_input_polarity(true, false);
  processor.process(input.data(), output.data(), frames);
  const float inverted_left = tail_mean(output, frames);
  assert(inverted_left < -.08F);
  processor.set_input_polarity(false, false);
  processor.set_input_mode(calcotone::InputRoutingMode::Stereo);
  processor.set_input_width(1.F);

  for (std::size_t frame = 0; frame < frames; ++frame) {
    input[frame * 2] = .22F * std::sin(6.2831853F * 220.F * frame / rate);
    input[frame * 2 + 1] = .18F * std::sin(6.2831853F * 440.F * frame / rate);
  }
  assert(processor.set_module_parameter(calcotone::RackModule::Ember, "drive", .8F));
  assert(processor.set_pressure_parameter("mix", .3F));
  const std::array<std::string_view, 4> order{"stomp", "chaos", "saturation", "delay"};
  assert(processor.set_serial_order(order));
  processor.set_stack_input(2); processor.set_stomp_input(0);
  processor.process(input.data(), output.data(), frames);
  assert(std::all_of(output.begin(), output.end(), [](float value) { return std::isfinite(value) && std::abs(value) <= 1.F; }));
  const std::array<std::string_view, 4> reverse_order{"delay", "saturation", "chaos", "stomp"};
  std::atomic<bool> reorder_running{true};
  std::thread reorder([&] {
    while (reorder_running.load(std::memory_order_relaxed)) {
      assert(processor.set_serial_order(order));
      assert(processor.set_serial_order(reverse_order));
    }
  });
  for (unsigned pass = 0; pass < 64; ++pass) {
    processor.process(input.data(), output.data(), 128);
    assert(std::all_of(output.begin(), output.begin() + 256, [](float value) { return std::isfinite(value) && std::abs(value) <= 1.F; }));
  }
  reorder_running.store(false, std::memory_order_relaxed);
  reorder.join();
  std::fill(input.begin(), input.end(), 1.F);
  processor.set_input_gain(2.F);
  processor.set_output_gain(1.5F);
  processor.process(input.data(), output.data(), frames);
  assert(processor.output_limited_samples() > 0U);
  assert(processor.pre_limiter_peak() > .9F);
  assert(std::all_of(output.begin(), output.end(), [](float value) { return std::isfinite(value) && std::abs(value) < 1.F; }));
  processor.set_active(false);
  processor.process(input.data(), output.data(), frames);
  assert(std::all_of(output.begin(), output.end(), [](float value) { return value == 0.F; }));
  assert(processor.sample_rate() == rate);
  std::cout << "native processor transport/input-routing boundary passed\n";
}
