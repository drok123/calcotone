#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>

namespace calcotone {

inline constexpr unsigned kLoopTrackCount = 8U;
inline constexpr float kLoopMaxSeconds = 60.F;
inline constexpr unsigned kLoopWaveformBins = 256U;
inline constexpr unsigned kLoopEnvelopeBins = 16'384U;

// Values 4-6 are deliberately reserved by the internal trim command queue.
enum class LoopCommand : unsigned {
  Record = 0U,
  Overdub = 1U,
  Play = 2U,
  Clear = 3U,
  TrackPlay = 7U,
  TrackStop = 8U,
  Mute = 9U,
  Solo = 10U,
  Undo = 11U,
  Redo = 12U,
  Bounce = 13U,
};
enum class LoopTransport : unsigned { Empty = 0U, Stopped = 1U, Playing = 2U, Recording = 3U, Overdubbing = 4U };

class LoopProcessor final {
 public:
  explicit LoopProcessor(float sample_rate = 48'000.F);
  ~LoopProcessor();
  LoopProcessor(const LoopProcessor&) = delete;
  LoopProcessor& operator=(const LoopProcessor&) = delete;

  void process(float* live_stereo, std::size_t frames) noexcept;
  void set_enabled(bool enabled) noexcept;
  void set_selected_track(unsigned track) noexcept;
  void set_master_level(float value) noexcept;
  void set_track_level(unsigned track, float value) noexcept;
  void set_overdub(float value) noexcept;
  void set_fade(float value) noexcept;
  void command(LoopCommand command) noexcept;
  void set_trim(float start, float end) noexcept;
  void auto_trim() noexcept;
  void reset_trim() noexcept;

  LoopTransport transport() const noexcept;
  unsigned selected_track() const noexcept;
  std::uint32_t track_mask() const noexcept;
  std::uint64_t loop_frames() const noexcept;
  std::uint64_t raw_frames() const noexcept;
  std::uint64_t position() const noexcept;
  float trim_start() const noexcept;
  float trim_end() const noexcept;
  std::array<float, kLoopWaveformBins> waveform() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
