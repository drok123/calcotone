#pragma once

#include <memory>

namespace calcotone {

class HaloDualGrainPitchProcessor final {
 public:
  explicit HaloDualGrainPitchProcessor(float sample_rate = 48'000.F);
  ~HaloDualGrainPitchProcessor();
  HaloDualGrainPitchProcessor(const HaloDualGrainPitchProcessor&) = delete;
  HaloDualGrainPitchProcessor& operator=(const HaloDualGrainPitchProcessor&) = delete;

  void set_pitch(unsigned channel, float semitones, float amount) noexcept;
  void process_frame(float left, float right, float& output_left, float& output_right) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
