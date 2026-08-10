#include "calcotone/native_processor.hpp"

#include "calcotone/input_router.hpp"
#include "calcotone/native_dream_engine.hpp"
#include "calcotone/native_visual_spectrum.hpp"
#include "calcotone/pitch_tracker.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace calcotone {
namespace {
constexpr std::size_t kBlockFrames = 2048;
constexpr unsigned kStackToken = static_cast<unsigned>(RackModule::Count);
constexpr unsigned kOrderSlots = kStackToken + 1U;

std::uint64_t pack_order(const std::array<unsigned, kOrderSlots>& order) noexcept {
  std::uint64_t packed = 0;
  for (unsigned slot = 0; slot < kOrderSlots; ++slot)
    packed |= static_cast<std::uint64_t>(order[slot] & 0xFU) << (slot * 4U);
  return packed;
}

void publish_peak(std::atomic<float>& destination, float value) noexcept {
  auto previous = destination.load(std::memory_order_relaxed);
  while (value > previous && !destination.compare_exchange_weak(
      previous, value, std::memory_order_relaxed, std::memory_order_relaxed)) {}
}
}

struct NativeProcessor::Impl {
  explicit Impl(float sample_rate)
      : rate(std::clamp(sample_rate, 8'000.F, 384'000.F)), tuner(rate),
        stack_one(rate), stack_two(rate), rack_one(rate), rack_two(rate),
        pressure_one(rate), pressure_two(rate), loop(rate), dream(rate, kBlockFrames),
        input_route_alpha(1.F - std::exp(-1.F / (.018F * rate))),
        input_route_current(input_route_target(InputRoutingMode::Stereo, 1.F, false, false)) {
    native_visual_spectrum().configure(rate);
    std::array<unsigned, kOrderSlots> initial{};
    for (unsigned slot = 0; slot < kOrderSlots; ++slot) initial[slot] = slot;
    packed_order.store(pack_order(initial));

    // The host starts before the embedded faceplate can publish its complete
    // preset. Keep every nonlinear/stateful stage bypassed and the final output
    // muted until the UI explicitly sends its synchronized engine state.
    for (unsigned module = 0; module < kStackToken; ++module) {
      rack_one.set_bypassed(static_cast<RackModule>(module), true);
      rack_two.set_bypassed(static_cast<RackModule>(module), true);
      module_bypassed[module].store(true, std::memory_order_relaxed);
    }
    pressure_one.set_bypassed(true);
    pressure_two.set_bypassed(true);
    apply_stomp_route();
  }

  void apply_stomp_route() noexcept {
    const bool bypassed = stomp_bypassed.load(std::memory_order_relaxed);
    const auto source = static_cast<StackInputSource>(stomp_input.load(std::memory_order_relaxed));
    rack_one.set_bypassed(RackModule::Stomp, bypassed || !stack_receives_lane(source, 0));
    rack_two.set_bypassed(RackModule::Stomp, bypassed || !stack_receives_lane(source, 1));
  }

  void process_block(const float* input, float* output, std::size_t frames) noexcept {
    for (std::size_t frame = 0; frame < frames; ++frame) tuner.push(input[frame * 2 + 1]);
    const auto mode = static_cast<InputRoutingMode>(std::min(
        static_cast<unsigned>(InputRoutingMode::Swap), input_mode.load(std::memory_order_relaxed)));
    const float width = input_width.load(std::memory_order_relaxed);
    const unsigned polarity = input_polarity.load(std::memory_order_relaxed);
    const auto route_target = input_route_target(mode, width, (polarity & 1U) != 0U, (polarity & 2U) != 0U);
    route_dual_mono(input, lane_one_input.data(), lane_two_input.data(), frames,
                    input_gain.load(std::memory_order_relaxed), route_target,
                    input_route_current, input_route_alpha);
    std::copy_n(lane_one_input.data(), frames * 2, lane_one_output.data());
    std::copy_n(lane_two_input.data(), frames * 2, lane_two_output.data());
    dream.begin_block(frames);
    const bool stack_off = stack_bypassed.load(std::memory_order_relaxed);
    const auto stack_source = static_cast<StackInputSource>(stack_input.load(std::memory_order_relaxed));
    const auto order_snapshot = packed_order.load(std::memory_order_acquire);
    bool any_rack_active = false;
    for (unsigned slot = 0; slot < kOrderSlots; ++slot) {
      const unsigned module = static_cast<unsigned>((order_snapshot >> (slot * 4U)) & 0xFU);
      if (module == kStackToken) {
        if (!stack_off && stack_receives_lane(stack_source, 0))
          stack_one.process(lane_one_output.data(), lane_one_output.data(), frames);
        if (!stack_off && stack_receives_lane(stack_source, 1))
          stack_two.process(lane_two_output.data(), lane_two_output.data(), frames);
      } else if (module < kStackToken) {
        const auto rack_module = static_cast<RackModule>(module);
        const bool enabled = !module_bypassed[module].load(std::memory_order_relaxed);
        any_rack_active = any_rack_active || enabled;
        dream.inject_route(rack_module, lane_one_output.data(), lane_two_output.data(), frames, enabled);
        rack_one.process_module(rack_module, lane_one_output.data(), frames);
        rack_two.process_module(rack_module, lane_two_output.data(), frames);
        dream.capture_module(rack_module, lane_one_output.data(), lane_two_output.data(), frames, enabled);
      }
    }
    dream.finish_block(lane_one_output.data(), lane_two_output.data(), frames,
                       any_rack_active || !stack_off);
    const bool host_active = active.load(std::memory_order_relaxed);
    sum_dual_mono(lane_one_output.data(), lane_two_output.data(), output, frames);
    if (host_active) loop.process(output, frames);
    const float gain = host_active ? output_gain.load(std::memory_order_relaxed) : 0.F;
    std::uint64_t limited = 0;
    float peak = 0.F;
    apply_output_safety(output, frames, gain, &limited, &peak);
    output_limited_samples.fetch_add(limited, std::memory_order_relaxed);
    publish_peak(pre_limiter_peak, peak);
    native_visual_spectrum().publish(output, frames);
  }

  float rate;
  PitchTracker tuner;
  StackAmp stack_one, stack_two;
  NativeRack rack_one, rack_two;
  NativePressure pressure_one, pressure_two;
  LoopProcessor loop;
  NativeDreamEngine dream;
  std::array<float, kBlockFrames * 2> lane_one_input{}, lane_two_input{};
  std::array<float, kBlockFrames * 2> lane_one_output{}, lane_two_output{};
  std::atomic<std::uint64_t> packed_order{};
  std::array<std::atomic<bool>, kStackToken> module_bypassed{};
  std::atomic<bool> active{false}, stack_bypassed{true}, stomp_bypassed{true}, pressure_bypassed{true};
  std::atomic<unsigned> stack_input{1}, stomp_input{1};
  std::atomic<unsigned> input_mode{static_cast<unsigned>(InputRoutingMode::Stereo)};
  std::atomic<float> input_width{1.F};
  std::atomic<unsigned> input_polarity{0U};
  std::atomic<float> input_gain{1.F}, output_gain{.72F};
  float input_route_alpha{};
  InputRouteMatrix input_route_current{};
  std::atomic<std::uint64_t> output_limited_samples{};
  std::atomic<float> pre_limiter_peak{};
};

NativeProcessor::NativeProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
NativeProcessor::~NativeProcessor() = default;
void NativeProcessor::process(const float* input, float* output, std::size_t frames) noexcept {
  for (std::size_t offset = 0; offset < frames; offset += kBlockFrames) {
    const auto block = std::min(kBlockFrames, frames - offset);
    impl_->process_block(input + offset * 2, output + offset * 2, block);
  }
}
bool NativeProcessor::set_module_parameter(RackModule module, std::string_view name, float value) noexcept {
  return std::isfinite(value) && impl_->rack_one.set_parameter(module, name, value)
      && impl_->rack_two.set_parameter(module, name, value);
}
bool NativeProcessor::set_pressure_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  // Reuse the existing host-level parameter tunnel for I/O matrix controls so
  // the embedded faceplate can update native routing without a parallel HTTP
  // command vocabulary. These names never reach the retired Pressure DSP.
  if (name == "inputMode") {
    set_input_mode(static_cast<InputRoutingMode>(static_cast<unsigned>(std::clamp(value, 0.F, 5.F))));
    return true;
  }
  if (name == "inputWidth") {
    set_input_width(value);
    return true;
  }
  if (name == "inputPolarity") {
    const auto bits = static_cast<unsigned>(std::clamp(value, 0.F, 3.F));
    set_input_polarity((bits & 1U) != 0U, (bits & 2U) != 0U);
    return true;
  }
  return impl_->pressure_one.set_parameter(name, value)
      && impl_->pressure_two.set_parameter(name, value);
}
void NativeProcessor::set_module_bypassed(RackModule module, bool bypassed) noexcept {
  if (module < RackModule::Count)
    impl_->module_bypassed[static_cast<unsigned>(module)].store(bypassed, std::memory_order_relaxed);
  if (module == RackModule::Stomp) {
    impl_->stomp_bypassed.store(bypassed, std::memory_order_relaxed); impl_->apply_stomp_route();
  } else {
    impl_->rack_one.set_bypassed(module, bypassed); impl_->rack_two.set_bypassed(module, bypassed);
  }
}
void NativeProcessor::set_pressure_bypassed(bool bypassed) noexcept {
  impl_->pressure_bypassed.store(bypassed, std::memory_order_relaxed);
  impl_->pressure_one.set_bypassed(bypassed); impl_->pressure_two.set_bypassed(bypassed);
}
void NativeProcessor::set_loop_enabled(bool value) noexcept { impl_->loop.set_enabled(value); }
void NativeProcessor::set_loop_selected_track(unsigned track) noexcept { impl_->loop.set_selected_track(track); }
void NativeProcessor::set_loop_master_level(float value) noexcept { impl_->loop.set_master_level(value); }
void NativeProcessor::set_loop_track_level(unsigned track, float value) noexcept { impl_->loop.set_track_level(track, value); }
void NativeProcessor::set_loop_overdub(float value) noexcept { impl_->loop.set_overdub(value); }
void NativeProcessor::set_loop_fade(float value) noexcept { impl_->loop.set_fade(value); }
void NativeProcessor::loop_command(LoopCommand command) noexcept { impl_->loop.command(command); }
void NativeProcessor::set_loop_trim(float start, float end) noexcept { impl_->loop.set_trim(start, end); }
void NativeProcessor::auto_trim_loop() noexcept { impl_->loop.auto_trim(); }
void NativeProcessor::reset_loop_trim() noexcept { impl_->loop.reset_trim(); }
LoopTransport NativeProcessor::loop_transport() const noexcept { return impl_->loop.transport(); }
unsigned NativeProcessor::loop_selected_track() const noexcept { return impl_->loop.selected_track(); }
std::uint32_t NativeProcessor::loop_track_mask() const noexcept { return impl_->loop.track_mask(); }
std::uint32_t NativeProcessor::loop_track_active_mask() const noexcept { return impl_->loop.track_active_mask(); }
std::uint32_t NativeProcessor::loop_track_mute_mask() const noexcept { return impl_->loop.track_mute_mask(); }
std::uint32_t NativeProcessor::loop_track_solo_mask() const noexcept { return impl_->loop.track_solo_mask(); }
std::uint64_t NativeProcessor::loop_frames() const noexcept { return impl_->loop.loop_frames(); }
std::uint64_t NativeProcessor::loop_raw_frames() const noexcept { return impl_->loop.raw_frames(); }
std::uint64_t NativeProcessor::loop_position() const noexcept { return impl_->loop.position(); }
float NativeProcessor::loop_trim_start() const noexcept { return impl_->loop.trim_start(); }
float NativeProcessor::loop_trim_end() const noexcept { return impl_->loop.trim_end(); }
std::array<float, kLoopWaveformBins> NativeProcessor::loop_waveform() const noexcept { return impl_->loop.waveform(); }
bool NativeProcessor::set_serial_order(std::span<const std::string_view> stages) noexcept {
  std::array<unsigned, kOrderSlots> next{};
  std::array<bool, kOrderSlots> used{};
  std::size_t count = 0;
  for (const auto name : stages) {
    const auto rack_module = rack_module_from_name(name);
    const unsigned module = name == "chaos" || name == "stack"
        ? kStackToken : static_cast<unsigned>(rack_module);
    if (module < kOrderSlots && !used[module]) { used[module] = true; next[count++] = module; }
  }
  if (count == 0) return false;
  for (unsigned module = 0; module < kOrderSlots; ++module)
    if (!used[module]) next[count++] = module;
  impl_->packed_order.store(pack_order(next), std::memory_order_release);
  return true;
}
void NativeProcessor::set_active(bool value) noexcept { impl_->active.store(value); }
void NativeProcessor::set_stack_bypassed(bool value) noexcept { impl_->stack_bypassed.store(value); }
void NativeProcessor::set_stack_input(unsigned value) noexcept { impl_->stack_input.store(std::min(2U, value)); }
void NativeProcessor::set_stomp_input(unsigned value) noexcept { impl_->stomp_input.store(std::min(2U, value)); impl_->apply_stomp_route(); }
void NativeProcessor::set_input_mode(InputRoutingMode value) noexcept {
  impl_->input_mode.store(std::min(static_cast<unsigned>(InputRoutingMode::Swap), static_cast<unsigned>(value)), std::memory_order_relaxed);
}
void NativeProcessor::set_input_width(float value) noexcept {
  impl_->input_width.store(std::clamp(std::isfinite(value) ? value : 1.F, 0.F, 2.F), std::memory_order_relaxed);
}
void NativeProcessor::set_input_polarity(bool invert_left, bool invert_right) noexcept {
  impl_->input_polarity.store((invert_left ? 1U : 0U) | (invert_right ? 2U : 0U), std::memory_order_relaxed);
}
void NativeProcessor::set_input_gain(float value) noexcept { impl_->input_gain.store(std::clamp(value, 0.F, 2.F)); }
void NativeProcessor::set_output_gain(float value) noexcept { impl_->output_gain.store(std::clamp(value, 0.F, 1.5F)); }
void NativeProcessor::set_stack_drive(float value) noexcept { impl_->stack_one.set_drive(value); impl_->stack_two.set_drive(value); }
void NativeProcessor::set_stack_tone(float value) noexcept { impl_->stack_one.set_tone(value); impl_->stack_two.set_tone(value); }
void NativeProcessor::set_stack_sag(float value) noexcept { impl_->stack_one.set_sag(value); impl_->stack_two.set_sag(value); }
void NativeProcessor::set_stack_mix(float value) noexcept { impl_->stack_one.set_mix(value); impl_->stack_two.set_mix(value); }
void NativeProcessor::set_stack_model(AmpModel value) noexcept { impl_->stack_one.set_model(value); impl_->stack_two.set_model(value); }
void NativeProcessor::set_stack_cabinet(Cabinet value) noexcept { impl_->stack_one.set_cabinet(value); impl_->stack_two.set_cabinet(value); }
void NativeProcessor::set_stack_quality(unsigned value) noexcept { impl_->stack_one.set_quality(value); impl_->stack_two.set_quality(value); }
float NativeProcessor::tuner_frequency() const noexcept { return impl_->tuner.frequency(); }
float NativeProcessor::tuner_level() const noexcept { return impl_->tuner.level(); }
std::uint64_t NativeProcessor::output_limited_samples() const noexcept { return impl_->output_limited_samples.load(std::memory_order_relaxed); }
float NativeProcessor::pre_limiter_peak() const noexcept { return impl_->pre_limiter_peak.load(std::memory_order_relaxed); }
float NativeProcessor::sample_rate() const noexcept { return impl_->rate; }

}  // namespace calcotone
