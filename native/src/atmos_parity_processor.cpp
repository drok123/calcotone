#include "calcotone/atmos_parity_processor.hpp"

#include "calcotone/atmos_parity_profiles.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kMaxLines = 12;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float coefficient(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, rate * .45F) / rate);
}
float read_linear(const std::vector<float>& line, std::size_t write, float delay) noexcept {
  float position = static_cast<float>(write) - std::max(1.F, delay);
  const float size = static_cast<float>(line.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto a = static_cast<std::size_t>(position) % line.size();
  const auto b = (a + 1U) % line.size();
  const float fraction = position - std::floor(position);
  return line[a] + (line[b] - line[a]) * fraction;
}
float quantize(float input, int bits) noexcept {
  if (bits <= 0) return input;
  const float levels = static_cast<float>((1U << std::min(bits, 23)) - 1U);
  return std::round(std::clamp(input, -1.F, 1.F) * levels) / levels;
}
}

struct AtmosParityProcessor::Impl {
  explicit Impl(float requested_rate) : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)) {
    // The largest canonical line is 253.1 ms and size can reach 3x. Add room for
    // predelay, modulation, and channel decorrelation without reallocating.
    const auto capacity = static_cast<std::size_t>(rate * .90F) + 64U;
    for (auto& channel : lines)
      for (auto& line : channel) line.assign(capacity, 0.F);
    const auto pre_capacity = static_cast<std::size_t>(rate * .075F) + 16U;
    for (auto& line : predelay) line.assign(pre_capacity, 0.F);
  }

  void reset() noexcept {
    for (auto& channel : lines) for (auto& line : channel) std::fill(line.begin(), line.end(), 0.F);
    for (auto& line : predelay) std::fill(line.begin(), line.end(), 0.F);
    for (auto& channel : damping_state) channel.fill(0.F);
    for (auto& channel : highpass_input) channel = 0.F;
    for (auto& channel : highpass_output) channel = 0.F;
    write.fill(0U); predelay_write = 0U; phase = 0.F;
  }

  void process(float* data, std::size_t frames) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .06F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      for (std::size_t i = 0; i < smooth.size(); ++i)
        smooth[i] += (target[i].load(std::memory_order_relaxed) - smooth[i]) * glide;

      const auto model = std::min<std::size_t>(11U, static_cast<std::size_t>(std::max(0.F, std::round(smooth[0]))));
      const auto& profile = atmos_parity_profile(model);
      const float decay = std::clamp(smooth[1], .35F, 16.F);
      const float size_control = clamp01(smooth[2]);
      const float size_scale = profile.size_range[0] + (profile.size_range[1] - profile.size_range[0]) * size_control;
      const float color = clamp01(smooth[3]);
      const float diffusion = clamp01(smooth[4]);
      const float motion = clamp01(smooth[5]);
      const float mix = clamp01(smooth[6]);
      const float input_gain = profile.input_trim;
      const float output_gain = profile.output_trim;
      const float damping_hz = (1'100.F + color * 11'500.F) / std::max(.42F, profile.damping_bias);
      const float damping_g = coefficient(damping_hz, rate);
      const float hp_g = coefficient(profile.highpass, rate);
      const float feedback = std::clamp(std::pow(.001F, .04F / std::max(.35F, decay * profile.decay_bias))
                                      * (.76F + diffusion * .20F), 0.F, model == 5 ? .9975F : .965F);
      phase += 2.F * kPi * (.07F + motion * .31F) / rate;
      if (phase >= 2.F * kPi) phase -= 2.F * kPi;

      const float dry[2]{data[frame * 2], data[frame * 2 + 1]};
      float excited[2]{};
      for (unsigned ch = 0; ch < 2; ++ch) {
        const float hp = dry[ch] - highpass_input[ch] + (1.F - hp_g) * highpass_output[ch];
        highpass_input[ch] = dry[ch]; highpass_output[ch] = hp;
        predelay[ch][predelay_write] = hp * input_gain;
        const float pre_seconds = profile.predelay[ch];
        excited[ch] = read_linear(predelay[ch], predelay_write, pre_seconds * rate);
        if (profile.converter_bits > 0) excited[ch] = quantize(excited[ch], profile.converter_bits);
      }

      float wet[2]{};
      for (unsigned ch = 0; ch < 2; ++ch) {
        float sum = 0.F;
        for (std::size_t line_index = 0; line_index < profile.line_count; ++line_index) {
          const float line_phase = phase + static_cast<float>(line_index) * .731F + static_cast<float>(ch) * 1.17F;
          const float modulation = std::sin(line_phase) * profile.modulation_depth * motion * rate;
          const float delay_frames = profile.line_times[line_index] * size_scale * rate + modulation + static_cast<float>(ch) * 1.37F;
          float sample = read_linear(lines[ch][line_index], write[line_index], delay_frames);
          if (profile.plate_dispersion > 0.F) {
            const float dispersed = sample - damping_state[ch][line_index];
            damping_state[ch][line_index] += dispersed * (.08F + profile.plate_dispersion * .06F);
            sample = sample * .72F + dispersed * .28F;
          }
          damping_state[ch][line_index] += (sample - damping_state[ch][line_index]) * damping_g;
          sum += damping_state[ch][line_index] * ((line_index & 1U) ? -1.F : 1.F);
        }
        wet[ch] = sum / std::sqrt(static_cast<float>(std::max<std::size_t>(1U, profile.line_count)));
      }

      for (unsigned ch = 0; ch < 2; ++ch) {
        for (std::size_t line_index = 0; line_index < profile.line_count; ++line_index) {
          const unsigned other = 1U - ch;
          const float alternating = (line_index & 1U) ? -wet[ch] : wet[ch];
          const float cross = wet[other] * profile.cross_amount;
          const float injected = excited[ch] * (.12F + diffusion * .17F);
          float value = injected + alternating * feedback + cross * (.45F + motion * .55F);
          if (profile.split_decay > 0.F && line_index >= profile.line_count / 2U)
            value *= 1.F - profile.split_decay * .38F;
          lines[ch][line_index][write[line_index]] = std::clamp(value, -1.35F, 1.35F);
        }
      }

      if (profile.converter_bits > 0) {
        const float converter_g = coefficient(profile.converter_lowpass > 0.F ? profile.converter_lowpass : 8'800.F, rate);
        for (unsigned ch = 0; ch < 2; ++ch) {
          converter_state[ch] += (quantize(wet[ch], profile.converter_bits) - converter_state[ch]) * converter_g;
          wet[ch] = converter_state[ch];
        }
      }

      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      for (unsigned ch = 0; ch < 2; ++ch)
        data[frame * 2 + ch] = std::clamp(dry[ch] * dry_gain + wet[ch] * output_gain * wet_gain, -1.2F, 1.2F);

      for (std::size_t line_index = 0; line_index < profile.line_count; ++line_index)
        write[line_index] = (write[line_index] + 1U) % lines[0][line_index].size();
      predelay_write = (predelay_write + 1U) % predelay[0].size();
    }
  }

  float rate;
  std::array<std::array<std::vector<float>, kMaxLines>, 2> lines;
  std::array<std::vector<float>, 2> predelay;
  std::array<std::size_t, kMaxLines> write{};
  std::size_t predelay_write{};
  std::array<std::array<float, kMaxLines>, 2> damping_state{};
  std::array<float, 2> converter_state{};
  std::array<float, 2> highpass_input{}, highpass_output{};
  std::array<std::atomic<float>, 7> target{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  std::array<float, 7> smooth{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  float phase{};
};

AtmosParityProcessor::AtmosParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
AtmosParityProcessor::~AtmosParityProcessor() = default;
void AtmosParityProcessor::process(float* data, std::size_t frames) noexcept { impl_->process(data, frames); }
void AtmosParityProcessor::reset() noexcept { impl_->reset(); }
bool AtmosParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "algorithm") index = 0;
  else if (name == "decay") index = 1;
  else if (name == "size") index = 2;
  else if (name == "color") index = 3;
  else if (name == "diffusion") index = 4;
  else if (name == "motion") index = 5;
  else if (name == "mix") index = 6;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
