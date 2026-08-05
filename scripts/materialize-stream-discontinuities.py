from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


header_path = Path("native/include/calcotone/elastic_stereo_fifo.hpp")
header = header_path.read_text(encoding="utf-8")
header = replace_once(
    header,
    "  bool push(float left, float right) noexcept;\n"
    "  bool pull(float& left, float& right) noexcept;\n",
    "  bool push(float left, float right, bool discontinuity = false) noexcept;\n"
    "  bool pull(float& left, float& right, bool* discontinuity = nullptr) noexcept;\n",
    "FIFO discontinuity API",
)
header = replace_once(
    header,
    "  std::array<float, capacity_frames * 2U> data_{};\n",
    "  std::array<float, capacity_frames * 2U> data_{};\n"
    "  std::array<std::uint8_t, capacity_frames> markers_{};\n",
    "FIFO marker ring",
)
header = replace_once(
    header,
    "  bool history_valid_{};\n",
    "  bool history_valid_{};\n"
    "  bool pending_discontinuity_{};\n",
    "FIFO pending marker state",
)
header_path.write_text(header, encoding="utf-8")

source_path = Path("native/src/elastic_stereo_fifo.cpp")
source = source_path.read_text(encoding="utf-8")
pattern = re.compile(
    r"bool ElasticStereoFifo::push\(float left, float right\) noexcept \{[\s\S]*?\n\}\n\n"
    r"bool ElasticStereoFifo::pull\(float& left, float& right\) noexcept \{[\s\S]*?\n\}\n\n"
    r"(?=void ElasticStereoFifo::trim_to_target)"
)
replacement = '''bool ElasticStereoFifo::push(float left, float right, bool discontinuity) noexcept {
  const auto write = write_.load(std::memory_order_relaxed);
  const auto read = read_.load(std::memory_order_acquire);
  if (write - read >= capacity_frames) {
    overruns_.fetch_add(1, std::memory_order_relaxed);
    return false;
  }
  const auto slot = static_cast<std::size_t>(write) & mask_;
  data_[slot * 2U] = left;
  data_[slot * 2U + 1U] = right;
  markers_[slot] = discontinuity ? 1U : 0U;
  write_.store(write + 1U, std::memory_order_release);
  const auto depth = write + 1U - read;
  auto peak = high_water_.load(std::memory_order_relaxed);
  while (depth > peak && !high_water_.compare_exchange_weak(
      peak, depth, std::memory_order_relaxed, std::memory_order_relaxed)) {}
  return true;
}

bool ElasticStereoFifo::pull(float& left, float& right, bool* discontinuity) noexcept {
  if (discontinuity) *discontinuity = false;
  const auto read = read_.load(std::memory_order_relaxed);
  const auto write = write_.load(std::memory_order_acquire);
  const auto depth = write - read;
  // Retain two future frames for Hermite interpolation. Startup priming makes this the
  // normal boundary condition instead of adding another full device period.
  if (depth < 3U) return false;

  // Event-driven devices deliver blocks, so raw FIFO depth has a harmless
  // period-sized sawtooth. Filter it before steering the sample clock to avoid
  // turning that scheduler cadence into pitch modulation.
  filtered_depth_ += (static_cast<double>(depth) - filtered_depth_) * 0.0002;
  const double error = filtered_depth_ - static_cast<double>(target_frames_);
  const double desired = 1.0 + std::clamp(
      error / (static_cast<double>(target_frames_) * 64.0), -0.01, 0.01);
  // About a 21 ms coefficient ramp at 48 kHz: quick enough to follow device
  // drift, slow enough that the resampling ratio itself cannot zipper.
  ratio_ += (desired - ratio_) * 0.001;
  published_ratio_.store(static_cast<float>(ratio_), std::memory_order_relaxed);
  if (std::abs(ratio_ - 1.0) > 1e-6)
    resampled_frames_.fetch_add(1, std::memory_order_relaxed);

  const auto current = static_cast<std::size_t>(read) & mask_;
  const auto next = static_cast<std::size_t>(read + 1U) & mask_;
  const auto next_two = static_cast<std::size_t>(read + 2U) & mask_;
  const bool current_crosses = markers_[current] != 0U;
  const bool next_crosses = markers_[next] != 0U;
  const bool next_two_crosses = markers_[next_two] != 0U;
  if (current_crosses) {
    // A new capture timeline cannot inherit interpolation phase or history from
    // the packet before the gap.
    phase_ = 0.0;
    history_valid_ = false;
  }
  const bool report_discontinuity = pending_discontinuity_ || current_crosses;
  pending_discontinuity_ = false;
  if (discontinuity) *discontinuity = report_discontinuity;
  markers_[current] = 0U;  // report exactly once, even when ratio_ advances by zero.

  const float current_left = data_[current * 2U];
  const float current_right = data_[current * 2U + 1U];
  const float next_left = next_crosses ? current_left : data_[next * 2U];
  const float next_right = next_crosses ? current_right : data_[next * 2U + 1U];
  const float next_two_left = next_crosses || next_two_crosses
      ? next_left : data_[next_two * 2U];
  const float next_two_right = next_crosses || next_two_crosses
      ? next_right : data_[next_two * 2U + 1U];
  const float mu = static_cast<float>(phase_);
  const float prior_left = history_valid_ ? previous_left_ : current_left;
  const float prior_right = history_valid_ ? previous_right_ : current_right;
  left = hermite(prior_left, current_left, next_left, next_two_left, mu);
  right = hermite(prior_right, current_right, next_right, next_two_right, mu);

  const double next_phase = phase_ + ratio_;
  auto advance = static_cast<std::uint64_t>(next_phase);
  phase_ = next_phase - static_cast<double>(advance);
  if (advance + 2U > depth) {
    advance = depth - 2U;
    phase_ = 0.0;
  }
  // A ratio slightly above one can skip one source frame. Preserve any marker
  // from that skipped frame and report it on the very next rendered sample.
  for (std::uint64_t skipped = 1U; skipped < advance; ++skipped) {
    const auto slot = static_cast<std::size_t>(read + skipped) & mask_;
    if (markers_[slot] != 0U) pending_discontinuity_ = true;
    markers_[slot] = 0U;
  }
  if (advance > 0U) {
    const auto previous = static_cast<std::size_t>(read + advance - 1U) & mask_;
    previous_left_ = data_[previous * 2U];
    previous_right_ = data_[previous * 2U + 1U];
    history_valid_ = true;
  }
  read_.store(read + advance, std::memory_order_release);
  return true;
}

'''
source, count = pattern.subn(replacement, source, count=1)
if count != 1:
    raise RuntimeError("missing FIFO push/pull implementation")
source = replace_once(
    source,
    "  history_valid_ = false;\n"
    "  published_ratio_.store(1.F, std::memory_order_relaxed);\n",
    "  history_valid_ = false;\n"
    "  pending_discontinuity_ = false;\n"
    "  published_ratio_.store(1.F, std::memory_order_relaxed);\n",
    "FIFO trim marker reset",
)
source_path.write_text(source, encoding="utf-8")

host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
host = replace_once(
    host,
    "    std::atomic<std::uint64_t> underrun_events{};\n",
    "    std::atomic<std::uint64_t> underrun_events{};\n"
    "    std::atomic<std::uint64_t> stream_recovery_events{};\n",
    "stream recovery telemetry state",
)
host = replace_once(
    host,
    "               << \",\\\"underrunEvents\\\":\" << underrun_events.load()\n",
    "               << \",\\\"underrunEvents\\\":\" << underrun_events.load()\n"
    "               << \",\\\"streamRecoveryEvents\\\":\" << stream_recovery_events.load()\n",
    "stream recovery health telemetry",
)
host = replace_once(
    host,
    "      capture_mmcss.store(realtime.mmcss(), std::memory_order_relaxed);\n"
    "      while (running.load(std::memory_order_relaxed)) {\n",
    "      capture_mmcss.store(realtime.mmcss(), std::memory_order_relaxed);\n"
    "      bool pending_stream_discontinuity = false;\n"
    "      while (running.load(std::memory_order_relaxed)) {\n",
    "capture marker state",
)
host = replace_once(
    host,
    "          if (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY)\n"
    "            capture_discontinuities.fetch_add(1, std::memory_order_relaxed);\n"
    "          if (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)\n"
    "            capture_timestamp_errors.fetch_add(1, std::memory_order_relaxed);\n",
    "          if (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) {\n"
    "            capture_discontinuities.fetch_add(1, std::memory_order_relaxed);\n"
    "            pending_stream_discontinuity = true;\n"
    "          }\n"
    "          if (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) {\n"
    "            capture_timestamp_errors.fetch_add(1, std::memory_order_relaxed);\n"
    "            pending_stream_discontinuity = true;\n"
    "          }\n",
    "WASAPI discontinuity flag propagation",
)
host = replace_once(
    host,
    "            ring->push(left, right);\n",
    "            const bool mark_discontinuity = pending_stream_discontinuity;\n"
    "            if (ring->push(left, right, mark_discontinuity)) {\n"
    "              if (mark_discontinuity) pending_stream_discontinuity = false;\n"
    "            } else {\n"
    "              // Carry an overrun boundary to the first sample that is\n"
    "              // successfully accepted after the full ring recovers.\n"
    "              pending_stream_discontinuity = true;\n"
    "            }\n",
    "capture marker push",
)
host = replace_once(
    host,
    "          std::uint64_t block_underrun_events = 0U;\n",
    "          std::uint64_t block_underrun_events = 0U;\n"
    "          std::uint64_t block_stream_recoveries = 0U;\n",
    "render marker counter",
)
host = replace_once(
    host,
    "            float captured_left = 0.F, captured_right = 0.F;\n"
    "            const bool pulled = ring->pull(captured_left, captured_right);\n"
    "            const bool valid = pulled && std::isfinite(captured_left) && std::isfinite(captured_right);\n"
    "            float left = 0.F, right = 0.F;\n",
    "            float captured_left = 0.F, captured_right = 0.F;\n"
    "            bool stream_discontinuity = false;\n"
    "            const bool pulled = ring->pull(captured_left, captured_right, &stream_discontinuity);\n"
    "            const bool valid = pulled && std::isfinite(captured_left) && std::isfinite(captured_right);\n"
    "            if (stream_discontinuity) {\n"
    "              recovery.mark_discontinuity();\n"
    "              ++block_stream_recoveries;\n"
    "            }\n"
    "            float left = 0.F, right = 0.F;\n",
    "render marker recovery",
)
host = replace_once(
    host,
    "          if (block_underrun_events != 0U)\n"
    "            underrun_events.fetch_add(block_underrun_events, std::memory_order_relaxed);\n",
    "          if (block_underrun_events != 0U)\n"
    "            underrun_events.fetch_add(block_underrun_events, std::memory_order_relaxed);\n"
    "          if (block_stream_recoveries != 0U)\n"
    "            stream_recovery_events.fetch_add(block_stream_recoveries, std::memory_order_relaxed);\n",
    "publish stream recovery events",
)
host_path.write_text(host, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_once(
    cmake,
    "add_executable(elastic_stereo_fifo_test tests/elastic_stereo_fifo_test.cpp)\n"
    "target_link_libraries(elastic_stereo_fifo_test PRIVATE calcotone_dsp)\n",
    "add_executable(elastic_stereo_fifo_test tests/elastic_stereo_fifo_test.cpp)\n"
    "target_link_libraries(elastic_stereo_fifo_test PRIVATE calcotone_dsp)\n"
    "add_executable(elastic_stereo_fifo_discontinuity_test tests/elastic_stereo_fifo_discontinuity_test.cpp)\n"
    "target_link_libraries(elastic_stereo_fifo_discontinuity_test PRIVATE calcotone_dsp)\n",
    "FIFO discontinuity test target",
)
cmake = replace_once(
    cmake,
    "add_test(NAME elastic_stereo_fifo_test COMMAND elastic_stereo_fifo_test)\n",
    "add_test(NAME elastic_stereo_fifo_test COMMAND elastic_stereo_fifo_test)\n"
    "add_test(NAME elastic_stereo_fifo_discontinuity_test COMMAND elastic_stereo_fifo_discontinuity_test)\n",
    "FIFO discontinuity CTest registration",
)
cmake_path.write_text(cmake, encoding="utf-8")

latency_path = Path("scripts/latency-path-audit.mjs")
latency = latency_path.read_text(encoding="utf-8")
latency = replace_once(
    latency,
    "const elasticFifo = readFileSync(resolve(root, 'native/src/elastic_stereo_fifo.cpp'), 'utf8');\n",
    "const elasticFifoHeader = readFileSync(resolve(root, 'native/include/calcotone/elastic_stereo_fifo.hpp'), 'utf8');\n"
    "const elasticFifo = readFileSync(resolve(root, 'native/src/elastic_stereo_fifo.cpp'), 'utf8');\n",
    "FIFO header audit source",
)
latency = replace_once(
    latency,
    "requireText(elasticFifo, 'hermite(prior_left', 'Four-point drift interpolation');\n",
    "requireText(elasticFifo, 'hermite(prior_left', 'Four-point drift interpolation');\n"
    "requireText(elasticFifoHeader, 'bool discontinuity = false', 'In-band FIFO discontinuity push API');\n"
    "requireText(elasticFifoHeader, 'bool* discontinuity = nullptr', 'In-band FIFO discontinuity pull API');\n"
    "requireText(elasticFifo, 'markers_[slot] = discontinuity ? 1U : 0U', 'FIFO discontinuity marker storage');\n"
    "requireText(elasticFifo, 'const bool next_crosses = markers_[next] != 0U', 'No interpolation across future discontinuity');\n"
    "requireText(nativeHost, 'pending_stream_discontinuity = true', 'WASAPI packet and overrun marker propagation');\n"
    "requireText(nativeHost, 'recovery.mark_discontinuity()', 'Exact-frame discontinuity recovery');\n"
    "requireText(nativeHost, 'streamRecoveryEvents', 'Discontinuity recovery telemetry');\n",
    "FIFO continuity audit contracts",
)
latency_path.write_text(latency, encoding="utf-8")
print("Materialized in-band WASAPI discontinuity recovery.")
