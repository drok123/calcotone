#include "calcotone/native_rack.hpp"
#include "calcotone/atmos_parity_processor.hpp"
#include "calcotone/ember_parity_processor.hpp"
#include "calcotone/ember_magnetic_core_processor.hpp"
#include "calcotone/ember_digital_capture_processor.hpp"
#include "calcotone/drift_parity_processor.hpp"
#include "calcotone/halo_parity_processor.hpp"
#include "calcotone/grain_parity_processor.hpp"
#include "calcotone/artifact_parity_processor.hpp"
#include "calcotone/stomp_parity_processor.hpp"
#include "calcotone/pressure_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kModules = static_cast<std::size_t>(RackModule::Count);
constexpr std::size_t kRackBlockFrames = 2048;
constexpr std::size_t kShapeLutSize = 2048;

const std::array<float, kShapeLutSize>& shape_lut() noexcept {
  static const auto table = [] {
    std::array<float, kShapeLutSize> values{};
    for (std::size_t i = 0; i < values.size(); ++i) {
      const float x = static_cast<float>(i) / static_cast<float>(values.size() - 1) * 10.F - 5.F;
      values[i] = std::tanh(x);
    }
    return values;
  }();
  return table;
}
float fast_shape(float value) noexcept {
  const auto& table = shape_lut();
  const float position = std::clamp((value + 5.F) * .1F, 0.F, 1.F) * static_cast<float>(kShapeLutSize - 1);
  const auto index = static_cast<std::size_t>(position);
  const float mu = position - static_cast<float>(index), mu2 = mu * mu;
  const auto at = [&](std::ptrdiff_t offset) { return table[std::clamp<std::ptrdiff_t>(static_cast<std::ptrdiff_t>(index) + offset, 0, kShapeLutSize - 1)]; };
  const float y0=at(-1), y1=at(0), y2=at(1), y3=at(2);
  const float a0=-.5F*y0+1.5F*y1-1.5F*y2+.5F*y3, a1=y0-2.5F*y1+2.F*y2-.5F*y3, a2=-.5F*y0+.5F*y2;
  return a0*mu*mu2+a1*mu2+a2*mu+y1;
}

float clamp01(float x) noexcept { return std::clamp(x, 0.F, 1.F); }
float one_pole(float input, float& state, float coefficient) noexcept {
  state += (input - state) * coefficient;
  return state;
}
float filter_coefficient(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, rate * .45F) / rate);
}

struct Params {
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> value{};
  std::atomic<bool> bypassed{true};
  float active{};
  Params(std::initializer_list<float> defaults) noexcept {
    std::size_t i = 0;
    for (float v : defaults) { target[i].store(v); value[i++] = v; }
  }
  void glide(float amount) noexcept {
    for (std::size_t i = 0; i < value.size(); ++i)
      value[i] += (target[i].load(std::memory_order_relaxed) - value[i]) * amount;
  }
};

struct Ember {
  Params p{0.F, .14F, 9500.F, .18F, .22F, .38F, .22F};
  EmberParityProcessor processor;
  EmberMagneticCoreProcessor magnetic;
  EmberDigitalCaptureProcessor digital;
  int active_mode{-1};
  explicit Ember(float rate) : processor(rate), magnetic(rate), digital(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    const float mode_value = p.target[0].load(std::memory_order_relaxed);
    const int mode = std::clamp(static_cast<int>(std::lround(mode_value)), 0, 17);
    if (mode != active_mode) {
      if (mode == 3) magnetic.reset();
      else if (mode >= 12) digital.reset();
      else if (active_mode == 3 || active_mode >= 12) processor.reset();
      active_mode = mode;
    }

    const float drive = p.target[1].load(std::memory_order_relaxed);
    const float tone = p.target[2].load(std::memory_order_relaxed);
    const float heat = p.target[3].load(std::memory_order_relaxed);
    const float character = p.target[4].load(std::memory_order_relaxed);
    const float dynamics = p.target[5].load(std::memory_order_relaxed);
    const float mix = p.target[6].load(std::memory_order_relaxed);

    if (mode == 3) {
      magnetic.set_parameter("drive", drive);
      magnetic.set_parameter("tone", tone);
      magnetic.set_parameter("heat", heat);
      magnetic.set_parameter("character", character);
      magnetic.set_parameter("dynamics", dynamics);
      magnetic.set_parameter("mix", mix);
      magnetic.process(data, frames);
      return;
    }

    if (mode >= 12) {
      digital.set_parameter("mode", static_cast<float>(mode - 12));
      digital.set_parameter("drive", drive);
      digital.set_parameter("clock", std::clamp((tone - 200.F) / 17800.F, 0.F, 1.F));
      digital.set_parameter("character", std::clamp(heat * .82F + dynamics * .18F, 0.F, 1.F));
      digital.set_parameter("filter", std::clamp(character * .82F + dynamics * .18F, 0.F, 1.F));
      digital.set_parameter("mix", mix);
      digital.process(data, frames);
      return;
    }

    processor.set_parameter("mode", mode_value);
    processor.set_parameter("drive", drive);
    processor.set_parameter("tone", tone);
    processor.set_parameter("heat", heat);
    processor.set_parameter("character", character);
    processor.set_parameter("dynamics", dynamics);
    processor.set_parameter("mix", mix);
    processor.process(data, frames);
  }
};

float read_delay(const std::vector<float>& buffer, std::size_t write, float delay) noexcept {
  const float size = static_cast<float>(buffer.size());
  float position = static_cast<float>(write) - delay;
  while (position < 0.F) position += size;
  const auto i0 = static_cast<std::size_t>(position) % buffer.size();
  const auto i1 = (i0 + 1) % buffer.size();
  const float fraction = position - std::floor(position);
  return buffer[i0] + (buffer[i1] - buffer[i0]) * fraction;
}

struct Drift {
  Params p{0.F, .28F, .0022F, .35F, .62F, .32F, .14F};
  DriftParityProcessor processor;
  explicit Drift(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("rate", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("depth", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("shape", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("spread", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("motion", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Halo {
  Params p{1.F, .36F, .22F, .42F, .14F, .58F, .14F};
  HaloParityProcessor processor;
  explicit Halo(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("algorithm", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("time", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("feedback", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("color", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("character", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("width", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Atmos {
  Params p{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  AtmosParityProcessor processor;
  explicit Atmos(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("algorithm", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("decay", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("size", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("color", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("diffusion", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("motion", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Grain {
  Params p{2.F, 13.F, .42F, .38F, .16F, .36F, .12F};
  GrainParityProcessor processor;
  explicit Grain(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("bits", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("density", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("pitch", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("chaos", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("bloom", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Artifact {
  Params p{0.F, .162F, .16F, .10F, .62F, .26F};
  ArtifactParityProcessor processor;
  explicit Artifact(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("wear", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("wow", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("noise", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("tone", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[5].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Stomp {
  Params p{0.F, .38F, .54F, .68F, .42F, .52F, 1.F};
  StompParityProcessor processor;
  explicit Stomp(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("drive", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("tone", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("level", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("character", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("body", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};
}  // namespace

struct NativeRack::Impl {
  float sample_rate;
  Ember ember;
  Drift drift;
  Halo halo;
  Atmos atmos;
  Grain grain;
  Artifact artifact;
  Stomp stomp;
  std::array<float, kRackBlockFrames * 2> dry{};
  std::array<std::atomic<unsigned>, kModules> order{};
  explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), ember(sample_rate), drift(sample_rate), halo(sample_rate), atmos(sample_rate), grain(sample_rate), artifact(sample_rate), stomp(sample_rate) {
    (void)shape_lut();
    for (unsigned i = 0; i < kModules; ++i) order[i].store(i);
  }
  Params& params(RackModule module) noexcept {
    switch (module) {
      case RackModule::Ember: return ember.p; case RackModule::Drift: return drift.p;
      case RackModule::Halo: return halo.p; case RackModule::Atmos: return atmos.p;
      case RackModule::Grain: return grain.p; case RackModule::Artifact: return artifact.p; default: return stomp.p;
    }
  }
  void run(RackModule module, float* data, std::size_t frames) noexcept {
    switch (module) {
      case RackModule::Ember: ember.process(data, frames, sample_rate); break;
      case RackModule::Drift: drift.process(data, frames, sample_rate); break;
      case RackModule::Halo: halo.process(data, frames, sample_rate); break;
      case RackModule::Atmos: atmos.process(data, frames, sample_rate); break;
      case RackModule::Grain: grain.process(data, frames, sample_rate); break;
      case RackModule::Artifact: artifact.process(data, frames, sample_rate); break;
      case RackModule::Stomp: stomp.process(data, frames, sample_rate); break;
      default: break;
    }
  }
};

RackModule rack_module_from_name(std::string_view name) noexcept {
  if (name == "saturation" || name == "ember") return RackModule::Ember;
  if (name == "chorus" || name == "drift") return RackModule::Drift;
  if (name == "delay" || name == "halo") return RackModule::Halo;
  if (name == "reverb" || name == "atmos") return RackModule::Atmos;
  if (name == "bitcrusher" || name == "grain") return RackModule::Grain;
  if (name == "media" || name == "artifact") return RackModule::Artifact;
  if (name == "stomp") return RackModule::Stomp;
  return RackModule::Count;
}
std::string_view rack_module_name(RackModule module) noexcept {
  constexpr std::array<std::string_view, kModules> names{"saturation", "chorus", "delay", "reverb", "bitcrusher", "media", "stomp"};
  const auto i = static_cast<std::size_t>(module); return i < names.size() ? names[i] : std::string_view{};
}

NativeRack::NativeRack(float rate) : impl_(std::make_unique<Impl>(rate)) {}
NativeRack::~NativeRack() = default;
void NativeRack::process(const float* input, float* output, std::size_t frames) noexcept {
  if (input != output) std::copy_n(input, frames * 2, output);
  for (unsigned slot = 0; slot < kModules; ++slot)
    process_module(static_cast<RackModule>(impl_->order[slot].load(std::memory_order_relaxed)), output, frames);
}
void NativeRack::process_module(RackModule module, float* data, std::size_t frames) noexcept {
  if (module >= RackModule::Count) return;
  auto& params = impl_->params(module);
  const float target = params.bypassed.load(std::memory_order_relaxed) ? 0.F : 1.F;
  if (target == 0.F && params.active < 1e-5F) { params.active = 0.F; return; }
  const float fade = 1.F - std::exp(-1.F / (impl_->sample_rate * .006F));
  for (std::size_t offset = 0; offset < frames; offset += kRackBlockFrames) {
    const std::size_t block = std::min(kRackBlockFrames, frames - offset);
    float* block_output = data + offset * 2;
    std::copy_n(block_output, block * 2, impl_->dry.data());
    impl_->run(module, block_output, block);
    for (std::size_t frame = 0; frame < block; ++frame) {
      params.active += (target - params.active) * fade;
      for (unsigned ch = 0; ch < 2; ++ch) {
        const auto i = frame * 2 + ch;
        block_output[i] = impl_->dry[i] + (block_output[i] - impl_->dry[i]) * params.active;
      }
    }
  }
}
bool NativeRack::set_parameter(RackModule module, std::string_view name, float value) noexcept {
  if (module >= RackModule::Count || !std::isfinite(value)) return false;
  std::size_t index = 99;
  switch (module) {
    case RackModule::Ember:
      if (name == "mode") index=0; else if(name=="drive")index=1; else if(name=="tone")index=2; else if(name=="heat")index=3; else if(name=="character")index=4; else if(name=="dynamics")index=5; else if(name=="mix")index=6; break;
    case RackModule::Drift:
      if(name=="mode")index=0; else if(name=="rate")index=1; else if(name=="depth")index=2; else if(name=="shape")index=3; else if(name=="spread")index=4; else if(name=="motion")index=5; else if(name=="mix")index=6; break;
    case RackModule::Halo:
      if(name=="algorithm")index=0; else if(name=="time")index=1; else if(name=="feedback")index=2; else if(name=="color")index=3; else if(name=="character")index=4; else if(name=="width")index=5; else if(name=="mix")index=6; break;
    case RackModule::Atmos:
      if(name=="algorithm")index=0; else if(name=="decay")index=1; else if(name=="size")index=2; else if(name=="color")index=3; else if(name=="diffusion")index=4; else if(name=="motion")index=5; else if(name=="mix")index=6; break;
    case RackModule::Grain:
      if(name=="mode")index=0; else if(name=="bits")index=1; else if(name=="density")index=2; else if(name=="pitch")index=3; else if(name=="chaos")index=4; else if(name=="bloom")index=5; else if(name=="mix")index=6; break;
    case RackModule::Artifact:
      if(name=="mode")index=0; else if(name=="wear")index=1; else if(name=="wow")index=2; else if(name=="noise")index=3; else if(name=="tone")index=4; else if(name=="mix")index=5; break;
    case RackModule::Stomp:
      if(name=="mode")index=0; else if(name=="drive")index=1; else if(name=="tone")index=2; else if(name=="level")index=3; else if(name=="character")index=4; else if(name=="body")index=5; else if(name=="mix")index=6; break;
    default: break;
  }
  if (index >= 7) return false;
  impl_->params(module).target[index].store(value, std::memory_order_relaxed); return true;
}
void NativeRack::set_bypassed(RackModule module, bool value) noexcept {
  if (module < RackModule::Count) impl_->params(module).bypassed.store(value, std::memory_order_relaxed);
}
void NativeRack::set_order(std::span<const RackModule> requested) noexcept {
  std::array<bool, kModules> used{}; std::array<RackModule, kModules> clean{}; std::size_t count = 0;
  for (auto module : requested) { const auto i=static_cast<std::size_t>(module); if(i<kModules&&!used[i]){used[i]=true;clean[count++]=module;} }
  for (unsigned i=0;i<kModules;++i) if(!used[i]) clean[count++]=static_cast<RackModule>(i);
  for (unsigned i=0;i<kModules;++i) impl_->order[i].store(static_cast<unsigned>(clean[i]), std::memory_order_relaxed);
}

struct NativePressure::Impl {
  PressureParityProcessor processor;
  explicit Impl(float sample_rate) : processor(sample_rate) {}
};

NativePressure::NativePressure(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
NativePressure::~NativePressure() = default;
void NativePressure::set_bypassed(bool bypassed) noexcept {
  impl_->processor.set_bypassed(bypassed);
}
bool NativePressure::set_parameter(std::string_view name, float value) noexcept {
  return impl_->processor.set_parameter(name, value);
}
void NativePressure::process(float* data, std::size_t frames) noexcept {
  impl_->processor.process(data, frames);
}

}  // namespace calcotone
