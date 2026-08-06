#include "calcotone/ember_magnetic_core_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr unsigned kQuality = 2U;

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float db_to_gain(float db) noexcept { return std::pow(10.F, db / 20.F); }

struct StereoBiquad {
  float b0{1.F}, b1{}, b2{}, a1{}, a2{};
  std::array<float, 2> x1{}, x2{}, y1{}, y2{};

  void reset() noexcept { x1 = {}; x2 = {}; y1 = {}; y2 = {}; }

  void set_highpass(float hz, float q, float rate) noexcept {
    const float omega = 2.F * kPi * std::clamp(hz, 5.F, rate * .45F) / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    const float a0 = 1.F + alpha;
    b0 = ((1.F + cosine) * .5F) / a0;
    b1 = -(1.F + cosine) / a0;
    b2 = b0;
    a1 = (-2.F * cosine) / a0;
    a2 = (1.F - alpha) / a0;
  }

  void set_lowpass(float hz, float q, float rate) noexcept {
    const float omega = 2.F * kPi * std::clamp(hz, 5.F, rate * .45F) / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    const float a0 = 1.F + alpha;
    b0 = ((1.F - cosine) * .5F) / a0;
    b1 = (1.F - cosine) / a0;
    b2 = b0;
    a1 = (-2.F * cosine) / a0;
    a2 = (1.F - alpha) / a0;
  }

  void set_peaking(float hz, float q, float gain_db, float rate) noexcept {
    const float omega = 2.F * kPi * std::clamp(hz, 5.F, rate * .45F) / rate;
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.F * std::max(.05F, q));
    const float amplitude = std::pow(10.F, gain_db / 40.F);
    const float a0 = 1.F + alpha / amplitude;
    b0 = (1.F + alpha * amplitude) / a0;
    b1 = (-2.F * cosine) / a0;
    b2 = (1.F - alpha * amplitude) / a0;
    a1 = (-2.F * cosine) / a0;
    a2 = (1.F - alpha / amplitude) / a0;
  }

  float process(float input, unsigned channel) noexcept {
    const float output = b0 * input + b1 * x1[channel] + b2 * x2[channel]
        - a1 * y1[channel] - a2 * y2[channel];
    x2[channel] = x1[channel];
    x1[channel] = input;
    y2[channel] = y1[channel];
    y1[channel] = output;
    return output;
  }
};

float compressor_sample(float input, unsigned channel, float rate,
                        float threshold_db, float ratio, float knee_db,
                        float attack_seconds, float release_seconds,
                        std::array<float, 2>& envelope,
                        std::array<float, 2>& gain_state) noexcept {
  const float magnitude = std::abs(input);
  const float envelope_attack = 1.F - std::exp(-1.F / (rate * std::max(.00005F, attack_seconds)));
  const float envelope_release = 1.F - std::exp(-1.F / (rate * std::max(.00005F, release_seconds)));
  envelope[channel] += (magnitude - envelope[channel])
      * (magnitude > envelope[channel] ? envelope_attack : envelope_release);

  const float level_db = 20.F * std::log10(std::max(envelope[channel], 1e-9F));
  const float over = level_db - threshold_db;
  float reduction_db = 0.F;
  if (over > knee_db * .5F) {
    reduction_db = -(over - over / std::max(1.F, ratio));
  } else if (over > -knee_db * .5F) {
    const float knee_position = over + knee_db * .5F;
    reduction_db = -(1.F - 1.F / std::max(1.F, ratio))
        * knee_position * knee_position / (2.F * std::max(.001F, knee_db));
  }

  const float target_gain = db_to_gain(reduction_db);
  const float gain_coefficient = 1.F - std::exp(-1.F / (rate * std::max(.00005F,
      target_gain < gain_state[channel] ? attack_seconds : release_seconds)));
  gain_state[channel] += (target_gain - gain_state[channel]) * gain_coefficient;
  return input * gain_state[channel];
}
}  // namespace

struct EmberMagneticCoreProcessor::Impl {
  float rate;
  std::array<std::atomic<float>, 6> target{};
  std::array<float, 6> value{.14F, 9500.F, .18F, .22F, .38F, .22F};

  StereoBiquad input_highpass;
  StereoBiquad tone_lowpass;
  StereoBiquad presence;
  StereoBiquad wet_dc_block;

  std::array<float, 2> previous_input{};
  std::array<float, 2> flux{};
  std::array<float, 2> remanence{};
  std::array<float, 2> eddy{};
  std::array<float, 2> dc_flux{};
  std::array<float, 2> saturation_memory{};
  float loss_memory{};
  float thermal_state{};

  std::array<float, 2> compressor_envelope{};
  std::array<float, 2> compressor_gain{1.F, 1.F};
  std::array<float, 2> limiter_envelope{};
  std::array<float, 2> limiter_gain{1.F, 1.F};

  explicit Impl(float sample_rate) : rate(std::clamp(sample_rate, 8000.F, 384000.F)) {
    for (std::size_t i = 0; i < value.size(); ++i) target[i].store(value[i]);
    input_highpass.set_highpass(22.F, .5F, rate);
    wet_dc_block.set_highpass(18.F, .5F, rate);
  }

  void reset() noexcept {
    input_highpass.reset();
    tone_lowpass.reset();
    presence.reset();
    wet_dc_block.reset();
    previous_input = {};
    flux = {};
    remanence = {};
    eddy = {};
    dc_flux = {};
    saturation_memory = {};
    loss_memory = 0.F;
    thermal_state = 0.F;
    compressor_envelope = {};
    compressor_gain = {1.F, 1.F};
    limiter_envelope = {};
    limiter_gain = {1.F, 1.F};
  }

  void update_shared_state(float left, float right, float drive, float heat) noexcept {
    const float power = .5F * (left * left + right * right);
    const float loss_target = std::min(1.5F, power * (.68F + drive * .86F));
    loss_memory += (loss_target - loss_memory)
        * (loss_target > loss_memory ? .000018F : .0000045F);

    const float thermal_target = std::min(1.5F,
        power * (.55F + drive * .72F) + loss_memory * .24F + heat * .08F);
    thermal_state += (thermal_target - thermal_state)
        * (thermal_target > thermal_state ? .000012F : .0000035F);
  }

  float process_core(float input, float drive, float heat, float character,
                     float dynamics, unsigned channel) noexcept {
    float previous = previous_input[channel];
    float local_flux = flux[channel];
    float local_remanence = remanence[channel];
    float local_eddy = eddy[channel];
    float local_dc_flux = dc_flux[channel];
    float local_saturation_memory = saturation_memory[channel];
    float accumulated = 0.F;

    const float mismatch = channel == 0 ? 1.0018F : .9987F;
    const float permeability = std::max(.84F,
        1.F - thermal_state * (.025F + heat * .025F));
    const float excitation = (.88F + drive * 2.4F + heat * .45F)
        * mismatch * permeability;
    const float base_coercivity = .035F + character * .085F;
    const float saturation = (1.05F + (1.F - dynamics) * .55F)
        * (1.F - std::min(.12F, local_saturation_memory * .08F));
    const float flux_rate = (.10F + dynamics * .07F) * (.96F + permeability * .04F);
    const float remanence_rate = (.00042F + heat * .00034F)
        * (1.F - std::min(.2F, thermal_state * .06F));
    const float eddy_rate = .15F + character * .18F;
    const float eddy_amount = (.018F + heat * .030F + character * .012F)
        * (1.F + thermal_state * .08F);

    for (unsigned step = 1; step <= kQuality; ++step) {
      const float sub = static_cast<float>(step) / static_cast<float>(kQuality);
      const float interpolated = previous + (input - previous) * sub;
      const float field = interpolated * excitation;

      local_dc_flux += (field - local_dc_flux) * (.000018F + heat * .000024F);
      const float direction = field >= local_flux ? 1.F : -1.F;
      const float minor_loop = std::min(1.F,
          std::abs(field - local_flux) / std::max(.08F, saturation));
      const float dynamic_coercivity = base_coercivity * (.72F + minor_loop * .28F)
          * (1.F + local_saturation_memory * .08F);
      const float biased_field = field + local_remanence * dynamic_coercivity * direction
          + local_dc_flux * (.012F + character * .02F);
      const float target_flux = std::tanh(biased_field / std::max(.35F, saturation)) * saturation;
      local_flux += (target_flux - local_flux) * flux_rate;

      const float saturation_stress = std::max(0.F,
          std::abs(local_flux) / std::max(.2F, saturation) - .62F);
      local_saturation_memory += (saturation_stress - local_saturation_memory)
          * (saturation_stress > local_saturation_memory
              ? .0025F : .00008F + dynamics * .00005F);

      const float remanent_target = std::tanh((local_flux + local_dc_flux * .035F) * 1.7F)
          * (.045F + character * .055F);
      local_remanence += (remanent_target - local_remanence) * remanence_rate;

      const float derivative = field - previous * excitation;
      local_eddy += (derivative - local_eddy) * eddy_rate;
      const float eddy_loss = local_eddy * eddy_amount;
      const float hysteresis_loss = std::copysign(1.F, local_flux == 0.F ? 1.F : local_flux)
          * std::abs(local_flux - target_flux) * (.006F + character * .008F);

      const float core = std::tanh((local_flux - eddy_loss - hysteresis_loss)
          * (1.02F + heat * .22F));
      const float residual = core - interpolated;
      const float wet = .10F + drive * .16F + heat * .05F;
      const float thermal_trim = 1.F - std::min(.025F,
          thermal_state * (.006F + heat * .006F));
      accumulated += interpolated + residual * std::min(.34F, wet) * thermal_trim;
    }

    previous_input[channel] = input;
    flux[channel] = local_flux;
    remanence[channel] = local_remanence;
    eddy[channel] = local_eddy;
    dc_flux[channel] = local_dc_flux;
    saturation_memory[channel] = local_saturation_memory;
    return accumulated / static_cast<float>(kQuality);
  }

  void process(float* data, std::size_t frames) noexcept {
    if (!data || frames == 0) return;
    constexpr std::array<float, 6> time_constants{.012F, .025F, .012F, .012F, .03F, .025F};

    for (std::size_t frame = 0; frame < frames; ++frame) {
      for (std::size_t i = 0; i < value.size(); ++i) {
        const float glide = 1.F - std::exp(-1.F / (rate * time_constants[i]));
        value[i] += (target[i].load(std::memory_order_relaxed) - value[i]) * glide;
      }

      const float drive = clamp01(value[0]);
      const float tone_hz = std::clamp(value[1], 200.F, 18000.F);
      const float heat = clamp01(value[2]);
      const float character = clamp01(value[3]);
      const float dynamics = clamp01(value[4]);
      const float mix = clamp01(value[5]);

      tone_lowpass.set_lowpass(std::max(2600.F, tone_hz * (1.F - heat * .09F)), 1.F, rate);
      presence.set_peaking(1450.F + character * 900.F, .65F,
          .25F + (character - .5F) * 1.25F, rate);

      const float dry[2]{data[frame * 2], data[frame * 2 + 1]};
      float filtered[2]{
        input_highpass.process(dry[0], 0),
        input_highpass.process(dry[1], 1),
      };
      update_shared_state(filtered[0], filtered[1], drive, heat);
      const float loss_scale = 1.F - loss_memory * (.002F + heat * .006F);

      float wet[2]{};
      for (unsigned channel = 0; channel < 2; ++channel) {
        wet[channel] = process_core(filtered[channel] * loss_scale,
            drive, heat, character, dynamics, channel);
        wet[channel] = tone_lowpass.process(wet[channel], channel);
        wet[channel] = presence.process(wet[channel], channel);
        wet[channel] = compressor_sample(wet[channel], channel, rate,
            -1.5F - dynamics * 2.5F, 1.02F + dynamics * .36F,
            12.F, .004F, .09F, compressor_envelope, compressor_gain);
        wet[channel] *= .99F - drive * .035F;
        wet[channel] = wet_dc_block.process(wet[channel], channel);
        wet[channel] = compressor_sample(wet[channel], channel, rate,
            -.5F, 20.F, .5F, .001F, .06F, limiter_envelope, limiter_gain);
      }

      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      data[frame * 2] = std::clamp(dry[0] * dry_gain + wet[0] * wet_gain, -1.2F, 1.2F);
      data[frame * 2 + 1] = std::clamp(dry[1] * dry_gain + wet[1] * wet_gain, -1.2F, 1.2F);
    }
  }
};

EmberMagneticCoreProcessor::EmberMagneticCoreProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
EmberMagneticCoreProcessor::~EmberMagneticCoreProcessor() = default;
void EmberMagneticCoreProcessor::process(float* data, std::size_t frames) noexcept {
  impl_->process(data, frames);
}
void EmberMagneticCoreProcessor::reset() noexcept { impl_->reset(); }
bool EmberMagneticCoreProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "drive") index = 0;
  else if (name == "tone") index = 1;
  else if (name == "heat") index = 2;
  else if (name == "character") index = 3;
  else if (name == "dynamics") index = 4;
  else if (name == "mix") index = 5;
  if (index >= impl_->target.size()) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
