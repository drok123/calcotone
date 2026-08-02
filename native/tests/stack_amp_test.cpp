#include "calcotone/stack_amp.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <vector>

int main() {
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
  std::cout << "Native STACK passed 90 paths | peak=" << global_peak << " rms=" << minimum_rms << ".." << maximum_rms
            << " | test wall=" << elapsed << "s\n";
  return 0;
}
