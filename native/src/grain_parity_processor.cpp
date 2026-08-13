#include "calcotone/grain_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::array<float, 12> kDryAnchors{
    .38F,.24F,.16F,.28F,.18F,.10F,.14F,.18F,.22F,.16F,.20F,.18F};
constexpr std::array<float, 12> kWetGains{
    1.18F,1.30F,1.32F,1.20F,1.F,1.F,1.18F,1.12F,1.17F,1.16F,1.22F,1.18F};
constexpr std::array<float, 10> kSliceIntervals{0.F,0.F,2.F,-2.F,5.F,-5.F,7.F,-7.F,12.F,-12.F};
constexpr std::array<std::array<float, 5>, 5> kPrismIntervals{{
    {0.F,0.F,7.F,-5.F,0.F},
    {0.F,4.F,7.F,-12.F,0.F},
    {0.F,3.F,7.F,12.F,0.F},
    {0.F,5.F,7.F,12.F,-12.F},
    {0.F,7.F,12.F,19.F,-12.F},
}};
constexpr std::array<std::size_t, 5> kPrismCounts{4U,4U,4U,5U,5U};
constexpr std::array<float, 8> kBeadsClockSteps{3.F,4.F,6.F,8.F,10.F,12.F,14.F,16.F};
constexpr std::array<float, 8> kMorphageneIntervals{0.F,0.F,7.F,-5.F,12.F,-12.F,19.F,-19.F};
constexpr std::array<float, 8> kMicrocosmDivisions{32.F,24.F,16.F,12.F,8.F,6.F,4.F,2.F};
constexpr std::array<std::array<unsigned, 8>, 4> kMicrocosmVariationPatterns{{
    {0U,1U,3U,2U,5U,3U,7U,4U},
    {0U,2U,1U,4U,3U,7U,5U,6U},
    {0U,0U,4U,1U,6U,2U,7U,3U},
    {0U,3U,6U,1U,4U,7U,2U,5U},
}};
constexpr std::array<std::array<float, 4>, 5> kMicrocosmIntervals{{
    {0.F,0.F,0.F,0.F},
    {0.F,7.F,0.F,0.F},
    {0.F,7.F,12.F,0.F},
    {0.F,5.F,7.F,12.F},
    {0.F,7.F,12.F,19.F},
}};
constexpr std::array<std::size_t, 5> kMicrocosmCounts{1U,2U,3U,4U,4U};
constexpr std::array<float, 11> kMicrocosmRateScales{1.F,1.F,.88F,2.05F,.48F,2.2F,1.16F,.82F,1.72F,1.F,.66F};
constexpr std::array<float, 11> kMicrocosmFeedbackCeilings{.34F,.32F,.28F,.42F,.48F,.26F,.18F,.16F,.28F,.38F,.44F};
constexpr std::array<float, 11> kMicrocosmDryAnchors{.18F,.20F,.18F,.10F,.12F,.22F,.18F,.08F,.18F,.16F,.12F};
constexpr std::array<float, 11> kMicrocosmWetGains{1.18F,1.14F,1.16F,1.28F,1.24F,1.12F,1.16F,1.22F,1.18F,1.20F,1.26F};

float clamp01(float value) noexcept { return std::clamp(value, 0.F, 1.F); }
float smoothing_coefficient(float seconds, float rate) noexcept {
  return 1.F - std::exp(-1.F / std::max(1.F, seconds * rate));
}
std::size_t next_power_of_two(std::size_t value) noexcept {
  std::size_t result = 1U;
  while (result < value) result <<= 1U;
  return result;
}
float semitone_step(float semitones) noexcept { return std::pow(2.F, semitones / 12.F); }
}  // namespace

struct GrainParityProcessor::Impl {
  struct Voice {
    bool active{};
    float phase{};
    float length{};
    float read{};
    float step{1.F};
    float step_delta{};
    float gain{};
    float pan{};
    float pan_drift{};
    float tone{};
    float last_left{};
    float last_right{};
  };

  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        buffer_size(next_power_of_two(std::max<std::size_t>(32'768U,
            static_cast<std::size_t>(std::ceil(rate * 4.F))))),
        mask(buffer_size - 1U),
        left(buffer_size, 0.F),
        right(buffer_size, 0.F) {}

  float random() noexcept {
    std::uint32_t x = random_state;
    x ^= x << 13U;
    x ^= x >> 17U;
    x ^= x << 5U;
    random_state = x;
    return static_cast<float>(x) / 4'294'967'296.F;
  }

  float interpolate(const std::vector<float>& buffer, float position) const noexcept {
    const auto base_signed = static_cast<std::int64_t>(std::floor(position));
    const float fraction = position - std::floor(position);
    const auto at = [&](std::int64_t offset) noexcept {
      const auto index = static_cast<std::size_t>(base_signed + offset) & mask;
      return buffer[index];
    };
    const float xm1 = at(-1);
    const float x0 = at(0);
    const float x1 = at(1);
    const float x2 = at(2);
    const float c0 = x0;
    const float c1 = .5F * (x1 - xm1);
    const float c2 = xm1 - 2.5F * x0 + 2.F * x1 - .5F * x2;
    const float c3 = .5F * (x2 - xm1) + 1.5F * (x0 - x1);
    return ((c3 * fraction + c2) * fraction + c1) * fraction + c0;
  }

  float wrap(float position) const noexcept {
    const float size = static_cast<float>(buffer_size);
    while (position < 0.F) position += size;
    while (position >= size) position -= size;
    return position;
  }

  void clear_runtime() noexcept {
    std::fill(left.begin(), left.end(), 0.F);
    std::fill(right.begin(), right.end(), 0.F);
    for (auto& voice : voices) voice = {};
    write_index = 0U;
    written_samples = 0U;
    spawn_counter = 0;
    spawn_sequence = 0U;
    random_state = 0x6d2b79f5U;
    output_left = output_right = 0.F;
    smear_left = smear_right = 0.F;
    hardware_left = hardware_right = 0.F;
    hardware_aux_left = hardware_aux_right = 0.F;
    input_envelope = previous_envelope = 0.F;
    input_energy = wet_energy = 1e-5F;
    makeup_gain = 1.F;
    previous_mode = -1;
    previous_microcosm_program = -1;
    slice_start = 0U;
    slice_length = 2048U;
    slice_phase = 0.F;
    slice_step = 1.F;
    slice_refresh_counter = 0U;
    slice_ready = false;
    freeze_start = 0U;
    freeze_length = 8192U;
    freeze_phase = 0.F;
    freeze_step = 1.F;
    freeze_refresh_counter = 0U;
    freeze_ready = false;
  }

  void reset() noexcept {
    for (std::size_t index = 0; index < smooth.size(); ++index)
      smooth[index] = target[index].load(std::memory_order_relaxed);
    clear_runtime();
  }

  void reset_mode_state(unsigned mode, float window, float density, float pitch, float motion) noexcept {
    if (previous_mode == static_cast<int>(mode)) return;
    previous_mode = static_cast<int>(mode);
    spawn_counter = 0;
    hardware_left = hardware_right = 0.F;
    hardware_aux_left = hardware_aux_right = 0.F;
    for (auto& voice : voices) voice.active = false;
    if (mode == 4U) {
      slice_ready = false;
      slice_ready = capture_slice(window, density, pitch, motion);
    }
    if (mode == 5U) {
      freeze_ready = false;
      freeze_ready = capture_freeze(window, density, pitch);
    }
  }

  void reset_microcosm_program(unsigned program) noexcept {
    if (previous_microcosm_program == static_cast<int>(program)) return;
    previous_microcosm_program = static_cast<int>(program);
    spawn_counter = 0;
    spawn_sequence = 0U;
  }

  bool capture_slice(float window, float density, float pitch, float motion) noexcept {
    const float milliseconds = 24.F + window * 210.F + (1.F - density) * 72.F;
    const auto desired_length = std::max<std::size_t>(128U,
        static_cast<std::size_t>(std::floor(rate * milliseconds / 1000.F)));
    const auto available = std::min(written_samples, buffer_size - 1U);
    if (available < 256U) return false;
    const auto desired_history = static_cast<std::size_t>(std::floor(rate * (.025F + motion * .24F)));
    const auto history = std::min(desired_history, available > 128U ? available - 128U : 0U);
    slice_length = std::max<std::size_t>(128U,
        std::min(desired_length, available > history ? available - history : 128U));
    slice_start = (write_index + buffer_size - history - slice_length) & mask;
    const auto range = std::max<std::size_t>(2U,
        std::min(kSliceIntervals.size(), 2U + static_cast<std::size_t>(std::floor(pitch * (kSliceIntervals.size() - 2U)))));
    slice_step = semitone_step(kSliceIntervals[spawn_sequence % range]);
    slice_phase = 0.F;
    slice_refresh_counter = 0U;
    ++spawn_sequence;
    return true;
  }

  std::array<float, 2> process_slice(float window, float density, float pitch,
                                      float motion, float memory) noexcept {
    const auto repeats = 2U + static_cast<unsigned>(std::floor(memory * 14.F));
    const auto refresh_at = slice_length * repeats;
    if (slice_refresh_counter >= refresh_at)
      slice_ready = capture_slice(window, density, pitch, motion);
    const float phase = std::fmod(slice_phase, static_cast<float>(slice_length));
    const float tightness = .48F + (1.F - density) * .86F;
    const float edge = std::max(16.F, std::min(static_cast<float>(slice_length) * .16F * tightness,
                                               rate * .008F * tightness));
    const float fade_in = std::min(1.F, phase / edge);
    const float fade_out = std::min(1.F, (static_cast<float>(slice_length) - phase) / edge);
    const float envelope = std::sin(std::min(fade_in, fade_out) * kPi * .5F);
    const float read = wrap(static_cast<float>(slice_start) + phase);
    const std::array<float, 2> result{
        interpolate(left, read) * envelope,
        interpolate(right, read) * envelope};
    slice_phase += slice_step;
    while (slice_phase >= static_cast<float>(slice_length)) slice_phase -= static_cast<float>(slice_length);
    ++slice_refresh_counter;
    return result;
  }

  bool capture_freeze(float window, float density, float pitch) noexcept {
    const float milliseconds = 120.F + window * 640.F + (1.F - density) * 240.F;
    const auto desired_length = std::max<std::size_t>(512U,
        static_cast<std::size_t>(std::floor(rate * milliseconds / 1000.F)));
    const auto available = std::min(written_samples, buffer_size - 1U);
    if (available < desired_length + 96U) return false;
    freeze_length = desired_length;
    freeze_start = (write_index + buffer_size - freeze_length - 96U) & mask;
    const float semitones = pitch <= .005F ? 0.F
        : (spawn_sequence % 2U == 0U ? 1.F : -1.F) * std::round(pitch * 12.F);
    freeze_step = semitone_step(semitones);
    freeze_phase = 0.F;
    freeze_refresh_counter = 0U;
    ++spawn_sequence;
    return true;
  }

  std::array<float, 2> process_freeze(float window, float density, float pitch,
                                       float motion, float memory, float transient) noexcept {
    const float hold_seconds = 1.4F + memory * 10.F;
    const auto refresh_samples = static_cast<std::size_t>(std::floor(rate * hold_seconds));
    const bool may_refresh = freeze_refresh_counter >= refresh_samples
        && (transient > .004F + (1.F - motion) * .012F
            || static_cast<float>(freeze_refresh_counter) > static_cast<float>(refresh_samples) * 2.5F);
    if (may_refresh) freeze_ready = capture_freeze(window, density, pitch);

    const float phase = std::fmod(freeze_phase, static_cast<float>(freeze_length));
    const float crossfade = std::max(64.F, std::min(static_cast<float>(freeze_length) * (.10F + density * .15F),
                                                    rate * (.018F + density * .018F)));
    const float texture_offset = std::sin(phase * (.002F + density * .009F)) * density * 3.5F
        + std::sin(phase * (.0007F + motion * .0012F)) * motion * 1.1F;
    const float read_a = wrap(static_cast<float>(freeze_start) + phase + texture_offset);
    float result_left = interpolate(left, read_a);
    float result_right = interpolate(right, read_a);
    if (phase > static_cast<float>(freeze_length) - crossfade) {
      const float amount = (phase - (static_cast<float>(freeze_length) - crossfade)) / crossfade;
      const float read_b = wrap(static_cast<float>(freeze_start) + phase - static_cast<float>(freeze_length));
      const float curve = amount * amount * (3.F - 2.F * amount);
      result_left += (interpolate(left, read_b) - result_left) * curve;
      result_right += (interpolate(right, read_b) - result_right) * curve;
    }
    freeze_phase += freeze_step;
    while (freeze_phase >= static_cast<float>(freeze_length)) freeze_phase -= static_cast<float>(freeze_length);
    ++freeze_refresh_counter;
    return {result_left, result_right};
  }

  bool spawn_voice(unsigned mode, float window, float density, float pitch,
                   float motion, float memory, unsigned microcosm_program,
                   float tempo, unsigned variation) noexcept {
    auto found = std::find_if(voices.begin(), voices.begin() + effective_voice_limit,
                             [](const Voice& voice) { return !voice.active; });
    if (found == voices.begin() + effective_voice_limit) return false;

    float grain_ms = 42.F + window * 120.F;
    float history_seconds = .035F + random() * (.14F + motion * .28F);
    float semitones = 0.F;
    float reverse_chance = motion * .08F;
    float pan = (random() * 2.F - 1.F) * (.24F + density * .42F);
    float pan_drift = (random() * 2.F - 1.F) * motion * .14F;
    float gain = .48F + density * .18F;
    float tone = .34F + random() * .44F;
    float glide_semitones = 0.F;

    if (mode == 0U) {
      grain_ms = 36.F + window * 150.F + random() * 34.F;
      const float cell_seconds = .045F + window * .08F;
      const auto cell = 1U + static_cast<unsigned>(std::floor(random() * (3.F + density * 12.F)));
      history_seconds = cell_seconds * static_cast<float>(cell) * (.52F + memory * 1.1F);
      const int range = static_cast<int>(std::round(pitch * 7.F));
      semitones = range > 0 ? std::round((random() * 2.F - 1.F) * static_cast<float>(range)) : 0.F;
      reverse_chance = motion * .22F;
      gain = .52F + density * .16F;
    } else if (mode == 1U) {
      grain_ms = 18.F + window * 66.F + random() * 22.F;
      history_seconds = .018F + random() * (.06F + memory * .52F + motion * .22F);
      semitones = (random() * 2.F - 1.F) * pitch * 9.F;
      reverse_chance = .08F + motion * .38F;
      pan = (random() * 2.F - 1.F) * (.72F + density * .26F);
      pan_drift = (random() * 2.F - 1.F) * (.12F + motion * .32F);
      gain = .58F + density * .18F;
      tone = .42F + random() * .48F;
    } else if (mode == 2U) {
      grain_ms = 150.F + window * 520.F + random() * 90.F;
      history_seconds = .10F + random() * (.34F + memory * 1.28F + motion * .55F);
      semitones = (random() * 2.F - 1.F) * pitch * 1.8F;
      reverse_chance = 0.F;
      pan *= .46F;
      pan_drift *= .55F;
      gain = .34F + density * .12F;
      tone = .14F + random() * .24F;
    } else if (mode == 3U) {
      grain_ms = 58.F + window * 120.F + memory * 110.F + random() * 24.F;
      history_seconds = .032F + random() * (.08F + memory * .20F + motion * .12F);
      const auto set_index = std::min<std::size_t>(kPrismIntervals.size() - 1U,
          static_cast<std::size_t>(std::floor(pitch * static_cast<float>(kPrismIntervals.size()))));
      semitones = kPrismIntervals[set_index][spawn_sequence % kPrismCounts[set_index]]
          + (random() * 2.F - 1.F) * motion * .12F;
      reverse_chance = 0.F;
      pan = std::sin(static_cast<float>(spawn_sequence) * 2.399F) * (.58F + density * .36F);
      pan_drift = 0.F;
      gain = .46F + density * .14F;
      tone = .46F + random() * .40F;
    } else if (mode == 6U) {
      grain_ms = 32.F + window * 760.F + random() * 110.F;
      history_seconds = .04F + motion * 1.65F + random() * (.10F + motion * .72F);
      semitones = (random() * 2.F - 1.F) * pitch * 24.F;
      reverse_chance = motion * .16F;
      pan = (random() * 2.F - 1.F) * (.34F + density * .52F);
      pan_drift = (random() * 2.F - 1.F) * motion * .12F;
      gain = .30F + density * .14F;
      tone = .16F + (1.F - memory) * .42F + random() * .16F;
    } else if (mode == 7U) {
      grain_ms = 30.F + window * 1180.F + random() * motion * 180.F;
      const float clock_cell = .025F + window * .12F;
      const auto divisor = 2U + static_cast<unsigned>(std::floor(density * 7.F));
      const auto clock_step = std::max(1U, static_cast<unsigned>(spawn_sequence % divisor));
      history_seconds = clock_cell * static_cast<float>(clock_step) + random() * motion * .48F;
      semitones = (random() * 2.F - 1.F) * pitch * 24.F;
      reverse_chance = std::max(0.F, (window - .72F) * 1.6F) + motion * .08F;
      pan = std::sin(static_cast<float>(spawn_sequence) * 2.399F) * (.62F + density * .32F);
      pan_drift = (random() * 2.F - 1.F) * motion * .08F;
      gain = .34F + density * .14F;
      tone = .68F + random() * .28F;
    } else if (mode == 8U) {
      grain_ms = 40.F + window * 940.F;
      const float splice_seconds = .10F + window * .34F;
      const auto splice_count = 2U + static_cast<unsigned>(std::floor(memory * 10.F));
      const auto organized_splice = (spawn_sequence * 5U + static_cast<unsigned>(std::floor(motion * 7.F))) % splice_count;
      history_seconds = splice_seconds * static_cast<float>(1U + organized_splice)
          + (random() * 2.F - 1.F) * motion * splice_seconds;
      const auto reel_range = std::max<std::size_t>(2U, std::min(kMorphageneIntervals.size(),
          2U + static_cast<std::size_t>(std::floor(pitch * static_cast<float>(kMorphageneIntervals.size() - 2U)))));
      semitones = kMorphageneIntervals[spawn_sequence % reel_range];
      reverse_chance = motion * .34F;
      pan = std::sin(static_cast<float>(spawn_sequence) * 1.618F) * (.30F + density * .46F);
      pan_drift = (random() * 2.F - 1.F) * density * .10F;
      gain = .38F + density * .13F;
      tone = .36F + random() * .34F;
    } else if (mode == 9U) {
      grain_ms = 20.F + window * 1420.F + random() * 95.F;
      const auto layer = spawn_sequence % 6U;
      const float layer_span = .24F + memory * .34F;
      history_seconds = .05F + static_cast<float>(layer) * layer_span
          + (random() * 2.F - 1.F) * motion * layer_span;
      semitones = (random() * 2.F - 1.F) * pitch * 12.F;
      reverse_chance = .05F + motion * .45F;
      pan = static_cast<float>(layer) / 5.F * 1.8F - .9F;
      pan_drift = (random() * 2.F - 1.F) * motion * .20F;
      gain = .31F + density * .15F;
      tone = .42F + random() * .42F;
    } else if (mode == 10U) {
      grain_ms = 15.F + window * 235.F;
      const float delay_seconds = .055F + window * .82F;
      history_seconds = delay_seconds + (random() * 2.F - 1.F) * motion * delay_seconds * .72F;
      semitones = (random() * 2.F - 1.F) * pitch * 12.F;
      reverse_chance = .06F + motion * .72F;
      pan = (random() * 2.F - 1.F) * (.48F + motion * .46F);
      pan_drift = (random() * 2.F - 1.F) * motion * .28F;
      gain = .46F + density * .18F;
      tone = .28F + (1.F - memory) * .48F;
    } else if (mode == 11U) {
      const auto division_index = std::min<std::size_t>(kMicrocosmDivisions.size() - 1U,
          static_cast<std::size_t>(std::floor(window * static_cast<float>(kMicrocosmDivisions.size()))));
      const float pulse_seconds = 240.F / (tempo * kMicrocosmDivisions[division_index]);
      const auto& pattern = kMicrocosmVariationPatterns[variation];
      const auto pattern_step = pattern[spawn_sequence % pattern.size()];
      history_seconds = pulse_seconds * static_cast<float>(1U + pattern_step) * (1.F + memory * .65F);
      grain_ms = std::max(28.F, pulse_seconds * 1000.F * (.46F + density * .78F));
      const auto set_index = std::min<std::size_t>(kMicrocosmIntervals.size() - 1U,
          static_cast<std::size_t>(std::floor(pitch * static_cast<float>(kMicrocosmIntervals.size()))));
      const float interval = kMicrocosmIntervals[set_index][spawn_sequence % kMicrocosmCounts[set_index]];
      semitones = interval * (spawn_sequence % 6U == 5U ? -1.F : 1.F);
      reverse_chance = static_cast<float>(variation) * .06F;
      pan = std::sin(static_cast<float>(spawn_sequence) * kPi * .5F) * (.38F + density * .42F);
      pan_drift = 0.F;
      gain = .39F + density * .14F;
      tone = .40F + random() * .38F;

      if (microcosm_program == 1U) {
        grain_ms = std::max(22.F, pulse_seconds * 1000.F * (.28F + density * .42F));
        history_seconds = pulse_seconds * static_cast<float>(1U + pattern[(spawn_sequence * 3U) % pattern.size()]);
        pan = (static_cast<float>(spawn_sequence % 4U) - 1.5F) * .34F;
        tone = .62F;
      } else if (microcosm_program == 2U) {
        grain_ms = std::max(80.F, pulse_seconds * 1000.F * (1.4F + density * 1.8F));
        glide_semitones = (spawn_sequence % 2U == 0U ? 1.F : -1.F) * static_cast<float>(variation + 1U) * 3.5F;
        reverse_chance = 0.F;
        pan_drift = .16F + static_cast<float>(variation) * .05F;
      } else if (microcosm_program == 3U) {
        grain_ms = std::max(180.F, pulse_seconds * 1000.F * (3.2F + memory * 4.8F));
        history_seconds *= .72F + random() * .46F;
        semitones *= .5F;
        reverse_chance = .04F;
        pan *= .46F;
        pan_drift = .08F + static_cast<float>(variation) * .025F;
        gain = .29F + density * .10F;
        tone = .12F + static_cast<float>(variation) * .05F;
      } else if (microcosm_program == 4U) {
        grain_ms = std::max(260.F, pulse_seconds * 1000.F * (5.F + memory * 6.F));
        history_seconds = pulse_seconds * static_cast<float>(2U + pattern_step % 4U) * (1.4F + memory);
        reverse_chance = spawn_sequence % 4U == 3U ? 1.F : 0.F;
        pan = std::sin(static_cast<float>(spawn_sequence) * 1.047F) * .82F;
        pan_drift = .18F + static_cast<float>(variation) * .04F;
        gain = .27F + density * .09F;
        tone = .18F;
      } else if (microcosm_program == 5U) {
        grain_ms = 34.F + pulse_seconds * 1000.F * .36F;
        history_seconds = pulse_seconds * static_cast<float>(1U + spawn_sequence % (3U + variation));
        semitones = interval + static_cast<float>(spawn_sequence % 3U) * 12.F;
        pan = (static_cast<float>(spawn_sequence % 5U) - 2.F) * .38F;
        gain = .46F + density * .14F;
        tone = .78F;
      } else if (microcosm_program == 6U) {
        grain_ms = std::max(24.F, pulse_seconds * 1000.F * (.52F + static_cast<float>(variation) * .12F));
        history_seconds = pulse_seconds * static_cast<float>(1U + pattern_step / 2U);
        semitones = variation >= 2U && spawn_sequence % 4U == 3U ? 12.F : 0.F;
        reverse_chance = static_cast<float>(variation) * .12F;
        pan = spawn_sequence % 2U == 0U ? -.54F : .54F;
        tone = .84F;
      } else if (microcosm_program == 7U) {
        grain_ms = std::max(42.F, pulse_seconds * 1000.F * (.9F + static_cast<float>(variation) * .22F));
        history_seconds = pulse_seconds * static_cast<float>(2U + pattern_step);
        semitones = variation == 3U && spawn_sequence % 4U == 0U ? -12.F : 0.F;
        reverse_chance = static_cast<float>(variation) * .14F;
        pan = 0.F;
        gain = .64F;
        tone = .72F;
      } else if (microcosm_program == 8U) {
        grain_ms = std::max(30.F, pulse_seconds * 1000.F * (.42F + density * .38F));
        semitones = interval + (variation == 3U && spawn_sequence % 4U == 3U ? 12.F : 0.F);
        history_seconds = pulse_seconds * static_cast<float>(1U + pattern_step % 4U);
        pan = std::sin(static_cast<float>(spawn_sequence) * 2.399F) * .76F;
        gain = .48F;
        tone = .82F;
      } else if (microcosm_program == 9U) {
        grain_ms = std::max(36.F, pulse_seconds * 1000.F * (.62F + density * .52F));
        history_seconds = pulse_seconds * static_cast<float>(1U + pattern_step)
            * (1.F + static_cast<float>(spawn_sequence % 3U) * .5F);
        reverse_chance = variation == 3U ? .18F : 0.F;
        pan = std::sin(static_cast<float>(spawn_sequence) * 1.571F) * .68F;
        tone = .56F;
      } else if (microcosm_program == 10U) {
        grain_ms = std::max(160.F, pulse_seconds * 1000.F * (2.4F + memory * 4.2F));
        history_seconds *= 1.35F + memory * .8F;
        reverse_chance = .48F + static_cast<float>(variation) * .12F;
        glide_semitones = (spawn_sequence % 2U == 0U ? -1.F : 1.F) * static_cast<float>(variation + 1U) * 2.F;
        pan_drift = .22F;
        gain = .31F + density * .08F;
        tone = .10F + (1.F - memory) * .18F;
      }
    }

    history_seconds = std::clamp(history_seconds, .012F, 3.75F);
    const float length = std::max(72.F, std::min(static_cast<float>(buffer_size - 256U),
        std::floor(rate * grain_ms / 1000.F)));
    float step = semitone_step(semitones);
    if (random() < reverse_chance) step *= -1.F;
    found->active = true;
    found->phase = 0.F;
    found->length = length;
    found->read = static_cast<float>((write_index + buffer_size
        - (static_cast<std::size_t>(std::floor(rate * history_seconds)) & mask)) & mask);
    found->step = step;
    found->step_delta = glide_semitones == 0.F ? 0.F
        : (std::copysign(semitone_step(semitones + glide_semitones), step) - step) / length;
    found->gain = gain;
    found->pan = pan;
    found->pan_drift = pan_drift;
    found->tone = tone;
    found->last_left = 0.F;
    found->last_right = 0.F;
    ++spawn_sequence;
    return true;
  }

  std::array<float, 3> render_voices(unsigned mode) noexcept {
    float wet_left = 0.F;
    float wet_right = 0.F;
    float active = 0.F;
    for (std::size_t index = 0; index < effective_voice_limit; ++index) {
      auto& voice = voices[index];
      if (!voice.active) continue;
      const float normalized = voice.phase / voice.length;
      if (normalized >= 1.F) {
        voice.active = false;
        continue;
      }
      const float sine = std::sin(normalized * kPi);
      const float envelope = mode == 2U || mode == 6U
          ? std::sqrt(std::max(0.F, sine)) * sine
          : mode == 8U
              ? std::min(1.F, sine * 2.4F) * std::sqrt(std::max(0.F, sine))
              : mode == 9U ? sine : sine * sine;
      float sample_left = interpolate(left, voice.read);
      float sample_right = interpolate(right, voice.read);
      const float tone_coefficient = mode == 2U || mode == 6U
          ? .08F + voice.tone * .26F
          : mode == 8U ? .16F + voice.tone * .38F
          : mode == 10U ? .12F + voice.tone * .42F
          : .24F + voice.tone * .62F;
      voice.last_left += (sample_left - voice.last_left) * tone_coefficient;
      voice.last_right += (sample_right - voice.last_right) * tone_coefficient;
      sample_left = voice.last_left;
      sample_right = voice.last_right;
      const float moving_pan = std::clamp(voice.pan + std::sin(normalized * kPi * 2.F) * voice.pan_drift, -1.F, 1.F);
      const float left_gain = std::sqrt((1.F - moving_pan) * .5F);
      const float right_gain = std::sqrt((1.F + moving_pan) * .5F);
      const float voice_gain = envelope * voice.gain;
      wet_left += (sample_left * .90F + sample_right * .10F) * voice_gain * left_gain;
      wet_right += (sample_right * .90F + sample_left * .10F) * voice_gain * right_gain;
      voice.read = wrap(voice.read + voice.step);
      voice.step += voice.step_delta;
      voice.phase += 1.F;
      active += 1.F;
    }
    return {wet_left, wet_right, active};
  }

  float spawn_rate(unsigned mode, float density, float window) const noexcept {
    switch (mode) {
      case 0U: return 18.F + density * 62.F;
      case 1U: return 6.F + density * 48.F;
      case 2U: return 10.F + density * 36.F;
      case 3U: return 16.F + density * 54.F;
      case 6U: return 4.F + density * 14.F;
      case 7U: return kBeadsClockSteps[std::min<std::size_t>(kBeadsClockSteps.size() - 1U,
          static_cast<std::size_t>(std::floor(density * static_cast<float>(kBeadsClockSteps.size()))))];
      case 8U: return 3.F + density * 12.F;
      case 9U: return 4.F + density * 15.F;
      case 10U: return 5.F + density * 24.F;
      case 11U: return 3.F + density * 15.F + (1.F - window) * 4.F;
      default: return 12.F;
    }
  }

  float feedback_for_mode(unsigned mode, float memory, unsigned microcosm_program) const noexcept {
    switch (mode) {
      case 2U: return memory * .24F;
      case 6U: return memory * .30F;
      case 7U: return memory * .12F;
      case 8U: return memory * .18F;
      case 9U: return memory * .20F;
      case 10U: return memory * .48F;
      case 11U: return memory * kMicrocosmFeedbackCeilings[microcosm_program];
      default: return 0.F;
    }
  }

  bool transient_allows_spawn(unsigned mode, float transient, float density, float motion,
                              unsigned microcosm_program) noexcept {
    if (mode == 1U)
      return transient > .0018F + (1.F - density) * .004F || random() < .05F + motion * .10F;
    if (mode == 9U)
      return transient > .0012F + (1.F - density) * .003F || random() < .10F + motion * .18F;
    if (mode == 11U && microcosm_program == 5U)
      return transient > .001F + (1.F - density) * .0025F || random() < .12F + density * .12F;
    return true;
  }

  std::array<float, 2> apply_hardware(unsigned mode, float input_left, float input_right,
                                      float window, float density, float motion, float memory,
                                      unsigned microcosm_program, unsigned variation) noexcept {
    float result_left = input_left;
    float result_right = input_right;
    if (mode == 6U) {
      const float coefficient = .018F + (1.F - window) * .065F;
      hardware_left += (input_left - hardware_left) * coefficient;
      hardware_right += (input_right - hardware_right) * coefficient;
      hardware_aux_left += (hardware_right - hardware_aux_left) * (.012F + memory * .024F);
      hardware_aux_right += (hardware_left - hardware_aux_right) * (.012F + memory * .024F);
      result_left = hardware_left * .84F + hardware_aux_left * (.10F + memory * .18F);
      result_right = hardware_right * .84F + hardware_aux_right * (.10F + memory * .18F);
    } else if (mode == 7U) {
      const float coefficient = .42F + (1.F - window) * .34F;
      hardware_left += (input_left - hardware_left) * coefficient;
      hardware_right += (input_right - hardware_right) * coefficient;
      const float detail_left = input_left - hardware_left;
      const float detail_right = input_right - hardware_right;
      result_left = input_left * .94F + detail_left * (.10F + motion * .12F) + detail_right * density * .04F;
      result_right = input_right * .94F + detail_right * (.10F + motion * .12F) + detail_left * density * .04F;
    } else if (mode == 8U) {
      const float coefficient = .18F + (1.F - window) * .28F;
      hardware_left += (input_left - hardware_left) * coefficient;
      hardware_right += (input_right - hardware_right) * coefficient;
      const float reel_drive = 1.02F + memory * .34F;
      result_left = std::tanh(hardware_left * reel_drive) / std::tanh(reel_drive);
      result_right = std::tanh(hardware_right * reel_drive) / std::tanh(reel_drive);
    } else if (mode == 9U) {
      hardware_left += (input_left - hardware_left) * (.20F + density * .16F);
      hardware_right += (input_right - hardware_right) * (.20F + density * .16F);
      hardware_aux_left += (hardware_right - hardware_aux_left) * (.026F + memory * .032F);
      hardware_aux_right += (hardware_left - hardware_aux_right) * (.026F + memory * .032F);
      result_left = hardware_left * .88F + hardware_aux_left * (.08F + motion * .12F);
      result_right = hardware_right * .88F + hardware_aux_right * (.08F + motion * .12F);
    } else if (mode == 10U) {
      const float coefficient = .14F + (1.F - memory) * .46F;
      hardware_left += (input_left - hardware_left) * coefficient;
      hardware_right += (input_right - hardware_right) * coefficient;
      result_left = input_left * .38F + hardware_left * .72F;
      result_right = input_right * .38F + hardware_right * .72F;
    } else if (mode == 11U) {
      const bool diffuse = microcosm_program == 3U || microcosm_program == 4U || microcosm_program == 10U;
      const bool glitch = microcosm_program >= 5U && microcosm_program <= 8U;
      const float first = diffuse ? .10F + (1.F - window) * .12F
          : glitch ? .52F : .24F + (1.F - window) * .20F;
      const float second = diffuse ? .025F + (1.F - memory) * .055F
          : .08F + (1.F - memory) * .14F;
      hardware_left += (input_left - hardware_left) * first;
      hardware_right += (input_right - hardware_right) * first;
      hardware_aux_left += (hardware_right - hardware_aux_left) * second;
      hardware_aux_right += (hardware_left - hardware_aux_right) * second;
      const float direct = glitch ? .62F : diffuse ? .12F : .28F;
      const float halo = diffuse ? .62F + memory * .18F : .34F + memory * .12F;
      const float shimmer = static_cast<float>(variation) * .018F;
      result_left = input_left * direct + hardware_left * (.46F - shimmer) + hardware_aux_left * halo;
      result_right = input_right * direct + hardware_right * (.46F - shimmer) + hardware_aux_right * halo;
    }
    return {result_left, result_right};
  }

  void process(float* data, std::size_t frames) noexcept {
    const float parameter_coefficient = smoothing_coefficient(.012F, rate);
    const float mix_coefficient = smoothing_coefficient(.025F, rate);
    const unsigned microcosm_program = std::min(10U, microcosm_program_target.load(std::memory_order_relaxed));
    const float tempo = std::clamp(tempo_target.load(std::memory_order_relaxed), 30.F, 300.F);
    const bool hold = hold_target.load(std::memory_order_relaxed);
    const unsigned variation = std::min(3U, static_cast<unsigned>(
        std::floor(clamp01(target[4].load(std::memory_order_relaxed)) * 4.F)));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      smooth[0] = target[0].load(std::memory_order_relaxed);
      for (std::size_t index = 1; index < 6U; ++index)
        smooth[index] += (target[index].load(std::memory_order_relaxed) - smooth[index]) * parameter_coefficient;
      smooth[6] += (target[6].load(std::memory_order_relaxed) - smooth[6]) * mix_coefficient;

      const unsigned mode = std::min(11U, static_cast<unsigned>(std::max(0.F, std::round(smooth[0]))));
      const float window = clamp01((smooth[1] - 4.F) / 12.F);
      const float density = clamp01(smooth[2]);
      const float pitch = clamp01(smooth[3]);
      const float motion = clamp01(smooth[4]);
      const float memory_amount = clamp01(smooth[5]);
      const float mix = clamp01(smooth[6]);
      reset_mode_state(mode, window, density, pitch, motion);
      if (mode == 11U) reset_microcosm_program(microcosm_program);
      else previous_microcosm_program = -1;

      float dry_left = data[frame * 2U];
      float dry_right = data[frame * 2U + 1U];
      if (!std::isfinite(dry_left) || std::abs(dry_left) < 1e-20F) dry_left = 0.F;
      if (!std::isfinite(dry_right) || std::abs(dry_right) < 1e-20F) dry_right = 0.F;

      const float peak = std::max(std::abs(dry_left), std::abs(dry_right));
      previous_envelope = input_envelope;
      input_envelope += (peak - input_envelope) * (peak > input_envelope ? .075F : .0018F);
      const float transient = std::max(0.F, input_envelope - previous_envelope);
      const float feedback = feedback_for_mode(mode, memory_amount, microcosm_program);
      const bool memory_held = mode == 11U && hold;
      if (!memory_held) {
        left[write_index] = std::clamp(dry_left + output_left * feedback, -1.2F, 1.2F);
        right[write_index] = std::clamp(dry_right + output_right * feedback, -1.2F, 1.2F);
        written_samples = std::min(buffer_size - 1U, written_samples + 1U);
      }

      float processed_left = 0.F;
      float processed_right = 0.F;
      if (mode == 4U) {
        if (!slice_ready) slice_ready = capture_slice(window, density, pitch, motion);
        if (slice_ready) {
          const auto slice = process_slice(window, density, pitch, motion, memory_amount);
          const float anchor = .18F + (1.F - memory_amount) * .14F;
          processed_left = dry_left * anchor + slice[0] * 1.02F;
          processed_right = dry_right * anchor + slice[1] * 1.02F;
        } else {
          processed_left = dry_left;
          processed_right = dry_right;
        }
      } else if (mode == 5U) {
        if (!freeze_ready) freeze_ready = capture_freeze(window, density, pitch);
        if (freeze_ready) {
          const auto freeze = process_freeze(window, density, pitch, motion, memory_amount, transient);
          const float anchor = .10F + (1.F - memory_amount) * .18F;
          processed_left = dry_left * anchor + freeze[0] * (.90F + memory_amount * .18F);
          processed_right = dry_right * anchor + freeze[1] * (.90F + memory_amount * .18F);
        } else {
          processed_left = dry_left;
          processed_right = dry_right;
        }
      } else {
        --spawn_counter;
        if (spawn_counter <= 0) {
          const float rate_for_mode = spawn_rate(mode, density, window);
          auto spawn_interval = std::max(24, static_cast<int>(std::floor(rate / rate_for_mode)));
          if (mode == 11U) {
            const auto division_index = std::min<std::size_t>(kMicrocosmDivisions.size() - 1U,
                static_cast<std::size_t>(std::floor(window * static_cast<float>(kMicrocosmDivisions.size()))));
            const float pulse_frames = rate * 240.F / (tempo * kMicrocosmDivisions[division_index]);
            const float activity = .75F + density * 2.25F;
            spawn_interval = std::max(24, static_cast<int>(std::floor(
                pulse_frames / (kMicrocosmRateScales[microcosm_program] * activity))));
          }
          const bool transient_ready = transient_allows_spawn(mode, transient, density, motion, microcosm_program);
          const bool spawned = transient_ready && spawn_voice(
              mode, window, density, pitch, motion, memory_amount, microcosm_program, tempo, variation);
          const float interval_variation = mode == 11U
              ? (spawn_sequence % 4U == 0U ? -.28F : spawn_sequence % 4U == 3U ? .22F : 0.F)
              : (random() - .5F) * motion;
          spawn_counter = spawned
              ? std::max(16, spawn_interval + static_cast<int>(interval_variation * static_cast<float>(spawn_interval)))
              : std::max(24, static_cast<int>(std::floor(static_cast<float>(spawn_interval) * .35F)));
        }
        const auto rendered = render_voices(mode);
        const float active = rendered[2];
        const float normalization = active > 1.F ? 1.F / std::sqrt(.72F + active * .38F) : 1.F;
        const float cohesion = mode == 0U ? memory_amount : 0.F;
        const float body = mode == 3U ? memory_amount : 0.F;
        const float dry_anchor = mode == 11U
            ? (microcosm_program == 7U && active < 1.F ? 1.F : kMicrocosmDryAnchors[microcosm_program])
            : std::max(.12F, kDryAnchors[mode] - cohesion * .10F);
        const float wet_gain = mode == 11U ? kMicrocosmWetGains[microcosm_program]
            : kWetGains[mode] + cohesion * .12F + body * .10F;
        processed_left = dry_left * dry_anchor + rendered[0] * normalization * wet_gain;
        processed_right = dry_right * dry_anchor + rendered[1] * normalization * wet_gain;
        if (mode == 2U) {
          const float coefficient = .035F + (1.F - window) * .08F;
          smear_left += (processed_left - smear_left) * coefficient;
          smear_right += (processed_right - smear_right) * coefficient;
          const float mid = (smear_left + smear_right) * .5F;
          processed_left = smear_left * .84F + mid * .16F;
          processed_right = smear_right * .84F + mid * .16F;
        } else if (mode >= 6U) {
          const auto hardware = apply_hardware(mode, processed_left, processed_right,
                                               window, density, motion, memory_amount,
                                               microcosm_program, variation);
          processed_left = hardware[0];
          processed_right = hardware[1];
        }
      }

      float safe_left = std::tanh(processed_left * 1.02F) / std::tanh(1.02F);
      float safe_right = std::tanh(processed_right * 1.02F) / std::tanh(1.02F);
      const float input_power = (dry_left * dry_left + dry_right * dry_right) * .5F;
      const float wet_power = (safe_left * safe_left + safe_right * safe_right) * .5F;
      input_energy += (input_power - input_energy) * .0016F;
      wet_energy += (wet_power - wet_energy) * .0016F;
      const float target_makeup = std::clamp(std::sqrt((input_energy + 1e-6F) / (wet_energy + 1e-6F)), .88F, 1.48F);
      makeup_gain += (target_makeup - makeup_gain) * .001F;
      safe_left *= makeup_gain;
      safe_right *= makeup_gain;
      const float output_smoothing = mode == 4U ? .92F : mode == 5U ? .86F : mode >= 6U ? .88F : .82F;
      output_left += (safe_left - output_left) * output_smoothing;
      output_right += (safe_right - output_right) * output_smoothing;
      if (std::abs(output_left) < 1e-20F) output_left = 0.F;
      if (std::abs(output_right) < 1e-20F) output_right = 0.F;

      const float dry_gain = std::cos(mix * kPi * .5F);
      const float wet_gain = std::sin(mix * kPi * .5F);
      data[frame * 2U] = std::clamp(dry_left * dry_gain + output_left * wet_gain, -1.2F, 1.2F);
      data[frame * 2U + 1U] = std::clamp(dry_right * dry_gain + output_right * wet_gain, -1.2F, 1.2F);
      if (!memory_held) write_index = (write_index + 1U) & mask;
    }
  }

  float rate;
  std::size_t buffer_size;
  std::size_t mask;
  std::vector<float> left;
  std::vector<float> right;
  std::array<Voice, 8> voices{};
  std::size_t effective_voice_limit{6U};
  std::size_t write_index{};
  std::size_t written_samples{};
  int spawn_counter{};
  std::uint64_t spawn_sequence{};
  std::uint32_t random_state{0x6d2b79f5U};
  float output_left{};
  float output_right{};
  float smear_left{};
  float smear_right{};
  float hardware_left{};
  float hardware_right{};
  float hardware_aux_left{};
  float hardware_aux_right{};
  float input_envelope{};
  float previous_envelope{};
  float input_energy{1e-5F};
  float wet_energy{1e-5F};
  float makeup_gain{1.F};
  int previous_mode{-1};
  int previous_microcosm_program{-1};
  std::size_t slice_start{};
  std::size_t slice_length{2048U};
  float slice_phase{};
  float slice_step{1.F};
  std::size_t slice_refresh_counter{};
  bool slice_ready{};
  std::size_t freeze_start{};
  std::size_t freeze_length{8192U};
  float freeze_phase{};
  float freeze_step{1.F};
  std::size_t freeze_refresh_counter{};
  bool freeze_ready{};
  std::array<std::atomic<float>, 7> target{2.F,13.F,.42F,.38F,.16F,.36F,.12F};
  std::array<float, 7> smooth{2.F,13.F,.42F,.38F,.16F,.36F,.12F};
  std::atomic<unsigned> microcosm_program_target{0U};
  std::atomic<float> tempo_target{120.F};
  std::atomic<bool> hold_target{false};
};

GrainParityProcessor::GrainParityProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
GrainParityProcessor::~GrainParityProcessor() = default;
void GrainParityProcessor::process(float* data, std::size_t frames) noexcept {
  if (data && frames) impl_->process(data, frames);
}
void GrainParityProcessor::reset() noexcept { impl_->reset(); }
bool GrainParityProcessor::set_parameter(std::string_view name, float value) noexcept {
  if (!std::isfinite(value)) return false;
  if (name == "microcosmProgram") {
    impl_->microcosm_program_target.store(
        std::min(10U, static_cast<unsigned>(std::max(0.F, std::round(value)))),
        std::memory_order_relaxed);
    return true;
  }
  if (name == "tempo") {
    impl_->tempo_target.store(std::clamp(value, 30.F, 300.F), std::memory_order_relaxed);
    return true;
  }
  if (name == "hold") {
    impl_->hold_target.store(value >= .5F, std::memory_order_relaxed);
    return true;
  }
  std::size_t index = 99U;
  if (name == "mode") index = 0U;
  else if (name == "bits") index = 1U;
  else if (name == "density") index = 2U;
  else if (name == "pitch") index = 3U;
  else if (name == "chaos") index = 4U;
  else if (name == "bloom") index = 5U;
  else if (name == "mix") index = 6U;
  if (index >= impl_->target.size()) return false;
  if (index == 0U) value = std::clamp(std::round(value), 0.F, 11.F);
  else if (index == 1U) value = std::clamp(value, 4.F, 16.F);
  else value = clamp01(value);
  impl_->target[index].store(value, std::memory_order_relaxed);
  return true;
}

}  // namespace calcotone
