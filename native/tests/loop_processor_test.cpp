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

void process_sample(calcotone::LoopProcessor& loop, float left, float right) {
  std::array<float, 2> sample{left, right};
  loop.process(sample.data(), 1U);
}

void record_synced(
    calcotone::LoopProcessor& loop,
    unsigned track,
    std::size_t frames,
    float left,
    float right) {
  loop.set_selected_track(track);
  consume(loop);
  loop.command(calcotone::LoopCommand::Record, track);
  std::size_t guard = 0U;
  while (loop.transport() != calcotone::LoopTransport::Recording && guard++ < 1'000'000U)
    process_sample(loop, left, right);
  assert(loop.transport() == calcotone::LoopTransport::Recording);
  assert(frames > 0U);
  if (frames > 1U) {
    std::vector<float> remainder((frames - 1U) * 2U);
    fill(remainder, left, right);
    loop.process(remainder.data(), frames - 1U);
  }
  loop.command(calcotone::LoopCommand::Record, track);
  consume(loop);
  assert(loop.transport() != calcotone::LoopTransport::Recording);
  assert(loop.raw_frames() == frames);
}

void overdub_one_pass(calcotone::LoopProcessor& loop, std::size_t frames, float left, float right) {
  loop.command(calcotone::LoopCommand::Overdub);
  std::size_t guard = 0U;
  while (loop.transport() != calcotone::LoopTransport::Overdubbing && guard++ < 1'000'000U)
    process_sample(loop, left, right);
  assert(loop.transport() == calcotone::LoopTransport::Overdubbing);
  if (frames > 1U) {
    std::vector<float> remainder((frames - 1U) * 2U);
    fill(remainder, left, right);
    loop.process(remainder.data(), frames - 1U);
  }
  assert(loop.transport() == calcotone::LoopTransport::Playing);
}

float render_peak(calcotone::LoopProcessor& processor, std::size_t frames = 64U) {
  std::vector<float> block(frames * 2U, 0.F);
  processor.process(block.data(), frames);
  float maximum = 0.F;
  for (const float sample : block) maximum = std::max(maximum, std::abs(sample));
  return maximum;
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
  record_synced(loop, 1U, 768U, .12F, .08F);
  assert(loop.loop_frames() == 768U);
  assert(loop.raw_frames() == 768U);
  assert((loop.track_mask() & 2U) != 0U);

  loop.set_selected_track(0);
  consume(loop);
  assert(loop.loop_frames() == 256U);
  loop.set_selected_track(1);
  consume(loop);
  assert(loop.loop_frames() == 768U);

  // DUB is an explicit, one-cycle additive pass. Stored audio is never attenuated
  // or replaced, and the engine exits DUB automatically at the same boundary.
  loop.set_selected_track(0);
  consume(loop);
  loop.set_overdub(1.F);
  overdub_one_pass(loop, 256U, .05F, -.04F);
  assert(loop.transport() == calcotone::LoopTransport::Playing);
  assert(loop.loop_frames() == 256U);

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
  loop.command(calcotone::LoopCommand::Record, 3U);
  while (loop.transport() != calcotone::LoopTransport::Recording)
    process_sample(loop, .09F, -.07F);
  loop.process(track_four_phrase.data(), 191U);
  loop.set_selected_track(4);
  loop.process(track_four_phrase.data() + 192U * 2U, 320U);
  loop.command(calcotone::LoopCommand::Record, 3U);
  consume(loop);
  loop.set_selected_track(3);
  consume(loop);
  assert(loop.raw_frames() == 512U);
  assert((loop.track_mask() & (1U << 3U)) != 0U);
  assert((loop.track_mask() & (1U << 4U)) == 0U);

  // Auto trim uses the stored transient envelope instead of scanning a full
  // 60-second audio buffer on the realtime thread.
  calcotone::LoopProcessor trim_loop(48'000.F);
  trim_loop.set_enabled(true);
  trim_loop.set_selected_track(0U);
  std::vector<float> transient_phrase(8192U * 2U, 0.F);
  for (std::size_t frame = 2048U; frame < 6144U; ++frame) {
    transient_phrase[frame * 2U] = .3F;
    transient_phrase[frame * 2U + 1U] = -.22F;
  }
  trim_loop.command(calcotone::LoopCommand::Record);
  trim_loop.process(transient_phrase.data(), 8192U);
  trim_loop.command(calcotone::LoopCommand::Record);
  consume(trim_loop);
  const auto raw_before_auto = trim_loop.raw_frames();
  trim_loop.auto_trim();
  consume(trim_loop);
  assert(trim_loop.raw_frames() == raw_before_auto);
  assert(trim_loop.loop_frames() < raw_before_auto);
  assert(trim_loop.trim_start() > 0.F);
  assert(trim_loop.trim_end() < 1.F);
  const auto waveform = trim_loop.waveform();
  assert(*std::max_element(waveform.begin(), waveform.end()) > .9F);

  // Playback still returns stored audio, and clear is selected-track only.
  std::vector<float> silence(256U * 2U, 0.F);
  loop.process(silence.data(), 256U);
  float peak = 0.F;
  for (const auto sample : silence) peak = std::max(peak, std::abs(sample));
  assert(peak > .01F);
  loop.set_selected_track(3U);
  consume(loop);
  loop.command(calcotone::LoopCommand::Clear);
  consume(loop);
  assert((loop.track_mask() & (1U << 3U)) == 0U);
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
  record_synced(performance_loop, 1U, 128U, .1F, .1F);
  performance_loop.set_selected_track(0U);

  const float both_tracks = render_peak(performance_loop);
  assert(both_tracks > .29F && both_tracks < .31F);

  performance_loop.set_track_level(0U, 3.F);  // private TrackStop sentinel
  (void)render_peak(performance_loop, 128U);
  const float track_one_stopped = render_peak(performance_loop);
  assert(track_one_stopped > .09F && track_one_stopped < .11F);

  performance_loop.set_track_level(0U, 2.F);  // private TrackPlay sentinel
  (void)render_peak(performance_loop, 128U);
  const float track_one_restarted = render_peak(performance_loop);
  assert(track_one_restarted > .29F && track_one_restarted < .31F);

  performance_loop.set_track_level(0U, 4.F);  // private Mute sentinel
  (void)render_peak(performance_loop, 128U);
  const float track_one_muted = render_peak(performance_loop);
  assert(track_one_muted > .09F && track_one_muted < .11F);
  performance_loop.set_track_level(0U, 4.F);
  (void)render_peak(performance_loop, 128U);

  performance_loop.set_track_level(0U, 5.F);  // private Solo sentinel
  (void)render_peak(performance_loop, 128U);
  const float track_one_solo = render_peak(performance_loop);
  assert(track_one_solo > .19F && track_one_solo < .21F);
  performance_loop.set_track_level(0U, 5.F);
  (void)render_peak(performance_loop, 128U);

  performance_loop.set_track_level(0U, .5F);  // ordinary fader remains ordinary
  const float half_track_one = render_peak(performance_loop);
  assert(half_track_one > .19F && half_track_one < .21F);

  // Realtime-safe UNDO/REDO journals only the frames touched by one DUB session.
  // Swapping happens one sample per callback frame, so no full-loop memcpy can
  // block the audio thread. The same journal naturally becomes REDO after UNDO.
  calcotone::LoopProcessor journal_loop(48'000.F);
  journal_loop.set_enabled(true);
  journal_loop.set_master_level(1.F);
  journal_loop.set_fade(0.F);
  journal_loop.set_track_level(0U, 1.F);
  std::vector<float> base_take(128U * 2U);
  fill(base_take, .2F, .2F);
  journal_loop.set_selected_track(0U);
  journal_loop.command(calcotone::LoopCommand::Record);
  journal_loop.process(base_take.data(), 128U);
  journal_loop.command(calcotone::LoopCommand::Record);
  consume(journal_loop);

  journal_loop.set_overdub(1.F);
  overdub_one_pass(journal_loop, 128U, .05F, .05F);
  const float dubbed_peak = render_peak(journal_loop, 128U);
  assert(dubbed_peak > .249F && dubbed_peak < .251F);

  journal_loop.set_track_level(0U, 6.F);  // private UNDO sentinel
  consume(journal_loop);
  std::vector<float> undo_swap(128U * 2U, 0.F);
  journal_loop.process(undo_swap.data(), 128U);
  const float undone_peak = render_peak(journal_loop, 128U);
  assert(undone_peak > .199F && undone_peak < .201F);

  journal_loop.set_track_level(0U, 7.F);  // private REDO sentinel
  consume(journal_loop);
  std::vector<float> redo_swap(128U * 2U, 0.F);
  journal_loop.process(redo_swap.data(), 128U);
  const float redone_peak = render_peak(journal_loop, 128U);
  assert(redone_peak > .249F && redone_peak < .251F);

  // BOUNCE renders the audible pre-master loop bus into an empty track, then
  // leaves that destination stopped so the mix is not automatically doubled.
  performance_loop.set_selected_track(2U);
  performance_loop.set_track_level(2U, 8.F);  // private BOUNCE sentinel
  std::vector<float> bounce_window(256U * 2U, 0.F);
  performance_loop.process(bounce_window.data(), 256U);
  consume(performance_loop);
  assert((performance_loop.track_mask() & (1U << 2U)) != 0U);
  performance_loop.set_track_level(0U, 3.F);
  performance_loop.set_track_level(1U, 3.F);
  performance_loop.set_track_level(2U, 2.F);
  const float bounced_peak = render_peak(performance_loop, 64U);
  assert(bounced_peak > .19F && bounced_peak < .21F);

  // Quantization is sample-clock owned. First REC establishes phase immediately;
  // its stop request at 120 BPM / beat quantize must wait until frame 24,000.
  calcotone::LoopProcessor quantized_loop(48'000.F);
  quantized_loop.set_enabled(true);
  quantized_loop.set_track_level(7U, 1120.F);  // native clock control: 120 BPM
  quantized_loop.set_track_level(7U, 2001.F);  // native clock control: beat quantize
  quantized_loop.set_selected_track(0U);
  std::vector<float> quantized_start(100U * 2U);
  fill(quantized_start, .1F, .1F);
  quantized_loop.command(calcotone::LoopCommand::Record);
  quantized_loop.process(quantized_start.data(), 100U);
  assert(quantized_loop.transport() == calcotone::LoopTransport::Recording);
  quantized_loop.command(calcotone::LoopCommand::Record);
  std::vector<float> until_boundary(23'900U * 2U);
  fill(until_boundary, .1F, .1F);
  quantized_loop.process(until_boundary.data(), 23'900U);
  assert(quantized_loop.transport() == calcotone::LoopTransport::Recording);
  consume(quantized_loop);
  assert(quantized_loop.transport() == calcotone::LoopTransport::Playing);
  assert(quantized_loop.raw_frames() == 24'000U);

  // Unity defaults are a fidelity guarantee: the stored float samples return at
  // the same level and polarity as the reference material when no fader is moved.
  calcotone::LoopProcessor unity_loop(48'000.F);
  unity_loop.set_enabled(true);
  std::vector<float> unity_take(128U * 2U);
  fill(unity_take, .137F, -.211F);
  unity_loop.command(calcotone::LoopCommand::Record);
  unity_loop.process(unity_take.data(), 128U);
  for (std::size_t frame = 0U; frame < 128U; ++frame) {
    assert(std::abs(unity_take[frame * 2U] - .137F) < 1e-7F);
    assert(std::abs(unity_take[frame * 2U + 1U] + .211F) < 1e-7F);
  }
  unity_loop.command(calcotone::LoopCommand::Record);
  consume(unity_loop);
  std::vector<float> unity_playback(128U * 2U, 0.F);
  unity_loop.process(unity_playback.data(), 128U);
  for (std::size_t frame = 0U; frame < 128U; ++frame) {
    assert(std::abs(unity_playback[frame * 2U] - .137F) < 1e-7F);
    assert(std::abs(unity_playback[frame * 2U + 1U] + .211F) < 1e-7F);
  }
  const auto loop_analysis = unity_loop.analysis();
  assert(loop_analysis.energy > .1F && loop_analysis.energy < .3F);
  assert(loop_analysis.transient >= 0.F && loop_analysis.transient <= 1.F);
  assert(loop_analysis.brightness >= 0.F && loop_analysis.brightness <= 1.F);
  assert(loop_analysis.stereo_width > .5F && loop_analysis.stereo_width < .9F);

  // 505-style Loop Sync: the first take owns the 128-frame master cycle, the
  // next take lands on an exact three-cycle multiple, and sixteen more cycles
  // return to the identical reference phase without accumulated drift.
  calcotone::LoopProcessor sync_loop(48'000.F);
  sync_loop.set_enabled(true);
  std::vector<float> sync_master(128U * 2U);
  fill(sync_master, .2F, .2F);
  sync_loop.command(calcotone::LoopCommand::Record);
  sync_loop.process(sync_master.data(), 128U);
  sync_loop.command(calcotone::LoopCommand::Record);
  consume(sync_loop);
  record_synced(sync_loop, 1U, 384U, .1F, .1F);
  assert(sync_loop.reference_frames() == 128U);
  const auto phase_before = sync_loop.reference_position();
  std::vector<float> sixteen_cycles(128U * 16U * 2U, 0.F);
  sync_loop.process(sixteen_cycles.data(), 128U * 16U);
  assert(sync_loop.reference_position() == phase_before);
  return 0;
}
