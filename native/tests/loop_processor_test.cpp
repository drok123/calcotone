#include "calcotone/loop_processor.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <vector>

namespace {
void fill(std::vector<float>& block, float left, float right) {
  for (std::size_t frame = 0; frame < block.size() / 2U; ++frame) {
    block[frame * 2U] = left;
    block[frame * 2U + 1U] = right;
  }
}

void consume(calcotone::LoopProcessor& loop) {
  std::array<float, 2> sample{};
  loop.process(sample.data(), 1U);
}
}

int main() {
  calcotone::LoopProcessor loop(48'000.F);
  loop.set_enabled(true);
  loop.set_master_level(.8F);
  loop.set_overdub(1.F);
  loop.set_fade(.1F);

  // Track 1 establishes a short phrase.
  loop.set_selected_track(0);
  std::vector<float> short_phrase(256U * 2U);
  fill(short_phrase, .2F, -.2F);
  loop.command(calcotone::LoopCommand::Record);
  loop.process(short_phrase.data(), 256U);
  assert(loop.transport() == calcotone::LoopTransport::Recording);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  assert(loop.loop_frames() == 256U);
  assert(loop.raw_frames() == 256U);
  assert((loop.track_mask() & 1U) != 0U);

  // Track 2 must be allowed to run longer than Track 1. This is the regression
  // that the original shared master_frames design could not support.
  loop.set_selected_track(1);
  consume(loop);
  std::vector<float> long_phrase(768U * 2U);
  fill(long_phrase, .12F, .08F);
  loop.command(calcotone::LoopCommand::Record);
  loop.process(long_phrase.data(), 768U);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  assert(loop.loop_frames() == 768U);
  assert(loop.raw_frames() == 768U);
  assert((loop.track_mask() & 2U) != 0U);

  loop.set_selected_track(0);
  consume(loop);
  assert(loop.loop_frames() == 256U);
  loop.set_selected_track(1);
  consume(loop);
  assert(loop.loop_frames() == 768U);

  // Manual trim is non-destructive: active loop length changes but the raw take remains.
  loop.set_trim(.25F, .75F);
  consume(loop);
  assert(loop.raw_frames() == 768U);
  assert(loop.loop_frames() >= 380U && loop.loop_frames() <= 386U);
  assert(loop.trim_start() > .24F && loop.trim_start() < .26F);
  assert(loop.trim_end() > .74F && loop.trim_end() < .76F);
  loop.reset_trim();
  consume(loop);
  assert(loop.loop_frames() == 768U);
  assert(loop.raw_frames() == 768U);

  // Auto trim uses the stored transient envelope instead of scanning a full
  // 60-second audio buffer on the realtime thread.
  loop.set_selected_track(2);
  consume(loop);
  std::vector<float> transient_phrase(8192U * 2U, 0.F);
  for (std::size_t frame = 2048U; frame < 6144U; ++frame) {
    transient_phrase[frame * 2U] = .3F;
    transient_phrase[frame * 2U + 1U] = -.22F;
  }
  loop.command(calcotone::LoopCommand::Record);
  loop.process(transient_phrase.data(), 8192U);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  const auto raw_before_auto = loop.raw_frames();
  loop.auto_trim();
  consume(loop);
  assert(loop.raw_frames() == raw_before_auto);
  assert(loop.loop_frames() < raw_before_auto);
  assert(loop.trim_start() > 0.F);
  assert(loop.trim_end() < 1.F);
  const auto waveform = loop.waveform();
  assert(*std::max_element(waveform.begin(), waveform.end()) > .9F);

  // Playback still returns stored audio, and clear is selected-track only.
  std::vector<float> silence(256U * 2U, 0.F);
  loop.process(silence.data(), 256U);
  float peak = 0.F;
  for (const auto sample : silence) peak = std::max(peak, std::abs(sample));
  assert(peak > .01F);
  loop.command(calcotone::LoopCommand::Clear);
  consume(loop);
  assert((loop.track_mask() & 4U) == 0U);
  assert((loop.track_mask() & 3U) == 3U);
  return 0;
}
