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

  // DUB is a latched live-replace pass. With RETAIN=0, exactly one full pass
  // must erase the previous Track 1 performance without changing its loop length.
  loop.set_selected_track(0);
  consume(loop);
  loop.set_overdub(0.F);
  loop.command(calcotone::LoopCommand::Overdub);
  consume(loop);
  assert(loop.transport() == calcotone::LoopTransport::Overdubbing);
  std::vector<float> replacement(256U * 2U);
  fill(replacement, .05F, -.04F);
  loop.process(replacement.data(), 256U);
  loop.command(calcotone::LoopCommand::Overdub);
  consume(loop);
  assert(loop.transport() == calcotone::LoopTransport::Playing);
  assert(loop.loop_frames() == 256U);
  std::vector<float> replaced_playback(256U * 2U, 0.F);
  loop.process(replaced_playback.data(), 256U);
  float replaced_peak = 0.F;
  for (const auto sample : replaced_playback) replaced_peak = std::max(replaced_peak, std::abs(sample));
  assert(replaced_peak > .02F);
  assert(replaced_peak < .05F);

  loop.set_selected_track(1);
  consume(loop);

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

  // Track 4 must arm reliably, and changing the selected UI track while REC is
  // active must never steal the recording target underneath the audio thread.
  loop.set_selected_track(3);
  consume(loop);
  std::vector<float> track_four_phrase(512U * 2U);
  fill(track_four_phrase, .09F, -.07F);
  loop.command(calcotone::LoopCommand::Record);
  loop.process(track_four_phrase.data(), 192U);
  loop.set_selected_track(4);
  loop.process(track_four_phrase.data() + 192U * 2U, 320U);
  loop.command(calcotone::LoopCommand::Record);
  consume(loop);
  loop.set_selected_track(3);
  consume(loop);
  assert(loop.raw_frames() == 512U);
  assert((loop.track_mask() & (1U << 3U)) != 0U);
  assert((loop.track_mask() & (1U << 4U)) == 0U);

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

  // RC-style performance commands are true engine state, not fader tricks.
  // The Windows bridge encodes them above the physical 0..1 fader range; prove
  // STOP/START, MUTE, SOLO and an ordinary fader write all produce distinct sums.
  calcotone::LoopProcessor performance_loop(48'000.F);
  performance_loop.set_enabled(true);
  performance_loop.set_master_level(1.F);
  performance_loop.set_fade(0.F);
  performance_loop.set_track_level(0U, 1.F);
  performance_loop.set_track_level(1U, 1.F);

  std::vector<float> track_one(128U * 2U);
  fill(track_one, .2F, .2F);
  performance_loop.set_selected_track(0U);
  performance_loop.command(calcotone::LoopCommand::Record);
  performance_loop.process(track_one.data(), 128U);
  performance_loop.command(calcotone::LoopCommand::Record);
  consume(performance_loop);

  std::vector<float> track_two(128U * 2U);
  fill(track_two, .1F, .1F);
  performance_loop.set_selected_track(1U);
  performance_loop.command(calcotone::LoopCommand::Record);
  performance_loop.process(track_two.data(), 128U);
  performance_loop.command(calcotone::LoopCommand::Record);
  consume(performance_loop);
  performance_loop.set_selected_track(0U);

  const auto render_peak = [](calcotone::LoopProcessor& processor) {
    std::vector<float> block(64U * 2U, 0.F);
    processor.process(block.data(), 64U);
    float maximum = 0.F;
    for (const float sample : block) maximum = std::max(maximum, std::abs(sample));
    return maximum;
  };

  const float both_tracks = render_peak(performance_loop);
  assert(both_tracks > .29F && both_tracks < .31F);

  performance_loop.set_track_level(0U, 3.F);  // private TrackStop sentinel
  const float track_one_stopped = render_peak(performance_loop);
  assert(track_one_stopped > .09F && track_one_stopped < .11F);

  performance_loop.set_track_level(0U, 2.F);  // private TrackPlay sentinel
  const float track_one_restarted = render_peak(performance_loop);
  assert(track_one_restarted > .29F && track_one_restarted < .31F);

  performance_loop.set_track_level(0U, 4.F);  // private Mute sentinel
  const float track_one_muted = render_peak(performance_loop);
  assert(track_one_muted > .09F && track_one_muted < .11F);
  performance_loop.set_track_level(0U, 4.F);

  performance_loop.set_track_level(0U, 5.F);  // private Solo sentinel
  const float track_one_solo = render_peak(performance_loop);
  assert(track_one_solo > .19F && track_one_solo < .21F);
  performance_loop.set_track_level(0U, 5.F);

  performance_loop.set_track_level(0U, .5F);  // ordinary fader remains ordinary
  const float half_track_one = render_peak(performance_loop);
  assert(half_track_one > .19F && half_track_one < .21F);
  return 0;
}
