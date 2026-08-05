#include "calcotone/halo_parity_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kSampleRate = 48'000.F;
constexpr std::size_t kBlock = 128;

void process_blocks(calcotone::HaloParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2;
  for (std::size_t offset = 0; offset < frames; offset += kBlock) {
    processor.process(audio.data() + offset * 2, std::min(kBlock, frames - offset));
  }
}

void settle(calcotone::HaloParityProcessor& processor) {
  std::vector<float> silence(48'000 * 2, 0.F);
  process_blocks(processor, silence);
  processor.reset();
}

std::vector<float> impulse_render(
    unsigned mode,
    float feedback,
    float color,
    float character,
    float width,
    std::size_t frames = 32768) {
  calcotone::HaloParityProcessor processor(kSampleRate);
  processor.set_parameter("algorithm", static_cast<float>(mode));
  processor.set_parameter("time", .03F);
  processor.set_parameter("feedback", feedback);
  processor.set_parameter("color", color);
  processor.set_parameter("character", character);
  processor.set_parameter("width", width);
  processor.set_parameter("mix", 1.F);
  settle(processor);
  std::vector<float> audio(frames * 2, 0.F);
  audio[0] = 1.F;
  audio[1] = .73F;
  process_blocks(processor, audio);
  for (float sample : audio) assert(std::isfinite(sample));
  return audio;
}

void test_model_identities() {
  constexpr std::size_t frames = 32768;
  std::array<double, 12> signatures{};
  for (std::size_t mode = 0; mode < signatures.size(); ++mode) {
    const auto audio = impulse_render(static_cast<unsigned>(mode), .47F, .58F, .63F, .71F, frames);
    double signature = 0.0;
    for (std::size_t index = 0; index < audio.size(); ++index) {
      signature += std::abs(static_cast<double>(audio[index]))
          * static_cast<double>((index % 257) + 1);
    }
    assert(signature > 1e-6);
    signatures[mode] = signature;
  }
  for (std::size_t first = 0; first < signatures.size(); ++first) {
    for (std::size_t second = first + 1; second < signatures.size(); ++second) {
      assert(std::abs(signatures[first] - signatures[second]) > 1e-5);
    }
  }
}

void test_feedback_extends_tail() {
  const auto low = impulse_render(1, .08F, .42F, .35F, .58F, 65536);
  const auto high = impulse_render(1, .76F, .42F, .35F, .58F, 65536);
  double low_tail = 0.0;
  double high_tail = 0.0;
  const std::size_t tail_start = 6000 * 2;
  for (std::size_t index = tail_start; index < low.size(); ++index) {
    low_tail += std::abs(static_cast<double>(low[index]));
    high_tail += std::abs(static_cast<double>(high[index]));
  }
  assert(high_tail > low_tail * 1.25);
}

void test_width_cross_output_law() {
  auto render = [](float width) {
    calcotone::HaloParityProcessor processor(kSampleRate);
    processor.set_parameter("algorithm", 0.F);
    processor.set_parameter("time", .03F);
    processor.set_parameter("feedback", 0.F);
    processor.set_parameter("color", 1.F);
    processor.set_parameter("character", 0.F);
    processor.set_parameter("width", width);
    processor.set_parameter("mix", 1.F);
    settle(processor);
    std::vector<float> audio(8192 * 2, 0.F);
    audio[0] = 1.F;
    process_blocks(processor, audio);
    double right_energy = 0.0;
    for (std::size_t frame = 0; frame < audio.size() / 2; ++frame) {
      right_energy += std::abs(static_cast<double>(audio[frame * 2 + 1]));
    }
    return right_energy;
  };
  const double mono_width = render(0.F);
  const double full_width = render(1.F);
  assert(mono_width > full_width * 4.0 + 1e-7);
}

void test_reset_is_deterministic() {
  calcotone::HaloParityProcessor processor(kSampleRate);
  processor.set_parameter("algorithm", 5.F);
  processor.set_parameter("time", .03F);
  processor.set_parameter("feedback", .52F);
  processor.set_parameter("color", .37F);
  processor.set_parameter("character", .68F);
  processor.set_parameter("width", .44F);
  processor.set_parameter("mix", 1.F);
  settle(processor);

  auto render = [&processor]() {
    std::vector<float> audio(16384 * 2, 0.F);
    audio[0] = .91F;
    audio[1] = -.37F;
    process_blocks(processor, audio);
    return audio;
  };

  const auto first = render();
  processor.reset();
  const auto second = render();
  assert(first.size() == second.size());
  for (std::size_t index = 0; index < first.size(); ++index) {
    assert(std::abs(first[index] - second[index]) < 1e-6F);
  }
}
}  // namespace

int main() {
  test_model_identities();
  test_feedback_extends_tail();
  test_width_cross_output_law();
  test_reset_is_deterministic();
}
