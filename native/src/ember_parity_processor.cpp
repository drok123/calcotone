#include "calcotone/ember_parity_processor.hpp"

#include "calcotone/ember_parity_profiles.hpp"
#include "calcotone/ember_tube_electrical_profiles.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr unsigned kTubeQuality = 2U;  // Matches TubeColorStage's canonical default.

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float coefficient(float hz, float rate) noexcept {
  return 1.F - std::exp(-2.F * kPi * std::clamp(hz, 10.F, rate * .45F) / rate);
}
float one_pole(float input, float& state, float amount) noexcept {
  state += (input - state) * amount;
  return state;
}
float soft_shape(float x) noexcept { return std::tanh(x); }
float db_to_gain(float db) noexcept { return std::pow(10.F, db / 20.F); }
float sign_of(float value) noexcept { return value > 0.F ? 1.F : value < 0.F ? -1.F : 0.F; }
float quantize(float x, unsigned bits) noexcept {
  const float steps = static_cast<float>((1U << std::clamp(bits, 4U, 20U)) - 1U);
  return std::round(std::clamp(x, -1.F, 1.F) * steps) / steps;
}
}  // namespace

struct EmberParityProcessor::Impl {
  float rate;
  float input_hp_coefficient{};
  float compressor_attack_coefficient{};
  float compressor_release_coefficient{};
  std::array<std::atomic<float>, 7> target{};
  std::array<float, 7> value{0.F, .14F, 9500.F, .18F, .22F, .38F, .22F};
  int active_mode{-1};
  unsigned pending_mode{};
  float mode_mix{1.F};
  float mode_fade_step{};
  unsigned mode_transition{};

  std::array<float, 2> input_hp_in{}, input_hp_out{};
  std::array<float, 2> tone{}, presence{}, compressor_envelope{}, compressor_gain{1.F, 1.F};
  std::array<float, 2> dc_in{}, dc_out{};
  std::array<float, 2> magnetic_memory{};
  std::array<float, 2> digital_previous{};
  std::array<std::uint32_t, 2> hold_count{};
  std::array<float, 2> held{};

  // Canonical TubeColorStage state. These correspond directly to the original
  // AudioWorklet's per-channel and shared electrical memories.
  std::array<float, 2> tube_previous_input{};
  std::array<float, 2> tube_bias_memory{};
  std::array<float, 2> tube_cathode_memory{};
  std::array<float, 2> tube_blocking_memory{};
  std::array<float, 2> tube_output_memory{};
  std::array<float, 2> tube_plate_charge{};
  float tube_supply_demand{};
  float tube_supply_sag{};
  float tube_thermal_state{};

  explicit Impl(float sample_rate) : rate(std::clamp(sample_rate, 8000.F, 384000.F)) {
    for (std::size_t i = 0; i < value.size(); ++i) target[i].store(value[i]);
    mode_fade_step = 1.F / std::max(1.F, rate * .003F);
    input_hp_coefficient = coefficient(22.F, rate);
    compressor_attack_coefficient = 1.F - std::exp(-1.F / (rate * .004F));
    compressor_release_coefficient = 1.F - std::exp(-1.F / (rate * .09F));
  }

  unsigned requested_mode() const noexcept {
    return std::min(17U, static_cast<unsigned>(std::max(0.F, std::round(target[0].load(std::memory_order_relaxed)))));
  }

  void prepare_mode_transition() noexcept {
    const unsigned requested = requested_mode();
    if (active_mode < 0) {
      active_mode = static_cast<int>(requested);
      pending_mode = requested;
      mode_mix = 1.F;
      mode_transition = 0U;
    } else if (requested != static_cast<unsigned>(active_mode)) {
      pending_mode = requested;
      if (mode_transition == 0U || mode_transition == 2U) mode_transition = 1U;
    }
  }

  void advance_mode_transition() noexcept {
    if (mode_transition == 1U) {
      mode_mix = std::max(0.F, mode_mix - mode_fade_step);
      if (mode_mix <= 0.F) {
        mode_mix = 0.F;
        active_mode = static_cast<int>(pending_mode);
        mode_transition = 2U;
      }
    } else if (mode_transition == 2U) {
      mode_mix = std::min(1.F, mode_mix + mode_fade_step);
      if (mode_mix >= 1.F) {
        mode_mix = 1.F;
        mode_transition = 0U;
      }
    }
  }

  float highpass_input(float input, unsigned channel) noexcept {
    const float output = input - input_hp_in[channel] + (1.F - input_hp_coefficient) * input_hp_out[channel];
    input_hp_in[channel] = input;
    input_hp_out[channel] = output;
    return output;
  }

  float generic(float x, unsigned mode, float drive, float heat, float character) noexcept {
    static constexpr std::array<float, 18> aggression{
      .7F,.42F,1.15F,1.F,2.2F,1.05F,2.8F,.42F,.42F,.42F,.42F,.42F,1.F,1.F,1.F,1.F,1.F,1.F
    };
    const float mode_aggression = aggression[std::min<std::size_t>(mode, aggression.size() - 1U)];
    const float pre_gain = mode == 1
        ? 1.F + std::pow(drive, 1.5F) * 1.15F + heat * .24F
        : 1.F + std::pow(drive, 1.35F) * (4.2F * mode_aggression) + heat * 1.4F;
    const float curve_gain = 1.F + drive * 7.F + heat * 3.F;
    const float bias = (character - .5F) * .06F;
    const float zero = std::tanh(bias * curve_gain);
    return (std::tanh((x * pre_gain + bias) * curve_gain) - zero)
        / std::max(1.F, curve_gain * .55F);
  }

  void update_tube_shared(float left, float right, const EmberTubeElectricalProfile& p,
                          float drive, float heat, float dynamics) noexcept {
    const float peak = std::max(std::abs(left), std::abs(right));
    const float power = .5F * (left * left + right * right);
    const float voltage_scale = p.supply / 300.F;
    const float load_scale = 100000.F / p.plate_load;
    const float demand_target = std::min(1.7F, peak * (.48F + drive * .72F) * load_scale);
    const float demand_coefficient = demand_target > tube_supply_demand
        ? .0018F + p.supply_stiffness * .0016F
        : .00008F + p.recovery * .00008F;
    tube_supply_demand += (demand_target - tube_supply_demand) * demand_coefficient;

    const float sag_target = tube_supply_demand
        * (.0035F + p.sag * .022F)
        * (.30F + dynamics * .70F)
        / std::max(.72F, voltage_scale);
    const float sag_coefficient = sag_target > tube_supply_sag
        ? .00075F + p.sag_attack * .0010F
        : .000055F + p.recovery * .00009F;
    tube_supply_sag += (sag_target - tube_supply_sag) * sag_coefficient;

    const float thermal_target = std::min(1.2F,
        power * (.34F + drive * 1.05F) * load_scale + heat * (.08F + p.thermal * .10F));
    const float thermal_coefficient = thermal_target > tube_thermal_state
        ? .000007F + p.thermal * .000008F
        : .0000022F + p.recovery * .0000018F;
    tube_thermal_state += (thermal_target - tube_thermal_state) * thermal_coefficient;
  }

  float tube(float input, const EmberTubeElectricalProfile& p, float drive, float heat,
             float character, float dynamics, unsigned channel) noexcept {
    float previous_input = tube_previous_input[channel];
    float bias_memory = tube_bias_memory[channel];
    float cathode_memory = tube_cathode_memory[channel];
    float blocking_memory = tube_blocking_memory[channel];
    float output_memory = tube_output_memory[channel];
    float plate_charge = tube_plate_charge[channel];

    const float voltage_scale = p.supply / 300.F;
    const float load_scale = 100000.F / p.plate_load;
    const float mu_scale = p.mu / 100.F;
    const float bias_scale = std::clamp(std::abs(p.bias) / 1.5F, .65F, 1.35F);
    const float channel_trim = channel == 0 ? 1.F + p.mismatch : 1.F - p.mismatch * .73F;
    const float rail_scale = std::max(.88F, 1.F - tube_supply_sag * (.72F + p.sag * .58F));
    const float thermal_softening = 1.F - tube_thermal_state * (.003F + p.thermal * .014F);
    const float input_gain = (.82F + std::pow(drive, 1.42F) * (.52F + p.gain * .38F))
        * channel_trim * rail_scale * thermal_softening * mu_scale * (.90F + voltage_scale * .10F);
    const float model_color = p.color_base + drive * p.color_drive + heat * p.color_heat
        + character * p.color_character;
    const float color_mix = std::clamp(model_color, .04F, p.color_ceiling);
    const float bias_amount = (.002F + p.bias_memory * .010F)
        * (.24F + heat * .76F) * (.34F + dynamics * .66F) * bias_scale;
    const float attack = p.bias_attack + heat * p.bias_attack_heat;
    const float release = p.bias_release + (1.F - dynamics) * p.bias_release_dynamics
        + p.recovery * p.bias_release_recovery;
    const float character_bias = (character - .5F) * p.character_range * .34F + p.static_bias;
    const float curve = p.softness + heat * p.heat_curve + drive * p.drive_curve;
    float accumulated = 0.F;

    for (unsigned step = 1; step <= kTubeQuality; ++step) {
      const float sub = static_cast<float>(step) / static_cast<float>(kTubeQuality);
      const float interpolated = previous_input + (input - previous_input) * sub;
      const float absolute = std::abs(interpolated);
      bias_memory += (absolute - bias_memory) * (absolute > bias_memory ? attack : release);

      const float cathode_target = std::min(1.25F,
          absolute * absolute * (p.cathode_drive + drive * p.cathode_drive_mod));
      const float cathode_coefficient = cathode_target > cathode_memory
          ? p.cathode_attack + heat * p.cathode_heat_attack
          : p.cathode_release + p.recovery * p.cathode_recovery;
      cathode_memory += (cathode_target - cathode_memory) * cathode_coefficient;

      const float dynamic_bias = bias_memory * bias_amount;
      const float cathode_shift = cathode_memory * p.cathode
          * (p.cathode_bias_base + dynamics * p.cathode_bias_dynamics);
      const float stage_input = interpolated * input_gain;
      const float grid_threshold = p.grid_headroom * (.72F + voltage_scale * .18F + bias_scale * .10F);
      const float overdrive = std::max(0.F, std::abs(stage_input) - grid_threshold);
      const float blocking_coefficient = overdrive > blocking_memory
          ? p.blocking_attack
          : p.blocking_release + p.recovery * p.blocking_recovery;
      blocking_memory += (overdrive - blocking_memory) * blocking_coefficient;
      const float recovery_bias = std::min(p.blocking_ceiling,
          blocking_memory * p.blocking * p.blocking_bias);

      const float effective_bias = character_bias - dynamic_bias - cathode_shift - recovery_bias;
      const float zero = std::tanh(effective_bias * curve);
      const float local_slope = std::max(.34F, input_gain * curve * (1.F - zero * zero));
      float shaped = (std::tanh((stage_input + effective_bias) * curve) - zero) / local_slope;

      const float plate_current = std::max(0.F,
          std::abs(stage_input) * p.plate_current_scale + cathode_memory * p.plate_cathode_coupling);
      const float plate_target = std::min(1.2F, plate_current * load_scale / std::max(.75F, voltage_scale));
      plate_charge += (plate_target - plate_charge)
          * (plate_target > plate_charge ? p.plate_attack : p.plate_release);
      shaped *= 1.F - std::min(p.plate_compression_ceiling, plate_charge * p.plate_compression);

      const float local_sag = std::min(p.local_sag_ceiling,
          bias_memory * (p.local_sag_base + dynamics * p.local_sag_dynamics)
          + cathode_memory * p.cathode * p.local_sag_cathode
          + tube_supply_sag * p.local_sag_supply);
      shaped *= 1.F - local_sag;

      const float harmonic_tilt = std::tanh(shaped * (1.F + p.harmonic_drive * (.4F + drive)))
          + p.even_harmonic * shaped * shaped * sign_of(shaped);
      shaped = harmonic_tilt / (1.F + p.even_harmonic * .28F);

      const float colored = interpolated + (shaped - interpolated) * color_mix;
      const float plate_follow = p.plate_follow_base + p.plate_memory * p.plate_follow_memory;
      output_memory += (colored - output_memory) * std::min(.97F, plate_follow);
      accumulated += output_memory;
    }

    tube_previous_input[channel] = input;
    tube_bias_memory[channel] = bias_memory;
    tube_cathode_memory[channel] = cathode_memory;
    tube_blocking_memory[channel] = blocking_memory;
    tube_output_memory[channel] = output_memory;
    tube_plate_charge[channel] = plate_charge;
    return accumulated / static_cast<float>(kTubeQuality);
  }

  float magnetic(float x, float drive, float heat, float character, float dynamics, unsigned ch) noexcept {
    const float memory = magnetic_memory[ch];
    const float flux = x * (1.2F + drive * 5.4F) + memory * (.08F + character * .22F);
    float wet = soft_shape(flux + flux * flux * .025F * heat);
    magnetic_memory[ch] += (wet - memory) * (.004F + heat * .018F);
    wet = wet * (.86F + character * .18F) + x * (.14F - character * .06F);
    return wet / (1.F + std::abs(wet) * dynamics * .22F);
  }

  float digital(float x, int machine, float drive, float tone_norm, float heat,
                float character, float dynamics, unsigned ch) noexcept {
    static constexpr std::array<unsigned, 6> bits{12, 12, 8, 12, 8, 8};
    static constexpr std::array<unsigned, 6> holds{3, 2, 5, 3, 4, 6};
    static constexpr std::array<float, 6> trims{.94F, .98F, .88F, .96F, .90F, .86F};
    const unsigned index = static_cast<unsigned>(std::clamp(machine, 0, 5));
    if (hold_count[ch]++ % std::max(1U, holds[index] - static_cast<unsigned>(tone_norm * 2.F)) == 0)
      held[ch] = x;
    float wet = quantize(held[ch] * (1.F + drive * .8F), bits[index]);
    const float fold = std::max(0.F, std::abs(wet) - (.82F - drive * .18F));
    wet -= std::copysign(fold * (.25F + heat * .45F), wet);
    const float cutoff = 2200.F + tone_norm * (machine == 2 || machine >= 4 ? 7200.F : 11800.F);
    wet = one_pole(wet, tone[ch], coefficient(cutoff, rate));
    wet += (wet - digital_previous[ch]) * character * (machine == 0 ? .08F : .035F);
    digital_previous[ch] = wet;
    return wet * trims[index] / (1.F + std::abs(wet) * dynamics * .08F);
  }

  float compressor(float input, unsigned channel, float threshold_db, float ratio) noexcept {
    const float magnitude = std::abs(input);
    compressor_envelope[channel] += (magnitude - compressor_envelope[channel])
        * (magnitude > compressor_envelope[channel] ? compressor_attack_coefficient : compressor_release_coefficient);
    const float level_db = 20.F * std::log10(std::max(compressor_envelope[channel], 1e-7F));
    const float over_db = level_db - threshold_db;
    float reduction_db = 0.F;
    if (over_db > -6.F) {
      const float knee = std::clamp((over_db + 6.F) / 12.F, 0.F, 1.F);
      reduction_db = -std::max(0.F, over_db) * (1.F - 1.F / std::max(1.F, ratio)) * knee;
    }
    const float target_gain = db_to_gain(reduction_db);
    compressor_gain[channel] += (target_gain - compressor_gain[channel])
        * (target_gain < compressor_gain[channel] ? compressor_attack_coefficient : compressor_release_coefficient);
    return input * compressor_gain[channel];
  }

  float analog_post(float wet, unsigned mode, const EmberParityProfile& profile, float drive,
                    float tone_hz, float heat, float character, float dynamics, unsigned channel) noexcept {
    float cutoff = tone_hz;
    float presence_hz = 3200.F + character * 2600.F;
    float presence_db = 2.2F * (character - .35F);
    float threshold_db = -4.F - dynamics * 12.F;
    float ratio = 1.2F + dynamics * 3.8F;
    float post_gain = 1.F;

    if (profile.branch == EmberParityBranch::Tube) {
      cutoff = std::max(1800.F, std::min(18000.F,
          tone_hz * profile.tube_post.tone_scale * (1.F - heat * profile.tube_post.tone_heat)));
      presence_hz = profile.tube_post.presence_hz + character * profile.tube_post.presence_span;
      presence_db = profile.tube_post.presence_base + (character - .5F) * profile.tube_post.presence_character;
      threshold_db = profile.tube_post.threshold_base - dynamics * profile.tube_post.threshold_dynamics;
      ratio = profile.tube_post.ratio_base + dynamics * profile.tube_post.ratio_dynamics;
      post_gain = profile.tube_post.post_base - drive * profile.tube_post.post_drive;
    } else if (profile.branch == EmberParityBranch::MagneticCore) {
      cutoff = std::max(2600.F, tone_hz * (1.F - heat * .09F));
      presence_hz = 1450.F + character * 900.F;
      presence_db = .25F + (character - .5F) * 1.25F;
      threshold_db = -1.5F - dynamics * 2.5F;
      ratio = 1.02F + dynamics * .36F;
      post_gain = .99F - drive * .035F;
    } else {
      const bool tube_generic = mode == 1U;
      const float mode_aggression = mode == 0U ? .7F : mode == 2U ? 1.15F : mode == 4U ? 2.2F
          : mode == 5U ? 1.05F : mode == 6U ? 2.8F : .42F;
      const float pre_gain = tube_generic
          ? 1.F + std::pow(drive, 1.5F) * 1.15F + heat * .24F
          : 1.F + std::pow(drive, 1.35F) * (4.2F * mode_aggression) + heat * 1.4F;
      cutoff = std::max(1200.F, tone_hz * (1.F - heat * (tube_generic ? .07F : .18F)));
      presence_db = (mode == 5U ? 5.F : tube_generic ? .8F : 2.2F) * (character - .35F);
      threshold_db = tube_generic ? -2.F - dynamics * 4.F : -4.F - dynamics * 12.F;
      ratio = tube_generic ? 1.05F + dynamics * .65F : 1.2F + dynamics * 3.8F;
      post_gain = tube_generic ? .98F / std::pow(pre_gain, .22F) : 1.F / std::pow(pre_gain, .72F);
    }

    wet = one_pole(wet, tone[channel], coefficient(cutoff, rate));
    const float presence_low = one_pole(wet, presence[channel], coefficient(presence_hz, rate));
    wet += (wet - presence_low) * (db_to_gain(presence_db) - 1.F);
    wet = compressor(wet, channel, threshold_db, ratio) * post_gain;
    const float dc = wet - dc_in[channel] + .995F * dc_out[channel];
    dc_in[channel] = wet;
    dc_out[channel] = dc;
    return dc;
  }

  void process(float* data, std::size_t frames) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .045F));
    prepare_mode_transition();
    for (std::size_t frame = 0; frame < frames; ++frame) {
      for (std::size_t i = 1; i < value.size(); ++i)
        value[i] += (target[i].load(std::memory_order_relaxed) - value[i]) * glide;
      prepare_mode_transition();
      advance_mode_transition();

      const unsigned mode = static_cast<unsigned>(std::max(0, active_mode));
      const auto& profile = ember_parity_profile(mode);
      const float drive = clamp01(value[1]);
      const float tone_hz = std::clamp(value[2], 200.F, 18000.F);
      const float heat = clamp01(value[3]);
      const float character = clamp01(value[4]);
      const float dynamics = clamp01(value[5]);
      const float mix = clamp01(value[6]);
      const float tone_norm = (tone_hz - 200.F) / 17800.F;

      float dry[2]{data[frame * 2], data[frame * 2 + 1]};
      float analog_input[2]{highpass_input(dry[0], 0), highpass_input(dry[1], 1)};
      if (profile.branch == EmberParityBranch::Tube) {
        const auto tube_index = std::min<std::size_t>(4U, static_cast<std::size_t>(mode - 7U));
        update_tube_shared(analog_input[0], analog_input[1], kEmberTubeElectricalProfiles[tube_index],
                           drive, heat, dynamics);
      }

      for (unsigned channel = 0; channel < 2; ++channel) {
        float wet = dry[channel];
        if (profile.branch == EmberParityBranch::DigitalCapture) {
          wet = digital(dry[channel], profile.digital_capture_mode, drive, tone_norm,
                        heat, character, dynamics, channel);
          // Saturation.ts intentionally uses linear routing for the digital-capture branch.
          const float processed = std::clamp(dry[channel] * (1.F - mix) + wet * mix, -1.2F, 1.2F);
          data[frame * 2 + channel] = dry[channel] + (processed - dry[channel]) * mode_mix;
          continue;
        }

        if (profile.branch == EmberParityBranch::Tube) {
          const auto tube_index = std::min<std::size_t>(4U, static_cast<std::size_t>(mode - 7U));
          wet = tube(analog_input[channel], kEmberTubeElectricalProfiles[tube_index],
                     drive, heat, character, dynamics, channel);
        } else if (profile.branch == EmberParityBranch::MagneticCore) {
          wet = magnetic(analog_input[channel], drive, heat, character, dynamics, channel);
        } else {
          wet = generic(analog_input[channel], mode, drive, heat, character);
        }

        wet = analog_post(wet, mode, profile, drive, tone_hz, heat, character, dynamics, channel);
        const float dry_gain = std::cos(mix * kPi * .5F);
        const float wet_gain = std::sin(mix * kPi * .5F);
        const float processed = std::clamp(dry[channel] * dry_gain + wet * wet_gain, -1.2F, 1.2F);
        data[frame * 2 + channel] = dry[channel] + (processed - dry[channel]) * mode_mix;
      }
    }
  }
};

EmberParityProcessor::EmberParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
EmberParityProcessor::~EmberParityProcessor() = default;
void EmberParityProcessor::process(float* data, std::size_t frames) noexcept { impl_->process(data, frames); }
bool EmberParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  std::size_t index = 99;
  if (name == "mode") index = 0; else if (name == "drive") index = 1; else if (name == "tone") index = 2;
  else if (name == "heat") index = 3; else if (name == "character") index = 4;
  else if (name == "dynamics") index = 5; else if (name == "mix") index = 6;
  if (index >= 7) return false;
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}
void EmberParityProcessor::reset() noexcept {
  impl_->input_hp_in = {}; impl_->input_hp_out = {};
  impl_->tone = {}; impl_->presence = {}; impl_->compressor_envelope = {}; impl_->compressor_gain = {1.F, 1.F};
  impl_->dc_in = {}; impl_->dc_out = {}; impl_->magnetic_memory = {}; impl_->digital_previous = {};
  impl_->hold_count = {}; impl_->held = {};
  impl_->tube_previous_input = {}; impl_->tube_bias_memory = {}; impl_->tube_cathode_memory = {};
  impl_->tube_blocking_memory = {}; impl_->tube_output_memory = {}; impl_->tube_plate_charge = {};
  impl_->tube_supply_demand = 0.F; impl_->tube_supply_sag = 0.F; impl_->tube_thermal_state = 0.F;
  impl_->active_mode = -1; impl_->pending_mode = 0U; impl_->mode_mix = 1.F; impl_->mode_transition = 0U;
}

}  // namespace calcotone