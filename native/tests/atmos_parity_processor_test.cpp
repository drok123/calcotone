#include "calcotone/atmos_parity_processor.hpp"
#include "calcotone/atmos_parity_profiles.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr std::size_t kBlock = 128U;

void process_blocks(calcotone::AtmosParityProcessor& processor, std::vector<float>& audio) {
  const std::size_t frames = audio.size() / 2U;
  for (std::size_t offset = 0; offset < frames; offset += kBlock)
    processor.process(audio.data() + offset * 2U, std::min(kBlock, frames - offset));
}

void configure(calcotone::AtmosParityProcessor& processor, unsigned mode, float decay = 2.4F) {
  assert(processor.set_parameter("algorithm", static_cast<float>(mode)));
  assert(processor.set_parameter("decay", decay));
  assert(processor.set_parameter("size", .52F));
  assert(processor.set_parameter("color", .42F));
  assert(processor.set_parameter("diffusion", .74F));
  assert(processor.set_parameter("motion", .18F));
  assert(processor.set_parameter("mix", 1.F));
}

std::vector<float> render(unsigned mode, float decay, std::size_t frames = 96'000U, bool left_only = false) {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, mode, decay);
  std::vector<float> audio(frames * 2U, 0.F);
  audio[0] = .5F;
  audio[1] = left_only ? 0.F : .5F;
  process_blocks(processor, audio);
  for (float sample : audio) assert(std::isfinite(sample) && std::abs(sample) <= 1.2F);
  return audio;
}

double energy(const std::vector<float>& audio, std::size_t first, std::size_t last, unsigned channel = 2U) {
  double result = 0.0;
  last = std::min(last, audio.size() / 2U);
  for (std::size_t frame = first; frame < last; ++frame) {
    if (channel == 2U) result += std::abs(static_cast<double>(audio[frame * 2U]))
                                  + std::abs(static_cast<double>(audio[frame * 2U + 1U]));
    else result += std::abs(static_cast<double>(audio[frame * 2U + channel]));
  }
  return result;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]) && std::abs(audio[index]) <= 1.2F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 251U) + 1U);
  }
  return result;
}

void test_model_identities() {
  std::array<double, calcotone::kAtmosParityProfiles.size()> signatures{};
  for (unsigned mode = 0; mode < signatures.size(); ++mode) {
    const auto audio = render(mode, mode == 5U ? 12.F : 2.4F, 48'000U);
    const double model_signature = signature(audio);
    assert(model_signature > 1e-6);
    signatures[mode] = model_signature;
  }
  for (std::size_t first = 0; first < signatures.size(); ++first)
    for (std::size_t second = first + 1U; second < signatures.size(); ++second)
      assert(std::abs(signatures[first] - signatures[second]) > 1e-4);
}

void test_early_reflections_precede_tail() {
  const auto room = render(0U, 1.2F, 24'000U);
  assert(energy(room, 250U, 950U) > 1e-5);
}

void test_decay_extends_tail() {
  const auto short_decay = render(2U, .55F);
  const auto long_decay = render(2U, 9.F);
  const double short_tail = energy(short_decay, 30'000U, 90'000U);
  const double long_tail = energy(long_decay, 30'000U, 90'000U);
  assert(long_tail > short_tail * 1.35 + 1e-7);
}

void test_emt_mono_excitation_reaches_both_pickups() {
  const auto emt = render(10U, 3.F, 48'000U, true);
  const double left = energy(emt, 0U, 48'000U, 0U);
  const double right = energy(emt, 0U, 48'000U, 1U);
  assert(left > 1e-5 && right > left * .18);
}

void test_new_modes_are_reachable() {
  for (unsigned mode = 12U; mode < calcotone::kAtmosParityProfiles.size(); ++mode) {
    const auto audio = render(mode, mode == 15U ? 6.F : 2.8F, 32'000U);
    assert(energy(audio, 0U, 32'000U) > 1e-6);
  }
}

void test_live_algorithm_switch_preserves_outgoing_tail() {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, 2U, 5.F);
  std::vector<float> first(24'000U * 2U, 0.F);
  first[0] = .6F; first[1] = -.35F;
  process_blocks(processor, first);
  assert(processor.set_parameter("algorithm", static_cast<float>(calcotone::kAtmosParityProfiles.size() - 1U)));
  std::vector<float> transition(48'000U * 2U, 0.F);
  process_blocks(processor, transition);
  assert(energy(transition, 0U, 8'000U) > 1e-5);
}

std::vector<float> render_after_live_selection(unsigned selected_mode) {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, 0U, 2.4F);

  // Force a true live model transition rather than the startup shortcut, then
  // leave more than the 80 ms network crossfade to retire the old room model.
  std::vector<float> pre_roll(256U * 2U, 0.F);
  process_blocks(processor, pre_roll);
  assert(processor.set_parameter("algorithm", static_cast<float>(selected_mode)));
  std::vector<float> settle(5'000U * 2U, 0.F);
  process_blocks(processor, settle);

  std::vector<float> probe(48'000U * 2U, 0.F);
  probe[0] = .5F;
  probe[1] = -.37F;
  process_blocks(processor, probe);
  return probe;
}

void test_live_algorithm_switch_commits_incoming_model() {
  const auto room = render_after_live_selection(0U);
  const auto spring = render_after_live_selection(14U);
  const auto veil = render_after_live_selection(16U);
  const double room_signature = signature(room);
  const double spring_signature = signature(spring);
  const double veil_signature = signature(veil);

  assert(std::abs(spring_signature - room_signature) > 1e-3);
  assert(std::abs(veil_signature - room_signature) > 1e-3);
  assert(std::abs(veil_signature - spring_signature) > 1e-3);
}

void test_reset_is_deterministic() {
  calcotone::AtmosParityProcessor processor(kRate);
  configure(processor, 8U, 6.F);
  auto render_once = [&processor]() {
    std::vector<float> audio(48'000U * 2U, 0.F);
    audio[0] = .41F; audio[1] = -.27F;
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
  test_model_identities();
  test_early_reflections_precede_tail();
  test_decay_extends_tail();
  test_emt_mono_excitation_reaches_both_pickups();
  test_new_modes_are_reachable();
  test_live_algorithm_switch_preserves_outgoing_tail();
  test_live_algorithm_switch_commits_incoming_model();
  test_reset_is_deterministic();

  calcotone::AtmosParityProcessor processor(kRate);
  assert(!processor.set_parameter("not-a-parameter", .5F));
}
