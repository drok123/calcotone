#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>

namespace calcotone {

class GrainParityProcessor final {
 public:
  explicit GrainParityProcessor(float sample_rate = 48'000.F);
  ~GrainParityProcessor();
  GrainParityProcessor(const GrainParityProcessor&) = delete;
  GrainParityProcessor& operator=(const GrainParityProcessor&) = delete;

  void process(float* interleaved_stereo, std::size_t frames) noexcept;
  bool set_parameter(std::string_view name, float value) noexcept;
  // Audio-thread reactions. Activity is a bounded excitation source rather
  // than a hidden parameter change; the reference clock only re-anchors grain
  // scheduling and never clears captured audio.
  void set_external_activity(float activity) noexcept;
  void set_cross_resynthesis(float pitch_semitones, float input_brightness,
                             float loop_activity, float loop_brightness) noexcept;
  void set_voice_limit(unsigned voices) noexcept;
  void set_reference_clock(std::uint64_t position, std::uint64_t frames,
                           bool running) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
