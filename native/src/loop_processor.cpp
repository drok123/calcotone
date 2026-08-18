#include "calcotone/loop_processor.hpp"

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
constexpr std::size_t kMinimumLoopFrames = 64U;
constexpr unsigned kQuantizeOff = 0U;
constexpr unsigned kQuantizeBeat = 1U;
constexpr unsigned kQuantizeBar = 2U;
constexpr unsigned kScheduledSlots = kLoopTrackCount + 4U;
constexpr unsigned kCommandQueueSlots = 64U;
constexpr unsigned kAutoTrimAction = 100U;
constexpr unsigned kResetTrimAction = 101U;
constexpr std::uint64_t kNoDue = std::numeric_limits<std::uint64_t>::max();
constexpr std::size_t kUndoScanPerAudioFrame = 64U;
constexpr std::size_t kUndoScanMinimum = 4'096U;
constexpr std::size_t kUndoScanMaximum = 131'072U;

float clamp01(float value) noexcept {
  return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F);
}
float clamp_bpm(float value) noexcept {
  return std::clamp(std::isfinite(value) ? value : 120.F, 30.F, 300.F);
}
}

struct LoopProcessor::Impl {
  struct ScheduledCommand {
    bool active{};
    std::uint64_t due{};
    LoopCommand command{LoopCommand::Play};
    unsigned track{};
  };

  struct PendingAction {
    unsigned code{};
    unsigned track{};
  };

  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        max_frames(static_cast<std::size_t>(std::ceil(rate * kLoopMaxSeconds))),
        envelope_scale(static_cast<float>(kLoopEnvelopeBins) / static_cast<float>(max_frames)),
        waveform_publish_period(std::max<std::size_t>(1U, static_cast<std::size_t>(rate / 10.F))),
        analysis_fast_attack(1.F - std::exp(-1.F / (rate * .002F))),
        analysis_fast_release(1.F - std::exp(-1.F / (rate * .025F))),
        analysis_slow(1.F - std::exp(-1.F / (rate * .120F))) {
    for (auto& level : track_levels) level.store(1.F, std::memory_order_relaxed);
    cached_fade = 0.F;
    refresh_fade_cache();
  }

  static std::uint32_t bit(unsigned track) noexcept { return 1U << track; }

  bool ensure_track_buffer(unsigned track) noexcept {
    if (track >= kLoopTrackCount) return false;
    if (tracks[track].size() == max_frames * 2U) return true;
    try {
      tracks[track].assign(max_frames * 2U, 0.F);
      return true;
    } catch (...) {
      return false;
    }
  }

  bool ensure_undo_journal(unsigned track) noexcept {
    if (track >= kLoopTrackCount) return false;
    if (undo_tracks[track].size() == max_frames * 2U && undo_tags[track].size() == max_frames) return true;
    try {
      undo_tracks[track].assign(max_frames * 2U, 0.F);
      undo_tags[track].assign(max_frames, 0U);
      return true;
    } catch (...) {
      undo_tracks[track].clear();
      undo_tags[track].clear();
      return false;
    }
  }

  bool any_occupied() const noexcept { return occupied_mask != 0U; }
  bool any_active_occupied() const noexcept { return (occupied_mask & active_mask) != 0U; }
  bool any_solo_occupied() const noexcept { return (occupied_mask & solo_mask) != 0U; }

  std::size_t active_length(unsigned track) const noexcept {
    return track < kLoopTrackCount ? lengths[track] : 0U;
  }

  void update_sync_clock(bool reset = false) noexcept {
    std::size_t frames = 0U;
    for (unsigned track = 0U; track < kLoopTrackCount; ++track) {
      if ((occupied_mask & bit(track)) != 0U && active_length(track) > 0U) {
        frames = active_length(track);
        break;
      }
    }
    if (frames != sync_frames || reset) {
      sync_frames = frames;
      sync_position = frames > 0U && !reset ? sync_position % frames : 0U;
    }
  }

  void update_length(unsigned track) noexcept {
    if (track >= kLoopTrackCount || (occupied_mask & bit(track)) == 0U || trim_end_frames[track] <= trim_start_frames[track]) {
      lengths[track] = 0U;
      fade_frames[track] = 0U;
      return;
    }
    lengths[track] = trim_end_frames[track] - trim_start_frames[track];
    fade_frames[track] = std::min<std::size_t>(
        lengths[track] / 4U,
        static_cast<std::size_t>(std::round(cached_fade * .02F * rate)));
  }

  void refresh_fade_cache() noexcept {
    cached_fade = clamp01(fade.load(std::memory_order_relaxed));
    for (unsigned track = 0U; track < kLoopTrackCount; ++track) update_length(track);
    fade_refresh_pending.store(false, std::memory_order_relaxed);
  }

  std::uint64_t quantize_frames() const noexcept {
    const unsigned mode = quantize_mode.load(std::memory_order_relaxed);
    if (mode == kQuantizeOff) return 0U;
    const float current_bpm = clamp_bpm(bpm.load(std::memory_order_relaxed));
    const auto beat = std::max<std::uint64_t>(
        kMinimumLoopFrames,
        static_cast<std::uint64_t>(std::llround(static_cast<double>(rate) * 60.0 / static_cast<double>(current_bpm))));
    return mode == kQuantizeBar ? beat * 4U : beat;
  }

  std::uint64_t next_boundary() const noexcept {
    if (sync_frames > 0U && playing) {
      const auto phase = sync_position % sync_frames;
      return clock_frame + (phase == 0U ? 0U : sync_frames - phase);
    }
    const auto quantum = quantize_frames();
    if (quantum == 0U) return clock_frame;
    return (clock_frame / quantum + 1U) * quantum;
  }

  bool should_quantize(LoopCommand command) const noexcept {
    return command == LoopCommand::Record || command == LoopCommand::Overdub || command == LoopCommand::Play
        || command == LoopCommand::TrackPlay || command == LoopCommand::TrackStop
        || command == LoopCommand::Undo || command == LoopCommand::Redo || command == LoopCommand::Bounce;
  }

  void recompute_next_scheduled_due() noexcept {
    next_scheduled_due = kNoDue;
    for (const auto& slot : scheduled)
      if (slot.active) next_scheduled_due = std::min(next_scheduled_due, slot.due);
  }

  void schedule_command(LoopCommand command, unsigned track) noexcept {
    const auto due = next_boundary();
    for (auto& slot : scheduled) {
      if (slot.active && slot.track == track && slot.command == command) {
        slot = ScheduledCommand{true, due, command, track};
        recompute_next_scheduled_due();
        return;
      }
    }
    for (auto& slot : scheduled) {
      if (!slot.active) {
        slot = ScheduledCommand{true, due, command, track};
        next_scheduled_due = std::min(next_scheduled_due, due);
        return;
      }
    }
    scheduled[0] = ScheduledCommand{true, due, command, track};
    recompute_next_scheduled_due();
  }

  bool enqueue_action(unsigned code, unsigned track) noexcept {
    const unsigned write = command_write.load(std::memory_order_relaxed);
    const unsigned next = (write + 1U) % kCommandQueueSlots;
    if (next == command_read.load(std::memory_order_acquire)) return false;
    command_queue[write] = PendingAction{code, std::min(track, kLoopTrackCount - 1U)};
    command_write.store(next, std::memory_order_release);
    return true;
  }

  bool dequeue_action(PendingAction& action) noexcept {
    const unsigned read = command_read.load(std::memory_order_relaxed);
    if (read == command_write.load(std::memory_order_acquire)) return false;
    action = command_queue[read];
    command_read.store((read + 1U) % kCommandQueueSlots, std::memory_order_release);
    return true;
  }

  void clear_envelope(unsigned track) noexcept {
    envelopes[track].fill(0.F);
    replace_envelope_bin[track] = kLoopEnvelopeBins;
    waveform_refresh_pending.store(true, std::memory_order_relaxed);
  }

  void update_envelope(unsigned track, std::size_t frame, float left, float right, bool replace) noexcept {
    const auto bin = std::min<std::size_t>(kLoopEnvelopeBins - 1U,
        static_cast<std::size_t>(static_cast<float>(frame) * envelope_scale));
    const float peak = std::max(std::abs(left), std::abs(right));
    if (replace && replace_envelope_bin[track] != bin) {
      envelopes[track][bin] = peak;
      replace_envelope_bin[track] = bin;
    } else {
      envelopes[track][bin] = std::max(envelopes[track][bin], peak);
    }
    waveform_refresh_pending.store(true, std::memory_order_relaxed);
  }

  void invalidate_journal(unsigned track) noexcept {
    undo_ready[track] = false;
    redo_ready[track] = false;
    swap_mode[track] = 0U;
    swap_remaining[track] = 0U;
    undo_touched[track] = 0U;
  }

  bool begin_overdub_journal(unsigned track) noexcept {
    if (undo_tracks[track].size() != max_frames * 2U || undo_tags[track].size() != max_frames) return false;
    auto generation = static_cast<std::uint16_t>(undo_generation[track] + 1U);
    if (generation == 0U) {
      std::fill(undo_tags[track].begin(), undo_tags[track].end(), static_cast<std::uint16_t>(0U));
      generation = 1U;
    }
    undo_generation[track] = generation;
    undo_touched[track] = 0U;
    undo_ready[track] = false;
    redo_ready[track] = false;
    swap_mode[track] = 0U;
    replace_envelope_bin[track] = kLoopEnvelopeBins;
    return true;
  }

  void journal_before_write(unsigned track, std::size_t absolute, std::size_t write, const std::vector<float>& buffer) noexcept {
    if (undo_tracks[track].size() != max_frames * 2U || undo_tags[track].size() != max_frames) return;
    const auto generation = undo_generation[track];
    if (generation == 0U || undo_tags[track][absolute] == generation) return;
    undo_tracks[track][write] = buffer[write];
    undo_tracks[track][write + 1U] = buffer[write + 1U];
    undo_tags[track][absolute] = generation;
    ++undo_touched[track];
  }

  void finish_overdub() noexcept {
    if (!overdubbing) return;
    const unsigned track = overdub_track;
    overdubbing = false;
    overdub_remaining = 0U;
    undo_ready[track] = undo_touched[track] > 0U;
    redo_ready[track] = false;
    waveform_refresh_pending.store(true, std::memory_order_relaxed);
  }

  void begin_journal_swap(unsigned track, unsigned mode) noexcept {
    if (track >= kLoopTrackCount || (occupied_mask & bit(track)) == 0U || swap_mode[track] != 0U) return;
    if (mode == 1U && !undo_ready[track]) return;
    if (mode == 2U && !redo_ready[track]) return;
    const auto length = active_length(track);
    if (length == 0U || undo_tracks[track].empty() || undo_tags[track].empty()) return;
    swap_mode[track] = mode;
    swap_cursor[track] = 0U;
    swap_remaining[track] = length;
  }

  void apply_journal_swap_budget(unsigned track, std::size_t budget) noexcept {
    const unsigned mode = swap_mode[track];
    if (mode == 0U || budget == 0U) return;
    const auto length = active_length(track);
    if (length == 0U || tracks[track].empty() || undo_tracks[track].empty() || undo_tags[track].empty()) {
      swap_mode[track] = 0U;
      swap_remaining[track] = 0U;
      return;
    }
    auto remaining_budget = std::min(budget, swap_remaining[track]);
    while (remaining_budget-- > 0U && swap_remaining[track] > 0U) {
      const auto relative = std::min(swap_cursor[track], length - 1U);
      const auto absolute = trim_start_frames[track] + relative;
      if (undo_tags[track][absolute] == undo_generation[track]) {
        const auto index = absolute * 2U;
        std::swap(tracks[track][index], undo_tracks[track][index]);
        std::swap(tracks[track][index + 1U], undo_tracks[track][index + 1U]);
      }
      swap_cursor[track] = relative + 1U >= length ? 0U : relative + 1U;
      --swap_remaining[track];
    }
    if (swap_remaining[track] == 0U) {
      swap_mode[track] = 0U;
      if (mode == 1U) {
        undo_ready[track] = false;
        redo_ready[track] = true;
      } else {
        undo_ready[track] = true;
        redo_ready[track] = false;
      }
      waveform_refresh_pending.store(true, std::memory_order_relaxed);
    }
  }

  void apply_journal_swaps(std::size_t frames) noexcept {
    const auto budget = std::clamp<std::size_t>(frames * kUndoScanPerAudioFrame, kUndoScanMinimum, kUndoScanMaximum);
    for (unsigned track = 0U; track < kLoopTrackCount; ++track)
      if (swap_mode[track] != 0U) apply_journal_swap_budget(track, budget);
  }

  void start_recording(unsigned track) noexcept {
    const auto track_bit = bit(track);
    occupied_mask &= ~track_bit;
    active_mask |= track_bit;
    mute_mask &= ~track_bit;
    solo_mask &= ~track_bit;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    lengths[track] = 0U;
    fade_frames[track] = 0U;
    positions[track] = 0U;
    invalidate_journal(track);
    clear_envelope(track);
    update_sync_clock();
    recording = true;
    record_track = track;
    overdubbing = false;
    overdub_remaining = 0U;
    record_count = 0U;
    playing = true;
  }

  void finish_recording(unsigned track) noexcept {
    const auto track_bit = bit(track);
    const bool establishing_sync = sync_frames == 0U;
    if (record_count >= kMinimumLoopFrames) {
      const auto frames = std::min(max_frames, record_count);
      raw_frames[track] = frames;
      trim_start_frames[track] = 0U;
      trim_end_frames[track] = frames;
      occupied_mask |= track_bit;
      active_mask |= track_bit;
      update_length(track);
      update_sync_clock(establishing_sync);
      positions[track] = 0U;
      playing = true;
    } else {
      occupied_mask &= ~track_bit;
      active_mask &= ~track_bit;
      lengths[track] = 0U;
    }
    recording = false;
    record_count = 0U;
    playing = playing && (any_active_occupied() || overdubbing);
    waveform_refresh_pending.store(true, std::memory_order_relaxed);
  }

  void clear_track(unsigned track) noexcept {
    const auto track_bit = bit(track);
    occupied_mask &= ~track_bit;
    active_mask &= ~track_bit;
    mute_mask &= ~track_bit;
    solo_mask &= ~track_bit;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    lengths[track] = 0U;
    fade_frames[track] = 0U;
    positions[track] = 0U;
    invalidate_journal(track);
    if (recording && record_track == track) {
      recording = false;
      record_count = 0U;
    }
    if (overdubbing && overdub_track == track) finish_overdub();
    if (bouncing && bounce_track == track) bouncing = false;
    if (!any_active_occupied()) playing = false;
    clear_envelope(track);
    update_sync_clock();
  }

  void set_trim_window(unsigned track, float requested_start, float requested_end) noexcept {
    const auto raw = raw_frames[track];
    if ((occupied_mask & bit(track)) == 0U || raw < kMinimumLoopFrames) return;
    const auto minimum = std::min(raw, kMinimumLoopFrames);
    auto start = static_cast<std::size_t>(std::llround(clamp01(requested_start) * static_cast<float>(raw)));
    auto end = static_cast<std::size_t>(std::llround(clamp01(requested_end) * static_cast<float>(raw)));
    start = std::min(start, raw - minimum);
    end = std::clamp(end, start + minimum, raw);
    trim_start_frames[track] = start;
    trim_end_frames[track] = end;
    update_length(track);
    update_sync_clock();
    positions[track] = std::min(positions[track], lengths[track] > 0U ? lengths[track] - 1U : 0U);
  }

  void reset_trim_window(unsigned track) noexcept {
    if ((occupied_mask & bit(track)) == 0U) return;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = raw_frames[track];
    update_length(track);
    update_sync_clock();
    positions[track] = 0U;
  }

  std::size_t used_envelope_bins(unsigned track) const noexcept {
    const double used = std::ceil(static_cast<double>(raw_frames[track])
        * static_cast<double>(kLoopEnvelopeBins) / static_cast<double>(max_frames));
    return std::clamp<std::size_t>(static_cast<std::size_t>(std::max(1.0, used)), 1U, kLoopEnvelopeBins);
  }

  void auto_trim_window(unsigned track) noexcept {
    if ((occupied_mask & bit(track)) == 0U || raw_frames[track] < kMinimumLoopFrames) return;
    const auto used = used_envelope_bins(track);
    float peak = 0.F;
    for (std::size_t bin = 0; bin < used; ++bin) peak = std::max(peak, envelopes[track][bin]);
    if (peak <= 1e-6F) return;
    const float threshold = std::max(.004F, peak * .035F);
    std::size_t first = used;
    std::size_t last = 0U;
    for (std::size_t bin = 0; bin < used; ++bin) {
      if (envelopes[track][bin] < threshold) continue;
      first = std::min(first, bin);
      last = bin;
    }
    if (first >= used || last < first) return;
    const double bin_frames = static_cast<double>(max_frames) / static_cast<double>(kLoopEnvelopeBins);
    const auto padding = static_cast<std::size_t>(std::max(1.0, std::round(static_cast<double>(rate) * .004)));
    auto start = static_cast<std::size_t>(std::floor(static_cast<double>(first) * bin_frames));
    start = start > padding ? start - padding : 0U;
    auto end = static_cast<std::size_t>(std::ceil(static_cast<double>(last + 1U) * bin_frames)) + padding;
    end = std::min(raw_frames[track], end);
    if (end - start < kMinimumLoopFrames) end = std::min(raw_frames[track], start + kMinimumLoopFrames);
    if (end - start < kMinimumLoopFrames) start = end > kMinimumLoopFrames ? end - kMinimumLoopFrames : 0U;
    trim_start_frames[track] = start;
    trim_end_frames[track] = end;
    update_length(track);
    update_sync_clock();
    positions[track] = 0U;
  }

  void play_track(unsigned track) noexcept {
    if ((occupied_mask & bit(track)) == 0U || active_length(track) == 0U) return;
    active_mask |= bit(track);
    positions[track] = 0U;
    playing = true;
  }

  void stop_track(unsigned track) noexcept {
    if (recording && record_track == track) finish_recording(track);
    if (overdubbing && overdub_track == track) finish_overdub();
    active_mask &= ~bit(track);
    positions[track] = 0U;
    if (!any_active_occupied()) playing = false;
  }

  void start_bounce(unsigned track) noexcept {
    const auto track_bit = bit(track);
    if (track >= kLoopTrackCount || (occupied_mask & track_bit) != 0U || tracks[track].size() != max_frames * 2U) return;
    const bool soloing = any_solo_occupied();
    std::size_t frames = 0U;
    const std::uint32_t source_mask = occupied_mask & active_mask & ~mute_mask & (soloing ? solo_mask : 0xffU);
    for (unsigned source = 0U; source < kLoopTrackCount; ++source)
      if ((source_mask & bit(source)) != 0U) frames = std::max(frames, active_length(source));
    if (frames < kMinimumLoopFrames) return;
    bounce_track = track;
    bounce_frames = std::min(max_frames, frames);
    bounce_count = 0U;
    bouncing = true;
    occupied_mask &= ~track_bit;
    active_mask &= ~track_bit;
    mute_mask &= ~track_bit;
    solo_mask &= ~track_bit;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    lengths[track] = 0U;
    fade_frames[track] = 0U;
    positions[track] = 0U;
    invalidate_journal(track);
    clear_envelope(track);
  }

  void finish_bounce() noexcept {
    if (!bouncing) return;
    const unsigned track = bounce_track;
    const auto frames = std::min(max_frames, bounce_count);
    bouncing = false;
    bounce_count = 0U;
    if (frames < kMinimumLoopFrames) return;
    raw_frames[track] = frames;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = frames;
    occupied_mask |= bit(track);
    active_mask &= ~bit(track);
    update_length(track);
    update_sync_clock();
    positions[track] = 0U;
    waveform_refresh_pending.store(true, std::memory_order_relaxed);
  }

  void execute_command(LoopCommand command, unsigned track) noexcept {
    if (command == LoopCommand::Record) {
      if (recording) finish_recording(record_track);
      else if (tracks[track].size() == max_frames * 2U) start_recording(track);
      return;
    }
    if (command == LoopCommand::Overdub) {
      if (overdubbing) {
        finish_overdub();
      } else if ((occupied_mask & bit(track)) != 0U && active_length(track) > 0U && begin_overdub_journal(track)) {
        overdub_track = track;
        overdub_remaining = active_length(track);
        active_mask |= bit(track);
        overdubbing = true;
        recording = false;
        playing = true;
      }
      return;
    }
    if (command == LoopCommand::Play) {
      if (any_occupied()) {
        const bool stop_all = any_active_occupied();
        for (unsigned index = 0U; index < kLoopTrackCount; ++index)
          if ((occupied_mask & bit(index)) != 0U) positions[index] = 0U;
        if (stop_all) active_mask &= ~occupied_mask;
        else active_mask |= occupied_mask;
        sync_position = 0U;
        playing = !stop_all;
        if (overdubbing) finish_overdub();
        recording = false;
        record_count = 0U;
      }
      return;
    }
    if (command == LoopCommand::Clear) { clear_track(track); return; }
    if (command == LoopCommand::TrackPlay) { play_track(track); return; }
    if (command == LoopCommand::TrackStop) { stop_track(track); return; }
    if (command == LoopCommand::Mute) { if ((occupied_mask & bit(track)) != 0U) mute_mask ^= bit(track); return; }
    if (command == LoopCommand::Solo) { if ((occupied_mask & bit(track)) != 0U) solo_mask ^= bit(track); return; }
    if (command == LoopCommand::Undo) { begin_journal_swap(track, 1U); return; }
    if (command == LoopCommand::Redo) { begin_journal_swap(track, 2U); return; }
    if (command == LoopCommand::Bounce) start_bounce(track);
  }

  void handle_command(LoopCommand command, unsigned track) noexcept {
    const bool first_record = command == LoopCommand::Record && !any_occupied() && !recording;
    if (first_record) {
      clock_frame = 0U;
      execute_command(command, track);
      return;
    }
    const bool stopped_undo = (command == LoopCommand::Undo || command == LoopCommand::Redo) && !playing;
    const bool stopping_overdub = command == LoopCommand::Overdub && overdubbing;
    if (should_quantize(command) && (sync_frames > 0U || quantize_frames() > 0U) && !stopped_undo && !stopping_overdub)
      schedule_command(command, track);
    else execute_command(command, track);
  }

  void consume_control() noexcept {
    if (trim_pending.exchange(false, std::memory_order_acq_rel)) {
      set_trim_window(
          trim_track.load(std::memory_order_relaxed),
          trim_start_pending.load(std::memory_order_relaxed),
          trim_end_pending.load(std::memory_order_relaxed));
    }
    PendingAction action{};
    while (dequeue_action(action)) {
      if (action.code == kAutoTrimAction) auto_trim_window(action.track);
      else if (action.code == kResetTrimAction) reset_trim_window(action.track);
      else handle_command(static_cast<LoopCommand>(action.code), action.track);
    }
  }

  void run_due_commands() noexcept {
    if (next_scheduled_due == kNoDue || next_scheduled_due > clock_frame) return;
    for (auto& slot : scheduled) {
      if (!slot.active || slot.due > clock_frame) continue;
      const auto command = slot.command;
      const auto track = slot.track;
      slot.active = false;
      execute_command(command, track);
    }
    recompute_next_scheduled_due();
  }

  void read_track_stereo(unsigned track, float& left, float& right) const noexcept {
    left = 0.F;
    right = 0.F;
    const auto length = lengths[track];
    if (length == 0U || tracks[track].empty()) return;
    const auto relative = std::min(positions[track], length - 1U);
    const auto absolute = trim_start_frames[track] + relative;
    const auto index = absolute * 2U;
    const auto& buffer = tracks[track];
    const auto seam = fade_frames[track];
    if (seam <= 1U || relative < length - seam) {
      left = buffer[index];
      right = buffer[index + 1U];
      return;
    }
    const auto local = relative - (length - seam);
    const float alpha = static_cast<float>(local) / static_cast<float>(seam);
    const auto start_absolute = trim_start_frames[track] + std::min(length - 1U, local);
    const auto start_index = start_absolute * 2U;
    left = buffer[index] * (1.F - alpha) + buffer[start_index] * alpha;
    right = buffer[index + 1U] * (1.F - alpha) + buffer[start_index + 1U] * alpha;
  }

  void advance_track(unsigned track) noexcept {
    const auto length = lengths[track];
    if (length == 0U) { positions[track] = 0U; return; }
    const auto next = positions[track] + 1U;
    positions[track] = next >= length ? 0U : next;
  }

  void process_segment(float* data, std::size_t frames, float loop_level, float overdub_gain) noexcept {
    std::array<float, kLoopTrackCount> levels{};
    std::array<unsigned, kLoopTrackCount> playback_tracks{};
    std::array<unsigned, kLoopTrackCount> advance_tracks{};
    std::size_t playback_count = 0U;
    std::size_t advance_count = 0U;

    const bool soloing = any_solo_occupied();
    const std::uint32_t playback_mask = playing
        ? occupied_mask & active_mask & ~mute_mask & (soloing ? solo_mask : 0xffU)
        : 0U;
    const std::uint32_t advance_mask = playing ? occupied_mask & active_mask : 0U;
    for (unsigned track = 0U; track < kLoopTrackCount; ++track) {
      if ((playback_mask & bit(track)) != 0U) {
        playback_tracks[playback_count++] = track;
        levels[track] = track_levels[track].load(std::memory_order_relaxed);
      }
      if ((advance_mask & bit(track)) != 0U) advance_tracks[advance_count++] = track;
    }

    for (std::size_t frame = 0U; frame < frames; ++frame) {
      const float live_left = std::isfinite(data[frame * 2U]) ? data[frame * 2U] : 0.F;
      const float live_right = std::isfinite(data[frame * 2U + 1U]) ? data[frame * 2U + 1U] : 0.F;
      float loop_left = 0.F;
      float loop_right = 0.F;

      for (std::size_t active = 0U; active < playback_count; ++active) {
        const unsigned track = playback_tracks[active];
        float track_left = 0.F;
        float track_right = 0.F;
        read_track_stereo(track, track_left, track_right);
        loop_left += track_left * levels[track];
        loop_right += track_right * levels[track];
      }

      data[frame * 2U] = live_left + loop_left * loop_level;
      data[frame * 2U + 1U] = live_right + loop_right * loop_level;

      const float mono = (loop_left + loop_right) * .5F;
      const float magnitude = std::max(std::abs(loop_left), std::abs(loop_right));
      analysis_fast_envelope += (magnitude - analysis_fast_envelope)
          * (magnitude > analysis_fast_envelope ? analysis_fast_attack : analysis_fast_release);
      analysis_slow_envelope += (magnitude - analysis_slow_envelope) * analysis_slow;
      analysis_energy_sum += magnitude;
      analysis_brightness_sum += std::abs(mono - analysis_previous_mono);
      analysis_width_sum += std::abs(loop_left - loop_right) * .5F;
      analysis_transient_peak = std::max(
          analysis_transient_peak, std::max(0.F, analysis_fast_envelope - analysis_slow_envelope));
      analysis_previous_mono = mono;
      ++analysis_block_frames;

      if (recording) {
        auto& buffer = tracks[record_track];
        if (record_count < max_frames && !buffer.empty()) {
          const auto write = record_count * 2U;
          buffer[write] = live_left;
          buffer[write + 1U] = live_right;
          update_envelope(record_track, record_count, live_left, live_right, false);
          ++record_count;
        }
      } else if (overdubbing && (occupied_mask & bit(overdub_track)) != 0U) {
        auto& buffer = tracks[overdub_track];
        const auto length = lengths[overdub_track];
        if (length > 0U && !buffer.empty()) {
          const auto relative = std::min(positions[overdub_track], length - 1U);
          const auto absolute = trim_start_frames[overdub_track] + relative;
          const auto write = absolute * 2U;
          journal_before_write(overdub_track, absolute, write, buffer);
          const float next_left = buffer[write] + live_left * overdub_gain;
          const float next_right = buffer[write + 1U] + live_right * overdub_gain;
          buffer[write] = next_left;
          buffer[write + 1U] = next_right;
          update_envelope(overdub_track, absolute, next_left, next_right, false);
          if (overdub_remaining > 0U) --overdub_remaining;
          if (overdub_remaining == 0U) finish_overdub();
        }
      }

      if (bouncing) {
        auto& target = tracks[bounce_track];
        if (!target.empty() && bounce_count < bounce_frames) {
          const auto write = bounce_count * 2U;
          target[write] = loop_left;
          target[write + 1U] = loop_right;
          update_envelope(bounce_track, bounce_count, loop_left, loop_right, false);
          ++bounce_count;
        }
      }

      for (std::size_t active = 0U; active < advance_count; ++active)
        advance_track(advance_tracks[active]);
      if (playing && sync_frames > 0U) {
        const auto next_sync = sync_position + 1U;
        sync_position = next_sync >= sync_frames ? 0U : next_sync;
      }
    }
  }

  LoopTransport current_transport() const noexcept {
    if (recording) return LoopTransport::Recording;
    if (overdubbing) return LoopTransport::Overdubbing;
    if (!any_occupied()) return LoopTransport::Empty;
    return playing && any_active_occupied() ? LoopTransport::Playing : LoopTransport::Stopped;
  }

  void reference_clock(int& track, std::size_t& frames, std::size_t& position) const noexcept {
    track = -1;
    frames = 0U;
    position = 0U;
    if (sync_frames > 0U) {
      for (unsigned index = 0U; index < kLoopTrackCount; ++index) {
        if ((occupied_mask & bit(index)) != 0U && active_length(index) == sync_frames) {
          track = static_cast<int>(index);
          break;
        }
      }
      frames = sync_frames;
      position = sync_position;
      return;
    }
    if (recording) {
      const auto beat = std::max<std::size_t>(
          kMinimumLoopFrames,
          static_cast<std::size_t>(std::llround(static_cast<double>(rate) * 60.0
              / static_cast<double>(clamp_bpm(bpm.load(std::memory_order_relaxed))))));
      frames = beat * 4U;
      position = frames > 0U ? record_count % frames : 0U;
    }
  }

  void refresh_published_waveform() noexcept {
    const unsigned track = selected.load(std::memory_order_relaxed);
    for (auto& bucket : published_waveform) bucket.store(0.F, std::memory_order_relaxed);
    if ((occupied_mask & bit(track)) == 0U || raw_frames[track] == 0U) return;
    const auto used = used_envelope_bins(track);
    float maximum = 0.F;
    for (std::size_t bin = 0U; bin < used; ++bin) maximum = std::max(maximum, envelopes[track][bin]);
    if (maximum <= 1e-6F) return;
    for (unsigned bucket = 0U; bucket < kLoopWaveformBins; ++bucket) {
      const auto start = std::min<std::size_t>(used - 1U, static_cast<std::size_t>(bucket) * used / kLoopWaveformBins);
      const auto end = std::max(start + 1U, std::min<std::size_t>(used,
          static_cast<std::size_t>(bucket + 1U) * used / kLoopWaveformBins + 1U));
      float peak = 0.F;
      for (auto bin = start; bin < end; ++bin) peak = std::max(peak, envelopes[track][bin]);
      published_waveform[bucket].store(clamp01(peak / maximum), std::memory_order_relaxed);
    }
  }

  void publish_runtime(std::size_t processed_frames) noexcept {
    const unsigned track = selected.load(std::memory_order_relaxed);
    const auto raw = raw_frames[track];
    const auto length = active_length(track);
    int reference_track = -1;
    std::size_t reference_frames = 0U;
    std::size_t reference_position = 0U;
    reference_clock(reference_track, reference_frames, reference_position);
    published_frames.store(length, std::memory_order_relaxed);
    published_raw_frames.store(raw, std::memory_order_relaxed);
    published_position.store(std::min(positions[track], length > 0U ? length - 1U : 0U), std::memory_order_relaxed);
    published_reference_track.store(reference_track, std::memory_order_relaxed);
    published_reference_frames.store(reference_frames, std::memory_order_relaxed);
    published_reference_position.store(reference_position, std::memory_order_relaxed);
    published_trim_start.store(raw > 0U ? static_cast<float>(trim_start_frames[track]) / static_cast<float>(raw) : 0.F, std::memory_order_relaxed);
    published_trim_end.store(raw > 0U ? static_cast<float>(trim_end_frames[track]) / static_cast<float>(raw) : 1.F, std::memory_order_relaxed);
    published_mask.store(occupied_mask, std::memory_order_relaxed);
    published_active_mask.store(active_mask & occupied_mask, std::memory_order_relaxed);
    published_mute_mask.store(mute_mask & occupied_mask, std::memory_order_relaxed);
    published_solo_mask.store(solo_mask & occupied_mask, std::memory_order_relaxed);
    published_transport.store(static_cast<unsigned>(current_transport()), std::memory_order_relaxed);
    const float inverse_analysis_frames = analysis_block_frames > 0U
        ? 1.F / static_cast<float>(analysis_block_frames) : 0.F;
    published_analysis_energy.store(
        clamp01(analysis_energy_sum * inverse_analysis_frames), std::memory_order_relaxed);
    published_analysis_transient.store(
        clamp01(analysis_transient_peak * 8.F), std::memory_order_relaxed);
    published_analysis_brightness.store(clamp01(
        analysis_brightness_sum * inverse_analysis_frames * 8.F), std::memory_order_relaxed);
    published_analysis_width.store(clamp01(
        analysis_width_sum * inverse_analysis_frames * 4.F), std::memory_order_relaxed);

    waveform_publish_elapsed += processed_frames;
    const bool refresh = waveform_refresh_pending.load(std::memory_order_relaxed)
        && (waveform_publish_elapsed >= waveform_publish_period || waveform_force.exchange(false, std::memory_order_acq_rel));
    if (refresh) {
      waveform_publish_elapsed = 0U;
      waveform_refresh_pending.store(false, std::memory_order_relaxed);
      refresh_published_waveform();
    }
  }

  void process(float* data, std::size_t frames) noexcept {
    analysis_energy_sum = 0.F;
    analysis_brightness_sum = 0.F;
    analysis_width_sum = 0.F;
    analysis_transient_peak = 0.F;
    analysis_block_frames = 0U;
    consume_control();
    if (fade_refresh_pending.load(std::memory_order_relaxed)) refresh_fade_cache();
    apply_journal_swaps(frames);

    if (!enabled.load(std::memory_order_relaxed)) {
      publish_runtime(frames);
      return;
    }

    const float loop_level = master_level.load(std::memory_order_relaxed);
    const float overdub_gain = overdub.load(std::memory_order_relaxed);
    std::size_t offset = 0U;

    while (offset < frames) {
      run_due_commands();
      std::size_t segment = frames - offset;
      if (next_scheduled_due != kNoDue && next_scheduled_due > clock_frame) {
        const auto until_due = next_scheduled_due - clock_frame;
        segment = std::min<std::size_t>(segment, static_cast<std::size_t>(until_due));
      }
      if (recording) {
        if (record_count >= max_frames) { finish_recording(record_track); continue; }
        segment = std::min(segment, max_frames - record_count);
      }
      if (bouncing) {
        if (bounce_count >= bounce_frames) { finish_bounce(); continue; }
        segment = std::min(segment, bounce_frames - bounce_count);
      }
      if (segment == 0U) { run_due_commands(); continue; }

      process_segment(data + offset * 2U, segment, loop_level, overdub_gain);
      offset += segment;
      clock_frame += segment;

      if (recording && record_count >= max_frames) finish_recording(record_track);
      if (bouncing && bounce_count >= bounce_frames) finish_bounce();
    }
    publish_runtime(frames);
  }

  float rate;
  std::size_t max_frames;
  float envelope_scale;
  std::size_t waveform_publish_period;
  std::size_t waveform_publish_elapsed{};
  float cached_fade{};
  float analysis_fast_attack{};
  float analysis_fast_release{};
  float analysis_slow{};
  float analysis_fast_envelope{};
  float analysis_slow_envelope{};
  float analysis_previous_mono{};
  float analysis_energy_sum{};
  float analysis_brightness_sum{};
  float analysis_width_sum{};
  float analysis_transient_peak{};
  std::size_t analysis_block_frames{};

  std::array<std::vector<float>, kLoopTrackCount> tracks;
  std::array<std::array<float, kLoopEnvelopeBins>, kLoopTrackCount> envelopes{};
  std::array<std::atomic<float>, kLoopTrackCount> track_levels{};
  std::array<std::size_t, kLoopTrackCount> raw_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_start_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_end_frames{};
  std::array<std::size_t, kLoopTrackCount> lengths{};
  std::array<std::size_t, kLoopTrackCount> fade_frames{};
  std::array<std::size_t, kLoopTrackCount> positions{};
  std::array<std::size_t, kLoopTrackCount> replace_envelope_bin{};
  std::uint32_t occupied_mask{};
  std::uint32_t active_mask{};
  std::uint32_t mute_mask{};
  std::uint32_t solo_mask{};

  std::array<std::vector<float>, kLoopTrackCount> undo_tracks;
  std::array<std::vector<std::uint16_t>, kLoopTrackCount> undo_tags;
  std::array<std::uint16_t, kLoopTrackCount> undo_generation{};
  std::array<std::size_t, kLoopTrackCount> undo_touched{};
  std::array<bool, kLoopTrackCount> undo_ready{};
  std::array<bool, kLoopTrackCount> redo_ready{};
  std::array<unsigned, kLoopTrackCount> swap_mode{};
  std::array<std::size_t, kLoopTrackCount> swap_cursor{};
  std::array<std::size_t, kLoopTrackCount> swap_remaining{};

  std::atomic<bool> enabled{false};
  std::atomic<unsigned> selected{0U};
  std::atomic<float> master_level{1.F};
  std::atomic<float> overdub{1.F};
  std::atomic<float> fade{0.F};
  std::atomic<bool> fade_refresh_pending{false};
  std::atomic<float> bpm{120.F};
  std::atomic<unsigned> quantize_mode{kQuantizeOff};
  std::uint64_t clock_frame{};
  std::size_t sync_frames{};
  std::size_t sync_position{};
  std::array<ScheduledCommand, kScheduledSlots> scheduled{};
  std::uint64_t next_scheduled_due{kNoDue};

  std::array<PendingAction, kCommandQueueSlots> command_queue{};
  std::atomic<unsigned> command_write{};
  std::atomic<unsigned> command_read{};
  std::atomic<bool> trim_pending{false};
  std::atomic<unsigned> trim_track{0U};
  std::atomic<float> trim_start_pending{0.F};
  std::atomic<float> trim_end_pending{1.F};

  bool playing{false};
  bool recording{false};
  unsigned record_track{0U};
  bool overdubbing{false};
  unsigned overdub_track{0U};
  std::size_t overdub_remaining{};
  std::size_t record_count{};
  bool bouncing{false};
  unsigned bounce_track{0U};
  std::size_t bounce_count{};
  std::size_t bounce_frames{};

  std::atomic<unsigned> published_transport{static_cast<unsigned>(LoopTransport::Empty)};
  std::atomic<std::uint32_t> published_mask{};
  std::atomic<std::uint32_t> published_active_mask{};
  std::atomic<std::uint32_t> published_mute_mask{};
  std::atomic<std::uint32_t> published_solo_mask{};
  std::atomic<std::uint64_t> published_frames{};
  std::atomic<std::uint64_t> published_raw_frames{};
  std::atomic<std::uint64_t> published_position{};
  std::atomic<int> published_reference_track{-1};
  std::atomic<std::uint64_t> published_reference_frames{};
  std::atomic<std::uint64_t> published_reference_position{};
  std::atomic<float> published_trim_start{0.F};
  std::atomic<float> published_trim_end{1.F};
  std::atomic<float> published_analysis_energy{};
  std::atomic<float> published_analysis_transient{};
  std::atomic<float> published_analysis_brightness{};
  std::atomic<float> published_analysis_width{};
  std::array<std::atomic<float>, kLoopWaveformBins> published_waveform{};
  std::atomic<bool> waveform_refresh_pending{true};
  std::atomic<bool> waveform_force{true};
};

LoopProcessor::LoopProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
LoopProcessor::~LoopProcessor() = default;
void LoopProcessor::process(float* data, std::size_t frames) noexcept { if (data && frames) impl_->process(data, frames); }
void LoopProcessor::set_enabled(bool value) noexcept { impl_->enabled.store(value, std::memory_order_relaxed); }
void LoopProcessor::set_selected_track(unsigned track) noexcept {
  impl_->selected.store(std::min(track, kLoopTrackCount - 1U), std::memory_order_relaxed);
  impl_->waveform_force.store(true, std::memory_order_release);
  impl_->waveform_refresh_pending.store(true, std::memory_order_release);
}
void LoopProcessor::set_master_level(float value) noexcept { impl_->master_level.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_track_level(unsigned track, float value) noexcept {
  if (track >= kLoopTrackCount || !std::isfinite(value)) return;
  if (value >= 2'000.F) {
    const auto mode = static_cast<unsigned>(std::clamp<long>(std::lround(value - 2'000.F), 0L, 2L));
    impl_->quantize_mode.store(mode, std::memory_order_relaxed);
    return;
  }
  if (value >= 1'000.F) {
    impl_->bpm.store(clamp_bpm(value - 1'000.F), std::memory_order_relaxed);
    return;
  }
  if (value >= 1.5F) {
    const long sentinel = std::lround(value);
    if (sentinel == 2L) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::TrackPlay), track);
    else if (sentinel == 3L) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::TrackStop), track);
    else if (sentinel == 4L) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::Mute), track);
    else if (sentinel == 5L) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::Solo), track);
    else if (sentinel == 6L) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::Undo), track);
    else if (sentinel == 7L) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::Redo), track);
    else if (sentinel == 8L && impl_->ensure_track_buffer(track)) impl_->enqueue_action(static_cast<unsigned>(LoopCommand::Bounce), track);
    return;
  }
  impl_->track_levels[track].store(clamp01(value), std::memory_order_relaxed);
}
void LoopProcessor::set_overdub(float value) noexcept { impl_->overdub.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_fade(float value) noexcept {
  impl_->fade.store(clamp01(value), std::memory_order_relaxed);
  impl_->fade_refresh_pending.store(true, std::memory_order_release);
}
void LoopProcessor::command(LoopCommand value) noexcept {
  command(value, impl_->selected.load(std::memory_order_relaxed));
}
void LoopProcessor::command(LoopCommand value, unsigned requested_track) noexcept {
  const unsigned track = std::min(requested_track, kLoopTrackCount - 1U);
  if (value == LoopCommand::Record && !impl_->ensure_track_buffer(track)) return;
  if (value == LoopCommand::Overdub && !impl_->ensure_undo_journal(track)) return;
  if (value == LoopCommand::Bounce && !impl_->ensure_track_buffer(track)) return;
  impl_->enqueue_action(static_cast<unsigned>(value), track);
}
void LoopProcessor::set_trim(float start, float end) noexcept {
  impl_->trim_start_pending.store(clamp01(start), std::memory_order_relaxed);
  impl_->trim_end_pending.store(clamp01(end), std::memory_order_relaxed);
  impl_->trim_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);
  impl_->trim_pending.store(true, std::memory_order_release);
}
void LoopProcessor::auto_trim() noexcept {
  impl_->enqueue_action(kAutoTrimAction, impl_->selected.load(std::memory_order_relaxed));
}
void LoopProcessor::reset_trim() noexcept {
  impl_->enqueue_action(kResetTrimAction, impl_->selected.load(std::memory_order_relaxed));
}
LoopTransport LoopProcessor::transport() const noexcept { return static_cast<LoopTransport>(impl_->published_transport.load(std::memory_order_relaxed)); }
unsigned LoopProcessor::selected_track() const noexcept { return impl_->selected.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_mask() const noexcept { return impl_->published_mask.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_active_mask() const noexcept { return impl_->published_active_mask.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_mute_mask() const noexcept { return impl_->published_mute_mask.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_solo_mask() const noexcept { return impl_->published_solo_mask.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::loop_frames() const noexcept { return impl_->published_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::raw_frames() const noexcept { return impl_->published_raw_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::position() const noexcept { return impl_->published_position.load(std::memory_order_relaxed); }
int LoopProcessor::reference_track() const noexcept { return impl_->published_reference_track.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::reference_frames() const noexcept { return impl_->published_reference_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::reference_position() const noexcept { return impl_->published_reference_position.load(std::memory_order_relaxed); }
LoopAnalysisProfile LoopProcessor::analysis() const noexcept {
  return {
    impl_->published_analysis_energy.load(std::memory_order_relaxed),
    impl_->published_analysis_transient.load(std::memory_order_relaxed),
    impl_->published_analysis_brightness.load(std::memory_order_relaxed),
    impl_->published_analysis_width.load(std::memory_order_relaxed),
  };
}
float LoopProcessor::trim_start() const noexcept { return impl_->published_trim_start.load(std::memory_order_relaxed); }
float LoopProcessor::trim_end() const noexcept { return impl_->published_trim_end.load(std::memory_order_relaxed); }
std::array<float, kLoopWaveformBins> LoopProcessor::waveform() const noexcept {
  std::array<float, kLoopWaveformBins> result{};
  for (unsigned index = 0U; index < kLoopWaveformBins; ++index)
    result[index] = impl_->published_waveform[index].load(std::memory_order_relaxed);
  return result;
}

}  // namespace calcotone
