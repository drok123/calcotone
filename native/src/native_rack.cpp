#include "calcotone/native_rack.hpp"

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
  std::array<float, 2> tone_state{}, dc_in{}, dc_out{};
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .045F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      p.glide(glide);
      const unsigned mode = std::min(17U, static_cast<unsigned>(std::round(p.value[0])));
      const float drive = clamp01(p.value[1]), heat = clamp01(p.value[3]);
      const float character = clamp01(p.value[4]), dynamics = clamp01(p.value[5]), mix = clamp01(p.value[6]);
      const float gain = 1.F + drive * (2.2F + static_cast<float>(mode % 6) * .38F) + heat * 1.35F;
      const float cutoff = std::clamp(p.value[2], 200.F, 18000.F);
      const float g = filter_coefficient(cutoff, rate);
      for (unsigned ch = 0; ch < 2; ++ch) {
        const std::size_t i = frame * 2 + ch;
        const float dry = data[i];
        const float bias = ((mode & 1U) ? -.035F : .025F) * character;
        float wet = std::tanh((dry + bias) * gain) - std::tanh(bias * gain);
        wet *= 1.F / std::max(.72F, std::tanh(gain));
        wet = one_pole(wet, tone_state[ch], g);
        const float dc = wet - dc_in[ch] + .995F * dc_out[ch];
        dc_in[ch] = wet; dc_out[ch] = dc;
        const float compressed = dc / (1.F + std::abs(dc) * dynamics * .42F);
        data[i] = std::clamp(dry + (compressed - dry) * mix, -1.2F, 1.2F);
      }
    }
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
  std::array<std::vector<float>, 2> buffer;
  std::size_t write{};
  float phase{};
  explicit Drift(float rate) {
    const auto size = static_cast<std::size_t>(rate * .08F) + 8;
    buffer[0].assign(size, 0.F); buffer[1].assign(size, 0.F);
  }
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .04F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      p.glide(glide);
      const unsigned mode = std::min(21U, static_cast<unsigned>(std::round(p.value[0])));
      const float hz = std::clamp(p.value[1], .05F, 2.5F) * (mode >= 17 ? .72F : 1.F);
      phase += 2.F * kPi * hz / rate; if (phase >= 2.F * kPi) phase -= 2.F * kPi;
      const float depth = std::clamp(p.value[2], 0.F, .008F) * rate;
      const float shape = clamp01(p.value[3]), spread = clamp01(p.value[4]);
      const float motion = clamp01(p.value[5]), mix = clamp01(p.value[6]);
      for (unsigned ch = 0; ch < 2; ++ch) {
        const std::size_t i = frame * 2 + ch;
        const float dry = data[i];
        buffer[ch][write] = dry;
        const float offset = ch ? kPi * (.3F + spread * .7F) : 0.F;
        float lfo = std::sin(phase + offset);
        lfo = lfo * (1.F - shape * .45F) + std::sin((phase + offset) * 2.F) * shape * .22F;
        const float base_ms = mode >= 8 && mode <= 18 ? 3.2F : 7.5F;
        float wet = read_delay(buffer[ch], write, base_ms * .001F * rate + depth * (.5F + .5F * lfo));
        if (mode == 19 || mode == 20) wet = dry - wet * (.68F + motion * .22F); // classic phaser family
        const float pan = mode >= 21 ? (.72F + .28F * std::sin(phase + offset)) : 1.F;
        data[i] = std::clamp(dry + (wet * pan - dry) * mix, -1.2F, 1.2F);
      }
      write = (write + 1) % buffer[0].size();
    }
  }
};

struct Halo {
  Params p{1.F, .36F, .22F, .42F, .14F, .58F, .14F};
  std::array<std::vector<float>, 2> buffer;
  std::array<float, 2> feedback_low{};
  std::size_t write{};
  explicit Halo(float rate) {
    const auto size = static_cast<std::size_t>(rate * 6.25F) + 8;
    buffer[0].assign(size, 0.F); buffer[1].assign(size, 0.F);
  }
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .12F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      p.glide(glide);
      const unsigned mode = std::min(11U, static_cast<unsigned>(std::round(p.value[0])));
      const float seconds = std::clamp(p.value[1], .03F, 6.2F);
      const float feedback = std::clamp(p.value[2], 0.F, .86F);
      const float color = clamp01(p.value[3]), character = clamp01(p.value[4]);
      const float width = clamp01(p.value[5]), mix = clamp01(p.value[6]);
      const float g = filter_coefficient(900.F + color * 11200.F, rate);
      const float wow = (mode == 1 || mode >= 7) ? std::sin(static_cast<float>(write) * 2.F * kPi * .7F / rate) * character * .0015F * rate : 0.F;
      float wet[2]{};
      wet[0] = read_delay(buffer[0], write, seconds * rate + wow);
      wet[1] = read_delay(buffer[1], write, seconds * rate - wow + width * .004F * rate);
      for (unsigned ch = 0; ch < 2; ++ch) {
        const unsigned source = (mode == 3 || mode == 9) ? 1U - ch : ch;
        const float dry = data[frame * 2 + ch];
        const float filtered = one_pole(wet[source], feedback_low[ch], g);
        buffer[ch][write] = std::clamp(dry + filtered * feedback, -1.3F, 1.3F);
        data[frame * 2 + ch] = std::clamp(dry + (wet[ch] - dry) * mix, -1.2F, 1.2F);
      }
      write = (write + 1) % buffer[0].size();
    }
  }
};

struct Atmos {
  Params p{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  std::array<std::array<std::vector<float>, 2>, 4> delay;
  std::array<std::array<std::size_t, 2>, 4> write{};
  std::array<float, 2> color_state{};
  explicit Atmos(float rate) {
    constexpr std::array<float, 4> times{.0297F, .0371F, .0411F, .0437F};
    for (unsigned n = 0; n < 4; ++n) for (unsigned ch = 0; ch < 2; ++ch)
      delay[n][ch].assign(static_cast<std::size_t>(rate * (times[n] + ch * .0017F) * 2.2F) + 8, 0.F);
  }
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .16F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      p.glide(glide);
      const unsigned mode = std::min(11U, static_cast<unsigned>(std::round(p.value[0])));
      const float decay = std::clamp(p.value[1], .35F, 16.F), size = clamp01(p.value[2]);
      const float color = clamp01(p.value[3]), diffusion = clamp01(p.value[4]);
      const float motion = clamp01(p.value[5]), mix = clamp01(p.value[6]);
      const float feedback = std::clamp(std::pow(.001F, .04F / decay) * (.78F + size * .18F), 0.F, .94F);
      const float g = filter_coefficient(1100.F + color * 11500.F, rate);
      const float dry_l = data[frame * 2], dry_r = data[frame * 2 + 1];
      float wet[2]{};
      for (unsigned ch = 0; ch < 2; ++ch) {
        const float input = ch ? dry_r : dry_l;
        float sum = 0.F;
        for (unsigned n = 0; n < 4; ++n) sum += delay[n][ch][write[n][ch]] * (n & 1U ? -1.F : 1.F);
        sum *= .25F;
        const float filtered = one_pole(sum, color_state[ch], g);
        for (unsigned n = 0; n < 4; ++n) {
          auto& line = delay[n][ch];
          const float cross = delay[(n + 1) % 4][1U - ch][write[(n + 1) % 4][1U - ch]];
          line[write[n][ch]] = std::clamp(input * (.18F + diffusion * .18F) + filtered * feedback + cross * motion * .045F, -1.2F, 1.2F);
          write[n][ch] = (write[n][ch] + 1) % line.size();
        }
        wet[ch] = filtered * (mode == 5 ? 1.12F : .92F);
      }
      data[frame * 2] = std::clamp(dry_l + (wet[0] - dry_l) * mix, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry_r + (wet[1] - dry_r) * mix, -1.2F, 1.2F);
    }
  }
};
}  // namespace

struct NativeRack::Impl {
  float sample_rate;
  Ember ember;
  Drift drift;
  Halo halo;
  Atmos atmos;
  std::array<std::atomic<unsigned>, kModules> order{};
  explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), drift(sample_rate), halo(sample_rate), atmos(sample_rate) {
    for (unsigned i = 0; i < kModules; ++i) order[i].store(i);
  }
  Params& params(RackModule module) noexcept {
    switch (module) {
      case RackModule::Ember: return ember.p; case RackModule::Drift: return drift.p;
      case RackModule::Halo: return halo.p; default: return atmos.p;
    }
  }
  void run(RackModule module, float* data, std::size_t frames) noexcept {
    switch (module) {
      case RackModule::Ember: ember.process(data, frames, sample_rate); break;
      case RackModule::Drift: drift.process(data, frames, sample_rate); break;
      case RackModule::Halo: halo.process(data, frames, sample_rate); break;
      case RackModule::Atmos: atmos.process(data, frames, sample_rate); break;
      default: break;
    }
  }
};

RackModule rack_module_from_name(std::string_view name) noexcept {
  if (name == "saturation" || name == "ember") return RackModule::Ember;
  if (name == "chorus" || name == "drift") return RackModule::Drift;
  if (name == "delay" || name == "halo") return RackModule::Halo;
  if (name == "reverb" || name == "atmos") return RackModule::Atmos;
  return RackModule::Count;
}
std::string_view rack_module_name(RackModule module) noexcept {
  constexpr std::array<std::string_view, kModules> names{"saturation", "chorus", "delay", "reverb"};
  const auto i = static_cast<std::size_t>(module); return i < names.size() ? names[i] : std::string_view{};
}

NativeRack::NativeRack(float rate) : impl_(std::make_unique<Impl>(rate)) {}
NativeRack::~NativeRack() = default;
void NativeRack::process(const float* input, float* output, std::size_t frames) noexcept {
  if (input != output) std::copy_n(input, frames * 2, output);
  for (unsigned slot = 0; slot < kModules; ++slot) {
    const auto module = static_cast<RackModule>(impl_->order[slot].load(std::memory_order_relaxed));
    if (module < RackModule::Count && !impl_->params(module).bypassed.load(std::memory_order_relaxed)) impl_->run(module, output, frames);
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
}  // namespace calcotone
