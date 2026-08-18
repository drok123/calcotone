#pragma once

#include "calcotone/input_router.hpp"
#include "calcotone/native_rack.hpp"
#include "calcotone/loop_processor.hpp"
#include "calcotone/stack_amp.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string_view>

namespace calcotone {

// Transport-independent realtime processor. WASAPI, KS/WaveRT, and future
// backends hand it interleaved stereo frames and receive the final stereo mix.
// Realtime process() is allocation-free; large Loop buffers are prepared on the control thread when first armed.
class NativeProcessor final {
 public:
  explicit NativeProcessor(float sample_rate = 48'000.F);
  ~NativeProcessor();
  NativeProcessor(const NativeProcessor&) = delete;
  NativeProcessor& operator=(const NativeProcessor&) = delete;

  void process(const float* input_stereo, float* output_stereo, std::size_t frames) noexcept;
  bool set_module_parameter(RackModule module, std::string_view parameter, float value) noexcept;
  bool set_pressure_parameter(std::string_view parameter, float value) noexcept;
  void set_module_bypassed(RackModule module, bool bypassed) noexcept;
  void set_pressure_bypassed(bool bypassed) noexcept;
  void set_loop_enabled(bool enabled) noexcept;
  void set_loop_selected_track(unsigned track) noexcept;
  void set_loop_master_level(float value) noexcept;
  void set_loop_track_level(unsigned track, float value) noexcept;
  void set_loop_overdub(float value) noexcept;
  void set_loop_fade(float value) noexcept;
  void loop_command(LoopCommand command) noexcept;
  void loop_command(LoopCommand command, unsigned track) noexcept;
  void set_loop_trim(float start, float end) noexcept;
  void auto_trim_loop() noexcept;
  void reset_loop_trim() noexcept;
  LoopTransport loop_transport() const noexcept;
  unsigned loop_selected_track() const noexcept;
  std::uint32_t loop_track_mask() const noexcept;
  std::uint32_t loop_track_active_mask() const noexcept;
  std::uint32_t loop_track_mute_mask() const noexcept;
  std::uint32_t loop_track_solo_mask() const noexcept;
  std::uint64_t loop_frames() const noexcept;
  std::uint64_t loop_raw_frames() const noexcept;
  std::uint64_t loop_position() const noexcept;
  int loop_reference_track() const noexcept;
  std::uint64_t loop_reference_frames() const noexcept;
  std::uint64_t loop_reference_position() const noexcept;
  float loop_trim_start() const noexcept;
  float loop_trim_end() const noexcept;
  std::array<float, kLoopWaveformBins> loop_waveform() const noexcept;
  bool set_serial_order(std::span<const std::string_view> stages) noexcept;
  void set_active(bool active) noexcept;
  void set_stack_bypassed(bool bypassed) noexcept;
  void set_stack_input(unsigned source) noexcept;
  void set_stomp_input(unsigned source) noexcept;
  void set_input_mode(InputRoutingMode mode) noexcept;
  void set_input_width(float width) noexcept;
  void set_input_polarity(bool invert_left, bool invert_right) noexcept;
  void set_input_gain(float gain) noexcept;
  void set_output_gain(float gain) noexcept;
  void set_stack_drive(float value) noexcept;
  void set_stack_tone(float value) noexcept;
  void set_stack_sag(float value) noexcept;
  void set_stack_mix(float value) noexcept;
  void set_stack_model(AmpModel model) noexcept;
  void set_stack_cabinet(Cabinet cabinet) noexcept;
  void set_stack_quality(unsigned quality) noexcept;
  float tuner_frequency() const noexcept;
  float tuner_level() const noexcept;
  std::uint64_t output_limited_samples() const noexcept;
  float pre_limiter_peak() const noexcept;
  float sample_rate() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
