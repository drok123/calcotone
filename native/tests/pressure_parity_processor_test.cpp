#include "calcotone/pressure_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kBlock = 128U;

void process_blocks(calcotone::PressureParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0; offset < frames; offset += kBlock)
    processor.process(audio.data() + offset * 2U, std::min(kBlock, frames - offset));
}

void configure(calcotone::PressureParityProcessor& processor, unsigned mode = 0U,
               unsigned style = 2U, float drive = .42F, float time = .46F,
               float character = .38F, float mix = .72F) {
  assert(processor.set_parameter("mode", static_cast<float>(mode)));
  assert(processor.set_parameter("style", static_cast<float>(style)));
  assert(processor.set_parameter("drive", drive));
  assert(processor.set_parameter("time", time));
  assert(processor.set_parameter("character", character));
  assert(processor.set_parameter("mix", mix));
  processor.set_bypassed(false);
  processor.reset();
}

std::vector<float> source(std::size_t frames, float frequency = 173.F,
                          std::size_t active_frames = 96'000U) {
  std::vector<float> audio(frames * 2U, 0.F);
  active_frames = std::min(active_frames, frames);
  for (std::size_t frame = 0; frame < active_frames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float burst = frame % 8192U < 1500U ? 1.F : .22F;
    const float transient = frame % 8192U < 72U
        ? .36F * std::exp(-static_cast<float>(frame % 8192U) / 18.F) : 0.F;
    audio[frame * 2U] = burst * .28F * std::sin(t * 2.F * kPi * frequency) + transient;
    audio[frame * 2U + 1U] = burst * .24F * std::sin(t * 2.F * kPi * frequency * 1.017F + .37F)
        + transient * .88F;
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double value = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.201F);
    value += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 251U) + 1U);
  }
  return value;
}

double rms(const std::vector<float>& audio, std::size_t first_frame = 0U) {
  double energy = 0.0;
  std::size_t samples = 0U;
  for (std::size_t frame = first_frame; frame < audio.size() / 2U; ++frame) {
    for (unsigned channel = 0; channel < 2U; ++channel) {
      const double sample = audio[frame * 2U + channel];
      energy += sample * sample;
      ++samples;
    }
  }
  return std::sqrt(energy / std::max<std::size_t>(1U, samples));
}

std::vector<float> render(unsigned mode, unsigned style, float drive = .42F,
                          float time = .46F, float character = .38F,
                          float mix = .72F, float frequency = 173.F,
                          std::size_t frames = 72'000U) {
  calcotone::PressureParityProcessor processor(kRate);
  configure(processor, mode, style, drive, time, character, mix);
  auto audio = source(frames, frequency);
  process_blocks(processor, audio);
  signature(audio);
  return audio;
}

std::vector<float> render_raw(float mode, float style, float drive, float time,
                              float character, float mix) {
  calcotone::PressureParityProcessor processor(kRate);
  assert(processor.set_parameter("mode", mode));
  assert(processor.set_parameter("style", style));
  assert(processor.set_parameter("drive", drive));
  assert(processor.set_parameter("time", time));
  assert(processor.set_parameter("character", character));
  assert(processor.set_parameter("mix", mix));
  processor.reset();
  auto audio = source(32'768U);
  process_blocks(processor, audio);
  return audio;
}

void test_all_mode_style_combinations_are_distinct() {
  std::array<double, calcotone::kPressureModeCount * calcotone::kPressureStyleCount> signatures{};
  std::size_t index = 0U;
  for (unsigned mode = 0U; mode < calcotone::kPressureModeCount; ++mode) {
    for (unsigned style = 0U; style < calcotone::kPressureStyleCount; ++style) {
      const auto audio = render(mode, style);
      assert(rms(audio, 4096U) > .001F);
      signatures[index++] = signature(audio);
    }
  }
  for (std::size_t first = 0U; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
}

void test_defaults_match_ui_contract() {
  calcotone::PressureParityProcessor defaults(kRate);
  defaults.reset();
  auto default_audio = source(32'768U);
  process_blocks(defaults, default_audio);

  calcotone::PressureParityProcessor explicit_defaults(kRate);
  configure(explicit_defaults, 0U, 2U, .42F, .46F, .38F, .72F);
  auto explicit_audio = source(32'768U);
  process_blocks(explicit_defaults, explicit_audio);
  assert(default_audio == explicit_audio);
}

void test_parameter_domains_clamp() {
  const auto low = render_raw(-20.F, -8.F, -1.F, -.4F, -.7F, -.5F);
  const auto explicit_low = render_raw(0.F, 0.F, 0.F, 0.F, 0.F, 0.F);
  assert(low == explicit_low);

  const auto high = render_raw(50.F, 99.F, 4.F, 3.F, 8.F, 2.F);
  const auto explicit_high = render_raw(3.F, 3.F, 1.F, 1.F, 1.F, 1.F);
  assert(high == explicit_high);
}

void test_correlated_equal_power_mix() {
  const auto dry = render(0U, 2U, .18F, .46F, .38F, 0.F, 311.F, 32'768U);
  const auto wet = render(0U, 2U, .18F, .46F, .38F, 1.F, 311.F, 32'768U);
  const auto half = render(0U, 2U, .18F, .46F, .38F, .5F, 311.F, 32'768U);
  const float curve = std::sqrt(.5F);
  const float normalization = 1.F / std::sqrt(1.F + .42F);
  const float coefficient = curve * normalization;
  for (std::size_t index = 0U; index < half.size(); ++index) {
    const float expected = (dry[index] + wet[index]) * coefficient;
    assert(std::abs(half[index] - expected) < 3e-5F);
  }
}

void test_detector_highpass_and_character_tone_are_live() {
  const auto sub = render(1U, 1U, .12F, .5F, 0.F, 1.F, 35.F, 48'000U);
  const auto mid = render(1U, 1U, .12F, .5F, 0.F, 1.F, 1200.F, 48'000U);
  assert(rms(mid, 4096U) > rms(sub, 4096U) * 1.25);

  const auto dark = render(2U, 2U, .35F, .5F, 0.F, 1.F, 6000.F, 48'000U);
  const auto bright = render(2U, 2U, .35F, .5F, 1.F, 1.F, 6000.F, 48'000U);
  assert(rms(bright, 4096U) > rms(dark, 4096U) * 1.08);
}

void test_time_changes_release_memory() {
  const auto fast = render(1U, 1U, .82F, 0.F, .4F, 1.F, 173.F, 144'000U);
  const auto slow = render(1U, 1U, .82F, 1.F, .4F, 1.F, 173.F, 144'000U);
  assert(std::abs(signature(fast) - signature(slow)) > 1e-3);
}

void test_bypass_fade_and_silence() {
  calcotone::PressureParityProcessor processor(kRate);
  configure(processor, 3U, 3U, .9F, .3F, .7F, 1.F);
  auto audio = source(48'000U);
  processor.set_bypassed(true);
  process_blocks(processor, audio);
  const auto dry = source(48'000U);
  double ending_error = 0.0;
  for (std::size_t frame = 40'000U; frame < 48'000U; ++frame) {
    ending_error += std::abs(static_cast<double>(audio[frame * 2U] - dry[frame * 2U]));
    ending_error += std::abs(static_cast<double>(audio[frame * 2U + 1U] - dry[frame * 2U + 1U]));
  }
  assert(ending_error < 1e-3);

  for (unsigned mode = 0U; mode < calcotone::kPressureModeCount; ++mode) {
    calcotone::PressureParityProcessor silent(kRate);
    configure(silent, mode, 3U, 1.F, 1.F, 1.F, 1.F);
    std::vector<float> silence(8192U * 2U, 0.F);
    process_blocks(silent, silence);
    for (float sample : silence) assert(sample == 0.F);
  }
}

void test_reset_is_deterministic() {
  calcotone::PressureParityProcessor processor(kRate);
  configure(processor, 2U, 3U, .83F, .72F, .61F, .88F);
  auto first = source(64'000U);
  process_blocks(processor, first);
  processor.reset();
  auto second = source(64'000U);
  process_blocks(processor, second);
  assert(first == second);
}
}  // namespace

int main() {
  test_all_mode_style_combinations_are_distinct();
  test_defaults_match_ui_contract();
  test_parameter_domains_clamp();
  test_correlated_equal_power_mix();
  test_detector_highpass_and_character_tone_are_live();
  test_time_changes_release_memory();
  test_bypass_fade_and_silence();
  test_reset_is_deterministic();

  calcotone::PressureParityProcessor processor(kRate);
  assert(!processor.set_parameter("not-a-parameter", .5F));
}
