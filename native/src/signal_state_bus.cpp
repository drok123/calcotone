#include "calcotone/signal_state_bus.hpp"

#include <algorithm>
#include <cmath>

namespace calcotone {
namespace {
float coefficient(float seconds, float sample_rate) noexcept {
  return 1.F - std::exp(-1.F / std::max(1.F, seconds * sample_rate));
}

float clamp01(float value) noexcept {
  return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F);
}
}  // namespace

SignalStateBus::SignalStateBus(float requested_rate) noexcept
    : sample_rate_(std::clamp(requested_rate, 8'000.F, 384'000.F)),
      fast_attack_(coefficient(.0015F, sample_rate_)),
      fast_release_(coefficient(.018F, sample_rate_)),
      slow_attack_(coefficient(.020F, sample_rate_)),
      slow_release_(coefficient(.140F, sample_rate_)),
      activity_release_(coefficient(.060F, sample_rate_)) {}

const SignalStateSnapshot& SignalStateBus::update(
    const float* input,
    std::size_t frames,
    const DreamBufferParityProfile& dream,
    float input_two_pitch_hz,
    const LoopAnalysisProfile& loop_analysis,
    int reference_track,
    std::uint64_t reference_frames,
    std::uint64_t reference_position,
    LoopTransport transport) noexcept {
  float input_two_transient = 0.F;
  float input_two_detail = 0.F;
  float input_two_magnitude = 0.F;
  if (input != nullptr) {
    for (std::size_t frame = 0; frame < frames; ++frame) {
      for (unsigned channel = 0; channel < 2U; ++channel) {
        const float sample = std::isfinite(input[frame * 2U + channel])
            ? std::abs(input[frame * 2U + channel]) : 0.F;
        const float fast_amount = sample > fast_envelope_[channel]
            ? fast_attack_ : fast_release_;
        const float slow_amount = sample > slow_envelope_[channel]
            ? slow_attack_ : slow_release_;
        fast_envelope_[channel] += (sample - fast_envelope_[channel]) * fast_amount;
        slow_envelope_[channel] += (sample - slow_envelope_[channel]) * slow_amount;
      }
      const float input_two = std::isfinite(input[frame * 2U + 1U])
          ? input[frame * 2U + 1U] : 0.F;
      input_two_detail += std::abs(input_two - previous_input_two_);
      input_two_magnitude += std::abs(input_two);
      previous_input_two_ = input_two;
      input_two_transient = std::max(
          input_two_transient, std::max(0.F, fast_envelope_[1] - slow_envelope_[1]));
    }
  }

  const float detected_activity = std::min(
      .35F, std::max(0.F, input_two_transient - .0008F) * 24.F);
  const float release_for_block = 1.F - std::pow(
      1.F - activity_release_, static_cast<float>(frames));
  activity_state_ += (0.F - activity_state_) * release_for_block;
  activity_state_ = std::max(activity_state_, detected_activity);
  const float brightness_target = frames > 0U
      ? clamp01(input_two_detail / (input_two_magnitude + 1e-5F) * .35F) : 0.F;
  const float brightness_amount = 1.F - std::exp(
      -static_cast<float>(frames) / std::max(1.F, sample_rate_ * .045F));
  brightness_state_ += (brightness_target - brightness_state_) * brightness_amount;

  if (std::isfinite(input_two_pitch_hz) && input_two_pitch_hz >= 30.F
      && input_two_pitch_hz <= 2'000.F && slow_envelope_[1] > .002F) {
    const float semitones_from_a = 12.F * std::log2(input_two_pitch_hz / 110.F);
    const float wrapped = std::remainder(semitones_from_a, 12.F);
    pitch_state_ += (std::clamp(wrapped, -6.F, 6.F) - pitch_state_) * brightness_amount;
  }

  const float loop_activity_target = std::min(
      .28F, clamp01(loop_analysis.transient) * .24F + clamp01(loop_analysis.energy) * .08F);
  const float loop_amount = 1.F - std::exp(
      -static_cast<float>(frames) / std::max(1.F, sample_rate_ * .060F));
  loop_activity_state_ += (loop_activity_target - loop_activity_state_) * loop_amount;

  const float fill = clamp01(dream.fill_ratio);
  const float dream_amount = 1.F - std::exp(
      -static_cast<float>(frames) / std::max(1.F, sample_rate_ * .22F));
  for (std::size_t head = 0; head < dream_state_.size(); ++head) {
    const float target = fill * clamp01(dream.memory_intent[head]);
    dream_state_[head] += (target - dream_state_[head]) * dream_amount;
    snapshot_.dream_intent[head] = clamp01(dream_state_[head]);
  }

  const bool moving = transport == LoopTransport::Playing
      || transport == LoopTransport::Recording
      || transport == LoopTransport::Overdubbing;
  snapshot_.input_one_envelope = clamp01(slow_envelope_[0]);
  snapshot_.input_two_envelope = clamp01(slow_envelope_[1]);
  snapshot_.input_two_transient = clamp01(input_two_transient);
  snapshot_.input_two_brightness = clamp01(brightness_state_);
  snapshot_.input_two_pitch_hz = std::isfinite(input_two_pitch_hz)
      ? std::clamp(input_two_pitch_hz, 0.F, 4'000.F) : 0.F;
  snapshot_.grain_activity = clamp01(activity_state_);
  snapshot_.cross_pitch_semitones = std::clamp(pitch_state_, -6.F, 6.F);
  snapshot_.loop_resynthesis_activity = clamp01(loop_activity_state_);
  snapshot_.loop_brightness = clamp01(loop_analysis.brightness);
  snapshot_.topology_morph = std::min(
      .10F, snapshot_.grain_activity * .18F
          + snapshot_.loop_resynthesis_activity * .10F
          + clamp01(loop_analysis.stereo_width) * .015F);
  snapshot_.dream_ghost = snapshot_.dream_intent[2];
  snapshot_.reference_running = moving && reference_track >= 0 && reference_frames > 0U;
  snapshot_.reference_frames = snapshot_.reference_running ? reference_frames : 0U;
  snapshot_.reference_position = snapshot_.reference_running
      ? reference_position % reference_frames : 0U;
  return snapshot_;
}

void SignalStateBus::reset() noexcept {
  fast_envelope_.fill(0.F);
  slow_envelope_.fill(0.F);
  dream_state_.fill(0.F);
  activity_state_ = 0.F;
  previous_input_two_ = 0.F;
  brightness_state_ = 0.F;
  pitch_state_ = 0.F;
  loop_activity_state_ = 0.F;
  snapshot_ = {};
}

const SignalStateSnapshot& SignalStateBus::snapshot() const noexcept {
  return snapshot_;
}

}  // namespace calcotone
