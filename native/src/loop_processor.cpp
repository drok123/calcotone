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
constexpr std::size_t kMinimumLoopFrames = 64U;
float clamp01(float value) noexcept { return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F); }
}

struct LoopProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        max_frames(static_cast<std::size_t>(std::ceil(rate * kLoopMaxSeconds))),
        envelope_scale(static_cast<float>(kLoopEnvelopeBins) / static_cast<float>(max_frames)) {
    for (auto& buffer : tracks) buffer.assign(max_frames * 2U, 0.F);
    for (auto& level : track_levels) level.store(.72F, std::memory_order_relaxed);
  }

  bool any_occupied() const noexcept {
    for (const bool filled : occupied) if (filled) return true;
    return false;
  }

  std::size_t active_length(unsigned track) const noexcept {
    if (!occupied[track]) return 0U;
    return trim_end_frames[track] > trim_start_frames[track]
        ? trim_end_frames[track] - trim_start_frames[track] : 0U;
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

  void start_recording(unsigned track) noexcept {
    occupied[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    positions[track] = 0U;
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
      playing = true;
    }
    recording = false;
    record_count = 0U;
    if (!any_occupied()) playing = false;
  }

  void clear_track(unsigned track) noexcept {
    occupied[track] = false;
    raw_frames[track] = 0U;
    trim_start_frames[track] = 0U;
    trim_end_frames[track] = 0U;
    positions[track] = 0U;
    if (recording) {
      recording = false;
      record_count = 0U;
    }
    overdubbing = false;
    if (!any_occupied()) playing = false;
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

  void consume_command() noexcept {
    const unsigned raw = pending_command.exchange(kNoCommand, std::memory_order_acq_rel);
    if (raw == kNoCommand) return;
    const unsigned track = selected.load(std::memory_order_relaxed);
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
    if (command == LoopCommand::Record) {
      if (recording) finish_recording(track);
      else start_recording(track);
      return;
    }
    if (command == LoopCommand::Overdub) {
      if (occupied[track] && active_length(track) > 0U) {
        overdubbing = !overdubbing;
        recording = false;
        playing = true;
      }
      return;
    }
    if (command == LoopCommand::Play) {
      if (any_occupied()) {
        playing = !playing;
        overdubbing = false;
        recording = false;
        record_count = 0U;
      }
      return;
    }
    if (command == LoopCommand::Clear) clear_track(track);
  }

  float read_track(unsigned track, unsigned channel) const noexcept {
    const auto length = active_length(track);
    if (length == 0U) return 0.F;
    const auto relative = std::min(positions[track], length - 1U);
    const auto absolute = trim_start_frames[track] + relative;
    const auto& buffer = tracks[track];
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
    return playing ? LoopTransport::Playing : LoopTransport::Stopped;
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

    const unsigned selected_track = selected.load(std::memory_order_relaxed);
    auto& selected_buffer = tracks[selected_track];
    const float loop_level = master_level.load(std::memory_order_relaxed);
    const float overdub_feedback = overdub.load(std::memory_order_relaxed);

    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float live_left = std::isfinite(data[frame * 2U]) ? data[frame * 2U] : 0.F;
      const float live_right = std::isfinite(data[frame * 2U + 1U]) ? data[frame * 2U + 1U] : 0.F;
      float loop_left = 0.F;
      float loop_right = 0.F;

      if (playing) {
        for (unsigned track = 0U; track < kLoopTrackCount; ++track) {
          if (!occupied[track] || active_length(track) == 0U) continue;
          const float level = track_levels[track].load(std::memory_order_relaxed);
          loop_left += read_track(track, 0U) * level;
          loop_right += read_track(track, 1U) * level;
        }
      }

      data[frame * 2U] = live_left + loop_left * loop_level;
      data[frame * 2U + 1U] = live_right + loop_right * loop_level;

      if (recording) {
        if (record_count < max_frames) {
          const auto write = record_count * 2U;
          selected_buffer[write] = live_left;
          selected_buffer[write + 1U] = live_right;
          update_envelope(selected_track, record_count, live_left, live_right);
          ++record_count;
        }
        if (record_count >= max_frames) finish_recording(selected_track);
      } else if (overdubbing && occupied[selected_track]) {
        const auto length = active_length(selected_track);
        if (length > 0U) {
          const auto relative = std::min(positions[selected_track], length - 1U);
          const auto absolute = trim_start_frames[selected_track] + relative;
          const auto write = absolute * 2U;
          const float next_left = selected_buffer[write] * overdub_feedback + live_left;
          const float next_right = selected_buffer[write + 1U] * overdub_feedback + live_right;
          selected_buffer[write] = next_left;
          selected_buffer[write + 1U] = next_right;
          update_envelope(selected_track, absolute, next_left, next_right);
        }
      }

      if (playing) {
        for (unsigned track = 0U; track < kLoopTrackCount; ++track) if (occupied[track]) advance_track(track);
      }
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
  std::array<std::size_t, kLoopTrackCount> raw_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_start_frames{};
  std::array<std::size_t, kLoopTrackCount> trim_end_frames{};
  std::array<std::size_t, kLoopTrackCount> positions{};
  std::atomic<bool> enabled{false};
  std::atomic<unsigned> selected{0U};
  std::atomic<float> master_level{.78F};
  std::atomic<float> overdub{1.F};
  std::atomic<float> fade{.18F};
  std::atomic<unsigned> pending_command{kNoCommand};
  std::atomic<float> pending_trim_start{0.F};
  std::atomic<float> pending_trim_end{1.F};
  bool playing{false};
  bool recording{false};
  bool overdubbing{false};
  std::size_t record_count{};
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
void LoopProcessor::set_track_level(unsigned track, float value) noexcept { if (track < kLoopTrackCount) impl_->track_levels[track].store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_overdub(float value) noexcept { impl_->overdub.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::set_fade(float value) noexcept { impl_->fade.store(clamp01(value), std::memory_order_relaxed); }
void LoopProcessor::command(LoopCommand value) noexcept { impl_->pending_command.store(static_cast<unsigned>(value), std::memory_order_release); }
void LoopProcessor::set_trim(float start, float end) noexcept {
  impl_->pending_trim_start.store(clamp01(start), std::memory_order_relaxed);
  impl_->pending_trim_end.store(clamp01(end), std::memory_order_relaxed);
  impl_->pending_command.store(kTrimCommand, std::memory_order_release);
}
void LoopProcessor::auto_trim() noexcept { impl_->pending_command.store(kAutoTrimCommand, std::memory_order_release); }
void LoopProcessor::reset_trim() noexcept { impl_->pending_command.store(kResetTrimCommand, std::memory_order_release); }
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
