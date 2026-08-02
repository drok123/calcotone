#pragma once

#include <array>
#include <atomic>
#include <cstddef>

namespace calcotone {

enum class AmpModel : unsigned { Blackface, AC30, Plexi, SVT, ModelT, Calcotone };
enum class Cabinet : unsigned { OneBy12, TwoBy12, FourBy12, EightBy10, Direct };

class StackAmp final {
 public:
  explicit StackAmp(float sample_rate = 48'000.0F) noexcept;
  void set_sample_rate(float sample_rate) noexcept;
  void set_model(AmpModel value) noexcept;
  void set_cabinet(Cabinet value) noexcept;
  void set_drive(float value) noexcept;
  void set_tone(float value) noexcept;
  void set_sag(float value) noexcept;
  void set_mix(float value) noexcept;
  void set_quality(unsigned oversample) noexcept;

  // Interleaved stereo. Input and output may alias. No allocation or locking.
  void process(const float* input, float* output, std::size_t frames) noexcept;

 private:
  struct ChannelState {
    float previous_input{};
    float input_low{};
    float tone_low{};
    float tone_high{};
    float feedback_low{};
    float transformer_memory{};
    float sag_envelope{};
    float cab_highpass_low{};
    float cab_low_one{};
    float cab_low_two{};
    float cab_body_low{};
    float dc_input{};
    float dc_value{};
  };

  float sample_rate_;
  std::atomic<unsigned> model_{5};
  std::atomic<unsigned> cabinet_{2};
  std::atomic<unsigned> quality_{1};
  std::atomic<float> drive_{0.36F};
  std::atomic<float> tone_{0.52F};
  std::atomic<float> sag_{0.34F};
  std::atomic<float> mix_{0.62F};
  std::array<float, 12> coefficients_{};
  std::array<ChannelState, 2> channels_{};
};

}  // namespace calcotone
