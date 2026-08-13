#include "calcotone/grain_parity_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kBlock = 128U;

void process_blocks(calcotone::GrainParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0; offset < frames; offset += kBlock)
    processor.process(audio.data() + offset * 2U, std::min(kBlock, frames - offset));
}

void configure(calcotone::GrainParityProcessor& processor, unsigned mode,
               float window = 13.F, float density = .58F, float pitch = .46F,
               float chaos = .34F, float bloom = .62F) {
  assert(processor.set_parameter("mode", static_cast<float>(mode)));
  assert(processor.set_parameter("bits", window));
  assert(processor.set_parameter("density", density));
  assert(processor.set_parameter("pitch", pitch));
  assert(processor.set_parameter("chaos", chaos));
  assert(processor.set_parameter("bloom", bloom));
  assert(processor.set_parameter("mix", 1.F));
}

std::vector<float> make_source(std::size_t frames, std::size_t active_frames = 72'000U) {
  std::vector<float> audio(frames * 2U, 0.F);
  active_frames = std::min(active_frames, frames);
  for (std::size_t frame = 0; frame < active_frames; ++frame) {
    const float envelope = frame % 4096U < 96U ? 1.F : .42F;
    const float left = envelope * (.26F * std::sin(static_cast<float>(frame) * .031F)
        + .13F * std::sin(static_cast<float>(frame) * .071F));
    const float right = envelope * (.23F * std::sin(static_cast<float>(frame) * .027F + .8F)
        + .11F * std::cos(static_cast<float>(frame) * .083F));
    audio[frame * 2U] = left;
    audio[frame * 2U + 1U] = right;
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) <= 1.21F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 257U) + 1U);
  }
  return result;
}

double energy(const std::vector<float>& audio, std::size_t first, std::size_t last) {
  double result = 0.0;
  last = std::min(last, audio.size() / 2U);
  for (std::size_t frame = first; frame < last; ++frame)
    result += std::abs(static_cast<double>(audio[frame * 2U]))
        + std::abs(static_cast<double>(audio[frame * 2U + 1U]));
  return result;
}

std::vector<float> render(unsigned mode, float window = 13.F, float density = .58F,
                          float pitch = .46F, float chaos = .34F, float bloom = .62F,
                          std::size_t frames = 120'000U) {
  calcotone::GrainParityProcessor processor(kRate);
  configure(processor, mode, window, density, pitch, chaos, bloom);
  auto audio = make_source(frames);
  process_blocks(processor, audio);
  signature(audio);
  return audio;
}

std::vector<float> render_microcosm(unsigned program, float tempo = 120.F,
                                    std::size_t frames = 120'000U) {
  calcotone::GrainParityProcessor processor(kRate);
  configure(processor, 11U, 13.F, .64F, .58F, .62F, .54F);
  assert(processor.set_parameter("microcosmProgram", static_cast<float>(program)));
  assert(processor.set_parameter("tempo", tempo));
  auto audio = make_source(frames);
  process_blocks(processor, audio);
  signature(audio);
  return audio;
}

void test_all_twelve_modes_have_distinct_live_memory_signatures() {
  std::array<double, 12> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode)
    signatures[mode] = signature(render(mode));
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);
}

void test_window_and_pitch_are_analysis_controls_not_bit_crushing() {
  const auto short_window = render(2U, 5.F, .62F, .08F, .18F, .55F, 72'000U);
  const auto long_window = render(2U, 16.F, .62F, .08F, .18F, .55F, 72'000U);
  const auto pitched = render(2U, 16.F, .62F, .92F, .18F, .55F, 72'000U);
  assert(std::abs(signature(short_window) - signature(long_window)) > 1e-3);
  assert(std::abs(signature(long_window) - signature(pitched)) > 1e-3);

  bool found_sub_lsb_value = false;
  for (float sample : long_window) {
    if (std::abs(sample) > 1e-6F && std::abs(sample * 2047.F - std::round(sample * 2047.F)) > 1e-3F) {
      found_sub_lsb_value = true;
      break;
    }
  }
  assert(found_sub_lsb_value);
}

void test_slice_and_freeze_capture_full_windows() {
  const auto slice = render(4U, 14.F, .52F, .48F, .42F, .74F, 144'000U);
  const auto freeze = render(5U, 14.F, .52F, .48F, .42F, .74F, 144'000U);
  assert(energy(slice, 80'000U, 140'000U) > 1e-4);
  assert(energy(freeze, 80'000U, 140'000U) > 1e-4);
  assert(std::abs(signature(slice) - signature(freeze)) > 1e-3);
}

void test_particle_memory_extends_the_tail() {
  const auto low_memory = render(10U, 12.F, .65F, .58F, .55F, 0.F, 144'000U);
  const auto high_memory = render(10U, 12.F, .65F, .58F, .55F, 1.F, 144'000U);
  const double low_tail = energy(low_memory, 90'000U, 144'000U);
  const double high_tail = energy(high_memory, 90'000U, 144'000U);
  assert(high_tail > low_tail * 1.08 + 1e-7);
}

void test_silence_remains_silent_in_memory_and_hardware_modes() {
  for (const unsigned mode : {2U, 5U, 6U, 8U, 10U, 11U}) {
    calcotone::GrainParityProcessor processor(kRate);
    configure(processor, mode, 16.F, 1.F, 1.F, 1.F, 1.F);
    std::vector<float> silence(16'384U * 2U, 0.F);
    process_blocks(processor, silence);
    for (float sample : silence) assert(sample == 0.F);
  }
}

void test_microcosm_programs_and_tempo_have_distinct_signatures() {
  std::array<double, 11> signatures{};
  for (unsigned program = 0; program < signatures.size(); ++program)
    signatures[program] = signature(render_microcosm(program));
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-3);

  const double slow = signature(render_microcosm(9U, 72.F, 96'000U));
  const double fast = signature(render_microcosm(9U, 168.F, 96'000U));
  assert(std::abs(slow - fast) > 1e-3);
}

void test_microcosm_hold_preserves_captured_memory() {
  calcotone::GrainParityProcessor held(kRate);
  calcotone::GrainParityProcessor released(kRate);
  configure(held, 11U, 13.F, .68F, .34F, .18F, 0.F);
  configure(released, 11U, 13.F, .68F, .34F, .18F, 0.F);
  assert(held.set_parameter("microcosmProgram", 0.F));
  assert(released.set_parameter("microcosmProgram", 0.F));
  auto seed_a = make_source(96'000U, 96'000U);
  auto seed_b = seed_a;
  process_blocks(held, seed_a);
  process_blocks(released, seed_b);

  assert(held.set_parameter("hold", 1.F));
  std::vector<float> held_tail(288'000U * 2U, 0.F);
  std::vector<float> released_tail(288'000U * 2U, 0.F);
  process_blocks(held, held_tail);
  process_blocks(released, released_tail);
  const double held_energy = energy(held_tail, 240'000U, 288'000U);
  const double released_energy = energy(released_tail, 240'000U, 288'000U);
  assert(held_energy > released_energy * 2.5 + 1e-5);
  assert(held.set_parameter("hold", 0.F));
}

void test_reset_is_deterministic() {
  calcotone::GrainParityProcessor processor(kRate);
  configure(processor, 11U, 10.F, .67F, .72F, .48F, .81F);
  processor.reset();
  auto render_once = [&processor]() {
    auto audio = make_source(96'000U, 64'000U);
    process_blocks(processor, audio);
    return audio;
  };
  const auto first = render_once();
  processor.reset();
  const auto second = render_once();
  assert(first.size() == second.size());
  for (std::size_t index = 0; index < first.size(); ++index)
    assert(std::abs(first[index] - second[index]) < 1e-6F);
}
}  // namespace

int main() {
  test_all_twelve_modes_have_distinct_live_memory_signatures();
  test_window_and_pitch_are_analysis_controls_not_bit_crushing();
  test_slice_and_freeze_capture_full_windows();
  test_particle_memory_extends_the_tail();
  test_silence_remains_silent_in_memory_and_hardware_modes();
  test_microcosm_programs_and_tempo_have_distinct_signatures();
  test_microcosm_hold_preserves_captured_memory();
  test_reset_is_deterministic();

  calcotone::GrainParityProcessor processor(kRate);
  assert(!processor.set_parameter("not-a-parameter", .5F));
}
