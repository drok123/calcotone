#include "calcotone/native_dream_engine.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr float kLaneInjection = .70710678118654752440F;
constexpr float kSafetyDrive = 1.35F;
constexpr float kSafetyNorm = .8740532878860070F;  // tanh(1.35)
constexpr std::size_t kDreamModules = 6U;

constexpr std::array<float, kDreamModules> kSendAmounts{
  .06F, .07F, .18F, .12F, .10F, .08F,
};
constexpr std::array<float, kDreamModules> kRouteAmounts{
  .007F, .009F, .019F, .026F, .014F, .011F,
};
// Ember <- ECHO, Drift <- NOW, Halo <- GHOST, Atmos <- NOW,
// Grain <- ECHO, Artifact <- GHOST.
constexpr std::array<unsigned, kDreamModules> kRouteHeads{1U, 0U, 2U, 0U, 1U, 2U};
constexpr std::array<float, 3> kMasterHeadGains{.013F, .008F, .0045F};
constexpr std::array<float, 3> kMasterFrequencies{4300.F, 2450.F, 1120.F};
constexpr std::array<float, 3> kRouteHighpass{90.F, 125.F, 170.F};
constexpr std::array<float, 3> kRouteLowpass{9800.F, 6500.F, 3600.F};

float memory_safety(float value) noexcept {
  return std::tanh(value * kSafetyDrive) / kSafetyNorm;
}

std::size_t dream_module_index(RackModule module) noexcept {
  const auto index = static_cast<std::size_t>(module);
  return index < kDreamModules ? index : kDreamModules;
}

struct StereoBiquad {
  float b0{1.F}, b1{}, b2{}, a1{}, a2{};
  std::array<float, 2> z1{}, z2{};

  void normalize(float numerator0, float numerator1, float numerator2,
                 float denominator0, float denominator1, float denominator2) noexcept {
    const float inverse = 1.F / denominator0;
    b0 = numerator0 * inverse;
    b1 = numerator1 * inverse;
    b2 = numerator2 * inverse;
    a1 = denominator1 * inverse;
    a2 = denominator2 * inverse;
  }

  void set_lowpass(float frequency, float q, float rate) noexcept {
    const float omega = 2.F * kPi * std::clamp(frequency, 5.F, rate * .45F) / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize((1.F - cosine) * .5F, 1.F - cosine, (1.F - cosine) * .5F,
              1.F + alpha, -2.F * cosine, 1.F - alpha);
  }

  void set_highpass(float frequency, float q, float rate) noexcept {
    const float omega = 2.F * kPi * std::clamp(frequency, 5.F, rate * .45F) / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize((1.F + cosine) * .5F, -(1.F + cosine), (1.F + cosine) * .5F,
              1.F + alpha, -2.F * cosine, 1.F - alpha);
  }

  void set_bandpass(float frequency, float q, float rate) noexcept {
    const float omega = 2.F * kPi * std::clamp(frequency, 5.F, rate * .45F) / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize(alpha, 0.F, -alpha, 1.F + alpha, -2.F * cosine, 1.F - alpha);
  }

  float process(float input, unsigned channel) noexcept {
    const float output = b0 * input + z1[channel];
    z1[channel] = b1 * input - a1 * output + z2[channel];
    z2[channel] = b2 * input - a2 * output;
    return output;
  }

  void reset() noexcept {
    z1 = {};
    z2 = {};
  }
};

struct RouteFilter {
  StereoBiquad highpass;
  StereoBiquad lowpass;
  float gain{};

  void configure(unsigned head, float rate) noexcept {
    highpass.set_highpass(kRouteHighpass[head], .55F, rate);
    lowpass.set_lowpass(kRouteLowpass[head], .50F, rate);
  }

  float process(float input, unsigned channel) noexcept {
    return memory_safety(lowpass.process(highpass.process(input, channel), channel));
  }

  void reset() noexcept {
    gain = 0.F;
    highpass.reset();
    lowpass.reset();
  }
};
}  // namespace

struct NativeDreamEngine::Impl {
  Impl(float requested_rate, std::size_t requested_frames)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        capacity(std::max<std::size_t>(1U, requested_frames)), memory(rate),
        capture_sum(capacity * 2U, 0.F), master_return(capacity * 2U, 0.F) {
    for (auto& head : raw_heads) head.assign(capacity * 2U, 0.F);
    for (std::size_t head = 0U; head < master_filters.size(); ++head)
      master_filters[head].set_bandpass(kMasterFrequencies[head], .52F, rate);
    for (std::size_t module = 0U; module < routes.size(); ++module)
      routes[module].configure(kRouteHeads[module], rate);
    send_smoothing = 1.F - std::exp(-1.F / (rate * .04F));
    route_smoothing = 1.F - std::exp(-1.F / (rate * .06F));
    master_smoothing = 1.F - std::exp(-1.F / (rate * .006F));
  }

  void begin(std::size_t requested_frames) noexcept {
    frames = std::min(requested_frames, capacity);
    std::fill_n(capture_sum.data(), frames * 2U, 0.F);
    memory.render_heads(raw_heads[0].data(), raw_heads[1].data(), raw_heads[2].data(), frames);

    for (std::size_t frame = 0U; frame < frames; ++frame) {
      for (unsigned channel = 0U; channel < 2U; ++channel) {
        const auto sample = frame * 2U + channel;
        float sum = 0.F;
        for (std::size_t head = 0U; head < raw_heads.size(); ++head)
          sum += master_filters[head].process(raw_heads[head][sample], channel)
              * kMasterHeadGains[head];
        sum *= .58F;
        const float midpoint = memory_safety((master_previous[channel] + sum) * .5F);
        const float current = memory_safety(sum);
        master_return[sample] = (midpoint + current) * .5F;
        master_previous[channel] = sum;
      }
    }
  }

  void route(RackModule destination, float* lane_one, float* lane_two,
             std::size_t requested_frames, bool enabled) noexcept {
    const auto module = dream_module_index(destination);
    if (module >= kDreamModules || !lane_one || !lane_two) return;
    const auto count = std::min({requested_frames, frames, capacity});
    auto& state = routes[module];
    const float target = enabled ? kRouteAmounts[module] : 0.F;
    const auto head = kRouteHeads[module];
    for (std::size_t frame = 0U; frame < count; ++frame) {
      state.gain += (target - state.gain) * route_smoothing;
      const float injection_gain = state.gain * kLaneInjection;
      for (unsigned channel = 0U; channel < 2U; ++channel) {
        const auto sample = frame * 2U + channel;
        const float recalled = state.process(raw_heads[head][sample], channel) * injection_gain;
        lane_one[sample] += recalled;
        lane_two[sample] += recalled;
      }
    }
  }

  void capture(RackModule source, const float* lane_one, const float* lane_two,
               std::size_t requested_frames, bool enabled) noexcept {
    const auto module = dream_module_index(source);
    if (module >= kDreamModules || !lane_one || !lane_two) return;
    const auto count = std::min({requested_frames, frames, capacity});
    const float target = enabled ? kSendAmounts[module] : 0.F;
    for (std::size_t frame = 0U; frame < count; ++frame) {
      send_gains[module] += (target - send_gains[module]) * send_smoothing;
      const float gain = send_gains[module] * kLaneInjection;
      for (unsigned channel = 0U; channel < 2U; ++channel) {
        const auto sample = frame * 2U + channel;
        capture_sum[sample] += (lane_one[sample] + lane_two[sample]) * gain;
      }
    }
  }

  void finish(float* lane_one, float* lane_two, std::size_t requested_frames,
              bool processed_path_enabled) noexcept {
    if (!lane_one || !lane_two) return;
    const auto count = std::min({requested_frames, frames, capacity});
    memory.capture(capture_sum.data(), count);
    const float target = processed_path_enabled ? 1.F : 0.F;
    for (std::size_t frame = 0U; frame < count; ++frame) {
      master_active += (target - master_active) * master_smoothing;
      const float gain = master_active * kLaneInjection;
      for (unsigned channel = 0U; channel < 2U; ++channel) {
        const auto sample = frame * 2U + channel;
        const float recalled = master_return[sample] * gain;
        lane_one[sample] += recalled;
        lane_two[sample] += recalled;
      }
    }
  }

  void reset() noexcept {
    memory.reset();
    std::fill(send_gains.begin(), send_gains.end(), 0.F);
    master_active = 0.F;
    master_previous = {};
    frames = 0U;
    for (auto& filter : master_filters) filter.reset();
    for (auto& route : routes) route.reset();
    std::fill(capture_sum.begin(), capture_sum.end(), 0.F);
    std::fill(master_return.begin(), master_return.end(), 0.F);
    for (auto& head : raw_heads) std::fill(head.begin(), head.end(), 0.F);
  }

  float rate;
  std::size_t capacity;
  std::size_t frames{};
  DreamBufferParityProcessor memory;
  std::array<std::vector<float>, 3> raw_heads;
  std::vector<float> capture_sum;
  std::vector<float> master_return;
  std::array<StereoBiquad, 3> master_filters;
  std::array<RouteFilter, kDreamModules> routes;
  std::array<float, kDreamModules> send_gains{};
  std::array<float, 2> master_previous{};
  float master_active{};
  float send_smoothing{};
  float route_smoothing{};
  float master_smoothing{};
};

NativeDreamEngine::NativeDreamEngine(float sample_rate, std::size_t max_block_frames)
    : impl_(std::make_unique<Impl>(sample_rate, max_block_frames)) {}
NativeDreamEngine::~NativeDreamEngine() = default;

void NativeDreamEngine::begin_block(std::size_t frames) noexcept {
  impl_->begin(frames);
}

void NativeDreamEngine::inject_route(RackModule destination, float* lane_one, float* lane_two,
                                     std::size_t frames, bool enabled) noexcept {
  impl_->route(destination, lane_one, lane_two, frames, enabled);
}

void NativeDreamEngine::capture_module(RackModule source, const float* lane_one,
                                       const float* lane_two, std::size_t frames,
                                       bool enabled) noexcept {
  impl_->capture(source, lane_one, lane_two, frames, enabled);
}

void NativeDreamEngine::finish_block(float* lane_one, float* lane_two, std::size_t frames,
                                     bool processed_path_enabled) noexcept {
  impl_->finish(lane_one, lane_two, frames, processed_path_enabled);
}

void NativeDreamEngine::reset() noexcept {
  impl_->reset();
}

DreamBufferParityProfile NativeDreamEngine::profile() const noexcept {
  return impl_->memory.profile();
}

}  // namespace calcotone
