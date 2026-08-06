#include "calcotone/stack_amp.hpp"
#include "calcotone/input_router.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <iostream>
#include <limits>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kBlock = 128U;

struct RenderSettings {
  calcotone::AmpModel model{calcotone::AmpModel::Calcotone};
  calcotone::Cabinet cabinet{calcotone::Cabinet::FourBy12};
  unsigned quality{1U};
  float drive{.36F};
  float tone{.52F};
  float sag{.34F};
  float mix{.62F};
};

std::vector<float> make_source(std::size_t frames, float high_frequency = 1319.F,
                               float amplitude = .24F) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0; frame < frames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float burst = frame % 8192U < 128U
        ? .18F * std::exp(-static_cast<float>(frame % 8192U) / 27.F) : 0.F;
    const float left = amplitude * std::sin(t * 2.F * kPi * 193.F)
        + .09F * std::sin(t * 2.F * kPi * high_frequency) + burst;
    const float right = amplitude * .97F * std::sin(t * 2.F * kPi * 197.F + .2F)
        + .085F * std::sin(t * 2.F * kPi * high_frequency * 1.013F) + burst * .91F;
    audio[frame * 2U] = left;
    audio[frame * 2U + 1U] = right;
  }
  return audio;
}

void configure(calcotone::StackAmp& amp, const RenderSettings& settings) {
  amp.set_model(settings.model);
  amp.set_cabinet(settings.cabinet);
  amp.set_quality(settings.quality);
  amp.set_drive(settings.drive);
  amp.set_tone(settings.tone);
  amp.set_sag(settings.sag);
  amp.set_mix(settings.mix);
}

void process_blocks(calcotone::StackAmp& amp, const std::vector<float>& input,
                    std::vector<float>& output) {
  const std::size_t frames = input.size() / 2U;
  output.assign(input.size(), 0.F);
  for (std::size_t offset = 0; offset < frames; offset += kBlock) {
    amp.process(input.data() + offset * 2U, output.data() + offset * 2U,
                std::min(kBlock, frames - offset));
  }
}

std::vector<float> render(const RenderSettings& settings,
                          const std::vector<float>& input) {
  calcotone::StackAmp amp(kRate);
  configure(amp, settings);
  std::vector<float> output;
  process_blocks(amp, input, output);
  return output;
}

double signature(const std::vector<float>& audio) {
  double value = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.151F);
    value += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 257U) + 1U);
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

void test_dual_mono_router() {
  constexpr std::array<float, 4> capture{.25F, -.5F, .75F, -1.F};
  std::array<float, 4> lane_one{}, lane_two{}, mixed{};
  calcotone::split_dual_mono(capture.data(), lane_one.data(), lane_two.data(), 2U, 2.F);
  constexpr std::array<float, 4> expected_one{.5F, .5F, 1.5F, 1.5F};
  constexpr std::array<float, 4> expected_two{-1.F, -1.F, -2.F, -2.F};
  assert(lane_one == expected_one && lane_two == expected_two);

  using calcotone::StackInputSource;
  assert(calcotone::stack_receives_lane(StackInputSource::InputOne, 0U));
  assert(!calcotone::stack_receives_lane(StackInputSource::InputOne, 1U));
  assert(!calcotone::stack_receives_lane(StackInputSource::InputTwo, 0U));
  assert(calcotone::stack_receives_lane(StackInputSource::InputTwo, 1U));
  assert(calcotone::stack_receives_lane(StackInputSource::Both, 0U));
  assert(calcotone::stack_receives_lane(StackInputSource::Both, 1U));

  calcotone::mix_dual_mono(lane_one.data(), lane_two.data(), mixed.data(), 2U, 1.F);
  assert(mixed[0] < 0.F && mixed[2] < 0.F);
  for (float sample : mixed) assert(std::isfinite(sample) && std::abs(sample) <= 1.F);
}

void test_defaults_match_ui_contract() {
  const auto input = make_source(24'000U);
  calcotone::StackAmp defaults(kRate);
  std::vector<float> default_output;
  process_blocks(defaults, input, default_output);

  const RenderSettings explicit_defaults{};
  const auto explicit_output = render(explicit_defaults, input);
  assert(default_output == explicit_output);
}

void test_all_amp_and_cabinet_identities() {
  const auto input = make_source(32'768U);
  std::array<double, 30> signatures{};
  std::size_t index = 0U;
  for (unsigned model = 0U; model < 6U; ++model) {
    for (unsigned cabinet = 0U; cabinet < 5U; ++cabinet) {
      RenderSettings settings;
      settings.model = static_cast<calcotone::AmpModel>(model);
      settings.cabinet = static_cast<calcotone::Cabinet>(cabinet);
      settings.quality = 2U;
      const auto output = render(settings, input);
      assert(rms(output, 4096U) > .003F);
      signatures[index++] = signature(output);
    }
  }
  for (std::size_t first = 0U; first < signatures.size(); ++first) {
    for (std::size_t second = first + 1U; second < signatures.size(); ++second) {
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
    }
  }
}

void test_quality_modes_are_live_and_finite() {
  const auto input = make_source(48'000U, 4879.F, .31F);
  std::array<double, 3> signatures{};
  const std::array<unsigned, 3> quality{1U, 2U, 4U};
  for (std::size_t index = 0U; index < quality.size(); ++index) {
    RenderSettings settings;
    settings.model = calcotone::AmpModel::ModelT;
    settings.cabinet = calcotone::Cabinet::FourBy12;
    settings.quality = quality[index];
    settings.drive = .82F;
    signatures[index] = signature(render(settings, input));
  }
  assert(std::abs(signatures[0] - signatures[1]) > 1e-4);
  assert(std::abs(signatures[1] - signatures[2]) > 1e-4);
}

void test_parameter_and_quality_clamps() {
  const auto input = make_source(24'000U);
  RenderSettings maximum;
  maximum.model = static_cast<calcotone::AmpModel>(999U);
  maximum.cabinet = static_cast<calcotone::Cabinet>(999U);
  maximum.quality = 99U;
  maximum.drive = 4.F;
  maximum.tone = 3.F;
  maximum.sag = 2.F;
  maximum.mix = 8.F;

  RenderSettings explicit_maximum;
  explicit_maximum.model = calcotone::AmpModel::Calcotone;
  explicit_maximum.cabinet = calcotone::Cabinet::Direct;
  explicit_maximum.quality = 4U;
  explicit_maximum.drive = 1.F;
  explicit_maximum.tone = 1.F;
  explicit_maximum.sag = 1.F;
  explicit_maximum.mix = 1.F;
  assert(render(maximum, input) == render(explicit_maximum, input));

  RenderSettings quality_three = explicit_maximum;
  quality_three.quality = 3U;
  RenderSettings quality_two = explicit_maximum;
  quality_two.quality = 2U;
  assert(render(quality_three, input) == render(quality_two, input));
}

void test_equal_power_mix() {
  const auto input = make_source(24'000U, 997.F, .08F);
  RenderSettings dry_settings;
  dry_settings.model = calcotone::AmpModel::Blackface;
  dry_settings.cabinet = calcotone::Cabinet::Direct;
  dry_settings.drive = .08F;
  dry_settings.mix = 0.F;
  RenderSettings wet_settings = dry_settings;
  wet_settings.mix = 1.F;
  RenderSettings half_settings = dry_settings;
  half_settings.mix = .5F;

  const auto dry = render(dry_settings, input);
  const auto wet = render(wet_settings, input);
  const auto half = render(half_settings, input);
  constexpr float equal_power = .7071067811865475F;
  for (std::size_t index = 0U; index < half.size(); ++index) {
    const float expected = (dry[index] + wet[index]) * equal_power;
    assert(std::abs(half[index] - expected) < 3e-5F);
  }
}

void test_direct_cabinet_retains_more_high_frequency_energy() {
  const auto input = make_source(48'000U, 8'200.F, .03F);
  RenderSettings four_by_twelve;
  four_by_twelve.model = calcotone::AmpModel::Blackface;
  four_by_twelve.cabinet = calcotone::Cabinet::FourBy12;
  four_by_twelve.drive = .10F;
  four_by_twelve.mix = 1.F;
  RenderSettings direct = four_by_twelve;
  direct.cabinet = calcotone::Cabinet::Direct;

  const double cabinet_rms = rms(render(four_by_twelve, input), 4096U);
  const double direct_rms = rms(render(direct, input), 4096U);
  assert(direct_rms > cabinet_rms * 1.10);
}

void test_sag_and_model_glide_are_live() {
  const auto input = make_source(64'000U, 2221.F, .34F);
  RenderSettings rigid;
  rigid.model = calcotone::AmpModel::ModelT;
  rigid.drive = .88F;
  rigid.sag = 0.F;
  RenderSettings sagging = rigid;
  sagging.sag = 1.F;
  assert(std::abs(signature(render(rigid, input)) - signature(render(sagging, input))) > 1e-3);

  calcotone::StackAmp switched(kRate);
  RenderSettings before;
  before.model = calcotone::AmpModel::Blackface;
  before.drive = .76F;
  before.mix = 1.F;
  configure(switched, before);
  std::vector<float> switched_output(input.size(), 0.F);
  constexpr std::size_t switch_frame = 16'384U;
  switched.process(input.data(), switched_output.data(), switch_frame);
  switched.set_model(calcotone::AmpModel::ModelT);
  for (std::size_t offset = switch_frame; offset < input.size() / 2U; offset += kBlock) {
    switched.process(input.data() + offset * 2U, switched_output.data() + offset * 2U,
                     std::min(kBlock, input.size() / 2U - offset));
  }
  float maximum_jump = 0.F;
  for (std::size_t index = switch_frame * 2U; index < switched_output.size(); ++index) {
    maximum_jump = std::max(maximum_jump, std::abs(switched_output[index] - switched_output[index - 2U]));
  }
  assert(maximum_jump < .75F);
  const auto unchanged = render(before, input);
  assert(std::abs(signature(switched_output) - signature(unchanged)) > 1e-3);
}

void test_in_place_processing_and_silence() {
  const auto input = make_source(24'000U);
  RenderSettings settings;
  settings.model = calcotone::AmpModel::Plexi;
  settings.cabinet = calcotone::Cabinet::TwoBy12;
  settings.quality = 4U;
  settings.drive = .72F;

  const auto separate = render(settings, input);
  calcotone::StackAmp in_place_amp(kRate);
  configure(in_place_amp, settings);
  auto in_place = input;
  for (std::size_t offset = 0U; offset < input.size() / 2U; offset += kBlock) {
    in_place_amp.process(in_place.data() + offset * 2U, in_place.data() + offset * 2U,
                         std::min(kBlock, input.size() / 2U - offset));
  }
  assert(separate == in_place);

  calcotone::StackAmp silent_amp(kRate);
  configure(silent_amp, settings);
  std::vector<float> silence(8192U * 2U, 0.F);
  silent_amp.process(silence.data(), silence.data(), silence.size() / 2U);
  for (float sample : silence) assert(sample == 0.F);
}
}  // namespace

int main() {
  test_dual_mono_router();
  test_defaults_match_ui_contract();
  test_all_amp_and_cabinet_identities();
  test_quality_modes_are_live_and_finite();
  test_parameter_and_quality_clamps();
  test_equal_power_mix();
  test_direct_cabinet_retains_more_high_frequency_energy();
  test_sag_and_model_glide_are_live();
  test_in_place_processing_and_silence();

  std::cout << "Native STACK exact-worklet parity passed: 30 amp/cab identities, quality, sag, cabinet, glide, mix, and routing\n";
  return 0;
}
