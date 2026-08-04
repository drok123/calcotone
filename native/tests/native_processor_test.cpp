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

int main() {
  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 4096;
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
  std::cout << "native processor transport boundary passed\n";
}
