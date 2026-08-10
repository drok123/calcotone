#include "calcotone/drift_classic_processor.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace calcotone {
namespace {
constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kTwoPi = kPi * 2.0;
constexpr std::size_t kTanhTableSize = 4097U;
constexpr double kTanhRange = 5.0;
constexpr int kLeslieControlPeriod = 32;

double clamp01(double value) noexcept {
  return std::clamp(std::isfinite(value) ? value : 0.0, 0.0, 1.0);
}

const std::array<double, kTanhTableSize>& tanh_table() noexcept {
  static const auto table = [] {
    std::array<double, kTanhTableSize> result{};
    for (std::size_t index = 0; index < result.size(); ++index) {
      const double normalized = static_cast<double>(index)
          / static_cast<double>(result.size() - 1U);
      result[index] = std::tanh(normalized * (kTanhRange * 2.0) - kTanhRange);
    }
    return result;
  }();
  return table;
}

double fast_tanh(double value) noexcept {
  if (value <= -kTanhRange) return -1.0;
  if (value >= kTanhRange) return 1.0;
  const auto& table = tanh_table();
  const double position = (value + kTanhRange)
      * (static_cast<double>(kTanhTableSize - 1U) / (kTanhRange * 2.0));
  const auto first = static_cast<std::size_t>(position);
  const auto second = std::min(first + 1U, kTanhTableSize - 1U);
  const double fraction = position - static_cast<double>(first);
  return table[first] + (table[second] - table[first]) * fraction;
}

struct AllpassState {
  double x1{};
  double y1{};
};
}  // namespace

struct DriftClassicProcessor::Impl {
  explicit Impl(float requested_rate)
      : sample_rate(std::clamp(static_cast<double>(requested_rate), 8'000.0, 384'000.0)) {
    (void)tanh_table();
    reset();
  }

  void reset() noexcept {
    phase = 0.0;
    phase_b = kPi * .5;
    phase_state_l = {};
    phase_state_r = {};
    phase_feedback_l = 0.0;
    phase_feedback_r = 0.0;
    schulte_feedback_l = 0.0;
    schulte_feedback_r = 0.0;
    phase_coefficients_l = {};
    phase_coefficients_r = {};
    coefficient_countdown = 0;
    coefficient_model = -1;
    vibe_target_l = .5;
    vibe_target_r = .5;
    lamp = .5;
    lamp_r = .5;
    rotor_horn_speed = 0.0;
    rotor_drum_speed = 0.0;
    rotor_horn_phase = 0.0;
    rotor_drum_phase = kPi * .37;
    rotor_low_l = 0.0;
    rotor_low_r = 0.0;
    leslie_control_countdown = 0;
    leslie_crossover = 0.0;
    leslie_horn_delay = 0.0;
    leslie_drum_delay = 0.0;
    leslie_horn_mix = .46;
    delay_l.fill(0.F);
    delay_r.fill(0.F);
    delay_index = 0;
    pan_position = 0.0;
  }

  void set_model(unsigned requested) noexcept {
    const unsigned next = std::min(requested, 8U);
    if (next == model) return;
    model = next;
    reset();
  }

  double coefficient(double frequency) const noexcept {
    const double safe = std::clamp(frequency, 35.0, sample_rate * .42);
    const double k = std::tan(kPi * safe / sample_rate);
    return (1.0 - k) / (1.0 + k);
  }

  static double allpass(double input, double coefficient_value, AllpassState& state) noexcept {
    const double output = -coefficient_value * input + state.x1 + coefficient_value * state.y1;
    state.x1 = input;
    state.y1 = output;
    return output;
  }

  void update_cascade_coefficients(double center, unsigned count, unsigned offset,
                                   double spread, std::array<double, 12>& destination) const noexcept {
    const double base = 1.44 + spread * .16;
    const double midpoint = static_cast<double>(count - 1U) * .5;
    for (unsigned i = 0; i < count; ++i) {
      const double ratio = std::pow(base, static_cast<double>(i) - midpoint);
      destination[offset + i] = coefficient(center * ratio);
    }
  }

  static double cascade(double input, unsigned count, std::array<AllpassState, 12>& states,
                        unsigned offset, const std::array<double, 12>& coefficients) noexcept {
    double value = input;
    for (unsigned i = 0; i < count; ++i)
      value = allpass(value, coefficients[offset + i], states[offset + i]);
    return value;
  }

  static double normalized_soft_clip(double input, double drive) noexcept {
    return fast_tanh(input * drive) / std::max(1e-6, drive);
  }

  bool should_refresh_coefficients(int requested_model) noexcept {
    if (coefficient_model != requested_model || coefficient_countdown <= 0) {
      coefficient_model = requested_model;
      coefficient_countdown = 7;
      return true;
    }
    --coefficient_countdown;
    return false;
  }

  std::array<float, 2> process_biphase(double left, double right, double rate, double depth,
                                       double shape, double spread, double motion) noexcept {
    const double speed = .045 + rate * 1.95;
    phase += kTwoPi * speed / sample_rate;
    phase_b += kTwoPi * speed * (.61 + motion * .52) / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    if (phase_b > kTwoPi) phase_b -= kTwoPi;

    if (should_refresh_coefficients(1)) {
      const double sweep_a = .5 + .5 * std::sin(phase);
      const double sweep_b = .5 + .5 * std::sin(phase_b + spread * kPi);
      const double center_a = 170.0 + std::pow(sweep_a, 1.25) * (1050.0 + depth * 1800.0);
      const double center_b = 230.0 + std::pow(sweep_b, 1.15) * (1250.0 + depth * 2200.0);
      update_cascade_coefficients(center_a, 6, 0, spread, phase_coefficients_l);
      update_cascade_coefficients(center_a * 1.012, 6, 0, spread, phase_coefficients_r);
      update_cascade_coefficients(center_b, 6, 6, 1.0 - spread, phase_coefficients_l);
      update_cascade_coefficients(center_b * .988, 6, 6, 1.0 - spread, phase_coefficients_r);
    }

    const double feedback = .08 + shape * .56;
    const double input_l = left + phase_feedback_l * feedback;
    const double input_r = right + phase_feedback_r * feedback;
    const double a_l = cascade(input_l, 6, phase_state_l, 0, phase_coefficients_l);
    const double a_r = cascade(input_r, 6, phase_state_r, 0, phase_coefficients_r);
    const double b_l = cascade(a_l, 6, phase_state_l, 6, phase_coefficients_l);
    const double b_r = cascade(a_r, 6, phase_state_r, 6, phase_coefficients_r);
    phase_feedback_l = b_l;
    phase_feedback_r = b_r;
    return {static_cast<float>(b_l), static_cast<float>(b_r)};
  }

  std::array<float, 2> process_small_stone(double left, double right, double rate, double depth,
                                           double shape, double spread, double motion) noexcept {
    const double speed = .035 + rate * 1.55;
    phase += kTwoPi * speed / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    if (should_refresh_coefficients(2)) {
      const double sweep_l = .5 + .5 * std::sin(phase);
      const double sweep_r = .5 + .5 * std::sin(phase + spread * .65);
      const double center_l = 150.0 + std::pow(sweep_l, 1.45) * (900.0 + depth * 2100.0);
      const double center_r = 150.0 + std::pow(sweep_r, 1.45) * (900.0 + depth * 2100.0);
      update_cascade_coefficients(center_l, 4, 0, motion, phase_coefficients_l);
      update_cascade_coefficients(center_r, 4, 0, motion, phase_coefficients_r);
    }
    const double feedback = .05 + shape * .67;
    const double x_l = left + phase_feedback_l * feedback;
    const double x_r = right + phase_feedback_r * feedback;
    const double p_l = cascade(x_l, 4, phase_state_l, 0, phase_coefficients_l);
    const double p_r = cascade(x_r, 4, phase_state_r, 0, phase_coefficients_r);
    phase_feedback_l = p_l;
    phase_feedback_r = p_r;
    return {static_cast<float>(p_l), static_cast<float>(p_r)};
  }

  std::array<float, 2> process_univibe(double left, double right, double rate, double depth,
                                       double shape, double spread, double motion) noexcept {
    const double speed = .08 + rate * 2.25;
    phase += kTwoPi * speed / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    if (should_refresh_coefficients(3)) {
      vibe_target_l = .5 + .5 * std::sin(phase);
      vibe_target_r = .5 + .5 * std::sin(phase + spread * .38);
    }
    const double rise = .0012 + motion * .0038;
    const double fall = .00038 + (1.0 - motion) * .0011;
    lamp += (vibe_target_l - lamp) * (vibe_target_l > lamp ? rise : fall);
    lamp_r += (vibe_target_r - lamp_r) * (vibe_target_r > lamp_r ? rise : fall);
    if (coefficient_countdown == 7) {
      const double center_l = 180.0 + std::pow(lamp, 1.7) * (1200.0 + depth * 2200.0);
      const double center_r = 180.0 + std::pow(lamp_r, 1.7) * (1200.0 + depth * 2200.0);
      update_cascade_coefficients(center_l, 4, 0, shape, phase_coefficients_l);
      update_cascade_coefficients(center_r, 4, 0, shape, phase_coefficients_r);
    }
    const double vibe_l = cascade(left, 4, phase_state_l, 0, phase_coefficients_l);
    const double vibe_r = cascade(right, 4, phase_state_r, 0, phase_coefficients_r);
    const double trem_l = .86 + lamp * (.08 + shape * .09);
    const double trem_r = .86 + lamp_r * (.08 + shape * .09);
    return {static_cast<float>(vibe_l * trem_l), static_cast<float>(vibe_r * trem_r)};
  }

  float read_delay(const std::array<float, 2048>& buffer, double delay_samples) const noexcept {
    double position = static_cast<double>(delay_index) - delay_samples;
    if (position < 0.0) position += static_cast<double>(buffer.size());
    const auto base = static_cast<std::size_t>(position);
    auto next = base + 1U;
    if (next == buffer.size()) next = 0U;
    const double fraction = position - static_cast<double>(base);
    return static_cast<float>(buffer[base] + (buffer[next] - buffer[base]) * fraction);
  }

  void refresh_leslie_control(double depth, double shape, double spread) noexcept {
    leslie_crossover = 1.0 - std::exp(-kTwoPi * (650.0 + shape * 500.0) / sample_rate);
    leslie_horn_delay = (.00015 + depth * .00055) * sample_rate;
    leslie_drum_delay = (.00008 + depth * .00024) * sample_rate;
    leslie_horn_mix = .46 + shape * .22;

    const std::array<double, 4> offsets{
      kPi * (.65 + spread * .32),
      kPi * (.55 + spread * .22),
      kPi * (.72 + spread * .25),
      kPi * (.58 + spread * .20),
    };
    for (std::size_t index = 0; index < offsets.size(); ++index) {
      leslie_offset_sine[index] = std::sin(offsets[index]);
      leslie_offset_cosine[index] = std::cos(offsets[index]);
    }
  }

  std::array<float, 2> process_leslie(double left, double right, double rate, double depth,
                                      double shape, double spread, double motion) noexcept {
    if (leslie_control_countdown <= 0) {
      refresh_leslie_control(depth, shape, spread);
      leslie_control_countdown = kLeslieControlPeriod - 1;
    } else {
      --leslie_control_countdown;
    }

    delay_l[delay_index] = static_cast<float>(left);
    delay_r[delay_index] = static_cast<float>(right);
    const bool fast = rate > .52;
    const double horn_target = fast ? 5.7 + rate * 1.3 : .55 + rate * 1.1;
    const double drum_target = fast ? 4.2 + rate * .8 : .42 + rate * .75;
    const double horn_accel = horn_target > rotor_horn_speed
        ? .000075 + motion * .00012 : .000022 + motion * .000035;
    const double drum_accel = drum_target > rotor_drum_speed
        ? .000028 + motion * .00005 : .000010 + motion * .000018;
    rotor_horn_speed += (horn_target - rotor_horn_speed) * horn_accel;
    rotor_drum_speed += (drum_target - rotor_drum_speed) * drum_accel;
    rotor_horn_phase += kTwoPi * rotor_horn_speed / sample_rate;
    rotor_drum_phase += kTwoPi * rotor_drum_speed / sample_rate;
    if (rotor_horn_phase > kTwoPi) rotor_horn_phase -= kTwoPi;
    if (rotor_drum_phase > kTwoPi) rotor_drum_phase -= kTwoPi;

    rotor_low_l += (left - rotor_low_l) * leslie_crossover;
    rotor_low_r += (right - rotor_low_r) * leslie_crossover;
    const double low_l = rotor_low_l;
    const double low_r = rotor_low_r;
    const double high_l = left - low_l;
    const double high_r = right - low_r;

    const double horn_sine = std::sin(rotor_horn_phase);
    const double horn_cosine = std::cos(rotor_horn_phase);
    const double drum_sine = std::sin(rotor_drum_phase);
    const double drum_cosine = std::cos(rotor_drum_phase);
    const auto shifted = [](double sine, double cosine, double offset_sine, double offset_cosine) noexcept {
      return sine * offset_cosine + cosine * offset_sine;
    };
    const double horn_mod_r = shifted(
        horn_sine, horn_cosine, leslie_offset_sine[0], leslie_offset_cosine[0]);
    const double drum_mod_r = shifted(
        drum_sine, drum_cosine, leslie_offset_sine[1], leslie_offset_cosine[1]);
    const double horn_amp_r_wave = shifted(
        horn_sine, horn_cosine, leslie_offset_sine[2], leslie_offset_cosine[2]);
    const double drum_amp_r_wave = shifted(
        drum_sine, drum_cosine, leslie_offset_sine[3], leslie_offset_cosine[3]);

    const double h_mod_l = (.5 + .5 * horn_sine) * leslie_horn_delay;
    const double h_mod_r = (.5 + .5 * horn_mod_r) * leslie_horn_delay;
    const double d_mod_l = (.5 + .5 * drum_sine) * leslie_drum_delay;
    const double d_mod_r = (.5 + .5 * drum_mod_r) * leslie_drum_delay;
    const double delayed_h_l = read_delay(delay_l, h_mod_l);
    const double delayed_h_r = read_delay(delay_r, h_mod_r);
    const double delayed_d_l = read_delay(delay_l, d_mod_l);
    const double delayed_d_r = read_delay(delay_r, d_mod_r);
    const double horn_amp_l = .70 + .30 * horn_sine;
    const double horn_amp_r = .70 + .30 * horn_amp_r_wave;
    const double drum_amp_l = .82 + .18 * drum_sine;
    const double drum_amp_r = .82 + .18 * drum_amp_r_wave;
    const double output_l = low_l * (1.0 - leslie_horn_mix) * drum_amp_l + delayed_d_l * .12
        + high_l * leslie_horn_mix * horn_amp_l + delayed_h_l * .18;
    const double output_r = low_r * (1.0 - leslie_horn_mix) * drum_amp_r + delayed_d_r * .12
        + high_r * leslie_horn_mix * horn_amp_r + delayed_h_r * .18;
    if (++delay_index == delay_l.size()) delay_index = 0U;
    return {static_cast<float>(output_l), static_cast<float>(output_r)};
  }

  std::array<float, 2> process_phase90(double left, double right, double rate, double depth,
                                       double shape, double spread, double motion) noexcept {
    const double speed = .055 + rate * 1.72;
    phase += kTwoPi * speed / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    if (should_refresh_coefficients(5)) {
      const double phase_offset = spread * .34;
      const double sweep_l = .5 + .5 * std::sin(phase);
      const double sweep_r = .5 + .5 * std::sin(phase + phase_offset);
      const double range = 7.4 + depth * 8.6;
      const double center_l = 115.0 * std::pow(range, std::pow(sweep_l, 1.12));
      const double center_r = 115.0 * std::pow(range, std::pow(sweep_r, 1.12));
      update_cascade_coefficients(center_l, 4, 0, .32 + motion * .18, phase_coefficients_l);
      update_cascade_coefficients(center_r * (.994 + motion * .012), 4, 0,
                                  .32 + motion * .18, phase_coefficients_r);
    }
    const double feedback = shape < .5 ? shape * .20 : .10 + (shape - .5) * .82;
    const double drive = 1.02 + shape * .72 + motion * .12;
    const double input_l = normalized_soft_clip(left + phase_feedback_l * feedback, drive);
    const double input_r = normalized_soft_clip(right + phase_feedback_r * feedback, drive * 1.006);
    const double phase_l = cascade(input_l, 4, phase_state_l, 0, phase_coefficients_l);
    const double phase_r = cascade(input_r, 4, phase_state_r, 0, phase_coefficients_r);
    phase_feedback_l = phase_l;
    phase_feedback_r = phase_r;
    return {static_cast<float>(phase_l), static_cast<float>(phase_r)};
  }

  std::array<float, 2> process_instant_phaser(double left, double right, double rate, double depth,
                                              double shape, double spread, double motion) noexcept {
    const double speed = .028 + rate * 1.34;
    phase += kTwoPi * speed / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    if (should_refresh_coefficients(6)) {
      const double sweep = .5 + .5 * std::sin(phase);
      const double age = motion * motion;
      const double center = 92.0 + std::pow(sweep, 1.18 + age * .28) * (1450.0 + depth * 4150.0);
      update_cascade_coefficients(center, 8, 0, .42 + age * .24, phase_coefficients_l);
      update_cascade_coefficients(center * (.986 + age * .024), 8, 0,
                                  .42 + age * .24, phase_coefficients_r);
    }
    const double feedback = .025 + shape * .54;
    const double drive = 1.015 + motion * .44;
    double phase_l = normalized_soft_clip(left + phase_feedback_l * feedback, drive);
    double phase_r = normalized_soft_clip(right + phase_feedback_r * feedback, drive * 1.004);
    double aux_l = phase_l;
    double aux_r = phase_r;
    for (unsigned stage = 0; stage < 8; ++stage) {
      phase_l = allpass(phase_l, phase_coefficients_l[stage], phase_state_l[stage]);
      phase_r = allpass(phase_r, phase_coefficients_r[stage], phase_state_r[stage]);
      if (stage == 5) {
        aux_l = phase_l;
        aux_r = phase_r;
      }
    }
    phase_feedback_l = phase_l;
    phase_feedback_r = phase_r;
    if (spread <= .5) {
      const double deep = spread * 2.0;
      return {static_cast<float>(aux_l + (phase_l - aux_l) * deep),
              static_cast<float>(aux_r + (phase_r - aux_r) * deep)};
    }
    const double wide = (spread - .5) * 2.0;
    return {static_cast<float>(phase_l), static_cast<float>(phase_r + (aux_r - phase_r) * wide)};
  }

  std::array<float, 2> process_schulte(double left, double right, double rate, double depth,
                                       double shape, double spread, double motion) noexcept {
    const double speed = .018 + rate * 1.08;
    phase += kTwoPi * speed / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    if (should_refresh_coefficients(7)) {
      const double target_l = .5 + .5 * std::sin(phase);
      const double target_r = .5 + .5 * std::sin(phase + spread * .28);
      const double rise = .0062 - motion * .0041;
      const double fall = .0018 - motion * .0011;
      lamp += (target_l - lamp) * (target_l > lamp ? rise : fall);
      lamp_r += (target_r - lamp_r) * (target_r > lamp_r ? rise * .982 : fall * 1.026);
      const double center_l = 82.0 + std::pow(lamp, 1.82 + motion * .34) * (1850.0 + depth * 4200.0);
      const double center_r = 82.0 + std::pow(lamp_r, 1.82 + motion * .34) * (1850.0 + depth * 4200.0);
      update_cascade_coefficients(center_l, 8, 0, .58 + motion * .18, phase_coefficients_l);
      update_cascade_coefficients(center_r, 8, 0, .58 + motion * .18, phase_coefficients_r);
    }
    const double feedback = .08 + shape * .52;
    const double input_l = left - schulte_feedback_l * feedback;
    const double input_r = right - schulte_feedback_r * feedback;
    const double phase_l = cascade(input_l, 8, phase_state_l, 0, phase_coefficients_l);
    const double phase_r = cascade(input_r, 8, phase_state_r, 0, phase_coefficients_r);
    const double feedback_pole = .018 + (1.0 - motion) * .026;
    schulte_feedback_l += (phase_l - schulte_feedback_l) * feedback_pole;
    schulte_feedback_r += (phase_r - schulte_feedback_r) * feedback_pole;
    return {static_cast<float>(phase_l * .96), static_cast<float>(phase_r * .96)};
  }

  std::array<float, 2> process_pn2(double left, double right, double rate, double depth,
                                   double shape, double spread, double motion) noexcept {
    const double speed = .06 + rate * 7.4;
    phase += kTwoPi * speed / sample_rate;
    if (phase > kTwoPi) phase -= kTwoPi;
    const double cycle = phase / kTwoPi;
    const double triangle = 1.0 - 4.0 * std::abs(cycle - .5);
    const double square = triangle >= 0.0 ? 1.0 : -1.0;
    const double square_blend = std::max(0.0, (shape - .36) / .64);
    const double target = triangle + (square - triangle) * square_blend;
    const double slew = .0025 + motion * motion * .095;
    pan_position += (target - pan_position) * slew;
    const double pan = pan_position * (.08 + depth * .92);
    const double angle = (pan + 1.0) * kPi * .25;
    const double gain_l = std::cos(angle) * std::sqrt(2.0);
    const double gain_r = std::sin(angle) * std::sqrt(2.0);
    const double mid = (left + right) * .5;
    const double side = (left - right) * .5 * spread;
    return {static_cast<float>((mid + side) * gain_l),
            static_cast<float>((mid - side) * gain_r)};
  }

  std::array<float, 2> process_sample(float left, float right, float rate_value, float depth_value,
                                      float shape_value, float spread_value, float motion_value) noexcept {
    const double input_l = std::isfinite(left) ? left : 0.0;
    const double input_r = std::isfinite(right) ? right : input_l;
    const double rate = clamp01(rate_value);
    const double depth = clamp01(depth_value);
    const double shape = clamp01(shape_value);
    const double spread = clamp01(spread_value);
    const double motion = clamp01(motion_value);
    std::array<float, 2> output{};
    switch (model) {
      case 1: output = process_biphase(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 2: output = process_small_stone(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 3: output = process_univibe(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 4: output = process_leslie(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 5: output = process_phase90(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 6: output = process_instant_phaser(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 7: output = process_schulte(input_l, input_r, rate, depth, shape, spread, motion); break;
      case 8: output = process_pn2(input_l, input_r, rate, depth, shape, spread, motion); break;
      default: output = {static_cast<float>(input_l), static_cast<float>(input_r)}; break;
    }
    output[0] = std::clamp(output[0], -1.2F, 1.2F);
    output[1] = std::clamp(output[1], -1.2F, 1.2F);
    return output;
  }

  double sample_rate;
  unsigned model{};
  double phase{};
  double phase_b{};
  std::array<AllpassState, 12> phase_state_l{};
  std::array<AllpassState, 12> phase_state_r{};
  double phase_feedback_l{};
  double phase_feedback_r{};
  double schulte_feedback_l{};
  double schulte_feedback_r{};
  std::array<double, 12> phase_coefficients_l{};
  std::array<double, 12> phase_coefficients_r{};
  int coefficient_countdown{};
  int coefficient_model{-1};
  double vibe_target_l{.5};
  double vibe_target_r{.5};
  double lamp{.5};
  double lamp_r{.5};
  double rotor_horn_speed{};
  double rotor_drum_speed{};
  double rotor_horn_phase{};
  double rotor_drum_phase{kPi * .37};
  double rotor_low_l{};
  double rotor_low_r{};
  int leslie_control_countdown{};
  double leslie_crossover{};
  double leslie_horn_delay{};
  double leslie_drum_delay{};
  double leslie_horn_mix{.46};
  std::array<double, 4> leslie_offset_sine{};
  std::array<double, 4> leslie_offset_cosine{1.0,1.0,1.0,1.0};
  std::array<float, 2048> delay_l{};
  std::array<float, 2048> delay_r{};
  std::size_t delay_index{};
  double pan_position{};
};

DriftClassicProcessor::DriftClassicProcessor(float sample_rate)
    : impl_(std::make_unique<Impl>(sample_rate)) {}
DriftClassicProcessor::~DriftClassicProcessor() = default;
void DriftClassicProcessor::reset() noexcept { impl_->reset(); }
void DriftClassicProcessor::set_model(unsigned model) noexcept { impl_->set_model(model); }
std::array<float, 2> DriftClassicProcessor::process_sample(
    float left, float right, float rate, float depth, float shape, float spread, float motion) noexcept {
  return impl_->process_sample(left, right, rate, depth, shape, spread, motion);
}

}  // namespace calcotone
