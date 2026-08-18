#pragma once

#include "calcotone/dream_buffer_parity_processor.hpp"
#include "calcotone/loop_processor.hpp"

#include <array>
#include <cstddef>
#include <cstdint>

namespace calcotone {

// Audio-thread snapshot shared by native processors. The bus observes physical
// inputs before routing, so Input 2 remains the guitar control source even when
// the audible lane matrix is swapped or folded. It owns no dynamic storage and
// performs no synchronization or control-thread work from update().
struct SignalStateSnapshot {
  float input_one_envelope{};
  float input_two_envelope{};
  float input_two_transient{};
  float input_two_brightness{};
  float input_two_pitch_hz{};
  float grain_activity{};
  float cross_pitch_semitones{};
  float loop_resynthesis_activity{};
  float loop_brightness{};
  float topology_morph{};
  std::array<float, 3> dream_intent{};
  float dream_ghost{};
  std::uint64_t reference_position{};
  std::uint64_t reference_frames{};
  bool reference_running{};
};

class SignalStateBus final {
 public:
  explicit SignalStateBus(float sample_rate = 48'000.F) noexcept;

  [[nodiscard]] const SignalStateSnapshot& update(
      const float* physical_input_stereo,
      std::size_t frames,
      const DreamBufferParityProfile& dream,
      float input_two_pitch_hz,
      const LoopAnalysisProfile& loop_analysis,
      int reference_track,
      std::uint64_t reference_frames,
      std::uint64_t reference_position,
      LoopTransport transport) noexcept;

  void reset() noexcept;
  [[nodiscard]] const SignalStateSnapshot& snapshot() const noexcept;

 private:
  float sample_rate_;
  float fast_attack_;
  float fast_release_;
  float slow_attack_;
  float slow_release_;
  float activity_release_;
  std::array<float, 2> fast_envelope_{};
  std::array<float, 2> slow_envelope_{};
  std::array<float, 3> dream_state_{};
  float activity_state_{};
  float previous_input_two_{};
  float brightness_state_{};
  float pitch_state_{};
  float loop_activity_state_{};
  SignalStateSnapshot snapshot_{};
};

}  // namespace calcotone
