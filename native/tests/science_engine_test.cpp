#include "calcotone/adaptive_fidelity.hpp"
#include "calcotone/circuit_dna_profiler.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

namespace {
constexpr std::size_t kFrames = 128U;
using Block = std::array<float, kFrames * 2U>;

void test_circuit_dna_learns_bounded_character_and_unity() {
  calcotone::CircuitDnaProfiler profiler(48'000.F);
  Block dry{};
  Block wet{};
  for (std::size_t frame = 0; frame < kFrames; ++frame) {
    const float source = .35F * std::sin(
        6.283185307F * 330.F * static_cast<float>(frame) / 48'000.F);
    dry[frame * 2U] = source;
    dry[frame * 2U + 1U] = source * .8F;
    wet[frame * 2U] = std::tanh(source * 1.8F) * .5F;
    wet[frame * 2U + 1U] = std::tanh(source * 1.4F) * .4F;
  }

  float gain = 1.F;
  for (unsigned block = 0; block < 800U; ++block)
    gain = profiler.observe(dry.data(), wet.data(), kFrames, true);
  const auto state = profiler.snapshot();
  assert(state.observations == 800U);
  assert(state.drive > 0.F && state.drive <= 1.F);
  assert(state.color > 0.F && state.color <= 1.F);
  assert(state.dynamics >= 0.F && state.dynamics <= 1.F);
  assert(state.memory >= 0.F && state.memory <= 1.F);
  assert(gain > 1.F && gain <= 1.03F);
  assert(state.calibration_gain == gain);

  profiler.reset();
  const auto reset = profiler.snapshot();
  assert(reset.observations == 0U);
  assert(reset.drive == 0.F);
  assert(reset.calibration_gain == 1.F);
}

void test_circuit_dna_never_changes_silence_or_exceeds_trim_bound() {
  calcotone::CircuitDnaProfiler profiler(48'000.F);
  Block silence{};
  for (unsigned block = 0; block < 500U; ++block) {
    const float gain = profiler.observe(
        silence.data(), silence.data(), kFrames, true);
    assert(gain >= .97F && gain <= 1.03F);
  }
  assert(profiler.snapshot().observations == 0U);
}

void test_adaptive_fidelity_reacts_fast_and_recovers_slowly() {
  calcotone::AdaptiveFidelity fidelity;
  assert(fidelity.state().level == calcotone::FidelityLevel::Balanced);

  assert(fidelity.observe(1'100U, 1'000U));
  auto state = fidelity.state();
  assert(state.level == calcotone::FidelityLevel::Safe);
  assert(state.transitions == 1U);

  for (unsigned observation = 0; observation < 1'200U; ++observation)
    (void)fidelity.observe(200U, 1'000U);
  state = fidelity.state();
  assert(state.level == calcotone::FidelityLevel::Balanced);
  assert(state.transitions == 2U);

  for (unsigned observation = 0; observation < 1'200U; ++observation)
    (void)fidelity.observe(200U, 1'000U);
  state = fidelity.state();
  assert(state.level == calcotone::FidelityLevel::Full);
  assert(state.transitions == 3U);
  assert(state.render_load < .46F);

  fidelity.reset();
  state = fidelity.state();
  assert(state.level == calcotone::FidelityLevel::Balanced);
  assert(state.transitions == 0U);
  assert(state.render_load == 0.F);
}
}  // namespace

int main() {
  test_circuit_dna_learns_bounded_character_and_unity();
  test_circuit_dna_never_changes_silence_or_exceeds_trim_bound();
  test_adaptive_fidelity_reacts_fast_and_recovers_slowly();
}
