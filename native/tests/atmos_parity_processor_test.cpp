#include "calcotone/atmos_parity_processor.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

int main() {
  constexpr float rate = 48'000.F;
  constexpr std::size_t frames = 48'000;
  std::vector<float> impulse(frames * 2, 0.F);
  impulse[0] = .5F;
  impulse[1] = .5F;

  for (unsigned algorithm = 0; algorithm < 12; ++algorithm) {
    calcotone::AtmosParityProcessor processor(rate);
    assert(processor.set_parameter("algorithm", static_cast<float>(algorithm)));
    assert(processor.set_parameter("decay", algorithm == 5 ? 12.F : 2.4F));
    assert(processor.set_parameter("size", .52F));
    assert(processor.set_parameter("color", .42F));
    assert(processor.set_parameter("diffusion", .74F));
    assert(processor.set_parameter("motion", .18F));
    assert(processor.set_parameter("mix", 1.F));

    auto output = impulse;
    processor.process(output.data(), output.size() / 2U);
    assert(std::all_of(output.begin(), output.end(), [](float value) {
      return std::isfinite(value) && std::abs(value) <= 1.2F;
    }));
    const float peak = *std::max_element(output.begin(), output.end(), [](float a, float b) {
      return std::abs(a) < std::abs(b);
    });
    assert(std::abs(peak) > 1e-6F);
  }

  calcotone::AtmosParityProcessor processor(rate);
  assert(!processor.set_parameter("not-a-parameter", .5F));
  processor.reset();
  std::cout << "Atmos parity processor passed all twelve canonical models\n";
}
