#include "calcotone/dream_buffer_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr float kTwoPi = kPi * 2.F;
constexpr float kHistorySeconds = 8.F;
constexpr float kMaxRecallSeconds = 6.2F;

float clamp01(float value) noexcept {
  return std::clamp(value, 0.F, 1.F);
}

float sanitize_capture(float value) noexcept {
  if (!std::isfinite(value)) return 0.F;
  if (std::abs(value) > 1.25F) value = std::tanh(value);
  return std::abs(value) < 1e-20F ? 0.F : value;
}

std::uint8_t encode_intent(float value) noexcept {
  return static_cast<std::uint8_t>(std::lround(clamp01(value) * 255.F));
}
}  // namespace

struct DreamBufferParityProcessor::Impl {
  struct Head {
    float base_left;
    float base_right;
    float depth_left;
    float depth_right;
    float rate;
    float initial_phase;
    float phase;
    double target_left{};
    double target_right{};
  };

  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        length(std::max<std::size_t>(2048U,
            static_cast<std::size_t>(std::ceil(rate * kHistorySeconds)))),
        left(length, 0.F), right(length, 0.F),
        intent_now(length, 0U), intent_echo(length, 0U), intent_ghost(length, 0U),
        max_recall_samples(static_cast<std::size_t>(std::ceil(rate * kMaxRecallSeconds))) {
    reset();
  }

  void reset() noexcept {
    std::fill(left.begin(), left.end(), 0.F);
    std::fill(right.begin(), right.end(), 0.F);
    std::fill(intent_now.begin(), intent_now.end(), 0U);
    std::fill(intent_echo.begin(), intent_echo.end(), 0U);
    std::fill(intent_ghost.begin(), intent_ghost.end(), 0U);
    write_index = 0U;
    written = 0U;
    captures = 0U;
    silent_frames = 0U;
    profile_peak = 0.F;
    fast_envelope = 0.F;
    slow_envelope = 0.F;
    detail_envelope = 0.F;
    previous_mono = 0.F;
    now_intent_state = .18F;
    echo_intent_state = .16F;
    ghost_intent_state = .08F;
    heads = {{
      {.061F, .079F, .014F, .017F, .071F, .37F, .37F},
      {.43F, .53F, .085F, .105F, .031F, 1.41F, 1.41F},
      {3.85F, 4.55F, 1.10F, 1.28F, .009F, 2.27F, 2.27F},
    }};
    for (std::size_t head = 0U; head < heads.size(); ++head) {
      offsets_left[head] = static_cast<double>(heads[head].base_left * rate);
      offsets_right[head] = static_cast<double>(heads[head].base_right * rate);
      heads[head].target_left = offsets_left[head];
      heads[head].target_right = offsets_right[head];
      memory_age_seconds[head] = (heads[head].base_left + heads[head].base_right) * .5F;
    }
  }

  float read_audio(const std::vector<float>& buffer, std::size_t index,
                   double offset_samples) const noexcept {
    double position = static_cast<double>(index) - offset_samples;
    while (position < 0.0) position += static_cast<double>(length);
    while (position >= static_cast<double>(length)) position -= static_cast<double>(length);
    const auto index_zero = static_cast<std::size_t>(std::floor(position));
    const auto index_one = index_zero + 1U < length ? index_zero + 1U : 0U;
    const float fraction = static_cast<float>(position - static_cast<double>(index_zero));
    return buffer[index_zero] + (buffer[index_one] - buffer[index_zero]) * fraction;
  }

  float read_intent(const std::vector<std::uint8_t>& buffer, std::size_t index,
                    double offset_samples) const noexcept {
    double position = static_cast<double>(index) - offset_samples;
    while (position < 0.0) position += static_cast<double>(length);
    while (position >= static_cast<double>(length)) position -= static_cast<double>(length);
    const auto index_zero = static_cast<std::size_t>(std::floor(position));
    const auto index_one = index_zero + 1U < length ? index_zero + 1U : 0U;
    const float fraction = static_cast<float>(position - static_cast<double>(index_zero));
    const float encoded = static_cast<float>(buffer[index_zero])
        + (static_cast<float>(buffer[index_one]) - static_cast<float>(buffer[index_zero])) * fraction;
    return encoded / 255.F;
  }

  void update_head_targets(std::size_t frames) noexcept {
    const float block_seconds = static_cast<float>(frames) / rate;
    for (std::size_t head = 0U; head < heads.size(); ++head) {
      auto& config = heads[head];
      config.phase += block_seconds * config.rate * kTwoPi;
      if (config.phase > kTwoPi) config.phase -= kTwoPi;
      const float sway = std::sin(config.phase);
      const float counter_sway = std::sin(config.phase * .73F + 1.17F);
      const float left_seconds = std::clamp(
          config.base_left + config.depth_left * sway, .012F, kHistorySeconds - .1F);
      const float right_seconds = std::clamp(
          config.base_right + config.depth_right * counter_sway, .012F, kHistorySeconds - .1F);
      memory_age_seconds[head] = (left_seconds + right_seconds) * .5F;
      config.target_left = static_cast<double>(left_seconds * rate);
      config.target_right = static_cast<double>(right_seconds * rate);
    }
  }

  void render(float* now, float* echo, float* ghost, std::size_t frames) noexcept {
    if (now) std::fill_n(now, frames * 2U, 0.F);
    if (echo) std::fill_n(echo, frames * 2U, 0.F);
    if (ghost) std::fill_n(ghost, frames * 2U, 0.F);
    if (frames == 0U) return;

    update_head_targets(frames);
    const auto start_left = offsets_left;
    const auto start_right = offsets_right;
    std::array<double, 3> step_left{};
    std::array<double, 3> step_right{};
    for (std::size_t head = 0U; head < heads.size(); ++head) {
      step_left[head] = (heads[head].target_left - start_left[head])
          / static_cast<double>(frames);
      step_right[head] = (heads[head].target_right - start_right[head])
          / static_cast<double>(frames);
    }

    for (std::size_t frame = 0U; frame < frames; ++frame) {
      const auto timeline_index = (write_index + frame) % length;
      const auto available = std::min(length, written + frame);
      for (std::size_t head = 0U; head < heads.size(); ++head) {
        const double offset_left = start_left[head] + step_left[head] * static_cast<double>(frame);
        const double offset_right = start_right[head] + step_right[head] * static_cast<double>(frame);
        const bool ready = available >= static_cast<std::size_t>(
            std::ceil(std::max(offset_left, offset_right))) + 2U;
        float* output = head == 0U ? now : head == 1U ? echo : ghost;
        if (!output || !ready) continue;
        const double intent_offset = (offset_left + offset_right) * .5;
        const auto& tag_buffer = head == 0U ? intent_now : head == 1U ? intent_echo : intent_ghost;
        const float remembered_intent = read_intent(tag_buffer, timeline_index, intent_offset);
        const float weight = head == 0U
            ? .60F + remembered_intent * .40F
            : head == 1U
              ? .48F + remembered_intent * .52F
              : .28F + remembered_intent * .72F;
        output[frame * 2U] = read_audio(left, timeline_index, offset_left) * weight;
        output[frame * 2U + 1U] = read_audio(right, timeline_index, offset_right) * weight;
      }
    }

    for (std::size_t head = 0U; head < heads.size(); ++head) {
      offsets_left[head] = heads[head].target_left;
      offsets_right[head] = heads[head].target_right;
    }
  }

  void capture_block(const float* input, std::size_t frames) noexcept {
    if (!input || frames == 0U) return;
    bool has_signal = false;
    for (std::size_t sample = 0U; sample < frames * 2U; ++sample) {
      const float value = input[sample];
      if (std::isfinite(value) && std::abs(value) > 1e-12F) {
        has_signal = true;
        break;
      }
    }
    if (!has_signal && written == 0U) return;
    silent_frames = has_signal ? 0U : silent_frames + frames;

    for (std::size_t frame = 0U; frame < frames; ++frame) {
      const float left_sample = sanitize_capture(input[frame * 2U]);
      const float right_sample = sanitize_capture(input[frame * 2U + 1U]);
      const float mono = (left_sample + right_sample) * .5F;
      const float amplitude = std::abs(mono);
      fast_envelope += (amplitude - fast_envelope) * .075F;
      slow_envelope += (amplitude - slow_envelope) * .0025F;
      detail_envelope += (std::abs(mono - previous_mono) - detail_envelope) * .018F;
      const float transient = clamp01((fast_envelope - slow_envelope * 1.18F) * 8.5F);
      const float sustained = clamp01(slow_envelope * 5.2F);
      const float brightness = clamp01(detail_envelope * 5.5F);
      previous_mono = mono;

      const float now_target = clamp01(.18F + transient * .54F + brightness * .24F + sustained * .10F);
      const float echo_target = clamp01(.16F + sustained * .52F + transient * .18F + brightness * .12F);
      const float ghost_target = clamp01(.08F + transient * .34F + sustained * .38F
          + brightness * sustained * .28F);
      now_intent_state += (now_target - now_intent_state) * .0045F;
      echo_intent_state += (echo_target - echo_intent_state) * .0022F;
      ghost_intent_state += (ghost_target - ghost_intent_state) * .0009F;

      left[write_index] = left_sample;
      right[write_index] = right_sample;
      intent_now[write_index] = encode_intent(now_intent_state);
      intent_echo[write_index] = encode_intent(echo_intent_state);
      intent_ghost[write_index] = encode_intent(ghost_intent_state);
      profile_peak = std::max(profile_peak, std::max(std::abs(left_sample), std::abs(right_sample)));

      ++write_index;
      if (write_index >= length) {
        write_index = 0U;
        ++captures;
      }
      if (written < length) ++written;
    }

    if (!has_signal && silent_frames >= max_recall_samples + frames) {
      written = 0U;
      silent_frames = 0U;
      profile_peak = 0.F;
      fast_envelope = 0.F;
      slow_envelope = 0.F;
      detail_envelope = 0.F;
      previous_mono = 0.F;
      now_intent_state = .18F;
      echo_intent_state = .16F;
      ghost_intent_state = .08F;
    }
  }

  DreamBufferParityProfile profile() const noexcept {
    return {
      static_cast<float>(written) / static_cast<float>(length),
      kHistorySeconds,
      profile_peak,
      captures,
      memory_age_seconds,
      {now_intent_state, echo_intent_state, ghost_intent_state},
    };
  }

  float rate;
  std::size_t length;
  std::vector<float> left;
  std::vector<float> right;
  std::vector<std::uint8_t> intent_now;
  std::vector<std::uint8_t> intent_echo;
  std::vector<std::uint8_t> intent_ghost;
  std::array<Head, 3> heads{};
  std::array<double, 3> offsets_left{};
  std::array<double, 3> offsets_right{};
  std::array<float, 3> memory_age_seconds{};
  std::size_t write_index{};
  std::size_t written{};
  std::size_t captures{};
  std::size_t silent_frames{};
  std::size_t max_recall_samples{};
  float profile_peak{};
  float fast_envelope{};
  float slow_envelope{};
  float detail_envelope{};
  float previous_mono{};
  float now_intent_state{.18F};
  float echo_intent_state{.16F};
  float ghost_intent_state{.08F};
};

DreamBufferParityProcessor::DreamBufferParityProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
DreamBufferParityProcessor::~DreamBufferParityProcessor() = default;

void DreamBufferParityProcessor::render_heads(float* now, float* echo, float* ghost,
                                               std::size_t frames) noexcept {
  impl_->render(now, echo, ghost, frames);
}

void DreamBufferParityProcessor::capture(const float* interleaved_stereo,
                                         std::size_t frames) noexcept {
  impl_->capture_block(interleaved_stereo, frames);
}

void DreamBufferParityProcessor::reset() noexcept {
  impl_->reset();
}

DreamBufferParityProfile DreamBufferParityProcessor::profile() const noexcept {
  return impl_->profile();
}

std::size_t DreamBufferParityProcessor::samples_written() const noexcept {
  return impl_->written;
}

float DreamBufferParityProcessor::sample_rate() const noexcept {
  return impl_->rate;
}

}  // namespace calcotone
