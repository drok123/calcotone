#include "calcotone/dream_buffer_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <limits>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kBlock = 128U;

struct Rendered {
  std::vector<float> now;
  std::vector<float> echo;
  std::vector<float> ghost;
};

std::vector<float> source(std::size_t frames, bool transient_heavy = true) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0U; frame < frames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float phrase = frame % 24'000U < 15'000U ? 1.F : .18F;
    const float transient = transient_heavy && frame % 8192U < 72U
        ? .42F * std::exp(-static_cast<float>(frame % 8192U) / 17.F) : 0.F;
    audio[frame * 2U] = phrase * .23F * std::sin(2.F * kPi * 173.F * t) + transient;
    audio[frame * 2U + 1U] = phrase * .19F * std::sin(2.F * kPi * 181.F * t + .41F)
        + transient * .81F;
  }
  return audio;
}

Rendered process(calcotone::DreamBufferParityProcessor& processor,
                 const std::vector<float>& input) {
  const auto frames = input.size() / 2U;
  Rendered rendered{
    std::vector<float>(input.size(), 0.F),
    std::vector<float>(input.size(), 0.F),
    std::vector<float>(input.size(), 0.F),
  };
  for (std::size_t offset = 0U; offset < frames; offset += kBlock) {
    const auto block = std::min(kBlock, frames - offset);
    processor.render_heads(rendered.now.data() + offset * 2U,
                           rendered.echo.data() + offset * 2U,
                           rendered.ghost.data() + offset * 2U, block);
    processor.capture(input.data() + offset * 2U, block);
  }
  return rendered;
}

double signature(const std::vector<float>& audio, std::size_t first_frame = 0U) {
  double result = 0.0;
  for (std::size_t index = first_frame * 2U; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.001F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 251U) + 1U);
  }
  return result;
}

void test_history_heads_and_motion() {
  calcotone::DreamBufferParityProcessor processor(kRate);
  const auto input = source(7U * static_cast<std::size_t>(kRate));
  const auto rendered = process(processor, input);
  assert(signature(rendered.now, 8'000U) > 10.0);
  assert(signature(rendered.echo, 30'000U) > 10.0);
  assert(signature(rendered.ghost, 250'000U) > 1.0);
  assert(std::abs(signature(rendered.now) - signature(rendered.echo)) > 1.0);
  assert(std::abs(signature(rendered.echo) - signature(rendered.ghost)) > 1.0);

  const auto profile = processor.profile();
  assert(profile.fill_ratio > .80F && profile.fill_ratio <= 1.F);
  assert(profile.history_seconds == 8.F);
  assert(profile.memory_age_seconds[0] > .04F && profile.memory_age_seconds[0] < .10F);
  assert(profile.memory_age_seconds[1] > .30F && profile.memory_age_seconds[1] < .70F);
  assert(profile.memory_age_seconds[2] > 2.5F && profile.memory_age_seconds[2] < 6.2F);
}

void test_capture_intelligence_is_content_dependent() {
  calcotone::DreamBufferParityProcessor transient(kRate);
  calcotone::DreamBufferParityProcessor sustained(kRate);
  process(transient, source(96'000U, true));
  process(sustained, source(96'000U, false));
  const auto a = transient.profile().memory_intent;
  const auto b = sustained.profile().memory_intent;
  assert(std::abs(a[0] - b[0]) > 1e-4F);
  assert(std::abs(a[1] - b[1]) > 1e-4F);
  assert(std::abs(a[2] - b[2]) > 1e-5F);
  for (float value : a) assert(value >= 0.F && value <= 1.F);
  for (float value : b) assert(value >= 0.F && value <= 1.F);
}

void test_nonfinite_and_capture_poison_guards() {
  calcotone::DreamBufferParityProcessor processor(kRate);
  std::vector<float> bad(32'768U * 2U, 0.F);
  for (std::size_t frame = 0U; frame < bad.size() / 2U; ++frame) {
    bad[frame * 2U] = frame % 3U == 0U
        ? std::numeric_limits<float>::quiet_NaN() : 8.F;
    bad[frame * 2U + 1U] = frame % 5U == 0U
        ? std::numeric_limits<float>::infinity() : -9.F;
  }
  const auto rendered = process(processor, bad);
  signature(rendered.now);
  signature(rendered.echo);
  signature(rendered.ghost);
  assert(processor.profile().input_peak <= 1.001F);
}

void test_silence_retires_memory() {
  calcotone::DreamBufferParityProcessor processor(kRate);
  process(processor, source(96'000U));
  assert(processor.samples_written() > 0U);
  const std::vector<float> silence(320'000U * 2U, 0.F);
  process(processor, silence);
  assert(processor.samples_written() == 0U);
}

void test_reset_is_deterministic() {
  calcotone::DreamBufferParityProcessor processor(kRate);
  const auto input = source(280'000U);
  const auto first = process(processor, input);
  processor.reset();
  const auto second = process(processor, input);
  assert(first.now == second.now);
  assert(first.echo == second.echo);
  assert(first.ghost == second.ghost);
}
}  // namespace

int main() {
  test_history_heads_and_motion();
  test_capture_intelligence_is_content_dependent();
  test_nonfinite_and_capture_poison_guards();
  test_silence_retires_memory();
  test_reset_is_deterministic();
}
