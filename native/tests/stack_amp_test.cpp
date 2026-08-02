#include "calcotone/stack_amp.hpp"
#include "calcotone/input_router.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <iostream>
#include <vector>

int main() {
  {
    constexpr std::array<float, 4> capture{0.25F, -0.5F, 0.75F, -1.F};
    std::array<float, 4> lane_one{}, lane_two{}, mixed{};
    calcotone::split_dual_mono(capture.data(), lane_one.data(), lane_two.data(), 2, 2.F);
    const std::array<float, 4> expected_one{0.5F, 0.5F, 1.5F, 1.5F};
    const std::array<float, 4> expected_two{-1.F, -1.F, -2.F, -2.F};
    if (lane_one != expected_one || lane_two != expected_two) {
      std::cerr << "dual-mono split failed\n";
      return 3;
    }
    using calcotone::StackInputSource;
    if (!calcotone::stack_receives_lane(StackInputSource::InputOne, 0) ||
        calcotone::stack_receives_lane(StackInputSource::InputOne, 1) ||
        calcotone::stack_receives_lane(StackInputSource::InputTwo, 0) ||
        !calcotone::stack_receives_lane(StackInputSource::InputTwo, 1) ||
        !calcotone::stack_receives_lane(StackInputSource::Both, 0) ||
        !calcotone::stack_receives_lane(StackInputSource::Both, 1)) {
      std::cerr << "STACK lane assignment failed\n";
      return 4;
    }
    calcotone::mix_dual_mono(lane_one.data(), lane_two.data(), mixed.data(), 2, 1.F);
    if (mixed[0] >= 0.F || mixed[2] >= 0.F ||
        std::ranges::any_of(mixed, [](float value) { return !std::isfinite(value) || std::abs(value) > 1.F; })) {
      std::cerr << "dual-mono mix guard failed\n";
      return 5;
    }
  }

  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 48'000;
  std::vector<float> input(frames * 2), output(frames * 2);
  for (std::size_t i = 0; i < frames; ++i) {
    const float t = static_cast<float>(i) / rate;
    const float x = std::sin(t * 6.2831853F * 193.F) * .24F + std::sin(t * 6.2831853F * 1319.F) * .09F;
    input[i * 2] = x; input[i * 2 + 1] = x * .97F;
  }
  float global_peak = 0.F, minimum_rms = 10.F, maximum_rms = 0.F;
  const auto started = std::chrono::steady_clock::now();
  for (unsigned quality : {1U, 2U, 4U}) for (unsigned model = 0; model < 6; ++model) for (unsigned cab = 0; cab < 5; ++cab) {
    calcotone::StackAmp amp(rate);
    amp.set_quality(quality); amp.set_model(static_cast<calcotone::AmpModel>(model)); amp.set_cabinet(static_cast<calcotone::Cabinet>(cab));
    double energy = 0.;
    for (std::size_t offset = 0; offset < frames; offset += 128) {
      amp.process(input.data() + offset * 2, output.data() + offset * 2, std::min<std::size_t>(128, frames - offset));
    }
    for (float value : output) {
      if (!std::isfinite(value)) { std::cerr << "non-finite output\n"; return 1; }
      global_peak = std::max(global_peak, std::abs(value)); energy += value * value;
    }
    const float rms = std::sqrt(energy / output.size());
    minimum_rms = std::min(minimum_rms, rms); maximum_rms = std::max(maximum_rms, rms);
  }
  const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
  if (global_peak > 1.151F || minimum_rms < .004F) return 2;
  std::cout << "Native routing + STACK passed 90 paths | peak=" << global_peak << " rms=" << minimum_rms << ".." << maximum_rms
            << " | test wall=" << elapsed << "s\n";
  return 0;
}
