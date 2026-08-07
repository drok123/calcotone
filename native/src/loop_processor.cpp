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
float clamp01(float value) noexcept { return std::clamp(std::isfinite(value) ? value : 0.F, 0.F, 1.F); }
}

struct LoopProcessor::Impl {
  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)),
        max_frames(static_cast<std::size_t>(std::ceil(rate * kLoopMaxSeconds))) {
    for (auto& buffer : tracks) buffer.assign(max_frames * 2U, 0.F);
    for (auto& level : track_levels) level.store(.72F, std::memory_order_relaxed);
  }

  void consume_command() noexcept {
    const unsigned raw = pending_command.exchange(kNoCommand, std::memory_order_acq_rel);
    if (raw == kNoCommand) return;
    const auto command = static_cast<LoopCommand>(raw);
    const unsigned track = selected.load(std::memory_order_relaxed);

    if (command == LoopCommand::Record) {
      if (recording) {
        if (master_frames == 0U && record_count >= 64U) {
          master_frames = std::min(max_frames, record_count);
          occupied[track] = true;
          playhead = 0U;
          playing = true;
        } else if (master_frames > 0U) {
          occupied[track] = true;
        }
        recording = false;
        record_fixed = false;
        record_count = 0U;
      } else {
        recording = true;
        record_fixed = master_frames > 0U;
        record_count = 0U;
        overdubbing = false;
        if (master_frames == 0U) playhead = 0U;
        else playing = true;
      }
      return;
    }

    if (command == LoopCommand::Overdub) {
      if (master_frames > 0U && occupied[track]) {
        overdubbing = !overdubbing;
        recording = false;
        record_fixed = false;
        playing = true;
      }
      return;
    }

    if (command == LoopCommand::Play) {
      if (master_frames > 0U) {
        playing = !playing;
        overdubbing = false;
        recording = false;
        record_fixed = false;
        record_count = 0U;
      }
      return;
    }

    if (command == LoopCommand::Clear) {
      occupied[track] = false;
      if (recording) {
        recording = false;
        record_fixed = false;
        record_count = 0U;
      }
      overdubbing = false;
      bool any = false;
      for (const bool filled : occupied) any = any || filled;
      if (!any) {
        master_frames = 0U;
        playhead = 0U;
        playing = false;
      }
    }
  }

  float read_track(unsigned track, unsigned channel, std::size_t position) const noexcept {
    if (master_frames == 0U) return 0.F;
    const auto& buffer = tracks[track];
    const std::size_t index = position * 2U + channel;
    const std::size_t fade_samples = std::min<std::size_t>(
        master_frames / 4U,
        static_cast<std::size_t>(std::round(fade.load(std::memory_order_relaxed) * .02F * rate)));
    if (fade_samples <= 1U || position < master_frames - fade_samples) return buffer[index];
    const std::size_t local = position - (master_frames - fade_samples);
    const float alpha = static_cast<float>(local) / static_cast<float>(fade_samples);
    const std::size_t start_position = std::min(master_frames - 1U, local);
    const float start = buffer[start_position * 2U + channel];
    return buffer[index] * (1.F - alpha) + start * alpha;
  }

  void process(float* data, std::size_t frames) noexcept {
    consume_command();
    if (!enabled.load(std::memory_order_relaxed)) return;

    const unsigned track = selected.load(std::memory_order_relaxed);
    auto& selected_buffer = tracks[track];
    const float loop_level = master_level.load(std::memory_order_relaxed);
    const float overdub_feedback = overdub.load(std::memory_order_relaxed);

    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float live_left = std::isfinite(data[frame * 2U]) ? data[frame * 2U] : 0.F;
      const float live_right = std::isfinite(data[frame * 2U + 1U]) ? data[frame * 2U + 1U] : 0.F;
      float loop_left = 0.F;
      float loop_right = 0.F;

      if (master_frames > 0U && playing) {
        for (unsigned layer = 0U; layer < kLoopTrackCount; ++layer) {
          if (!occupied[layer]) continue;
          if (recording && record_fixed && layer == track) continue;
          const float level = track_levels[layer].load(std::memory_order_relaxed);
          loop_left += read_track(layer, 0U, playhead) * level;
          loop_right += read_track(layer, 1U, playhead) * level;
        }
      }

      data[frame * 2U] = live_left + loop_left * loop_level;
      data[frame * 2U + 1U] = live_right + loop_right * loop_level;

      if (recording) {
        if (master_frames == 0U) {
          if (record_count < max_frames) {
            const std::size_t write = record_count * 2U;
            selected_buffer[write] = live_left;
            selected_buffer[write + 1U] = live_right;
            ++record_count;
          }
          if (record_count >= max_frames) {
            master_frames = max_frames;
            occupied[track] = true;
            recording = false;
            playing = true;
            playhead = 0U;
            record_count = 0U;
          }
          continue;
        }

        const std::size_t write = playhead * 2U;
        selected_buffer[write] = live_left;
        selected_buffer[write + 1U] = live_right;
        ++record_count;
        if (record_count >= master_frames) {
          occupied[track] = true;
          recording = false;
          record_fixed = false;
          record_count = 0U;
        }
      } else if (overdubbing && master_frames > 0U && occupied[track]) {
        const std::size_t write = playhead * 2U;
        selected_buffer[write] = selected_buffer[write] * overdub_feedback + live_left;
        selected_buffer[write + 1U] = selected_buffer[write + 1U] * overdub_feedback + live_right;
      }

      if (master_frames > 0U && (playing || recording || overdubbing)) {
        ++playhead;
        if (playhead >= master_frames) playhead = 0U;
      }
    }

    published_frames.store(master_frames, std::memory_order_relaxed);
    published_position.store(playhead, std::memory_order_relaxed);
    std::uint32_t mask = 0U;
    for (unsigned index = 0U; index < kLoopTrackCount; ++index)
      if (occupied[index]) mask |= (1U << index);
    published_mask.store(mask, std::memory_order_relaxed);
    published_transport.store(static_cast<unsigned>(current_transport()), std::memory_order_relaxed);
  }

  LoopTransport current_transport() const noexcept {
    if (recording) return LoopTransport::Recording;
    if (overdubbing) return LoopTransport::Overdubbing;
    if (master_frames == 0U) return LoopTransport::Empty;
    return playing ? LoopTransport::Playing : LoopTransport::Stopped;
  }

  float rate;
  std::size_t max_frames;
  std::array<std::vector<float>, kLoopTrackCount> tracks;
  std::array<std::atomic<float>, kLoopTrackCount> track_levels{};
  std::array<bool, kLoopTrackCount> occupied{};
  std::atomic<bool> enabled{false};
  std::atomic<unsigned> selected{0U};
  std::atomic<float> master_level{.78F};
  std::atomic<float> overdub{1.F};
  std::atomic<float> fade{.18F};
  std::atomic<unsigned> pending_command{kNoCommand};
  bool playing{false};
  bool recording{false};
  bool record_fixed{false};
  bool overdubbing{false};
  std::size_t master_frames{};
  std::size_t playhead{};
  std::size_t record_count{};
  std::atomic<unsigned> published_transport{static_cast<unsigned>(LoopTransport::Empty)};
  std::atomic<std::uint32_t> published_mask{};
  std::atomic<std::uint64_t> published_frames{};
  std::atomic<std::uint64_t> published_position{};
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
LoopTransport LoopProcessor::transport() const noexcept { return static_cast<LoopTransport>(impl_->published_transport.load(std::memory_order_relaxed)); }
unsigned LoopProcessor::selected_track() const noexcept { return impl_->selected.load(std::memory_order_relaxed); }
std::uint32_t LoopProcessor::track_mask() const noexcept { return impl_->published_mask.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::loop_frames() const noexcept { return impl_->published_frames.load(std::memory_order_relaxed); }
std::uint64_t LoopProcessor::position() const noexcept { return impl_->published_position.load(std::memory_order_relaxed); }

}  // namespace calcotone
