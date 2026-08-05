#include "calcotone/native_dream_engine.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;
constexpr float kPi = 3.14159265358979323846F;
constexpr std::size_t kBlock = 128U;

std::vector<float> source(std::size_t frames, float scale = 1.F) {
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0U; frame < frames; ++frame) {
    const float t = static_cast<float>(frame) / kRate;
    const float burst = frame % 8192U < 1800U ? 1.F : .22F;
    audio[frame * 2U] = scale * burst * .23F * std::sin(2.F * kPi * 173.F * t);
    audio[frame * 2U + 1U] = scale * burst * .19F * std::sin(2.F * kPi * 181.F * t + .37F);
  }
  return audio;
}

double signature(const std::vector<float>& audio) {
  double result = 0.0;
  for (std::size_t index = 0U; index < audio.size(); ++index) {
    assert(std::isfinite(audio[index]));
    assert(std::abs(audio[index]) < 1.25F);
    result += std::abs(static_cast<double>(audio[index]))
        * static_cast<double>((index % 193U) + 1U);
  }
  return result;
}

void warm(calcotone::NativeDreamEngine& dream, calcotone::RackModule source_module,
          std::size_t frames) {
  auto input = source(frames);
  std::vector<float> lane_one(kBlock * 2U);
  std::vector<float> lane_two(kBlock * 2U);
  for (std::size_t offset = 0U; offset < frames; offset += kBlock) {
    const auto block = std::min(kBlock, frames - offset);
    std::copy_n(input.data() + offset * 2U, block * 2U, lane_one.data());
    std::copy_n(input.data() + offset * 2U, block * 2U, lane_two.data());
    dream.begin_block(block);
    dream.capture_module(source_module, lane_one.data(), lane_two.data(), block, true);
    dream.finish_block(lane_one.data(), lane_two.data(), block, true);
  }
}

std::vector<float> render_tail(calcotone::NativeDreamEngine& dream,
                               std::size_t frames, bool processed) {
  std::vector<float> output(frames * 2U, 0.F);
  std::vector<float> lane_one(kBlock * 2U, 0.F);
  std::vector<float> lane_two(kBlock * 2U, 0.F);
  for (std::size_t offset = 0U; offset < frames; offset += kBlock) {
    const auto block = std::min(kBlock, frames - offset);
    std::fill_n(lane_one.data(), block * 2U, 0.F);
    std::fill_n(lane_two.data(), block * 2U, 0.F);
    dream.begin_block(block);
    dream.finish_block(lane_one.data(), lane_two.data(), block, processed);
    for (std::size_t sample = 0U; sample < block * 2U; ++sample)
      output[offset * 2U + sample] = (lane_one[sample] + lane_two[sample]) * .7071067811865475F;
  }
  return output;
}

void test_idle_raw_does_not_fill_memory() {
  calcotone::NativeDreamEngine dream(kRate, kBlock);
  std::vector<float> lane_one(kBlock * 2U, 0.F);
  std::vector<float> lane_two(kBlock * 2U, 0.F);
  for (unsigned block = 0U; block < 3000U; ++block) {
    dream.begin_block(kBlock);
    dream.finish_block(lane_one.data(), lane_two.data(), kBlock, false);
  }
  const auto profile = dream.profile();
  assert(profile.fill_ratio == 0.F);
  assert(profile.history_seconds == 8.F);
  assert(profile.input_peak == 0.F);
  assert(profile.captures == 0U);
  assert(std::all_of(lane_one.begin(), lane_one.end(), [](float value) { return value == 0.F; }));
  assert(std::all_of(lane_two.begin(), lane_two.end(), [](float value) { return value == 0.F; }));
}

void test_master_return_is_parallel_and_bounded() {
  calcotone::NativeDreamEngine dream(kRate, kBlock);
  warm(dream, calcotone::RackModule::Halo, 96'000U);
  const auto tail = render_tail(dream, 24'000U, true);
  assert(signature(tail) > 1.0);
  assert(dream.profile().fill_ratio > .20F);
}

void test_module_send_laws_are_distinct() {
  calcotone::NativeDreamEngine ember(kRate, kBlock);
  calcotone::NativeDreamEngine delay(kRate, kBlock);
  warm(ember, calcotone::RackModule::Ember, 96'000U);
  warm(delay, calcotone::RackModule::Halo, 96'000U);
  const auto ember_tail = render_tail(ember, 24'000U, true);
  const auto delay_tail = render_tail(delay, 24'000U, true);
  assert(signature(delay_tail) > signature(ember_tail) * 1.35);
}

void test_now_echo_and_ghost_routes_are_distinct() {
  calcotone::NativeDreamEngine dream(kRate, kBlock);
  warm(dream, calcotone::RackModule::Halo, 300'000U);

  std::vector<float> now_lane_one(kBlock * 2U, 0.F), now_lane_two(kBlock * 2U, 0.F);
  std::vector<float> echo_lane_one(kBlock * 2U, 0.F), echo_lane_two(kBlock * 2U, 0.F);
  std::vector<float> ghost_lane_one(kBlock * 2U, 0.F), ghost_lane_two(kBlock * 2U, 0.F);
  double now_signature = 0.0, echo_signature = 0.0, ghost_signature = 0.0;
  for (unsigned block_index = 0U; block_index < 160U; ++block_index) {
    std::fill(now_lane_one.begin(), now_lane_one.end(), 0.F);
    std::fill(now_lane_two.begin(), now_lane_two.end(), 0.F);
    std::fill(echo_lane_one.begin(), echo_lane_one.end(), 0.F);
    std::fill(echo_lane_two.begin(), echo_lane_two.end(), 0.F);
    std::fill(ghost_lane_one.begin(), ghost_lane_one.end(), 0.F);
    std::fill(ghost_lane_two.begin(), ghost_lane_two.end(), 0.F);
    dream.begin_block(kBlock);
    dream.inject_route(calcotone::RackModule::Drift, now_lane_one.data(), now_lane_two.data(), kBlock, true);
    dream.inject_route(calcotone::RackModule::Ember, echo_lane_one.data(), echo_lane_two.data(), kBlock, true);
    dream.inject_route(calcotone::RackModule::Artifact, ghost_lane_one.data(), ghost_lane_two.data(), kBlock, true);
    dream.finish_block(now_lane_one.data(), now_lane_two.data(), kBlock, false);
    now_signature += signature(now_lane_one);
    echo_signature += signature(echo_lane_one);
    ghost_signature += signature(ghost_lane_one);
  }
  assert(now_signature > 0.01);
  assert(echo_signature > 0.01);
  assert(ghost_signature > 0.001);
  assert(std::abs(now_signature - echo_signature) > 0.01);
  assert(std::abs(echo_signature - ghost_signature) > 0.01);
}

void test_raw_mode_rejects_warmed_memory() {
  calcotone::NativeDreamEngine dream(kRate, kBlock);
  warm(dream, calcotone::RackModule::Atmos, 240'000U);

  auto probe = source(72'000U, .35F);
  std::vector<float> lane_one(kBlock * 2U), lane_two(kBlock * 2U);
  double ending_error = 0.0;
  for (std::size_t offset = 0U; offset < probe.size() / 2U; offset += kBlock) {
    const auto block = std::min(kBlock, probe.size() / 2U - offset);
    std::copy_n(probe.data() + offset * 2U, block * 2U, lane_one.data());
    std::copy_n(probe.data() + offset * 2U, block * 2U, lane_two.data());
    dream.begin_block(block);
    dream.finish_block(lane_one.data(), lane_two.data(), block, false);
    if (offset > 64'000U) {
      for (std::size_t sample = 0U; sample < block * 2U; ++sample) {
        ending_error += std::abs(static_cast<double>(lane_one[sample] - probe[offset * 2U + sample]));
        ending_error += std::abs(static_cast<double>(lane_two[sample] - probe[offset * 2U + sample]));
      }
    }
  }
  assert(ending_error < 1e-4);
}

void test_reset_is_deterministic() {
  calcotone::NativeDreamEngine dream(kRate, kBlock);
  warm(dream, calcotone::RackModule::Grain, 160'000U);
  const auto first = render_tail(dream, 16'000U, true);
  dream.reset();
  warm(dream, calcotone::RackModule::Grain, 160'000U);
  const auto second = render_tail(dream, 16'000U, true);
  assert(first == second);
}
}  // namespace

int main() {
  test_idle_raw_does_not_fill_memory();
  test_master_return_is_parallel_and_bounded();
  test_module_send_laws_are_distinct();
  test_now_echo_and_ghost_routes_are_distinct();
  test_raw_mode_rejects_warmed_memory();
  test_reset_is_deterministic();
}
