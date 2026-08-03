#include "calcotone/pitch_tracker.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
  constexpr float rate = 48'000.F;
  for (float expected : {82.4069F, 110.F, 440.F, 880.F}) {
    calcotone::PitchTracker tracker(rate);
    for (unsigned frame = 0; frame < 48'000; ++frame)
      tracker.push(.32F * std::sin(static_cast<float>(frame) * 6.283185307F * expected / rate));
    assert(std::abs(tracker.frequency() - expected) < expected * .012F);
    assert(tracker.level() > .05F);
    for (unsigned frame = 0; frame < 24'000; ++frame) tracker.push(0.F);
    assert(tracker.frequency() == 0.F);
  }
  std::cout << "pitch tracker tests passed\n";
}
