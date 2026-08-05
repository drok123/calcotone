#include "calcotone/drift_standard_processor.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr float kTwoPi = kPi * 2.F;

float clamp01(float value) noexcept {
  return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F);
}

float triangle(float phase) noexcept {
  return (2.F / kPi) * std::asin(std::sin(phase));
}

enum class FilterType { Lowpass, Highpass };

struct Biquad {
  void reset() noexcept { z1 = z2 = 0.F; }

  void configure(FilterType next_type, float cutoff, float q, float sample_rate) noexcept {
    const float safe_cutoff = std::clamp(cutoff, 10.F, sample_rate * .45F);
    const float safe_q = std::max(.05F, q);
    if (configured && next_type == type && std::abs(safe_cutoff - last_cutoff) < .25F
        && std::abs(safe_q - last_q) < 1e-4F) return;
    configured = true;
    type = next_type;
    last_cutoff = safe_cutoff;
    last_q = safe_q;
    const float omega = kTwoPi * safe_cutoff / sample_rate;
    const float cosine = std::cos(omega);
    const float sine = std::sin(omega);
    const float alpha = sine / (2.F * safe_q);
    float raw_b0{}, raw_b1{}, raw_b2{};
    if (type == FilterType::Lowpass) {
      raw_b0 = (1.F - cosine) * .5F;
      raw_b1 = 1.F - cosine;
      raw_b2 = raw_b0;
    } else {
      raw_b0 = (1.F + cosine) * .5F;
      raw_b1 = -(1.F + cosine);
      raw_b2 = raw_b0;
    }
    const float a0 = 1.F + alpha;
    b0 = raw_b0 / a0;
    b1 = raw_b1 / a0;
    b2 = raw_b2 / a0;
    a1 = (-2.F * cosine) / a0;
    a2 = (1.F - alpha) / a0;
  }

  float process(float input) noexcept {
    const float output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    return output;
  }

  FilterType type{FilterType::Lowpass};
  bool configured{};
  float last_cutoff{-1.F}, last_q{-1.F};
  float b0{1.F}, b1{}, b2{}, a1{}, a2{}, z1{}, z2{};
};

struct VoiceSettings {
  float delay_seconds{};
  float depth_seconds{};
  float lfo_hz{};
  float highpass_hz{55.F};
  float lowpass_hz{12'000.F};
  float pan{};
  float gain{};
  float feedback{};
};

struct Settings {
  float preamp_drive{};
  float preamp_asymmetry{};
  float input_lowpass{18'000.F};
  float sum_gain{1.F};
  std::array<VoiceSettings, 4> voices{};
};

float preamp_shape(float input, float drive, float asymmetry) noexcept {
  if (drive <= .0001F) return input;
  const float gain = 1.F + drive * 5.2F;
  const float shifted = input + std::max(0.F, input) * asymmetry;
  return std::tanh(shifted * gain) / std::max(1e-6F, std::tanh(gain));
}

Settings calculate_settings(unsigned mode, float rate, float depth, float shape,
                            float spread, float motion) noexcept {
  Settings settings{};
  mode = std::min(mode, 13U);

  if (mode >= 10U) {
    struct Flanger {
      float base, sweep, rate_scale, feedback, hp, lp, phase, drive, asymmetry;
    };
    constexpr std::array<Flanger, 4> flangers{{
      {.00135F,.0048F,.92F,.58F,45.F,13'500.F,.985F,.042F,.010F},
      {.00180F,.0037F,.63F,.34F,70.F,10'800.F,.975F,.028F,.008F},
      {.00075F,.0068F,1.12F,.72F,38.F,15'800.F,.968F,.052F,.012F},
      {.00155F,.00425F,.78F,.48F,82.F,11'700.F,.982F,.036F,.009F},
    }};
    const auto& f = flangers[mode - 10U];
    const float normalized_depth = depth / .008F;
    const float sweep = f.sweep * (.32F + normalized_depth * .92F);
    const float feedback = std::min(.82F, f.feedback * (.5F + shape * .72F));
    const float width = std::min(.98F, .18F + spread * .8F);
    const float lfo_rate = std::max(.035F, rate * f.rate_scale * (.72F + motion * .48F));
    settings.preamp_drive = f.drive;
    settings.preamp_asymmetry = f.asymmetry;
    settings.input_lowpass = f.lp + (motion - .5F) * 1800.F;
    settings.sum_gain = .69F;
    for (unsigned i = 0; i < 4; ++i) {
      auto& voice = settings.voices[i];
      const bool active = i < 2U;
      voice.gain = active ? .78F : 0.F;
      voice.lfo_hz = lfo_rate * (i == 0 ? 1.F : f.phase);
      voice.depth_seconds = active ? sweep * (i ? -.94F : 1.F) : 0.F;
      voice.delay_seconds = f.base + static_cast<float>(i) * .00024F;
      voice.highpass_hz = f.hp;
      voice.lowpass_hz = f.lp - static_cast<float>(i) * 420.F;
      voice.pan = i == 0 ? -width : width;
      voice.feedback = active ? feedback * (i ? -.965F : 1.F) : 0.F;
    }
    return settings;
  }

  if (mode == 8U) {
    const float intensity = shape;
    const float rate_trim = std::pow(2.F, (rate - .28F) * .22F);
    const float depth_trim = .75F + (depth / .0022F) * .25F;
    const float pan_width = std::min(.96F, .246F + spread * .7F);
    const float chorus_rate = (.19F + intensity * .63F) * rate_trim;
    const float chorus_depth = (.00055F + intensity * .00245F) * depth_trim;
    settings.preamp_drive = .018F + motion * .09F;
    settings.preamp_asymmetry = .018F;
    settings.input_lowpass = 9600.F - motion * 1900.F;
    settings.sum_gain = .82F;
    for (unsigned i = 0; i < 4; ++i) {
      auto& voice = settings.voices[i];
      const bool active = i < 2U;
      voice.gain = active ? .72F : 0.F;
      voice.lfo_hz = chorus_rate * (i == 0 ? 1.F : .97F);
      voice.depth_seconds = active ? chorus_depth * (i ? -.92F : 1.F) : 0.F;
      voice.delay_seconds = .0148F + static_cast<float>(i) * .00115F;
      voice.highpass_hz = 82.F;
      voice.lowpass_hz = 7100.F + (1.F - motion) * 1500.F;
      voice.pan = i == 0 ? -pan_width : pan_width;
    }
    return settings;
  }

  if (mode == 9U) {
    constexpr std::array<float, 7> mode_depth{.34F,.46F,.60F,.76F,.84F,.91F,.98F};
    constexpr std::array<float, 7> mode_rate{.165F,.185F,.215F,.245F,.178F,.205F,.232F};
    constexpr std::array<float, 4> base{.0084F,.0118F,.0159F,.0204F};
    constexpr std::array<float, 4> signs{1.F,-1.F,-.74F,.74F};
    const unsigned index = std::min(6U, static_cast<unsigned>(std::floor(shape * 7.F)));
    const float rate_trim = std::pow(2.F, (rate - .28F) * .16F);
    const float depth_trim = .75F + (depth / .0022F) * .25F;
    const float pan_width = std::min(.98F, .30F + spread);
    const float motion_delta = motion - .32F;
    settings.preamp_drive = .018F;
    settings.preamp_asymmetry = .006F;
    settings.input_lowpass = 13'800.F - motion_delta * 900.F;
    settings.sum_gain = .52F;
    for (unsigned i = 0; i < 4; ++i) {
      auto& voice = settings.voices[i];
      voice.gain = .55F + static_cast<float>(i % 2U) * .035F;
      voice.lfo_hz = mode_rate[index] * rate_trim
          * (1.F + static_cast<float>(i) * (.031F + motion_delta * .006F));
      voice.depth_seconds = .00092F * mode_depth[index] * depth_trim * signs[i];
      voice.delay_seconds = base[i] * (1.F + motion_delta * .025F * static_cast<float>(i + 1U));
      voice.highpass_hz = 92.F + motion_delta * 18.F;
      voice.lowpass_hz = 10'800.F - static_cast<float>(i) * 260.F - motion_delta * 520.F;
      voice.pan = i % 2U ? pan_width : -pan_width;
    }
    return settings;
  }

  constexpr std::array<float, 8> rate_mul{1.F,.73F,.41F,1.18F,.58F,.92F,.31F,.48F};
  constexpr std::array<float, 8> base{.015F,.018F,.011F,.006F,.021F,.012F,.024F,.016F};
  const unsigned voices = mode == 1U || mode == 6U ? 4U : mode == 2U ? 3U : 2U;
  settings.sum_gain = 1.F / std::sqrt(static_cast<float>(voices));
  for (unsigned i = 0; i < 4; ++i) {
    auto& voice = settings.voices[i];
    const bool active = i < voices;
    voice.gain = active ? 1.F : 0.F;
    voice.lfo_hz = rate * rate_mul[mode] * (1.F + static_cast<float>(i) * .071F * motion);
    voice.depth_seconds = active
        ? depth * (.65F + static_cast<float>(i) * .12F) * (i % 2U ? -1.F : 1.F)
            * (mode == 3U ? 1.45F : 1.F)
        : 0.F;
    voice.delay_seconds = base[mode] + static_cast<float>(i) * .0026F * (.4F + shape);
    const float normal_pan = (i % 2U ? 1.F : -1.F) * (.18F + spread * .72F);
    const float orbit_width = std::min(.99F, .58F + spread * .6F);
    const float orbit_pan = std::sin((static_cast<float>(i) / 4.F) * kTwoPi + motion * kPi) * orbit_width;
    voice.pan = mode == 7U ? orbit_pan : normal_pan;
    voice.highpass_hz = 55.F + motion * 45.F;
    voice.lowpass_hz = 6500.F + shape * 9000.F - (mode == 4U ? static_cast<float>(i) * 900.F : 0.F);
  }
  return settings;
}
}  // namespace

struct DriftStandardProcessor::Impl {
  explicit Impl(float requested_rate)
      : sample_rate(std::clamp(requested_rate, 8000.F, 384000.F)) {
    const auto capacity = static_cast<std::size_t>(sample_rate * .10F) + 64U;
    for (auto& buffer : delay) buffer.assign(capacity, 0.F);
    reset();
  }

  void reset() noexcept {
    for (auto& buffer : delay) std::fill(buffer.begin(), buffer.end(), 0.F);
    for (auto& filter : input_tone) filter.reset();
    for (auto& filter : highpass) filter.reset();
    for (auto& filter : lowpass) filter.reset();
    phase = {0.F,.71F,1.93F,3.17F};
    write = 0;
    previous_input = {};
  }

  float shaped_input(float input, unsigned channel, float drive, float asymmetry) noexcept {
    if (drive <= .0001F) {
      previous_input[channel] = input;
      return input;
    }
    const float midpoint = (previous_input[channel] + input) * .5F;
    previous_input[channel] = input;
    return (preamp_shape(midpoint, drive, asymmetry) + preamp_shape(input, drive, asymmetry)) * .5F;
  }

  float read_delay(unsigned voice, float delay_samples) const noexcept {
    const auto& buffer = delay[voice];
    float position = static_cast<float>(write) - std::max(1.F, delay_samples);
    const float size = static_cast<float>(buffer.size());
    while (position < 0.F) position += size;
    while (position >= size) position -= size;
    const auto floor_position = std::floor(position);
    const auto a = static_cast<std::size_t>(floor_position) % buffer.size();
    const auto b = (a + 1U) % buffer.size();
    const float fraction = position - floor_position;
    return buffer[a] + (buffer[b] - buffer[a]) * fraction;
  }

  std::array<float, 2> process_sample(float left, float right, float rate, float depth,
                                      float shape, float spread, float motion) noexcept {
    const Settings settings = calculate_settings(mode, rate, depth, shape, spread, motion);
    std::array<float, 2> source{
      shaped_input(std::isfinite(left) ? left : 0.F, 0, settings.preamp_drive, settings.preamp_asymmetry),
      shaped_input(std::isfinite(right) ? right : left, 1, settings.preamp_drive, settings.preamp_asymmetry),
    };
    for (unsigned ch = 0; ch < 2; ++ch) {
      input_tone[ch].configure(FilterType::Lowpass, settings.input_lowpass, .45F, sample_rate);
      source[ch] = input_tone[ch].process(source[ch]);
    }

    float output_l = 0.F;
    float output_r = 0.F;
    for (unsigned voice = 0; voice < 4; ++voice) {
      const auto& v = settings.voices[voice];
      phase[voice] += kTwoPi * std::max(0.F, v.lfo_hz) / sample_rate;
      if (phase[voice] >= kTwoPi) phase[voice] -= kTwoPi;
      const float lfo = voice % 2U ? triangle(phase[voice]) : std::sin(phase[voice]);
      const float delay_seconds = std::clamp(v.delay_seconds + v.depth_seconds * lfo, .00002F, .089F);
      float sample = read_delay(voice, delay_seconds * sample_rate);
      highpass[voice].configure(FilterType::Highpass, v.highpass_hz, .5F, sample_rate);
      lowpass[voice].configure(FilterType::Lowpass, v.lowpass_hz, .5F, sample_rate);
      sample = lowpass[voice].process(highpass[voice].process(sample));
      const float input = source[voice % 2U] + sample * v.feedback;
      delay[voice][write] = std::clamp(input, -1.35F, 1.35F);

      const float pan = std::clamp(v.pan, -1.F, 1.F);
      const float angle = (pan + 1.F) * kPi * .25F;
      const float gain_l = std::cos(angle);
      const float gain_r = std::sin(angle);
      output_l += sample * v.gain * gain_l;
      output_r += sample * v.gain * gain_r;
    }
    write = (write + 1U) % delay[0].size();
    return {
      std::clamp(output_l * settings.sum_gain, -1.2F, 1.2F),
      std::clamp(output_r * settings.sum_gain, -1.2F, 1.2F),
    };
  }

  float sample_rate;
  unsigned mode{};
  std::array<std::vector<float>, 4> delay;
  std::size_t write{};
  std::array<float, 4> phase{};
  std::array<float, 2> previous_input{};
  std::array<Biquad, 2> input_tone{};
  std::array<Biquad, 4> highpass{};
  std::array<Biquad, 4> lowpass{};
};

DriftStandardProcessor::DriftStandardProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
DriftStandardProcessor::~DriftStandardProcessor() = default;
void DriftStandardProcessor::reset() noexcept { impl_->reset(); }
void DriftStandardProcessor::set_mode(unsigned mode) noexcept { impl_->mode = std::min(mode, 13U); }
std::array<float, 2> DriftStandardProcessor::process_sample(
    float left, float right, float rate, float depth, float shape, float spread, float motion) noexcept {
  return impl_->process_sample(left, right, rate, depth, shape, spread, motion);
}

}  // namespace calcotone
