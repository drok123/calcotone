#include "calcotone/signal_state_bus.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kFrames = 128U;
using Block = std::array<float, kFrames * 2U>;

calcotone::DreamBufferParityProfile empty_dream() {
  calcotone::DreamBufferParityProfile profile{};
  profile.history_seconds = 8.F;
  return profile;
}

calcotone::LoopAnalysisProfile empty_loop() {
  return {};
}

void test_silence_has_no_excitation() {
  calcotone::SignalStateBus bus(kRate);
  Block silence{};
  const auto& state = bus.update(
      silence.data(), kFrames, empty_dream(), 0.F, empty_loop(), -1, 0U, 0U,
      calcotone::LoopTransport::Empty);
  assert(state.input_two_transient == 0.F);
  assert(state.grain_activity == 0.F);
  assert(state.dream_ghost == 0.F);
  assert(state.loop_resynthesis_activity == 0.F);
  assert(state.topology_morph == 0.F);
  assert(!state.reference_running);
}

void test_only_physical_input_two_drives_grain() {
  Block left_impulse{};
  left_impulse[0] = .9F;
  calcotone::SignalStateBus left_bus(kRate);
  const auto& left = left_bus.update(
      left_impulse.data(), kFrames, empty_dream(), 0.F, empty_loop(), -1, 0U, 0U,
      calcotone::LoopTransport::Empty);
  assert(left.input_one_envelope > 0.F);
  assert(left.grain_activity == 0.F);

  Block right_impulse{};
  right_impulse[1] = .9F;
  calcotone::SignalStateBus right_bus(kRate);
  const auto& right = right_bus.update(
      right_impulse.data(), kFrames, empty_dream(), 220.F, empty_loop(), -1, 0U, 0U,
      calcotone::LoopTransport::Empty);
  assert(right.input_two_transient > .005F);
  assert(right.grain_activity > .08F);
  assert(right.grain_activity <= .35F);
  assert(right.topology_morph > 0.F && right.topology_morph <= .10F);
}

void test_steady_input_stops_looking_like_a_transient() {
  calcotone::SignalStateBus bus(kRate);
  Block steady{};
  for (std::size_t frame = 0; frame < kFrames; ++frame)
    steady[frame * 2U + 1U] = .4F;
  float initial = 0.F;
  for (unsigned block = 0; block < 500U; ++block) {
    const auto& state = bus.update(
        steady.data(), kFrames, empty_dream(), 220.F, empty_loop(), -1, 0U, 0U,
        calcotone::LoopTransport::Empty);
    if (block == 0U) initial = state.grain_activity;
  }
  assert(initial > .08F);
  assert(bus.snapshot().grain_activity < .01F);
}

void test_dream_ghost_is_fill_gated_and_smoothed() {
  calcotone::SignalStateBus bus(kRate);
  Block silence{};
  auto dream = empty_dream();
  dream.fill_ratio = 1.F;
  dream.memory_intent = {.2F, .5F, 1.F};
  for (unsigned block = 0; block < 500U; ++block)
    (void)bus.update(silence.data(), kFrames, dream, 0.F, empty_loop(),
                     -1, 0U, 0U,
                     calcotone::LoopTransport::Empty);
  const auto& state = bus.snapshot();
  assert(state.dream_intent[0] > .18F && state.dream_intent[0] <= .2F);
  assert(state.dream_intent[1] > .45F && state.dream_intent[1] <= .5F);
  assert(state.dream_ghost > .9F && state.dream_ghost <= 1.F);
}

void test_pitch_brightness_and_loop_drive_resynthesis_sideband() {
  calcotone::SignalStateBus bus(kRate);
  Block guitar{};
  for (std::size_t frame = 0; frame < kFrames; ++frame)
    guitar[frame * 2U + 1U] = .3F * std::sin(
        6.283185307F * 220.F * static_cast<float>(frame) / kRate);
  calcotone::LoopAnalysisProfile loop_profile{
      .energy = .8F,
      .transient = .9F,
      .brightness = .7F,
      .stereo_width = .6F,
  };
  for (unsigned block = 0; block < 500U; ++block)
    (void)bus.update(guitar.data(), kFrames, empty_dream(), 220.F,
                     loop_profile, 0, 1024U, block * kFrames,
                     calcotone::LoopTransport::Playing);
  const auto& state = bus.snapshot();
  assert(state.input_two_brightness > 0.F && state.input_two_brightness <= 1.F);
  assert(std::abs(state.cross_pitch_semitones) < .01F);
  assert(state.loop_resynthesis_activity > .2F
         && state.loop_resynthesis_activity <= .28F);
  assert(std::abs(state.loop_brightness - .7F) < 1e-6F);
  assert(state.topology_morph > 0.F && state.topology_morph <= .10F);
}

void test_reference_clock_preserves_exact_sample_position() {
  calcotone::SignalStateBus bus(kRate);
  Block silence{};
  const auto& running = bus.update(
      silence.data(), kFrames, empty_dream(), 0.F, empty_loop(), 3, 1000U, 997U,
      calcotone::LoopTransport::Overdubbing);
  assert(running.reference_running);
  assert(running.reference_frames == 1000U);
  assert(running.reference_position == 997U);

  const auto& stopped = bus.update(
      silence.data(), kFrames, empty_dream(), 0.F, empty_loop(), 3, 1000U, 997U,
      calcotone::LoopTransport::Stopped);
  assert(!stopped.reference_running);
  assert(stopped.reference_frames == 0U);
  assert(stopped.reference_position == 0U);
}
}  // namespace

int main() {
  test_silence_has_no_excitation();
  test_only_physical_input_two_drives_grain();
  test_steady_input_stops_looking_like_a_transient();
  test_dream_ghost_is_fill_gated_and_smoothed();
  test_pitch_brightness_and_loop_drive_resynthesis_sideband();
  test_reference_clock_preserves_exact_sample_position();
}
