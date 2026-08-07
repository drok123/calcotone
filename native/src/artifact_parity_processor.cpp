#include "calcotone/artifact_parity_processor.hpp"
#include "calcotone/pressure_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float quantize(float value, float steps) noexcept { return std::round(value * steps) / steps; }
float smoothing_coefficient(float seconds, float rate) noexcept {
  return 1.F - std::exp(-1.F / std::max(1.F, seconds * rate));
}
float bipolar_around_default(float value, float center) noexcept {
  value = clamp01(value);
  return value >= center ? (value - center) / std::max(1e-6F, 1.F - center)
                         : (value - center) / std::max(1e-6F, center);
}
float db_gain(float decibels) noexcept { return std::pow(10.F, decibels / 20.F); }
float normalized_tanh_slope(float drive) noexcept {
  const float safe = std::max(1.F, drive);
  return safe / std::max(1e-6F, std::tanh(safe));
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

struct Biquad {
  float b0{1.F}, b1{}, b2{}, a1{}, a2{};
  float x1{}, x2{}, y1{}, y2{};

  void reset() noexcept { x1 = x2 = y1 = y2 = 0.F; }
  float process(float input) noexcept {
    const float output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = input; y2 = y1; y1 = output;
    return std::isfinite(output) ? output : 0.F;
  }
  void identity() noexcept { b0 = 1.F; b1 = b2 = a1 = a2 = 0.F; }
  void normalize(float rb0, float rb1, float rb2, float ra0, float ra1, float ra2) noexcept {
    const float inverse = 1.F / std::max(1e-9F, ra0);
    b0 = rb0 * inverse; b1 = rb1 * inverse; b2 = rb2 * inverse;
    a1 = ra1 * inverse; a2 = ra2 * inverse;
  }
  void lowpass(float rate, float frequency, float q = .55F) noexcept {
    frequency = std::clamp(frequency, 10.F, rate * .475F);
    const float omega = 2.F * kPi * frequency / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize((1.F - cosine) * .5F, 1.F - cosine, (1.F - cosine) * .5F,
              1.F + alpha, -2.F * cosine, 1.F - alpha);
  }
  void highpass(float rate, float frequency, float q = .55F) noexcept {
    frequency = std::clamp(frequency, 10.F, rate * .475F);
    const float omega = 2.F * kPi * frequency / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    normalize((1.F + cosine) * .5F, -(1.F + cosine), (1.F + cosine) * .5F,
              1.F + alpha, -2.F * cosine, 1.F - alpha);
  }
  void low_shelf(float rate, float frequency, float decibels) noexcept {
    if (std::abs(decibels) < 1e-5F) { identity(); return; }
    frequency = std::clamp(frequency, 10.F, rate * .475F);
    const float a = std::pow(10.F, decibels / 40.F);
    const float omega = 2.F * kPi * frequency / rate;
    const float cosine = std::cos(omega);
    const float sine = std::sin(omega);
    const float alpha = sine * .5F * std::sqrt(2.F);
    const float two_root_a_alpha = 2.F * std::sqrt(a) * alpha;
    normalize(a * ((a + 1.F) - (a - 1.F) * cosine + two_root_a_alpha),
              2.F * a * ((a - 1.F) - (a + 1.F) * cosine),
              a * ((a + 1.F) - (a - 1.F) * cosine - two_root_a_alpha),
              (a + 1.F) + (a - 1.F) * cosine + two_root_a_alpha,
              -2.F * ((a - 1.F) + (a + 1.F) * cosine),
              (a + 1.F) + (a - 1.F) * cosine - two_root_a_alpha);
  }
  void high_shelf(float rate, float frequency, float decibels) noexcept {
    if (std::abs(decibels) < 1e-5F) { identity(); return; }
    frequency = std::clamp(frequency, 10.F, rate * .475F);
    const float a = std::pow(10.F, decibels / 40.F);
    const float omega = 2.F * kPi * frequency / rate;
    const float cosine = std::cos(omega);
    const float sine = std::sin(omega);
    const float alpha = sine * .5F * std::sqrt(2.F);
    const float two_root_a_alpha = 2.F * std::sqrt(a) * alpha;
    normalize(a * ((a + 1.F) + (a - 1.F) * cosine + two_root_a_alpha),
              -2.F * a * ((a - 1.F) + (a + 1.F) * cosine),
              a * ((a + 1.F) + (a - 1.F) * cosine - two_root_a_alpha),
              (a + 1.F) - (a - 1.F) * cosine + two_root_a_alpha,
              2.F * ((a - 1.F) - (a + 1.F) * cosine),
              (a + 1.F) - (a - 1.F) * cosine - two_root_a_alpha);
  }
};

struct AnalogState {
  float previous_ada_input{};
  float previous_dc_input{};
  float previous_dc_output{};
  float tpt_state{};
  void reset() noexcept { previous_ada_input = previous_dc_input = previous_dc_output = tpt_state = 0.F; }
};
float antiderivative(float input) noexcept {
  const float magnitude = std::abs(std::clamp(input, -24.F, 24.F));
  return magnitude + std::log1p(std::exp(-2.F * magnitude)) - std::log(2.F);
}
float ada_tanh(float input, AnalogState& state) noexcept {
  const float previous = state.previous_ada_input;
  const float delta = input - previous;
  const float output = std::abs(delta) > 1e-6F
      ? (antiderivative(input) - antiderivative(previous)) / delta
      : std::tanh((input + previous) * .5F);
  state.previous_ada_input = input;
  return output;
}
float analog_stage(float raw, float input_gain, float drive, float asymmetry,
                   float cutoff, float dc_cutoff, float output_gain,
                   float rate, AnalogState& state) noexcept {
  const float side_drive = std::max(1.F, drive * (raw >= 0.F ? 1.F + asymmetry : 1.F - asymmetry * .62F));
  const float driven = std::abs(raw) < 1e-20F ? 0.F : raw * input_gain * side_drive;
  const float shaped = ada_tanh(driven, state);
  const float dc_r = std::exp(-2.F * kPi * std::max(2.F, dc_cutoff) / rate);
  const float dc_out = shaped - state.previous_dc_input + dc_r * state.previous_dc_output;
  state.previous_dc_input = shaped;
  state.previous_dc_output = std::abs(dc_out) < 1e-20F ? 0.F : dc_out;
  cutoff = std::clamp(cutoff, 10.F, rate * .475F);
  const float g = std::tan(kPi * cutoff / rate);
  const float v = (state.previous_dc_output - state.tpt_state) * g / (1.F + g);
  const float lowpass = v + state.tpt_state;
  state.tpt_state = lowpass + v;
  return std::clamp(lowpass * output_gain, -1.5F, 1.5F);
}

float generic_saturation(float input, float amount) noexcept {
  const float drive = std::max(.001F, quantize(amount, 128.F));
  return std::tanh(input * drive) / drive;
}
float summing_transfer(float input, float compression, float asymmetry) noexcept {
  const float comp = std::clamp(quantize(compression, 512.F), 0.F, .12F);
  const float asym = std::clamp(quantize(asymmetry, 512.F), -.08F, .08F);
  const float even = asym * input * input * (1.F - std::abs(input));
  return std::clamp(input - comp * input * input * input + even, -1.F, 1.F);
}
float transformer_transfer(float input, float drive, float asymmetry) noexcept {
  const float safe_drive = std::max(1.F, quantize(drive, 128.F));
  const float asym = quantize(asymmetry, 512.F);
  const float magnetic_curvature = input * input * (input >= 0.F ? 1.F : -.42F);
  const float compressed = std::tanh((input + asym * magnetic_curvature) * safe_drive)
      / std::max(1e-6F, std::tanh(safe_drive));
  return std::clamp(compressed * .985F, -1.F, 1.F);
}
float atr_tape_transfer(float input, float drive, float bias) noexcept {
  const float safe_drive = std::max(1.F, quantize(drive, 128.F));
  const float quantized_bias = quantize(bias, 256.F);
  const float biased = input + quantized_bias * .035F
      + input * input * (.018F + quantized_bias * .012F);
  const float soft = std::tanh(biased * safe_drive) / std::max(1e-6F, std::tanh(safe_drive));
  const float compression = 1.F - std::min(.085F, std::abs(input) * .045F * safe_drive);
  return std::clamp(soft * compression, -1.F, 1.F);
}
float bcm_reference(float input, float drive, float color) noexcept {
  const float channel_drive = 1.1F + drive * 3.F;
  const float channel_asymmetry = .012F + color * .038F;
  const float side_scale = input >= 0.F ? 1.F + channel_asymmetry : 1.F - channel_asymmetry * .58F;
  const float channel_soft = std::tanh(input * channel_drive * side_scale)
      / std::max(1e-6F, channel_drive * side_scale);
  const float channel = input + (channel_soft - input) * (.18F + drive * .38F);
  const float core_drive = 1.05F + color * 2.4F + drive * .45F;
  const float transformer_soft = std::tanh(channel * core_drive) / std::max(1e-6F, core_drive);
  const float transformer = channel + (transformer_soft - channel) * (.12F + color * .28F + drive * .06F);
  const float even = std::max(0.F, transformer) * std::max(0.F, transformer) * (.004F + color * .008F);
  return std::clamp(transformer + even, -1.F, 1.F);
}
float bcm_capture(float input, float drive, float color) noexcept {
  const float d = std::clamp(quantize(drive, 128.F), 0.F, 1.F);
  const float c = std::clamp(quantize(color, 128.F), 0.F, 1.F);
  const float low_drive = bcm_reference(input, .16F, .22F) * (1.F - c)
      + bcm_reference(input, .16F, .82F) * c;
  const float high_drive = bcm_reference(input, .84F, .22F) * (1.F - c)
      + bcm_reference(input, .84F, .82F) * c;
  return std::clamp(low_drive * (1.F - d) + high_drive * d, -1.F, 1.F);
}

struct ModelPoint {
  bool insert{};
  bool transport{true};
  bool tascam{};
  bool atr{};
  bool bcm{};
  bool summing{};
  float model_input{1.F};
  float pre_drive{1.F};
  float pre_asymmetry{};
  float post_drive{1.F};
  float post_asymmetry{};
  float low_shelf_hz{100.F};
  float low_shelf_db{};
  float high_shelf_hz{10'000.F};
  float high_shelf_db{};
  float model_output{1.F};
  float highpass_hz{28.F};
  float lowpass_hz{18'000.F};
  float crossfeed{};
  float delay_left{.008F};
  float delay_right{.0093F};
  float wow_hz{.55F};
  float flutter_hz{2.1F};
  float left_depth{.0001F};
  float right_depth{-.000072F};
  float cassette_noise{};
  float vinyl_noise{};
  float generic_amount{1.2F};
  float bcm_capture_drive{};
  float bcm_capture_color{};
};
}  // namespace

struct ArtifactParityProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)), dynamics(rate) {
    const auto capacity = static_cast<std::size_t>(rate * .55F) + 64U;
    for (auto& buffer : transport) buffer.assign(capacity, 0.F);
    update_point();
    update_filters();
  }

  float random_signed() noexcept {
    random_state ^= random_state << 13U;
    random_state ^= random_state >> 17U;
    random_state ^= random_state << 5U;
    return static_cast<float>(random_state & 0xffffU) / 32767.5F - 1.F;
  }
  float random_unit() noexcept { return random_signed() * .5F + .5F; }

  void reset() noexcept {
    for (std::size_t index = 0; index < smooth.size(); ++index)
      smooth[index] = target[index].load(std::memory_order_relaxed);
    for (auto& buffer : transport) std::fill(buffer.begin(), buffer.end(), 0.F);
    for (auto& channel : filters) for (auto& filter : channel) filter.reset();
    for (auto& channel : tascam_pre) channel.reset();
    for (auto& channel : tascam_post) channel.reset();
    brown.fill(0.F);
    wow_phase = flutter_phase = 0.F;
    write = 0U;
    random_state = 0xA471FAC7U;
    coefficient_countdown = 0U;
    active_mode = -1;
    dynamics.reset();
    update_point();
    update_filters();
  }

  ModelPoint make_point(unsigned mode, float wear, float wow, float noise, float tone) noexcept {
    ModelPoint result{};
    if (mode == 8U) {
      result.insert = true; result.transport = false; result.tascam = true;
      result.model_input = .82F + wear * 2.9F;
      result.pre_drive = 1.05F + wear * 4.4F;
      result.pre_asymmetry = .045F;
      result.post_drive = 1.F + std::pow(tone, 1.55F) * 7.6F;
      result.post_asymmetry = .032F + wear * .025F;
      result.model_output = std::clamp(std::pow(result.model_input, -.38F)
          * std::pow(result.pre_drive, -.10F) * std::pow(result.post_drive, -.08F), .18F, 1.1F);
      result.low_shelf_hz = 100.F;
      result.low_shelf_db = bipolar_around_default(wow, .16F) * 10.F;
      result.high_shelf_hz = 10'000.F;
      result.high_shelf_db = bipolar_around_default(noise, .10F) * 10.F;
      result.highpass_hz = 28.F; result.lowpass_hz = 19'000.F;
      return result;
    }
    if (mode == 9U || mode == 10U || mode == 11U) {
      result.insert = true; result.transport = false; result.summing = true;
      const float weight = bipolar_around_default(wow, .16F);
      const float presence = bipolar_around_default(noise, .10F);
      if (mode == 9U) {
        result.pre_drive = .008F + wear * .035F;
        result.post_drive = .006F + tone * .022F;
        result.pre_asymmetry = .004F + wear * .018F;
        result.low_shelf_hz = 110.F; result.low_shelf_db = weight * 1.5F + wear * .15F;
        result.high_shelf_hz = 12'000.F; result.high_shelf_db = presence * 1.15F - wear * .12F;
        result.highpass_hz = 20.F + std::max(0.F, -weight) * 8.F;
        result.lowpass_hz = 21'500.F; result.crossfeed = .0015F + wear * .0045F;
      } else if (mode == 10U) {
        result.pre_drive = .007F + wear * .038F;
        result.post_drive = .006F + tone * .018F;
        result.pre_asymmetry = .0015F + wear * .005F;
        result.low_shelf_hz = 90.F; result.low_shelf_db = weight - wear * .08F;
        result.high_shelf_hz = 8500.F; result.high_shelf_db = presence * 1.2F + wear * .08F;
        result.highpass_hz = 24.F; result.lowpass_hz = 22'000.F;
        result.crossfeed = .001F + wear * .003F;
      } else {
        result.pre_drive = .006F + wear * .028F;
        result.post_drive = .005F + tone * .018F;
        result.pre_asymmetry = .002F + wear * .008F;
        result.low_shelf_hz = 100.F; result.low_shelf_db = weight * 1.3F + wear * .12F;
        result.high_shelf_hz = 10'500.F; result.high_shelf_db = presence * 1.1F + wear * .1F;
        result.highpass_hz = 22.F; result.lowpass_hz = 21'800.F;
        result.crossfeed = .0008F + wear * .0025F;
      }
      result.post_asymmetry = result.pre_asymmetry * .55F;
      result.model_output = 1.F / (1.F + result.crossfeed);
      return result;
    }
    if (mode == 12U) {
      result.insert = true; result.atr = true;
      struct Speed { float bump_hz,bump_db,hp,lp,wow_hz,flutter_hz,depth,noise_scale,drive_scale; } speed;
      if (wow < .08F) speed = {48.F,3.8F,38.F,11'800.F,.16F,2.7F,.0019F,1.7F,1.28F};
      else if (wow < .14F) speed = {62.F,3.F,31.F,15'200.F,.18F,3.1F,.00125F,1.35F,1.14F};
      else if (wow < .62F) speed = {82.F,2.15F,27.F,18'900.F,.21F,3.6F,.00068F,1.F,1.F};
      else speed = {108.F,1.05F,24.F,21'500.F,.25F,4.2F,.00034F,.72F,.82F};
      const float bias = (tone - .5F) * 2.F;
      result.model_input = .9F + wear * 2.8F;
      result.pre_drive = 1.02F + wear * 2.6F;
      result.pre_asymmetry = .018F;
      result.post_drive = 1.05F + wear * speed.drive_scale * 5.4F;
      result.post_asymmetry = bias;
      const float transfer_gain = result.model_input
          * normalized_tanh_slope(result.pre_drive) * .985F
          * normalized_tanh_slope(result.post_drive);
      result.model_output = 1.F / std::max(1.F, transfer_gain);
      result.low_shelf_hz = speed.bump_hz;
      result.low_shelf_db = speed.bump_db + wear * .65F;
      result.high_shelf_hz = 10'500.F;
      result.high_shelf_db = bias * 1.8F - wear * .45F;
      result.highpass_hz = speed.hp;
      result.lowpass_hz = speed.lp - std::max(0.F, bias) * 650.F;
      result.delay_left = .0012F; result.delay_right = .00155F;
      result.wow_hz = speed.wow_hz; result.flutter_hz = speed.flutter_hz;
      const float instability = speed.depth * (.35F + wear * .65F);
      result.left_depth = instability; result.right_depth = -instability * .68F;
      result.cassette_noise = noise * noise * speed.noise_scale * .0085F;
      return result;
    }
    if (mode == 13U) {
      result.insert = true; result.transport = false; result.bcm = true;
      const float weight = bipolar_around_default(wow, .16F);
      const float presence = bipolar_around_default(noise, .10F);
      const float input_gain = .96F + tone * .72F + wear * .12F;
      result.model_input = input_gain;
      result.bcm_capture_drive = clamp01(.12F + tone * .58F + wear * .1F);
      result.bcm_capture_color = clamp01(.22F + wear * .44F + std::max(0.F, weight) * .14F);
      result.post_drive = .012F + wear * .044F + tone * .018F;
      result.post_asymmetry = .009F + wear * .024F + tone * .008F;
      result.low_shelf_hz = 105.F; result.low_shelf_db = .35F + weight * 1.85F + wear * .28F;
      result.high_shelf_hz = 11'500.F; result.high_shelf_db = presence * 1.28F - wear * .18F + tone * .12F;
      result.highpass_hz = 19.F + std::max(0.F, -weight) * 8.F;
      result.lowpass_hz = 21'200.F - wear * 720.F;
      result.crossfeed = .0022F + wear * .0062F + tone * .0012F;
      result.model_output = (1.F / std::max(1e-6F, input_gain)) / (1.F + result.crossfeed);
      return result;
    }

    const bool cassette = mode == 0U || mode == 1U || mode == 3U;
    const bool vinyl = mode == 2U || mode == 5U;
    const bool narrow = mode == 4U || mode == 7U;
    const bool broken = mode == 6U;
    const float top_max = narrow ? 6200.F : cassette ? (mode == 1U ? 16'000.F : 14'000.F) : 18'000.F;
    result.highpass_hz = narrow ? 140.F : cassette ? 48.F : 28.F;
    result.lowpass_hz = 2200.F + tone * (top_max - 2200.F);
    result.generic_amount = 1.2F + wear * (broken ? 12.F : narrow ? 7.F : cassette ? 8.F : 4.F);
    result.wow_hz = mode == 1U ? .18F : mode == 3U ? .72F : broken ? .91F : cassette ? .32F : .55F;
    result.flutter_hz = mode == 1U ? 3.2F : mode == 3U ? 7.4F : broken ? 9.1F : cassette ? 4.8F : 2.1F;
    const float depth = .0001F + wow * (broken ? .0042F : mode == 3U ? .0034F : mode == 1U ? .0015F : cassette ? .0026F : .0012F);
    result.left_depth = depth; result.right_depth = -depth * .72F;
    const float base_noise = noise * noise * .012F;
    result.cassette_noise = cassette || narrow || broken ? base_noise * (broken ? 1.7F : 1.F) : 0.F;
    result.vinyl_noise = vinyl ? base_noise * (mode == 5U ? 1.7F : 1.25F) : 0.F;
    return result;
  }

  void update_point() noexcept {
    const unsigned mode = std::min(13U, static_cast<unsigned>(std::max(0.F, std::round(smooth[0]))));
    point = make_point(mode, clamp01(smooth[1]), clamp01(smooth[2]), clamp01(smooth[3]), clamp01(smooth[4]));
    if (static_cast<int>(mode) != active_mode) {
      active_mode = static_cast<int>(mode);
      coefficient_countdown = 0U;
    }
  }

  void update_filters() noexcept {
    for (unsigned channel = 0; channel < 2U; ++channel) {
      filters[channel][0].low_shelf(rate, point.low_shelf_hz, point.low_shelf_db);
      filters[channel][1].high_shelf(rate, point.high_shelf_hz, point.high_shelf_db);
      filters[channel][2].highpass(rate, point.highpass_hz, .55F);
      filters[channel][3].lowpass(rate, point.lowpass_hz, .55F);
    }
  }

  float process_channel(unsigned channel, float input) noexcept {
    float value = input;
    if (point.tascam) {
      value = analog_stage(value, point.model_input, point.pre_drive, point.pre_asymmetry,
                           24'000.F, 8.F, 1.F, rate, tascam_pre[channel]);
    } else {
      value *= point.model_input;
      if (point.bcm) value = bcm_capture(value, point.bcm_capture_drive, point.bcm_capture_color);
      else if (point.summing) value = summing_transfer(value, point.pre_drive, point.pre_asymmetry);
      else if (point.atr) value = transformer_transfer(value, point.pre_drive, point.pre_asymmetry);
    }
    value = filters[channel][0].process(value);
    value = filters[channel][1].process(value);
    if (!point.tascam) value *= point.model_output;
    value = filters[channel][2].process(value);
    value = filters[channel][3].process(value);
    if (point.tascam) {
      value = analog_stage(value, 1.F, point.post_drive, point.post_asymmetry,
                           24'000.F, 8.F, point.model_output, rate, tascam_post[channel]);
    } else if (point.bcm || point.summing) {
      value = summing_transfer(value, point.post_drive, point.post_asymmetry);
    } else if (point.atr) {
      value = atr_tape_transfer(value, point.post_drive, point.post_asymmetry);
    } else {
      value = generic_saturation(value, point.generic_amount);
    }
    return std::clamp(value, -1.5F, 1.5F);
  }

  std::array<float, 2> noise_frame() noexcept {
    std::array<float, 2> cassette{};
    std::array<float, 2> vinyl{};
    for (unsigned channel = 0; channel < 2U; ++channel) {
      const float white = random_signed();
      brown[channel] = brown[channel] * .985F + white * .015F;
      const float impulse = random_unit() < .00035F
          ? random_signed() * (.35F + random_unit() * .65F) : 0.F;
      cassette[channel] = white * .23F + brown[channel] * .7F;
      vinyl[channel] = brown[channel] * .38F + impulse;
    }
    return {cassette[0] * point.cassette_noise + vinyl[0] * point.vinyl_noise,
            cassette[1] * point.cassette_noise + vinyl[1] * point.vinyl_noise};
  }

  void process(float* data, std::size_t frames) noexcept {
    const unsigned requested_mode = std::min(17U, static_cast<unsigned>(std::max(0.F, std::round(target[0].load(std::memory_order_relaxed)))));
    if (requested_mode >= 14U) {
      dynamics.set_bypassed(false);
      dynamics.set_parameter("mode", static_cast<float>(requested_mode - 14U));
      dynamics.set_parameter("style", std::round(clamp01(target[3].load(std::memory_order_relaxed)) * 3.F));
      dynamics.set_parameter("drive", clamp01(target[1].load(std::memory_order_relaxed)));
      dynamics.set_parameter("time", clamp01(target[2].load(std::memory_order_relaxed)));
      dynamics.set_parameter("character", clamp01(target[4].load(std::memory_order_relaxed)));
      dynamics.set_parameter("mix", clamp01(target[5].load(std::memory_order_relaxed)));
      dynamics.process(data, frames);
      return;
    }
    const float character_smoothing = smoothing_coefficient(.04F, rate);
    const float mix_smoothing = smoothing_coefficient(.025F, rate);
    for (std::size_t frame = 0; frame < frames; ++frame) {
      smooth[0] = target[0].load(std::memory_order_relaxed);
      for (std::size_t index = 1; index < 5U; ++index)
        smooth[index] += (target[index].load(std::memory_order_relaxed) - smooth[index]) * character_smoothing;
      smooth[5] += (target[5].load(std::memory_order_relaxed) - smooth[5]) * mix_smoothing;
      update_point();
      if (coefficient_countdown == 0U) {
        update_filters();
        coefficient_countdown = 31U;
      } else --coefficient_countdown;

      const std::array<float, 2> dry{data[frame * 2U], data[frame * 2U + 1U]};
      std::array<float, 2> processed{
          process_channel(0U, std::isfinite(dry[0]) ? dry[0] : 0.F),
          process_channel(1U, std::isfinite(dry[1]) ? dry[1] : 0.F)};
      std::array<float, 2> wet{};
      if (point.transport) {
        transport[0][write] = processed[0];
        transport[1][write] = processed[1];
        wow_phase += 2.F * kPi * point.wow_hz / rate;
        flutter_phase += 2.F * kPi * point.flutter_hz / rate;
        if (wow_phase >= 2.F * kPi) wow_phase -= 2.F * kPi;
        if (flutter_phase >= 2.F * kPi) flutter_phase -= 2.F * kPi;
        const float left_delay = (point.delay_left + std::sin(wow_phase) * point.left_depth) * rate;
        const float right_delay = (point.delay_right + (2.F / kPi) * std::asin(std::sin(flutter_phase)) * point.right_depth) * rate;
        wet[0] = read_linear(transport[0], write, std::max(1.F, left_delay));
        wet[1] = read_linear(transport[1], write, std::max(1.F, right_delay));
      } else {
        wet = processed;
      }
      if (point.crossfeed > 0.F) {
        const auto original = wet;
        wet[0] += processed[1] * point.crossfeed;
        wet[1] += processed[0] * point.crossfeed;
        (void)original;
      }
      const auto noise = noise_frame();
      wet[0] += noise[0];
      wet[1] += noise[1];

      const float mix = clamp01(smooth[5]);
      const float dry_gain = point.insert ? 1.F - mix : std::cos(mix * kPi * .5F);
      const float wet_gain = point.insert ? mix : std::sin(mix * kPi * .5F);
      data[frame * 2U] = std::clamp(dry[0] * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
      data[frame * 2U + 1U] = std::clamp(dry[1] * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
      write = (write + 1U) % transport[0].size();
    }
  }

  float rate;
  PressureParityProcessor dynamics;
  std::array<std::vector<float>, 2> transport;
  std::array<std::array<Biquad, 4>, 2> filters{};
  std::array<AnalogState, 2> tascam_pre{};
  std::array<AnalogState, 2> tascam_post{};
  std::array<float, 2> brown{};
  std::size_t write{};
  float wow_phase{};
  float flutter_phase{};
  std::uint32_t random_state{0xA471FAC7U};
  std::size_t coefficient_countdown{};
  int active_mode{-1};
  ModelPoint point{};
  std::array<std::atomic<float>, 6> target{0.F,.162F,.16F,.10F,.62F,.26F};
  std::array<float, 6> smooth{0.F,.162F,.16F,.10F,.62F,.26F};
};

ArtifactParityProcessor::ArtifactParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
ArtifactParityProcessor::~ArtifactParityProcessor() = default;
void ArtifactParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}
void ArtifactParityProcessor::reset() noexcept { impl_->reset(); }
bool ArtifactParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99U;
  if (name == "mode") index = 0U;
  else if (name == "wear") index = 1U;
  else if (name == "wow") index = 2U;
  else if (name == "noise") index = 3U;
  else if (name == "tone") index = 4U;
  else if (name == "mix") index = 5U;
  if (index >= impl_->target.size()) return false;
  if (index == 0U) value = std::clamp(std::round(value), 0.F, 17.F);
  else value = clamp01(value);
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
