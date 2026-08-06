#include "calcotone/halo_dual_grain_pitch_processor.hpp"

#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kPi = 3.14159265358979323846F;

std::vector<float> render(float semitones, float amount) {
  calcotone::HaloDualGrainPitchProcessor processor(48'000.F);
  processor.set_pitch(0, semitones, amount);
  processor.set_pitch(1, -semitones * .72F, amount);
  std::vector<float> output(48'000 * 2, 0.F);
  for (std::size_t frame = 0; frame < output.size() / 2; ++frame) {
    const float left = std::sin(2.F * kPi * 220.F * static_cast<float>(frame) / 48'000.F) * .35F;
    const float right = std::sin(2.F * kPi * 331.F * static_cast<float>(frame) / 48'000.F) * .27F;
    processor.process_frame(left, right, output[frame * 2], output[frame * 2 + 1]);
    assert(std::isfinite(output[frame * 2]));
    assert(std::isfinite(output[frame * 2 + 1]));
  }
  return output;
}

void test_pitch_amount_changes_grain_travel() {
  const auto neutral = render(7.F, 0.F);
  const auto shifted = render(7.F, .82F);
  double difference = 0.0;
  double shifted_energy = 0.0;
  for (std::size_t index = 0; index < neutral.size(); ++index) {
    difference += std::abs(static_cast<double>(neutral[index] - shifted[index]));
    shifted_energy += std::abs(static_cast<double>(shifted[index]));
  }
  assert(shifted_energy > 1.0);
  assert(difference > shifted_energy * .08);
}

void test_stereo_channels_remain_independent() {
  calcotone::HaloDualGrainPitchProcessor processor(48'000.F);
  processor.set_pitch(0, 12.F, .8F);
  processor.set_pitch(1, -12.F, .8F);
  double right_energy = 0.0;
  for (std::size_t frame = 0; frame < 24'000; ++frame) {
    const float input = std::sin(2.F * kPi * 180.F * static_cast<float>(frame) / 48'000.F) * .4F;
    float left{};
    float right{};
    processor.process_frame(input, 0.F, left, right);
    right_energy += std::abs(static_cast<double>(right));
  }
  assert(right_energy < 1e-8);
}

void test_reset_is_deterministic() {
  calcotone::HaloDualGrainPitchProcessor processor(48'000.F);
  processor.set_pitch(0, 7.F, .7F);
  processor.set_pitch(1, -5.F, .7F);
  auto run = [&processor]() {
    std::vector<float> output(24'000 * 2, 0.F);
    for (std::size_t frame = 0; frame < output.size() / 2; ++frame) {
      const float input = frame < 12'000
          ? std::sin(2.F * kPi * 260.F * static_cast<float>(frame) / 48'000.F) * .31F
          : 0.F;
      processor.process_frame(input, -input * .4F, output[frame * 2], output[frame * 2 + 1]);
    }
    return output;
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
  test_pitch_amount_changes_grain_travel();
  test_stereo_channels_remain_independent();
  test_reset_is_deterministic();
}
