#include "calcotone/native_processor.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kBlock = 128U;

std::vector<float> source(std::size_t frames, float scale = 1.F) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0U; frame < frames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float burst = frame % 8192U < 1700U ? 1.F : .2F;
    audio[frame * 2U] = scale * burst * .21F * std::sin(2.F * kPi * 167.F * t);
    audio[frame * 2U + 1U] = scale * burst * .18F * std::sin(2.F * kPi * 191.F * t + .43F);
  }
  return audio;
}

std::vector<float> process(calcotone::NativeProcessor& processor,
                           const std::vector<float>& input) {
  std::vector<float> output(input.size(), 0.F);
  const auto frames = input.size() / 2U;
  for (std::size_t offset = 0U; offset < frames; offset += kBlock) {
    const auto block = std::min(kBlock, frames - offset);
    processor.process(input.data() + offset * 2U, output.data() + offset * 2U, block);
  }
  return output;
}

double energy(const std::vector<float>& audio, std::size_t first_frame = 0U) {
  double result = 0.0;
  for (std::size_t sample = first_frame * 2U; sample < audio.size(); ++sample) {
    assert(std::isfinite(audio[sample]));
    assert(std::abs(audio[sample]) <= 1.001F);
    result += static_cast<double>(audio[sample]) * audio[sample];
  }
  return result;
}

void configure_active_ember(calcotone::NativeProcessor& processor) {
  processor.set_active(true);
  processor.set_module_bypassed(calcotone::RackModule::Ember, false);
  assert(processor.set_module_parameter(calcotone::RackModule::Ember, "drive", .28F));
  assert(processor.set_module_parameter(calcotone::RackModule::Ember, "mix", .34F));
}

void test_live_processor_emits_parallel_memory_tail() {
  calcotone::NativeProcessor processor(kRate);
  configure_active_ember(processor);
  process(processor, source(240'000U));
  const std::vector<float> silence(32'000U * 2U, 0.F);
  const auto tail = process(processor, silence);
  assert(energy(tail) > 1e-8);
}

void test_all_bypassed_returns_to_true_raw_after_fade() {
  calcotone::NativeProcessor warmed(kRate);
  calcotone::NativeProcessor fresh(kRate);
  configure_active_ember(warmed);
  fresh.set_active(true);
  process(warmed, source(240'000U));
  warmed.set_module_bypassed(calcotone::RackModule::Ember, true);

  const auto probe = source(72'000U, .35F);
  const auto warmed_output = process(warmed, probe);
  const auto fresh_output = process(fresh, probe);
  double error = 0.0;
  double reference = 0.0;
  for (std::size_t frame = 64'000U; frame < probe.size() / 2U; ++frame) {
    for (unsigned channel = 0U; channel < 2U; ++channel) {
      const auto sample = frame * 2U + channel;
      error += std::abs(static_cast<double>(warmed_output[sample] - fresh_output[sample]));
      reference += std::abs(static_cast<double>(fresh_output[sample]));
    }
  }
  assert(error / std::max(1.0, reference) < 1e-6);
}

void test_silent_raw_start_has_no_hidden_dream_output() {
  calcotone::NativeProcessor processor(kRate);
  processor.set_active(true);
  const std::vector<float> silence(16'384U * 2U, 0.F);
  const auto output = process(processor, silence);
  assert(energy(output) == 0.0);
}
}  // namespace

int main() {
  test_live_processor_emits_parallel_memory_tail();
  test_all_bypassed_returns_to_true_raw_after_fade();
  test_silent_raw_start_has_no_hidden_dream_output();
}
