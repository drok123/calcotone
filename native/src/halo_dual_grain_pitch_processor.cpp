#include "calcotone/halo_dual_grain_pitch_processor.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace calcotone {
namespace {
constexpr std::array<float, 7> kEnvelope{0.F, .18F, .72F, 1.F, .72F, .18F, 0.F};

float read_delay(const std::vector<float>& buffer, std::size_t write, float delay_samples) noexcept {
  float position = static_cast<float>(write) - delay_samples;
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto first = static_cast<std::size_t>(position);
  const auto second = (first + 1) % buffer.size();
  const float fraction = position - static_cast<float>(first);
  return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}

float envelope(float normalized) noexcept {
  const float position = std::clamp(normalized, 0.F, 1.F) * static_cast<float>(kEnvelope.size() - 1);
  const auto first = static_cast<std::size_t>(position);
  const auto second = std::min(first + 1, kEnvelope.size() - 1);
  const float fraction = position - static_cast<float>(first);
  return kEnvelope[first] + (kEnvelope[second] - kEnvelope[first]) * fraction;
}

}  // namespace

struct HaloDualGrainPitchProcessor::Impl {
  struct Grain {
    bool active{};
    std::size_t age{};
    float start_delay{};
    float end_delay{};
  };

  float sample_rate;
  std::array<std::vector<float>, 2> buffer;
  std::array<std::array<Grain, 2>, 2> grains{};
  std::array<float, 2> semitones{};
  std::array<float, 2> amount{};
  std::size_t write{};
  std::size_t sample_counter{};
  std::size_t next_grain{};
  std::size_t grain_duration{};
  std::size_t grain_hop{};
  unsigned next_voice{};

  explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)) {
    const auto size = static_cast<std::size_t>(sample_rate * .24F) + 32;
    buffer[0].assign(size, 0.F);
    buffer[1].assign(size, 0.F);
    grain_duration = std::max<std::size_t>(8, static_cast<std::size_t>(std::lround(sample_rate * .11F)));
    grain_hop = std::max<std::size_t>(4, static_cast<std::size_t>(std::lround(sample_rate * .055F)));
    next_grain = static_cast<std::size_t>(std::lround(sample_rate * .02F));
  }

  void start_grain(unsigned voice) noexcept {
    for (unsigned channel = 0; channel < 2; ++channel) {
      const float ratio = std::pow(2.F, (semitones[channel] * amount[channel]) / 12.F);
      const float slope = 1.F - ratio;
      const float travel_seconds = std::clamp(std::abs(slope) * .11F, .008F, .085F);
      const float low_seconds = .006F;
      const float high_seconds = low_seconds + travel_seconds;
      auto& grain = grains[channel][voice];
      grain.active = true;
      grain.age = 0;
      grain.start_delay = (slope < 0.F ? high_seconds : low_seconds) * sample_rate;
      grain.end_delay = (slope < 0.F ? low_seconds : high_seconds) * sample_rate;
    }
  }

  void clear_state() noexcept {
    for (auto& channel : buffer) std::fill(channel.begin(), channel.end(), 0.F);
    grains = {};
    write = 0;
    sample_counter = 0;
    next_grain = static_cast<std::size_t>(std::lround(sample_rate * .02F));
    next_voice = 0;
  }

  void process_frame(float left, float right, float& output_left, float& output_right) noexcept {
    while (sample_counter >= next_grain) {
      start_grain(next_voice);
      next_voice = 1U - next_voice;
      next_grain += grain_hop;
    }

    buffer[0][write] = std::isfinite(left) ? left : 0.F;
    buffer[1][write] = std::isfinite(right) ? right : 0.F;
    std::array<float, 2> output{};
    for (unsigned channel = 0; channel < 2; ++channel) {
      for (unsigned voice = 0; voice < 2; ++voice) {
        auto& grain = grains[channel][voice];
        if (!grain.active) continue;
        const float normalized = static_cast<float>(grain.age) / static_cast<float>(grain_duration);
        const float delay_samples = grain.start_delay + (grain.end_delay - grain.start_delay) * normalized;
        output[channel] += read_delay(buffer[channel], write, delay_samples) * envelope(normalized);
        ++grain.age;
        if (grain.age >= grain_duration) grain.active = false;
      }
    }

    write = (write + 1) % buffer[0].size();
    ++sample_counter;
    output_left = output[0];
    output_right = output[1];
  }
};

HaloDualGrainPitchProcessor::HaloDualGrainPitchProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
HaloDualGrainPitchProcessor::~HaloDualGrainPitchProcessor() = default;

void HaloDualGrainPitchProcessor::set_pitch(unsigned channel, float semitones, float amount) noexcept {
  if (channel >= 2 || !std::isfinite(semitones) || !std::isfinite(amount)) return;
  impl_->semitones[channel] = std::clamp(semitones, -12.F, 12.F);
  impl_->amount[channel] = std::clamp(amount, 0.F, 1.F);
}

void HaloDualGrainPitchProcessor::process_frame(
    float left,
    float right,
    float& output_left,
    float& output_right) noexcept {
  impl_->process_frame(left, right, output_left, output_right);
}

void HaloDualGrainPitchProcessor::reset() noexcept {
  impl_->clear_state();
}

}  // namespace calcotone
