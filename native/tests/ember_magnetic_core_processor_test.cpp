#include "calcotone/ember_magnetic_core_processor.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kTau = 6.2831853071795864769F;

void configure(calcotone::EmberMagneticCoreProcessor& processor) {
  assert(processor.set_parameter("drive", .71F));
  assert(processor.set_parameter("tone", 8'700.F));
  assert(processor.set_parameter("heat", .58F));
  assert(processor.set_parameter("character", .66F));
  assert(processor.set_parameter("dynamics", .47F));
  assert(processor.set_parameter("mix", 1.F));
}

void warm_controls(calcotone::EmberMagneticCoreProcessor& processor) {
  std::vector<float> silence(4096 * 2, 0.F);
  processor.process(silence.data(), 4096);
}
}  // namespace

int main() {
  calcotone::EmberMagneticCoreProcessor driven(kRate);
  configure(driven);
  warm_controls(driven);

  constexpr std::size_t burst_frames = 8192;
  std::vector<float> burst(burst_frames * 2, 0.F);
  for (std::size_t frame = 0; frame < burst_frames; ++frame) {
    const float time = static_cast<float>(frame) / kRate;
    const float signal = .58F * std::sin(kTau * 83.F * time)
        + .21F * std::sin(kTau * 719.F * time);
    burst[frame * 2] = signal;
    burst[frame * 2 + 1] = signal;
  }
  driven.process(burst.data(), burst_frames);

  assert(std::all_of(burst.begin(), burst.end(), [](float value) {
    return std::isfinite(value) && std::abs(value) <= 1.21F;
  }));

  double stereo_difference = 0.0;
  for (std::size_t frame = 0; frame < burst_frames; ++frame)
    stereo_difference += std::abs(static_cast<double>(burst[frame * 2] - burst[frame * 2 + 1]));
  assert(stereo_difference > 1e-4);  // Canonical transformer component mismatch.

  calcotone::EmberMagneticCoreProcessor fresh(kRate);
  configure(fresh);
  warm_controls(fresh);

  constexpr std::size_t probe_frames = 1024;
  std::vector<float> history_probe(probe_frames * 2, 0.F);
  std::vector<float> fresh_probe(probe_frames * 2, 0.F);
  for (std::size_t frame = 0; frame < probe_frames; ++frame) {
    const float signal = .035F * std::sin(kTau * 197.F * static_cast<float>(frame) / kRate);
    history_probe[frame * 2] = signal;
    history_probe[frame * 2 + 1] = signal;
    fresh_probe[frame * 2] = signal;
    fresh_probe[frame * 2 + 1] = signal;
  }

  driven.process(history_probe.data(), probe_frames);
  fresh.process(fresh_probe.data(), probe_frames);

  double history_difference = 0.0;
  for (std::size_t i = 0; i < history_probe.size(); ++i)
    history_difference += std::abs(static_cast<double>(history_probe[i] - fresh_probe[i]));
  assert(history_difference > 1e-5);  // Hysteresis/remanence survives the preceding burst.

  driven.reset();
  assert(!driven.set_parameter("unknown", .5F));
  return 0;
}
