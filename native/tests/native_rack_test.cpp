#include "calcotone/native_rack.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kFrames = 48'000;
std::vector<float> signal() {
  std::vector<float> data(kFrames * 2);
  for (std::size_t i = 0; i < kFrames; ++i) {
    const float sample = .24F * std::sin(static_cast<float>(i) * 6.283185307F * 173.F / kRate);
    data[i * 2] = sample; data[i * 2 + 1] = sample * .83F;
  }
  return data;
}
void require_safe(const std::vector<float>& data) {
  for (float sample : data) { assert(std::isfinite(sample)); assert(std::abs(sample) <= 1.201F); }
}
}  // namespace

int main() {
  const auto input = signal(); std::vector<float> output(input.size());
  calcotone::NativeRack bypassed(kRate);
  bypassed.process(input.data(), output.data(), kFrames);
  assert(input == output);

  constexpr std::array modules{calcotone::RackModule::Ember, calcotone::RackModule::Drift,
      calcotone::RackModule::Halo, calcotone::RackModule::Atmos, calcotone::RackModule::Grain,
      calcotone::RackModule::Artifact, calcotone::RackModule::Stomp};
  for (const auto module : modules) {
    calcotone::NativeRack rack(kRate); rack.set_bypassed(module, false);
    if (module == calcotone::RackModule::Ember) { assert(rack.set_parameter(module, "drive", 1.F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Drift) { assert(rack.set_parameter(module, "depth", .008F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Halo) { assert(rack.set_parameter(module, "time", .03F)); assert(rack.set_parameter(module, "feedback", .86F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Atmos) { assert(rack.set_parameter(module, "decay", 16.F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Grain) { assert(rack.set_parameter(module, "density", 1.F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else if (module == calcotone::RackModule::Artifact) { assert(rack.set_parameter(module, "mode", 13.F)); assert(rack.set_parameter(module, "wear", .8F)); assert(rack.set_parameter(module, "mix", .8F)); }
    else { assert(rack.set_parameter(module, "mode", 8.F)); assert(rack.set_parameter(module, "drive", 1.F)); assert(rack.set_parameter(module, "mix", 1.F)); }
    rack.process(input.data(), output.data(), kFrames); require_safe(output); assert(output != input);
  }

  calcotone::NativeRack silence_rack(kRate);
  for (auto module : modules) silence_rack.set_bypassed(module, false);
  std::vector<float> silence(input.size(), 0.F);
  for (int pass = 0; pass < 4; ++pass) silence_rack.process(silence.data(), silence.data(), kFrames);
  require_safe(silence);
  // Artifact models may contribute a bounded analog floor while enabled; the
  // complete rack must nevertheless remain quiet and never self-oscillate.
  assert(std::all_of(silence.begin(), silence.end(), [](float x) { return std::abs(x) < .025F; }));

  // Every STOMP topology survives a full-scale control sweep without NaN,
  // runaway output, or a silent model selection.
  for (unsigned mode = 0; mode < 14; ++mode) {
    calcotone::NativeRack stomp(kRate);
    stomp.set_bypassed(calcotone::RackModule::Stomp, false);
    assert(stomp.set_parameter(calcotone::RackModule::Stomp, "mode", static_cast<float>(mode)));
    assert(stomp.set_parameter(calcotone::RackModule::Stomp, "drive", 1.F));
    assert(stomp.set_parameter(calcotone::RackModule::Stomp, "level", 1.F));
    assert(stomp.set_parameter(calcotone::RackModule::Stomp, "mix", 1.F));
    stomp.process(input.data(), output.data(), kFrames);
    require_safe(output);
    const float peak = *std::max_element(output.begin(), output.end(), [](float a, float b) { return std::abs(a) < std::abs(b); });
    assert(std::abs(peak) > .001F);
  }
  // Live hardware/model changes must reach a true dry crossing rather than
  // numerically gliding through unrelated model indices. At 48 kHz the native
  // handoff uses a 3 ms / 144-frame fade-out before committing the new model.
  {
    calcotone::NativeRack transition(kRate);
    transition.set_bypassed(calcotone::RackModule::Stomp, false);
    assert(transition.set_parameter(calcotone::RackModule::Stomp, "mode", 0.F));
    assert(transition.set_parameter(calcotone::RackModule::Stomp, "drive", .82F));
    assert(transition.set_parameter(calcotone::RackModule::Stomp, "mix", 1.F));
    std::vector<float> warmup(4096U * 2U);
    for (std::size_t frame = 0; frame < 4096U; ++frame) {
      const float sample = .22F * std::sin(static_cast<float>(frame) * 6.283185307F * 173.F / kRate);
      warmup[frame * 2U] = sample; warmup[frame * 2U + 1U] = sample;
    }
    transition.process(warmup.data(), warmup.data(), 4096U);
    assert(transition.set_parameter(calcotone::RackModule::Stomp, "mode", 13.F));
    std::vector<float> changing(512U * 2U);
    for (std::size_t frame = 0; frame < 512U; ++frame) {
      const float sample = .22F * std::sin(static_cast<float>(frame + 4096U) * 6.283185307F * 173.F / kRate);
      changing[frame * 2U] = sample; changing[frame * 2U + 1U] = sample;
    }
    const auto dry_change = changing;
    transition.process(changing.data(), changing.data(), 512U);
    require_safe(changing);
    constexpr std::size_t dry_crossing = 143U;
    assert(std::abs(changing[dry_crossing * 2U] - dry_change[dry_crossing * 2U]) < 1e-5F);
    assert(std::abs(changing[dry_crossing * 2U + 1U] - dry_change[dry_crossing * 2U + 1U]) < 1e-5F);
  }

  assert(calcotone::rack_module_from_name("saturation") == calcotone::RackModule::Ember);
  assert(calcotone::rack_module_from_name("bitcrusher") == calcotone::RackModule::Grain);
  assert(calcotone::rack_module_from_name("media") == calcotone::RackModule::Artifact);
  assert(calcotone::rack_module_from_name("stomp") == calcotone::RackModule::Stomp);
  assert(calcotone::rack_module_from_name("garbage") == calcotone::RackModule::Count);

  calcotone::NativePressure pressure(kRate);
  pressure.set_bypassed(false);
  assert(pressure.set_parameter("mode", 2.F));
  assert(pressure.set_parameter("style", 3.F));
  assert(pressure.set_parameter("drive", .8F));
  output = input; pressure.process(output.data(), kFrames); require_safe(output); assert(output != input);

  std::cout << "native rack tests passed\n";
}
