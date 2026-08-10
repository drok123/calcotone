#include "calcotone/loop_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace calcotone {
namespace {
constexpr unsigned kNoCommand = 0xffU;
constexpr unsigned kTrimCommand = 4U;
constexpr unsigned kAutoTrimCommand = 5U;
constexpr unsigned kResetTrimCommand = 6U;
constexpr unsigned kTrackPlayBit = 1U << 0U;
constexpr unsigned kTrackStopBit = 1U << 1U;
constexpr unsigned kTrackMuteBit = 1U << 2U;
constexpr unsigned kTrackSoloBit = 1U << 3U;
constexpr std::size_t kMinimumLoopFrames = 64U;
constexpr unsigned kQuantizeOff = 0U;
constexpr unsigned kQuantizeBeat = 1U;
constexpr unsigned kQuantizeBar = 2U;
constexpr unsigned kScheduledSlots = kLoopTrackCount + 4U;
float clamp01(float value) noexcept { return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F); }
float clamp_bpm(float value) noexcept { return std::clamp(std::isfinite(value) ? value : 120.F, 30.F, 300.F); }
}

struct LoopProcessor::Impl {
  struct ScheduledCommand {
    bool active{};
    std::uint64_t due{};
    LoopCommand command{LoopCommand::Play};
    unsigned track{};
  };

  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        max_frames(static_cast<std::size_t>(std::ceil(rate * kLoopMaxSeconds))),
        envelope_scale(static_cast<float>(kLoopEnvelopeBins) / static_cast<float>(max_frames)) {
    // Track audio is allocated on the control thread when REC is armed, not
    // all eight tracks at host startup. The realtime process path stays allocation-free.
    for (auto& level : track_levels) level.store(.72F, std::memory_order_relaxed);
  }

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

  bool any_occupied() const noexcept {
    for (const bool filled : occupied) if (filled) return true;
    return false;
  }

  bool any_active_occupied() const noexcept {
    for (unsigned track = 0U; track < kLoopTrackCount; ++track)
      if (occupied[track] && active[track]) return true;
    return false;
  }

  bool any_solo_occupied() const noexcept {
    for (unsigned track = 0U; track < kLoopTrackCount; ++track)
      if (occupied[track] && soloed[track]) return true;
    return false;
  }

  std::size_t active_length(unsigned track) const noexcept {
    if (!occupied[track]) return 0U;
    return trim_end_frames[track] > trim_start_frames[track]
        ? trim_end_frames[track] - trim_start_frames[track] : 0U;
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
    const auto quantum = quantize_frames();
    if (quantum == 0U) return clock_frame;
    return (clock_frame / quantum + 1U) * quantum;
  }

  bool should_quantize(LoopCommand command) const noexcept {
    return command == LoopCommand::Record || command == LoopCommand::Overdub || command == LoopCommand::Play
        || command == LoopCommand::TrackPlay || command == LoopCommand::TrackStop
        || command == LoopCommand::Undo || command == LoopCommand::Redo || command == LoopCommand::Bounce;
  }

  void schedule_command(LoopCommand command, unsigned track) noexcept {
    const auto due = next_boundary();
    for (auto& slot : scheduled) {
      if (slot.active && slot.track == track) {
        slot = ScheduledCommand{true, due, command, track};
        return;
      }
    }
    for (auto& slot : scheduled) {
      if (!slot.active) {
        slot = ScheduledCommand{true, due, command, track};
        return;
      }
    }
    scheduled[0] = ScheduledCommand{true, due, command, track};
  }

  void clear_envelope(unsigned track) noexcept {
    envelopes[track].fill(0.F);
  }

  void update_envelope(unsigned track, std::size_t frame, float left, float right) noexcept {
    const auto bin = std::min<std::size_t>(kLoopEnvelopeBins - 1U,
        static_cast<std::size_t>(static_cast<float>(frame) * envelope_scale));
    const float peak = std::max(std::abs(left), std::abs(right));
    envelopes[track][bin] = std::max(envelopes[track][bin], peak);
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
    undo_ready[track] = undo_touched[track] > 0U;
    redo_ready[track] = false;
  }

  void begin_journal_swap(unsigned track, unsigned mode) noexcept {
    if (track >= kLoopTrackCount || !occupied[track] || swap_mode[track] != 0U) return;
    if (mode == 1U && !undo_ready[track]) return;
    if (mode == 2U && !redo_ready[track]) return;
    const auto length = active_length(track);
    if (length == 0U || undo_tracks[track].empty() || undo_tags[track].empty()) return;
    swap_mode[track] = mode;
    swap_cursor[track] = std::min(positions[track], length - 1U);
    swap_remaining[track] = length;
  }

  void apply_journal_swap_step(unsigned track) noexcept {
    const unsigned mode = swap_mode[track];
    if (mode == 0U) return;
    const auto length = active_length(track);
    if (length == 0U || tracks[track].empty() || undo_tracks[track].empty() || undo_tags[track].empty()) {
      swap_mode[track] = 0U;
      swap_remaining[track] = 0U;
      return;
    }
    const auto relative = std::min(swap_cursor[track], length - 1U);
    const auto absolute = trim_start_frames[track] + relative;
    if (undo_tags[track][absolute] == undo_generation[track]) {
      const auto index = absolute * 2U;
      std::swap(tracks[track][index], undo_tracks[track][index]);
      std::swap(tracks[track][index + 1U], undo_tracks[track][index + 1U]);
    }
    swap_cursor[track] = relative + 1U >= length ? 0U : relative + 1U;
    if (swap_remaining[track] > 0U) --swap_remaining[track];
    if (swap_remaining[track] == 0U) {
      swap_mode[track] = 0U;
      if (mode == 1U) {
        undo_ready[track] = false;
        redo_ready[track] = true;
      } else {
        undo_ready[track] = true;
        redo_ready[track] = false;
      }
    }
  }

  void start_recording(unsigned track) noexcept {
    occupied[track] = false;
    active[track] = true;
    muted[track] = false;
    soloed[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    positions[track] = 0U;
    invalidate_journal(track);
    clear_envelope(track);
    recording = true;
    overdubbing = false;
    record_count = 0U;
    playing = true;
  }

  void finish_recording(unsigned track) noexcept {
    if (record_count >= kMinimumLoopFrames) {
      const auto frames = std::min(max_frames, record_count);
      raw_frames[track] = frames;
      trim_start_frames[track] = 0U;
      trim_end_frames[track] = frames;
      positions[track] = 0U;
      occupied[track] = true;
      active[track] = true;
      playing = true;
    } else {
      active[track] = false;
    }
    recording = false;
    record_count = 0U;
    if (!any_active_occupied()) playing = false;
  }

  void clear_track(unsigned track) noexcept {
    occupied[track] = false;
    active[track] = false;
    muted[track] = false;
    soloed[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    positions[track] = 0U;
    invalidate_journal(track);
    if (recording && record_track == track) {
      recording = false;
      record_count = 0U;
    }
    if (overdubbing && overdub_track == track) finish_overdub();
    if (bouncing && bounce_track == track) bouncing = false;
    if (!any_active_occupied()) playing = false;
  }

  void set_trim_window(unsigned track, float requested_start, float requested_end) noexcept {
    const auto raw = raw_frames[track];
    if (!occupied[track] || raw < kMinimumLoopFrames) return;
    const auto minimum = std::min(raw, kMinimumLoopFrames);
    auto start = static_cast<std::size_t>(std::llround(clamp01(requested_start) * static_cast<float>(raw)));
    auto end = static_cast<std::size_t>(std::llround(clamp01(requested_end) * static_cast<float>(raw)));
    start = std::min(start, raw - minimum);
    end = std::clamp(end, start + minimum, raw);
    trim_start_frames[track] = start;
    trim_end_frames[track] = end;
    positions[track] = std::min(positions[track], std::max<std::size_t>(1U, end - start) - 1U);
  }

  void reset_trim_window(unsigned track) noexcept {
    if (!occupied[track]) return;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = raw_frames[track];
    positions[track] = 0U;
  }

  std::size_t used_envelope_bins(unsigned track) const noexcept {
    const double used = std::ceil(static_cast<double>(raw_frames[track])
        * static_cast<double>(kLoopEnvelopeBins) / static_cast<double>(max_frames));
    return std::clamp<std::size_t>(static_cast<std::size_t>(std::max(1.0, used)), 1U, kLoopEnvelopeBins);
  }

  void auto_trim_window(unsigned track) noexcept {
    if (!occupied[track] || raw_frames[track] < kMinimumLoopFrames) return;
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
    positions[track] = 0U;
  }

  void play_track(unsigned track) noexcept {
    if (!occupied[track] || active_length(track) == 0U) return;
    active[track] = true;
    positions[track] = 0U;
    playing = true;
  }

  void stop_track(unsigned track) noexcept {
    if (recording && record_track == track) finish_recording(track);
    if (overdubbing && overdub_track == track) finish_overdub();
    active[track] = false;
    positions[track] = 0U;
    if (!any_active_occupied()) playing = false;
  }

  void start_bounce(unsigned track) noexcept {
    if (track >= kLoopTrackCount || occupied[track] || tracks[track].size() != max_frames * 2U) return;
    const bool soloing = any_solo_occupied();
    std::size_t frames = 0U;
    for (unsigned source = 0U; source < kLoopTrackCount; ++source) {
      if (source == track || !occupied[source] || !active[source] || muted[source]) continue;
      if (soloing && !soloed[source]) continue;
      frames = std::max(frames, active_length(source));
    }
    if (frames < kMinimumLoopFrames) return;
    bounce_track = track;
    bounce_frames = std::min(max_frames, frames);
    bounce_count = 0U;
    bouncing = true;
    occupied[track] = false;
    active[track] = false;
    muted[track] = false;
    soloed[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
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
    positions[track] = 0U;
    occupied[track] = true;
    // Bounce lands stopped so the rendered mix is never doubled automatically.
    active[track] = false;
  }

  void execute_command(LoopCommand command, unsigned track) noexcept {
    if (command == LoopCommand::Record) {
      if (recording) finish_recording(record_track);
      else if (tracks[track].size() == max_frames * 2U) { record_track = track; start_recording(record_track); }
      return;
    }
    if (command == LoopCommand::Overdub) {
      if (overdubbing) {
        finish_overdub();
      } else if (occupied[track] && active_length(track) > 0U) {
        begin_overdub_journal(track);
        overdub_track = track;
        active[track] = true;
        overdubbing = true;
        recording = false;
        playing = true;
      }
      return;
    }
    if (command == LoopCommand::Play) {
      if (any_occupied()) {
        const bool stop_all = any_active_occupied();
        for (unsigned index = 0U; index < kLoopTrackCount; ++index) {
          if (!occupied[index]) continue;
          active[index] = !stop_all;
          positions[index] = 0U;
        }
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
    if (command == LoopCommand::Mute) { if (occupied[track]) muted[track] = !muted[track]; return; }
    if (command == LoopCommand::Solo) { if (occupied[track]) soloed[track] = !soloed[track]; return; }
    if (command == LoopCommand::Undo) { begin_journal_swap(track, 1U); return; }
    if (command == LoopCommand::Redo) { begin_journal_swap(track, 2U); return; }
    if (command == LoopCommand::Bounce) start_bounce(track);
  }

  void consume_performance_commands() noexcept {
    const bool quantized = quantize_frames() > 0U;
    for (unsigned track = 0U; track < kLoopTrackCount; ++track) {
      const unsigned bits = pending_performance[track].exchange(0U, std::memory_order_acq_rel);
      if (bits == 0U) continue;
      if ((bits & kTrackMuteBit) != 0U) execute_command(LoopCommand::Mute, track);
      if ((bits & kTrackSoloBit) != 0U) execute_command(LoopCommand::Solo, track);
      if ((bits & kTrackPlayBit) != 0U) {
        if (quantized) schedule_command(LoopCommand::TrackPlay, track); else execute_command(LoopCommand::TrackPlay, track);
      }
      if ((bits & kTrackStopBit) != 0U) {
        if (quantized) schedule_command(LoopCommand::TrackStop, track); else execute_command(LoopCommand::TrackStop, track);
      }
    }
  }

  void queue_performance(unsigned track, LoopCommand command) noexcept {
    if (track >= kLoopTrackCount) return;
    unsigned bit = 0U;
    if (command == LoopCommand::TrackPlay) bit = kTrackPlayBit;
    else if (command == LoopCommand::TrackStop) bit = kTrackStopBit;
    else if (command == LoopCommand::Mute) bit = kTrackMuteBit;
    else if (command == LoopCommand::Solo) bit = kTrackSoloBit;
    if (bit != 0U) pending_performance[track].fetch_or(bit, std::memory_order_release);
  }

  void queue_command(unsigned track, LoopCommand command) noexcept {
    pending_track.store(std::min(track, kLoopTrackCount - 1U), std::memory_order_relaxed);
    pending_command.store(static_cast<unsigned>(command), std::memory_order_release);
  }

  void consume_command() noexcept {
    consume_performance_commands();
    const unsigned raw = pending_command.exchange(kNoCommand, std::memory_order_acq_rel);
    if (raw == kNoCommand) return;
    const unsigned track = pending_track.load(std::memory_order_acquire);
    if (raw == kTrimCommand) {
      set_trim_window(track, pending_trim_start.load(std::memory_order_relaxed), pending_trim_end.load(std::memory_order_relaxed));
      return;
    }
    if (raw == kAutoTrimCommand) {
      auto_trim_window(track);
      return;
    }
    if (raw == kResetTrimCommand) {
      reset_trim_window(track);
      return;
    }

    const auto command = static_cast<LoopCommand>(raw);
    const bool first_record = command == LoopCommand::Record && !any_occupied() && !recording;
    if (first_record) {
      clock_frame = 0U;
      execute_command(command, track);
      return;
    }
    const bool stopped_undo = (command == LoopCommand::Undo || command == LoopCommand::Redo) && !playing;
    if (should_quantize(command) && quantize_frames() > 0U && !stopped_undo) schedule_command(command, track);
    else execute_command(command, track);
  }

  void run_scheduled_commands() noexcept {
    for (auto& slot : scheduled) {
      if (!slot.active || slot.due > clock_frame) continue;
      const auto command = slot.command;
      const auto track = slot.track;
      slot.active = false;
      execute_command(command, track);
    }
  }

  float read_track(unsigned track, unsigned channel) const noexcept {
    const auto length = active_length(track);
    if (length == 0U) return 0.F;
    const auto relative = std::min(positions[track], length - 1U);
    const auto absolute = trim_start_frames[track] + relative;
    const auto& buffer = tracks[track];
    if (buffer.empty()) return 0.F;
    const auto index = absolute * 2U + channel;
    const auto fade_samples = std::min<std::size_t>(
        length / 4U,
        static_cast<std::size_t>(std::round(fade.load(std::memory_order_relaxed) * .02F * rate)));
    if (fade_samples <= 1U || relative < length - fade_samples) return buffer[index];
    const auto local = relative - (length - fade_samples);
    const float alpha = static_cast<float>(local) / static_cast<float>(fade_samples);
    const auto start_relative = std::min(length - 1U, local);
    const auto start_absolute = trim_start_frames[track] + start_relative;
    const float start = buffer[start_absolute * 2U + channel];
    return buffer[index] * (1.F - alpha) + start * alpha;
  }

  void advance_track(unsigned track) noexcept {
    const auto length = active_length(track);
    if (length == 0U) {
      positions[track] = 0U;
      return;
    }
    const auto next = positions[track] + 1U;
    positions[track] = next >= length ? 0U : next;
  }

  LoopTransport current_transport() const noexcept {
    if (recording) return LoopTransport::Recording;
    if (overdubbing) return LoopTransport::Overdubbing;
    if (!any_occupied()) return LoopTransport::Empty;
    return playing && any_active_occupied() ? LoopTransport::Playing : LoopTransport::Stopped;
  }

  void publish_runtime() noexcept {
    const unsigned track = selected.load(std::memory_order_relaxed);
    const auto raw = raw_frames[track];
    const auto length = active_length(track);
    published_frames.store(length, std::memory_order_relaxed);
    published_raw_frames.store(raw, std::memory_order_relaxed);
    published_position.store(std::min(positions[track], length > 0U ? length - 1U : 0U), std::memory_order_relaxed);
    published_trim_start.store(raw > 0U ? static_cast<float>(trim_start_frames[track]) / static_cast<float>(raw) : 0.F, std::memory_order_relaxed);
    published_trim_end.store(raw > 0U ? static_cast<float>(trim_end_frames[track]) / static_cast<float>(raw) : 1.F, std::memory_order_relaxed);
    std::uint32_t mask = 0U;
    for (unsigned index = 0U; index < kLoopTrackCount; ++index) if (occupied[index]) mask |= (1U << index);
    published_mask.store(mask, std::memory_order_relaxed);
    published_transport.store(static_cast<unsigned>(current_transport()), std::memory_order_relaxed);

    for (auto& bucket : published_waveform) bucket.store(0.F, std::memory_order_relaxed);
    if (!occupied[track] || raw == 0U) return;
    const auto used = used_envelope_bins(track);
    float maximum = 0.F;
    for (std::size_t bin = 0; bin < used; ++bin) maximum = std::max(maximum, envelopes[track][bin]);
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

  void process(float* data, std::size_t frames) noexcept {
    consume_command();
    if (!enabled.load(std::memory_order_relaxed)) {
      publish_runtime();
      return;
    }

    const float loop_level = master_level.load(std::memory_order_relaxed);
    const float overdub_feedback = overdub.load(std::memory_order_relaxed);

    for (std::size_t frame = 0; frame < frames; ++frame) {
      run_scheduled_commands();
      for (unsigned track = 0U; track < kLoopTrackCount; ++track)
        if (swap_mode[track] != 0U) apply_journal_swap_step(track);

      const float live_left = std::isfinite(data[frame * 2U]) ? data[frame * 2U] : 0.F;
      const float live_right = std::isfinite(data[frame * 2U + 1U]) ? data[frame * 2U + 1U] : 0.F;
      float loop_left = 0.F;
      float loop_right = 0.F;
      const bool soloing = any_solo_occupied();

      if (playing) {
        for (unsigned track = 0U; track < kLoopTrackCount; ++track) {
          if (!occupied[track] || !active[track] || muted[track] || active_length(track) == 0U) continue;
          if (soloing && !soloed[track]) continue;
          const float level = track_levels[track].load(std::memory_order_relaxed);
          loop_left += read_track(track, 0U) * level;
          loop_right += read_track(track, 1U) * level;
        }
      }

      data[frame * 2U] = live_left + loop_left * loop_level;
      data[frame * 2U + 1U] = live_right + loop_right * loop_level;

      if (recording) {
        auto& record_buffer = tracks[record_track];
        if (record_count < max_frames && !record_buffer.empty()) {
          const auto write = record_count * 2U;
          record_buffer[write] = live_left;
          record_buffer[write + 1U] = live_right;
          update_envelope(record_track, record_count, live_left, live_right);
          ++record_count;
        }
        if (record_count >= max_frames) finish_recording(record_track);
      } else if (overdubbing && occupied[overdub_track]) {
        auto& overdub_buffer = tracks[overdub_track];
        const auto length = active_length(overdub_track);
        if (length > 0U && !overdub_buffer.empty()) {
          const auto relative = std::min(positions[overdub_track], length - 1U);
          const auto absolute = trim_start_frames[overdub_track] + relative;
          const auto write = absolute * 2U;
          journal_before_write(overdub_track, absolute, write, overdub_buffer);
          // DUB is a continuous rolling replacement pass. At RETAIN=0 the
          // previous performance is completely gone after one full orbit; raising
          // RETAIN restores classic feedback overdubbing without changing transport.
          const float next_left = overdub_buffer[write] * overdub_feedback + live_left;
          const float next_right = overdub_buffer[write + 1U] * overdub_feedback + live_right;
          overdub_buffer[write] = next_left;
          overdub_buffer[write + 1U] = next_right;
          update_envelope(overdub_track, absolute, next_left, next_right);
        }
      }

      if (bouncing) {
        auto& target = tracks[bounce_track];
        if (!target.empty() && bounce_count < bounce_frames) {
          const auto write = bounce_count * 2U;
          target[write] = loop_left;
          target[write + 1U] = loop_right;
          update_envelope(bounce_track, bounce_count, loop_left, loop_right);
          ++bounce_count;
        }
        if (bounce_count >= bounce_frames) finish_bounce();
      }

      if (playing) {
        for (unsigned track = 0U; track < kLoopTrackCount; ++track)
          if (occupied[track] && active[track]) advance_track(track);
      }
      ++clock_frame;
    }
    publish_runtime();
  }

  float rate;
  std::size_t max_frames;
  float envelope_scale;
  std::array<std::vector<float>, kLoopTrackCount> tracks;
  std::array<std::array<float, kLoopEnvelopeBins>, kLoopTrackCount> envelopes{};
  std::array<std::atomic<float>, kLoopTrackCount> track_levels{};
  std::array<bool, kLoopTrackCount> occupied{};
  std::array<bool, kLoopTrackCount> active{};
  std::array<bool, kLoopTrackCount> muted{};
  std::array<bool, kLoopTrackCount> soloed{};
  std::array<std::size_t, kLoopTrackCount> raw_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_start_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_end_frames{};
  std::array<std::size_t, kLoopTrackCount> positions{};

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
  std::atomic<float> master_level{.78F};
  // RETAIN feedback: 0 = live replace, 1 = classic additive overdub.
  std::atomic<float> overdub{0.F};
  std::atomic<float> fade{.18F};
  std::atomic<float> bpm{120.F};
  std::atomic<unsigned> quantize_mode{kQuantizeOff};
  std::uint64_t clock_frame{};
  std::array<ScheduledCommand, kScheduledSlots> scheduled{};

  std::atomic<unsigned> pending_command{kNoCommand};
  std::array<std::atomic<unsigned>, kLoopTrackCount> pending_performance{};
  std::atomic<unsigned> pending_track{0U};
  std::atomic<float> pending_trim_start{0.F};
  std::atomic<float> pending_trim_end{1.F};
  bool playing{false};
  bool recording{false};
  unsigned record_track{0U};
  bool overdubbing{false};
  unsigned overdub_track{0U};
  std::size_t record_count{};
  bool bouncing{false};
  unsigned bounce_track{0U};
  std::size_t bounce_count{};
  std::size_t bounce_frames{};

  std::atomic<unsigned> published_transport{static_cast<unsigned>(LoopTransport::Empty)};
  std::atomic<std::uint32_t> published_mask{};
  std::atomic<std::uint64_t> published_frames{};
  std::atomic<std::uint64_t> published_raw_frames{};
  std::atomic<std::uint64_t> published_position{};
  std::atomic<float> published_trim_start{0.F};
  std::atomic<float> published_trim_end{1.F};
  std::array<std::atomic<float>, kLoopWaveformBins> published_waveform{};
};

LoopProcessor::LoopProcessor(float rate) : impl_(std::make_unique<Impl>(rate)) {}
LoopProcessor::~LoopProcessor() = default;
void LoopProcessor::process(float* data, std::size_t frames) noexcept { if (data && frames) impl_->process(data, frames); }
void LoopProcessor::set_enabled(bool value) noexcept { impl_->enabled.store(value, std::memory_order_relaxed); }
void LoopProcessor::set_selected_track(unsigned track) noexcept { impl_->selected.store(std::min(track, kLoopTrackCount - 1U), std::memory_order_relaxed); }
void LoopProcessor::set_master_level(float value) noexcept { impl_->master_level.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_track_level(unsigned track, float value) noexcept {
  if (track >= kLoopTrackCount || !std::isfinite(value)) return;
  // The native faceplate has a stable text control protocol. Values above the
  // physical 0..1 fader range are private Loop control frames so new performance
  // features do not require a breaking native-host protocol revision.
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
    if (sentinel == 2L) impl_->queue_performance(track, LoopCommand::TrackPlay);
    else if (sentinel == 3L) impl_->queue_performance(track, LoopCommand::TrackStop);
    else if (sentinel == 4L) impl_->queue_performance(track, LoopCommand::Mute);
    else if (sentinel == 5L) impl_->queue_performance(track, LoopCommand::Solo);
    else if (sentinel == 6L) impl_->queue_command(track, LoopCommand::Undo);
    else if (sentinel == 7L) impl_->queue_command(track, LoopCommand::Redo);
    else if (sentinel == 8L && impl_->ensure_track_buffer(track)) impl_->queue_command(track, LoopCommand::Bounce);
    return;
  }
  impl_->track_levels[track].store(clamp01(value), std::memory_order_relaxed);
}
void LoopProcessor::set_overdub(float value) noexcept { impl_->overdub.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_fade(float value) noexcept { impl_->fade.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::command(LoopCommand value) noexcept {
  const unsigned track = impl_->selected.load(std::memory_order_relaxed);
  if (value == LoopCommand::TrackPlay || value == LoopCommand::TrackStop || value == LoopCommand::Mute || value == LoopCommand::Solo) {
    impl_->queue_performance(track, value);
    return;
  }
  if (value == LoopCommand::Record && !impl_->ensure_track_buffer(track)) return;
  if (value == LoopCommand::Overdub) impl_->ensure_undo_journal(track);
  if (value == LoopCommand::Bounce && !impl_->ensure_track_buffer(track)) return;
  impl_->queue_command(track, value);
}
void LoopProcessor::set_trim(float start, float end) noexcept {
  impl_->pending_trim_start.store(clamp01(start), std::memory_order_relaxed);
  impl_->pending_trim_end.store(clamp01(end), std::memory_order_relaxed);
  impl_->pending_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);
  impl_->pending_command.store(kTrimCommand, std::memory_order_release);
}
void LoopProcessor::auto_trim() noexcept {
  impl_->pending_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);
  impl_->pending_command.store(kAutoTrimCommand, std::memory_order_release);
}
void LoopProcessor::reset_trim() noexcept {
  impl_->pending_track.store(impl_->selected.load(std::memory_order_relaxed), std::memory_order_relaxed);
  impl_->pending_command.store(kResetTrimCommand, std::memory_order_release);
}
LoopTransport LoopProcessor::transport() const noexcept { return static_cast<LoopTransport>(impl_->published_transport.load(std::memory_order_relaxed)); }
unsigned LoopProcessor::selected_track() const noexcept { return impl_->selected.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_mask() const noexcept { return impl_->published_mask.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::loop_frames() const noexcept { return impl_->published_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::raw_frames() const noexcept { return impl_->published_raw_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::position() const noexcept { return impl_->published_position.load(std::memory_order_relaxed); }
float LoopProcessor::trim_start() const noexcept { return impl_->published_trim_start.load(std::memory_order_relaxed); }
float LoopProcessor::trim_end() const noexcept { return impl_->published_trim_end.load(std::memory_order_relaxed); }
std::array<float, kLoopWaveformBins> LoopProcessor::waveform() const noexcept {
  std::array<float, kLoopWaveformBins> result{};
  for (unsigned index = 0U; index < kLoopWaveformBins; ++index)
    result[index] = impl_->published_waveform[index].load(std::memory_order_relaxed);
  return result;
}

}  // namespace calcotone
