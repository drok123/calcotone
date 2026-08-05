#include "calcotone/atmos_parity_processor.hpp"
#include "calcotone/atmos_parity_profiles.hpp"
#include "calcotone/atmos_lexicon224_converter.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <memory>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kMaxLines = 12;
constexpr std::size_t kMaxEarly = 5;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float smooth_coefficient(float seconds, float rate) noexcept {
  return 1.F - std::exp(-1.F / std::max(1.F, seconds * rate));
}
float filter_coefficient(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, rate * .45F) / rate);
}
float one_pole(float input, float& state, float coefficient) noexcept {
  state += (input - state) * coefficient;
  return state;
}
float highpass(float input, float& low_state, float coefficient) noexcept {
  return input - one_pole(input, low_state, coefficient);
}
float read_linear(const std::vector<float>& buffer, std::size_t write, float delay_samples) noexcept {
  float position = static_cast<float>(write) - std::max(1.F, delay_samples);
  const float size = static_cast<float>(buffer.size());
  while (position < 0.F) position += size;
  while (position >= size) position -= size;
  const auto first = static_cast<std::size_t>(position) % buffer.size();
  const auto second = (first + 1U) % buffer.size();
  const float fraction = position - std::floor(position);
  return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}
float triangle_wave(float phase) noexcept {
  return (2.F / kPi) * std::asin(std::sin(phase));
}
float output_polarity(std::size_t index) noexcept {
  return index % 4U == 1U || index % 4U == 2U ? -1.F : 1.F;
}
float loop_saturate(float input) noexcept {
  return input - .035F * input * input * input;
}
float converter_texture(float input, int bits) noexcept {
  if (bits <= 0) return input;
  const float x = std::clamp(input, -1.F, 1.F);
  const float levels = std::pow(2.F, static_cast<float>(std::max(4, bits) - 1));
  const float stepped = std::round(x * levels) / levels;
  const float gain_step = std::round(std::abs(x) * 15.F) / 15.F;
  return std::clamp(stepped * (.998F - gain_step * .0045F), -1.F, 1.F);
}

struct AllpassState { float x1{}, x2{}, y1{}, y2{}; };
float allpass(float input, float frequency, float q, float rate, AllpassState& state) noexcept {
  const float safe_frequency = std::clamp(frequency, 20.F, rate * .42F);
  const float omega = 2.F * kPi * safe_frequency / rate;
  const float cosine = std::cos(omega);
  const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
  const float inverse_a0 = 1.F / (1.F + alpha);
  const float b0 = (1.F - alpha) * inverse_a0;
  const float b1 = (-2.F * cosine) * inverse_a0;
  const float b2 = 1.F;
  const float a1 = b1;
  const float a2 = b0;
  const float output = b0 * input + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
  state.x2 = state.x1; state.x1 = input; state.y2 = state.y1; state.y1 = output;
  return output;
}

struct CompressorState { float gain{1.F}; };
float compress_sample(
    float input, float threshold, float ratio, float attack, float release,
    float rate, CompressorState& state) noexcept {
  const float level_db = 20.F * std::log10(std::max(1e-8F, std::abs(input)));
  constexpr float knee = 12.F;
  float output_db = level_db;
  if (level_db > threshold + knee * .5F) {
    output_db = threshold + (level_db - threshold) / std::max(1.F, ratio);
  } else if (level_db > threshold - knee * .5F) {
    const float distance = level_db - (threshold - knee * .5F);
    output_db = level_db + (1.F / std::max(1.F, ratio) - 1.F) * distance * distance / (2.F * knee);
  }
  const float target_gain = std::pow(10.F, (output_db - level_db) / 20.F);
  const float time = target_gain < state.gain ? attack : release;
  state.gain += (target_gain - state.gain) * smooth_coefficient(std::max(.0002F, time), rate);
  return input * state.gain;
}

struct AtmosControls {
  float decay{2.4F};
  float size{.52F};
  float color{.42F};
  float diffusion{.74F};
  float motion{.18F};
};

class AtmosNetwork {
 public:
  AtmosNetwork(float rate, std::size_t model)
      : rate_(rate),
        model_(std::min<std::size_t>(11U, model)),
        lexicon_input_(rate_, Lexicon224ConverterRole::Input),
        lexicon_output_(rate_, Lexicon224ConverterRole::Output) {
    const auto line_capacity = static_cast<std::size_t>(rate_ * .90F) + 64U;
    for (auto& line : lines_) line.assign(line_capacity, 0.F);
    const auto predelay_capacity = static_cast<std::size_t>(rate_ * .075F) + 16U;
    for (auto& buffer : predelay_) buffer.assign(predelay_capacity, 0.F);
    const auto early_capacity = static_cast<std::size_t>(rate_ * .22F) + 16U;
    for (auto& buffer : early_history_) buffer.assign(early_capacity, 0.F);
  }

  void reset() noexcept {
    for (auto& line : lines_) std::fill(line.begin(), line.end(), 0.F);
    for (auto& buffer : predelay_) std::fill(buffer.begin(), buffer.end(), 0.F);
    for (auto& buffer : early_history_) std::fill(buffer.begin(), buffer.end(), 0.F);
    write_.fill(0U); predelay_write_ = 0U; early_write_ = 0U;
    diffuser_state_.fill({}); damping_state_.fill(0.F); loop_hp_low_.fill(0.F); phase_.fill(0.F);
    input_hp_low_.fill(0.F); input_lp_state_.fill(0.F); early_filter_state_.fill(0.F);
    early_bus_state_.fill(0.F); late_converter_state_.fill(0.F); compressor_state_.fill({});
    lexicon_input_.reset();
    lexicon_output_.reset();
  }

  std::array<float, 2> process_frame(const std::array<float, 2>& input, const AtmosControls& controls) noexcept {
    const auto& profile = atmos_parity_profile(model_);
    const auto& early_profile = atmos_early_profile(model_);
    const float size = clamp01(controls.size);
    const float color = clamp01(controls.color);
    const float diffusion = clamp01(controls.diffusion);
    const float motion = clamp01(controls.motion);
    const float decay = std::clamp(controls.decay, .35F, 16.F);
    const float shaped_size = std::pow(size, 1.35F);
    const float size_scale = profile.size_range[0] + shaped_size * (profile.size_range[1] - profile.size_range[0]);
    const float normalized_decay = clamp01(std::log(std::max(.35F, decay) / .35F) / std::log(16.F / .35F));
    const float effective_decay = model_ == 10U ? .5F + normalized_decay * 5.F
                                                : std::max(.25F, decay * profile.decay_bias);
    const float color_cutoff = 1700.F * std::pow(10.2F, color) * profile.damping_bias;
    const bool freeze = model_ == 5U;
    const float loop_budget = freeze ? .958F : .875F;
    const float cross_magnitude = std::min(freeze ? .016F : .034F,
        profile.cross_amount * (.14F + diffusion * .22F));

    std::array<float, 2> converted{};
    for (unsigned channel = 0; channel < 2; ++channel) {
      converted[channel] = converter_texture(input[channel] * profile.input_trim, profile.converter_bits);
    }
    if (model_ == 11U) converted = lexicon_input_.process(converted[0], converted[1]);

    std::array<float, 2> predelayed{};
    const float input_lowpass_hz = profile.converter_lowpass > 0.F ? profile.converter_lowpass : 16'000.F;
    const float input_hp_coefficient = filter_coefficient(profile.highpass, rate_);
    const float input_lp_coefficient = filter_coefficient(input_lowpass_hz, rate_);
    for (unsigned channel = 0; channel < 2; ++channel) {
      const float source = model_ == 10U ? converted[0] + converted[1] : converted[channel];
      const float filtered = one_pole(highpass(source, input_hp_low_[channel], input_hp_coefficient),
                                      input_lp_state_[channel], input_lp_coefficient);
      predelay_[channel][predelay_write_] = filtered;
      const float predelay_seconds = std::min(.05F, profile.predelay[channel] * (1.F + size * .72F));
      predelayed[channel] = read_linear(predelay_[channel], predelay_write_, predelay_seconds * rate_);
      early_history_[channel][early_write_] = predelayed[channel];
    }

    const float threshold_base = early_profile.threshold + diffusion * 2.5F - motion * 1.5F;
    const float ratio = early_profile.ratio + diffusion * 1.15F + motion * .45F;
    const float attack = std::max(.001F, early_profile.attack * (1.05F - motion * .35F));
    const float release = early_profile.release * (.82F + normalized_decay * .52F + size * .18F);
    std::array<float, 2> compressed{};
    for (unsigned channel = 0; channel < 2; ++channel) {
      compressed[channel] = compress_sample(predelayed[channel], threshold_base + static_cast<float>(channel) * .35F,
          ratio, attack, release, rate_, compressor_state_[channel]);
    }

    std::array<float, 2> early{};
    for (std::size_t index = 0; index < early_profile.count; ++index) {
      const unsigned source_channel = static_cast<unsigned>(index % 2U);
      const unsigned destination_channel = index < 2U ? source_channel : 1U - source_channel;
      const float delay_seconds = early_profile.times[index] * (.72F + size * .82F);
      float tap = read_linear(early_history_[source_channel], early_write_, delay_seconds * rate_);
      const float cutoff = std::clamp(early_profile.lowpass * (.52F + color * .62F)
          * (1.F - static_cast<float>(index) * .045F), 2800.F, 18'000.F);
      tap = one_pole(tap, early_filter_state_[index], filter_coefficient(cutoff, rate_));
      const float contour = (1.F - static_cast<float>(index) * .085F) * (.92F + diffusion * .08F)
          / std::sqrt(static_cast<float>(early_profile.count));
      early[destination_channel] += tap * contour;
    }
    const float early_bus_cutoff = std::clamp(early_profile.lowpass * (.58F + color * .58F), 3400.F, 18'000.F);
    for (unsigned channel = 0; channel < 2; ++channel) {
      early[channel] = one_pole(early[channel], early_bus_state_[channel], filter_coefficient(early_bus_cutoff, rate_));
    }

    std::array<float, kMaxLines> raw{};
    std::array<float, kMaxLines> loop_signal{};
    std::array<float, kMaxLines> excitation{};
    std::array<float, kMaxLines> self_feedback{};
    std::array<float, kMaxLines> cross_gain{};
    std::array<float, kMaxLines> cross_injection{};
    std::array<float, 2> late{};
    const float density_scale = .9F + diffusion * .1F;
    const float diffusion_amount = std::min(1.5F, diffusion * profile.diffusion_bias);
    const float decay_norm = std::min(1.F, std::log2(1.F + effective_decay) / std::log2(17.F));
    const float energy_trim = 1.F / std::sqrt(1.F + decay_norm * .58F + diffusion * .25F + size * .18F);
    const float base_output = profile.output_trim / std::sqrt(static_cast<float>(std::max<std::size_t>(1U, profile.line_count / 2U)));

    for (std::size_t index = 0; index < profile.line_count; ++index) {
      const float line_time = profile.line_times[index] * size_scale * density_scale;
      const float base_rate = profile.modulation_rates[index];
      const float lfo_rate = base_rate * (.9F + size * .18F)
          * (1.F + motion * (.028F + static_cast<float>(index % 5U) * .008F));
      phase_[index] += 2.F * kPi * lfo_rate / rate_;
      if (phase_[index] >= 2.F * kPi) phase_[index] -= 2.F * kPi;
      const float waveform = index % 3U == 0U ? std::sin(phase_[index]) : triangle_wave(phase_[index]);
      const float requested_modulation = profile.modulation_depth * motion * (.56F + static_cast<float>(index) * .04F);
      const float modulation_amount = std::min(requested_modulation, std::max(.00002F, line_time * .015F));
      const float delay_seconds = std::clamp(line_time + waveform * modulation_amount, .001F, .86F);
      raw[index] = read_linear(lines_[index], write_[index], delay_seconds * rate_);

      const float diffuser_frequency = (profile.plate_dispersion > 0.F ? 720.F : 460.F)
          + diffusion_amount * (profile.plate_dispersion > 0.F ? 2200.F : 1550.F)
          + static_cast<float>(index) * (profile.plate_dispersion > 0.F ? 113.F : 91.F);
      const float diffuser_q = (profile.plate_dispersion > 0.F ? .5F : .25F)
          + diffusion_amount * (1.02F + static_cast<float>(index) * .03F);
      excitation[index] = allpass(compressed[index % 2U], diffuser_frequency, diffuser_q,
                                  rate_, diffuser_state_[index]);

      const float plate_tilt = profile.plate_dispersion > 0.F
          ? 1.F - static_cast<float>(index) / static_cast<float>(std::max<std::size_t>(1U, profile.line_count - 1U)) * .18F
          : 1.F;
      const float damping_hz = std::clamp(color_cutoff * (1.F - static_cast<float>(index) * .014F) * plate_tilt,
          1000.F, profile.converter_lowpass > 0.F ? profile.converter_lowpass : 19'000.F);
      const float damped = one_pole(raw[index], damping_state_[index], filter_coefficient(damping_hz, rate_));
      const float loop_highpass_hz = std::clamp(profile.highpass * (.48F + (1.F - size) * .3F)
          + static_cast<float>(index) * 1.9F, 36.F, 340.F);
      loop_signal[index] = loop_saturate(highpass(damped, loop_hp_low_[index],
          filter_coefficient(loop_highpass_hz, rate_)));

      const float split_position = static_cast<float>(index)
          / static_cast<float>(std::max<std::size_t>(1U, profile.line_count - 1U));
      const float spectral_decay_scale = 1.F + profile.split_decay * (split_position - .5F)
          * (.7F + (1.F - color) * .6F);
      const float line_decay = std::pow(.001F, line_time / std::max(.18F, effective_decay * spectral_decay_scale));
      const float spread = .988F - static_cast<float>(index) * .0019F;
      self_feedback[index] = std::min(loop_budget - cross_magnitude - .042F,
          std::max(.18F, line_decay * spread));
      cross_gain[index] = cross_magnitude * (index % 4U < 2U ? 1.F : -1.F);
      late[index % 2U] += raw[index] * output_polarity(index) * base_output * energy_trim;
    }

    const std::size_t cross_offset = std::max<std::size_t>(3U, profile.line_count / 2U);
    for (std::size_t index = 0; index < profile.line_count; ++index) {
      const std::size_t destination = (index + cross_offset) % profile.line_count;
      cross_injection[destination] += raw[index] * cross_gain[index];
    }
    for (std::size_t index = 0; index < profile.line_count; ++index) {
      const float write_value = excitation[index] + loop_signal[index] * self_feedback[index]
          + cross_injection[index];
      lines_[index][write_[index]] = std::clamp(write_value, -1.35F, 1.35F);
      write_[index] = (write_[index] + 1U) % lines_[index].size();
    }

    const float converter_cutoff = profile.converter_lowpass > 0.F
        ? profile.converter_lowpass * (.80F + color * .20F) : 19'000.F;
    for (unsigned channel = 0; channel < 2; ++channel) {
      late[channel] = one_pole(late[channel], late_converter_state_[channel],
                               filter_coefficient(converter_cutoff, rate_));
      late[channel] = converter_texture(late[channel], profile.converter_bits);
    }
    if (model_ == 11U) late = lexicon_output_.process(late[0], late[1]);

    const float early_presence = early_profile.early_level * (1.12F - size * .24F)
        * (1.08F - diffusion * .18F);
    const float late_presence = early_profile.late_level * (.88F + diffusion * .16F)
        / std::sqrt(1.F + normalized_decay * .58F + size * .24F);
    predelay_write_ = (predelay_write_ + 1U) % predelay_[0].size();
    early_write_ = (early_write_ + 1U) % early_history_[0].size();
    return {early[0] * early_presence + late[0] * late_presence,
            early[1] * early_presence + late[1] * late_presence};
  }

 private:
  float rate_;
  std::size_t model_;
  std::array<std::vector<float>, kMaxLines> lines_;
  std::array<std::vector<float>, 2> predelay_;
  std::array<std::vector<float>, 2> early_history_;
  std::array<std::size_t, kMaxLines> write_{};
  std::size_t predelay_write_{};
  std::size_t early_write_{};
  std::array<AllpassState, kMaxLines> diffuser_state_{};
  std::array<float, kMaxLines> damping_state_{};
  std::array<float, kMaxLines> loop_hp_low_{};
  std::array<float, kMaxLines> phase_{};
  std::array<float, 2> input_hp_low_{};
  std::array<float, 2> input_lp_state_{};
  std::array<float, kMaxEarly> early_filter_state_{};
  std::array<float, 2> early_bus_state_{};
  std::array<float, 2> late_converter_state_{};
  std::array<CompressorState, 2> compressor_state_{};
  AtmosLexicon224Converter lexicon_input_;
  AtmosLexicon224Converter lexicon_output_;
};
}  // namespace

struct AtmosParityProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        active(std::make_unique<AtmosNetwork>(rate, 2U)),
        fade_total(std::max<std::size_t>(1U, static_cast<std::size_t>(std::lround(rate * .82F)))) {}

  AtmosControls controls() const noexcept {
    return {smooth[1], smooth[2], smooth[3], smooth[4], smooth[5]};
  }

  void reset() noexcept {
    for (std::size_t index = 0; index < smooth.size(); ++index)
      smooth[index] = target[index].load(std::memory_order_relaxed);
    active_model = std::min<std::size_t>(11U, static_cast<std::size_t>(std::max(0.F, std::round(smooth[0]))));
    active = std::make_unique<AtmosNetwork>(rate, active_model);
    retiring.reset();
    fade_position = 0U;
    processed_frames = 0U;
  }

  void switch_model(std::size_t requested, const AtmosControls& current) {
    requested = std::min<std::size_t>(11U, requested);
    if (requested == active_model) return;
    if (processed_frames == 0U) {
      active = std::make_unique<AtmosNetwork>(rate, requested);
      retiring.reset();
    } else {
      retiring = std::move(active);
      retiring_controls = current;
      active = std::make_unique<AtmosNetwork>(rate, requested);
      fade_position = 0U;
    }
    active_model = requested;
  }

  void process(float* data, std::size_t frames) noexcept {
    static constexpr std::array<float, 7> smoothing_seconds{0.F,.06F,.06F,.05F,.05F,.08F,.025F};
    for (std::size_t frame = 0; frame < frames; ++frame) {
      smooth[0] = target[0].load(std::memory_order_relaxed);
      for (std::size_t index = 1; index < smooth.size(); ++index) {
        const float coefficient = smooth_coefficient(smoothing_seconds[index], rate);
        smooth[index] += (target[index].load(std::memory_order_relaxed) - smooth[index]) * coefficient;
      }
      const auto requested_model = std::min<std::size_t>(11U,
          static_cast<std::size_t>(std::max(0.F, std::round(smooth[0]))));
      const AtmosControls current = controls();
      switch_model(requested_model, current);

      const std::array<float, 2> dry{data[frame * 2], data[frame * 2 + 1]};
      const auto active_wet = active->process_frame(dry, current);
      std::array<float, 2> wet = active_wet;
      if (retiring) {
        const float t = std::min(1.F, static_cast<float>(fade_position + 1U) / static_cast<float>(fade_total));
        const float active_gain = std::sin(t * kPi * .5F);
        const float retiring_gain = std::cos(t * kPi * .5F);
        const auto retiring_wet = retiring->process_frame(dry, retiring_controls);
        wet[0] = active_wet[0] * active_gain + retiring_wet[0] * retiring_gain;
        wet[1] = active_wet[1] * active_gain + retiring_wet[1] * retiring_gain;
        if (++fade_position >= fade_total) retiring.reset();
      }

      const float mix = clamp01(smooth[6]);
      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      data[frame * 2] = std::clamp(dry[0] * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry[1] * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
      ++processed_frames;
    }
  }

  float rate;
  std::array<std::atomic<float>, 7> target{2.F,2.4F,.52F,.42F,.74F,.18F,.13F};
  std::array<float, 7> smooth{2.F,2.4F,.52F,.42F,.74F,.18F,.13F};
  std::unique_ptr<AtmosNetwork> active;
  std::unique_ptr<AtmosNetwork> retiring;
  AtmosControls retiring_controls{};
  std::size_t active_model{2U};
  std::size_t fade_position{};
  std::size_t fade_total{};
  std::size_t processed_frames{};
};

AtmosParityProcessor::AtmosParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
AtmosParityProcessor::~AtmosParityProcessor() = default;
void AtmosParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}
void AtmosParityProcessor::reset() noexcept { impl_->reset(); }
bool AtmosParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99U;
  if (name == "algorithm") index = 0U;
  else if (name == "decay") index = 1U;
  else if (name == "size") index = 2U;
  else if (name == "color") index = 3U;
  else if (name == "diffusion") index = 4U;
  else if (name == "motion") index = 5U;
  else if (name == "mix") index = 6U;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
