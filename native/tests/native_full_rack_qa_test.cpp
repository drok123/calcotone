#include "calcotone/native_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <span>
#include <string_view>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kBlock = 128;
constexpr float kPi2 = 6.2831853071795864769F;
constexpr std::array<calcotone::RackModule, 7> kModules{
    calcotone::RackModule::Ember,
    calcotone::RackModule::Drift,
    calcotone::RackModule::Halo,
    calcotone::RackModule::Atmos,
    calcotone::RackModule::Grain,
    calcotone::RackModule::Artifact,
    calcotone::RackModule::Stomp,
};

struct ControlSet {
  calcotone::RackModule module;
  std::span<const std::string_view> names;
};

constexpr std::array<std::string_view, 6> kEmber{"drive", "tone", "heat", "character", "dynamics", "mix"};
constexpr std::array<std::string_view, 6> kDrift{"rate", "depth", "shape", "spread", "motion", "mix"};
constexpr std::array<std::string_view, 6> kHalo{"time", "feedback", "color", "character", "width", "mix"};
constexpr std::array<std::string_view, 6> kAtmos{"decay", "size", "color", "diffusion", "motion", "mix"};
constexpr std::array<std::string_view, 6> kGrain{"bits", "density", "pitch", "chaos", "bloom", "mix"};
constexpr std::array<std::string_view, 5> kArtifact{"wear", "wow", "noise", "tone", "mix"};
constexpr std::array<std::string_view, 6> kStomp{"drive", "tone", "level", "character", "body", "mix"};
constexpr std::array<ControlSet, 7> kControls{{
    {calcotone::RackModule::Ember, kEmber},
    {calcotone::RackModule::Drift, kDrift},
    {calcotone::RackModule::Halo, kHalo},
    {calcotone::RackModule::Atmos, kAtmos},
    {calcotone::RackModule::Grain, kGrain},
    {calcotone::RackModule::Artifact, kArtifact},
    {calcotone::RackModule::Stomp, kStomp},
}};

float sample_for(std::uint64_t frame, unsigned channel, float amplitude = .085F) {
  const float t = static_cast<float>(frame) / kRate;
  const float low = std::sin(kPi2 * (channel == 0 ? 97.F : 131.F) * t);
  const float mid = std::sin(kPi2 * (channel == 0 ? 613.F : 809.F) * t + .37F);
  const float high = std::sin(kPi2 * (channel == 0 ? 3719.F : 5147.F) * t + .11F);
  return amplitude * (low * .58F + mid * .29F + high * .13F);
}

void fill_input(std::vector<float>& input, std::uint64_t start_frame, float amplitude = .085F) {
  for (std::size_t frame = 0; frame < input.size() / 2; ++frame) {
    input[frame * 2] = sample_for(start_frame + frame, 0, amplitude);
    input[frame * 2 + 1] = sample_for(start_frame + frame, 1, amplitude);
  }
}

void assert_healthy(std::span<const float> output) {
  float peak = 0.F;
  double sum = 0.0;
  double sum_squares = 0.0;
  for (const float value : output) {
    assert(std::isfinite(value));
    assert(std::abs(value) <= 1.F);
    peak = std::max(peak, std::abs(value));
    sum += value;
    sum_squares += static_cast<double>(value) * value;
  }
  const double mean = sum / std::max<std::size_t>(1, output.size());
  const double rms = std::sqrt(sum_squares / std::max<std::size_t>(1, output.size()));
  assert(peak > 1e-5F);
  assert(rms > 1e-6 && rms < .95);
  assert(std::abs(mean) < .18);
}

void bypass_everything(calcotone::NativeProcessor& processor) {
  for (const auto module : kModules) processor.set_module_bypassed(module, true);
  processor.set_stack_bypassed(true);
  processor.set_pressure_bypassed(true);
}

void configure_module(calcotone::NativeProcessor& processor, calcotone::RackModule module, float seed) {
  const auto entry = std::find_if(kControls.begin(), kControls.end(), [module](const ControlSet& set) {
    return set.module == module;
  });
  assert(entry != kControls.end());
  for (std::size_t index = 0; index < entry->names.size(); ++index) {
    float value = .18F + std::fmod(seed + static_cast<float>(index) * .113F, .46F);
    if (entry->names[index] == "mix") value = .42F;
    if (entry->names[index] == "feedback") value = std::min(value, .52F);
    if (entry->names[index] == "noise") value = .08F;
    assert(processor.set_module_parameter(module, entry->names[index], value));
  }
}

void configure_full_rack(calcotone::NativeProcessor& processor) {
  processor.set_active(true);
  processor.set_input_gain(.82F);
  processor.set_output_gain(.72F);
  for (std::size_t index = 0; index < kModules.size(); ++index) {
    configure_module(processor, kModules[index], .071F * static_cast<float>(index + 1));
    processor.set_module_bypassed(kModules[index], false);
  }
  processor.set_stack_bypassed(false);
  processor.set_stack_input(2);
  processor.set_stomp_input(2);
  processor.set_stack_model(calcotone::AmpModel::Calcotone);
  processor.set_stack_cabinet(calcotone::Cabinet::FourBy12);
  processor.set_stack_quality(4);
  processor.set_stack_drive(.34F);
  processor.set_stack_tone(.52F);
  processor.set_stack_sag(.31F);
  processor.set_stack_mix(.44F);
  processor.set_pressure_bypassed(false);
  assert(processor.set_pressure_parameter("mode", 1.F));
  assert(processor.set_pressure_parameter("style", 2.F));
  assert(processor.set_pressure_parameter("drive", .34F));
  assert(processor.set_pressure_parameter("time", .43F));
  assert(processor.set_pressure_parameter("character", .48F));
  assert(processor.set_pressure_parameter("mix", .36F));
}

void raw_bypass_contract() {
  calcotone::NativeProcessor processor(kRate);
  processor.set_active(true);
  processor.set_input_gain(1.F);
  processor.set_output_gain(1.F);
  bypass_everything(processor);

  std::vector<float> input(kBlock * 2), output(kBlock * 2);
  std::uint64_t cursor = 0;
  for (unsigned block = 0; block < 48; ++block) {
    fill_input(input, cursor, .06F);
    processor.process(input.data(), output.data(), kBlock);
    cursor += kBlock;
  }

  constexpr float equal_power = .70710678F;
  for (std::size_t frame = 0; frame < kBlock; ++frame) {
    const float expected = (input[frame * 2] + input[frame * 2 + 1]) * equal_power;
    assert(std::abs(output[frame * 2] - expected) < 2e-5F);
    assert(std::abs(output[frame * 2 + 1] - expected) < 2e-5F);
  }
  assert(processor.output_limited_samples() == 0U);
}

void individual_module_health() {
  for (std::size_t module_index = 0; module_index < kModules.size(); ++module_index) {
    calcotone::NativeProcessor processor(kRate);
    processor.set_active(true);
    processor.set_input_gain(1.F);
    processor.set_output_gain(.72F);
    bypass_everything(processor);
    configure_module(processor, kModules[module_index], .083F * static_cast<float>(module_index + 1));
    processor.set_module_bypassed(kModules[module_index], false);
    if (kModules[module_index] == calcotone::RackModule::Stomp) processor.set_stomp_input(2);

    std::vector<float> input(kBlock * 2), output(kBlock * 2);
    double difference_power = 0.0;
    std::size_t difference_samples = 0;
    std::uint64_t cursor = 0;
    for (unsigned block = 0; block < 560; ++block) {
      fill_input(input, cursor);
      processor.process(input.data(), output.data(), kBlock);
      cursor += kBlock;
      assert_healthy(output);
      if (block < 320) continue;
      for (std::size_t frame = 0; frame < kBlock; ++frame) {
        const float dry = (input[frame * 2] + input[frame * 2 + 1]) * .70710678F * .72F;
        const float delta = output[frame * 2] - dry;
        difference_power += static_cast<double>(delta) * delta;
        ++difference_samples;
      }
    }
    const double difference_rms = std::sqrt(difference_power / std::max<std::size_t>(1, difference_samples));
    assert(difference_rms > 1e-5);
    assert(processor.pre_limiter_peak() < 2.F);
  }
}

void full_rack_order_and_stress() {
  calcotone::NativeProcessor processor(kRate);
  configure_full_rack(processor);

  constexpr std::array<std::string_view, 8> stages{
      "saturation", "chorus", "delay", "reverb", "bitcrusher", "media", "stomp", "chaos"};
  std::array<std::string_view, 8> order = stages;
  std::vector<float> input(kBlock * 2), output(kBlock * 2);
  std::uint64_t cursor = 0;

  for (std::size_t rotation = 0; rotation < stages.size(); ++rotation) {
    std::rotate(order.begin(), order.begin() + 1, order.end());
    assert(processor.set_serial_order(order));
    for (unsigned block = 0; block < 48; ++block) {
      fill_input(input, cursor, .055F);
      processor.process(input.data(), output.data(), kBlock);
      cursor += kBlock;
      assert_healthy(output);
    }
  }

  std::uint32_t random = 0xC01C07E5U;
  for (unsigned pass = 0; pass < 512; ++pass) {
    random = random * 1664525U + 1013904223U;
    const std::size_t module_index = random % kControls.size();
    const auto& controls = kControls[module_index];
    random = random * 1664525U + 1013904223U;
    const std::size_t parameter_index = random % controls.names.size();
    random = random * 1664525U + 1013904223U;
    float value = .08F + static_cast<float>((random >> 8U) & 0xFFFFU) / 65535.F * .62F;
    const auto parameter = controls.names[parameter_index];
    if (parameter == "mix") value = std::min(value, .48F);
    if (parameter == "feedback") value = std::min(value, .55F);
    if (parameter == "noise") value = std::min(value, .22F);
    assert(processor.set_module_parameter(controls.module, parameter, value));

    fill_input(input, cursor, .052F);
    processor.process(input.data(), output.data(), kBlock);
    cursor += kBlock;
    assert_healthy(output);
  }

  assert(std::isfinite(processor.pre_limiter_peak()));
  assert(processor.pre_limiter_peak() < 4.F);
  assert(processor.output_limited_samples() < cursor / 20U);
}

void deterministic_fresh_state() {
  calcotone::NativeProcessor first(kRate), second(kRate);
  configure_full_rack(first);
  configure_full_rack(second);
  std::vector<float> input(kBlock * 2), output_one(kBlock * 2), output_two(kBlock * 2);
  std::uint64_t cursor = 0;
  for (unsigned block = 0; block < 384; ++block) {
    fill_input(input, cursor, .045F);
    first.process(input.data(), output_one.data(), kBlock);
    second.process(input.data(), output_two.data(), kBlock);
    cursor += kBlock;
    for (std::size_t sample = 0; sample < output_one.size(); ++sample) {
      assert(std::isfinite(output_one[sample]));
      assert(std::isfinite(output_two[sample]));
      assert(std::abs(output_one[sample] - output_two[sample]) < 1e-6F);
    }
  }
}
}  // namespace

int main() {
  raw_bypass_contract();
  individual_module_health();
  full_rack_order_and_stress();
  deterministic_fresh_state();
  std::cout << "native full-rack DSP QA passed\n";
}
