#include "calcotone/halo_space_echo_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr std::size_t kBlock = 128;

void process_blocks(calcotone::HaloSpaceEchoProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2;
  for (std::size_t offset = 0; offset < frames; offset += kBlock) {
    processor.process(audio.data() + offset * 2, std::min(kBlock, frames - offset));
  }
}

void configure(calcotone::HaloSpaceEchoProcessor& processor, float width, float feedback = .52F) {
  processor.set_parameter("time", .03F);
  processor.set_parameter("feedback", feedback);
  processor.set_parameter("color", .57F);
  processor.set_parameter("character", .64F);
  processor.set_parameter("width", width);
  processor.set_parameter("mix", 1.F);
  std::vector<float> silence(48'000 * 2, 0.F);
  process_blocks(processor, silence);
  processor.reset();
}

std::vector<float> render(float width, float feedback = .52F, bool right_input = false) {
  calcotone::HaloSpaceEchoProcessor processor(48'000.F);
  configure(processor, width, feedback);
  std::vector<float> audio(48'000 * 2, 0.F);
  audio[right_input ? 1 : 0] = 1.F;
  process_blocks(processor, audio);
  for (float sample : audio) assert(std::isfinite(sample));
  return audio;
}

void test_head_modes_are_distinct() {
  constexpr std::array<float, 7> widths{0.F, .15F, .30F, .45F, .60F, .75F, 1.F};
  std::array<double, widths.size()> signatures{};
  for (std::size_t mode = 0; mode < widths.size(); ++mode) {
    const auto audio = render(widths[mode]);
    double signature = 0.0;
    for (std::size_t index = 0; index < audio.size(); ++index) {
      signature += std::abs(static_cast<double>(audio[index])) * static_cast<double>((index % 211) + 1);
    }
    assert(signature > 1e-6);
    signatures[mode] = signature;
  }
  for (std::size_t first = 0; first < signatures.size(); ++first) {
    for (std::size_t second = first + 1; second < signatures.size(); ++second) {
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
    }
  }
}

void test_feedback_extends_transport_tail() {
  const auto low = render(1.F, .05F);
  const auto high = render(1.F, .82F);
  double low_tail = 0.0;
  double high_tail = 0.0;
  for (std::size_t index = 24'000 * 2; index < low.size(); ++index) {
    low_tail += std::abs(static_cast<double>(low[index]));
    high_tail += std::abs(static_cast<double>(high[index]));
  }
  assert(high_tail > low_tail * 1.4 + 1e-8);
}

void test_record_head_is_mono() {
  const auto left = render(.45F, .2F, false);
  const auto right = render(.45F, .2F, true);
  assert(left.size() == right.size());
  for (std::size_t frame = 2000; frame < left.size() / 2; ++frame) {
    assert(std::abs(left[frame * 2] - right[frame * 2]) < 1e-5F);
    assert(std::abs(left[frame * 2 + 1] - right[frame * 2 + 1]) < 1e-5F);
  }
}

void test_reset_is_deterministic() {
  calcotone::HaloSpaceEchoProcessor processor(48'000.F);
  configure(processor, 1.F, .61F);
  auto run = [&processor]() {
    std::vector<float> audio(32'768 * 2, 0.F);
    audio[0] = .83F;
    audio[1] = -.22F;
    process_blocks(processor, audio);
    return audio;
  };
  const auto first = run();
  processor.reset();
  const auto second = run();
  for (std::size_t index = 0; index < first.size(); ++index) {
    assert(std::abs(first[index] - second[index]) < 1e-6F);
  }
}
}  // namespace

int main() {
  test_head_modes_are_distinct();
  test_feedback_extends_transport_tail();
  test_record_head_is_mono();
  test_reset_is_deterministic();
}
