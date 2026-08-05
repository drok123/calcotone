from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
host = replace_once(
    host,
    '#include "calcotone/native_processor.hpp"\n',
    '#include "calcotone/native_processor.hpp"\n#include "calcotone/stream_recovery.hpp"\n',
    "stream recovery include",
)

thread_pattern = re.compile(
    r"void set_realtime_thread\(\) noexcept \{[\s\S]*?\n\}\n\}  // namespace"
)
thread_replacement = '''class RealtimeThreadScope final {
 public:
  RealtimeThreadScope() noexcept {
    task_ = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task_index_);
    if (task_) {
      mmcss_ = true;
      AvSetMmThreadPriority(task_, AVRT_PRIORITY_CRITICAL);
    } else {
      SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
    }
  }
  ~RealtimeThreadScope() {
    if (task_) AvRevertMmThreadCharacteristics(task_);
  }
  RealtimeThreadScope(const RealtimeThreadScope&) = delete;
  RealtimeThreadScope& operator=(const RealtimeThreadScope&) = delete;
  [[nodiscard]] bool mmcss() const noexcept { return mmcss_; }
 private:
  HANDLE task_{};
  DWORD task_index_{};
  bool mmcss_{};
};
}  // namespace'''
host, count = thread_pattern.subn(thread_replacement, host, count=1)
if count != 1:
    raise RuntimeError("missing realtime thread helper")

host = replace_once(
    host,
    "    std::atomic<std::uint64_t> underruns{};\n"
    "    std::atomic<std::uint64_t> render_deadline_misses{};\n",
    "    std::atomic<std::uint64_t> underruns{};\n"
    "    std::atomic<std::uint64_t> underrun_events{};\n"
    "    std::atomic<std::uint64_t> render_deadline_misses{};\n",
    "underrun event telemetry",
)
host = replace_once(
    host,
    "    std::atomic<float> input_peak{};\n"
    "    std::atomic<float> output_peak{};\n",
    "    std::atomic<float> input_peak{};\n"
    "    std::atomic<float> output_peak{};\n"
    "    std::atomic<bool> capture_mmcss{};\n"
    "    std::atomic<bool> render_mmcss{};\n",
    "MMCSS telemetry",
)
host = replace_once(
    host,
    "               << \",\\\"underruns\\\":\" << underruns.load() << \",\\\"overruns\\\":\" << ring->overruns()\n",
    "               << \",\\\"underruns\\\":\" << underruns.load()\n"
    "               << \",\\\"underrunEvents\\\":\" << underrun_events.load()\n"
    "               << \",\\\"captureMmcss\\\":\" << (capture_mmcss.load() ? \"true\" : \"false\")\n"
    "               << \",\\\"renderMmcss\\\":\" << (render_mmcss.load() ? \"true\" : \"false\")\n"
    "               << \",\\\"overruns\\\":\" << ring->overruns()\n",
    "continuity health telemetry",
)

host = replace_once(
    host,
    "    std::thread capture_thread([&] {\n"
    "      set_realtime_thread();\n",
    "    std::thread capture_thread([&] {\n"
    "      RealtimeThreadScope realtime;\n"
    "      capture_mmcss.store(realtime.mmcss(), std::memory_order_relaxed);\n",
    "capture realtime scope",
)

old_capture_loop = '''          for (UINT32 frame = 0; frame < frames; ++frame) {
            const float left = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + input_one_channel, capture_encoding);
            const float right = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + input_two_channel, capture_encoding);
            publish_peak(input_peak, std::max(std::abs(left), std::abs(right)));
            if (std::abs(left) >= .999F) input_clips.fetch_add(1, std::memory_order_relaxed);
            if (std::abs(right) >= .999F) input_clips.fetch_add(1, std::memory_order_relaxed);
            ring->push(left, right);
          }
'''
new_capture_loop = '''          float packet_peak = 0.F;
          std::uint64_t packet_clips = 0U;
          for (UINT32 frame = 0; frame < frames; ++frame) {
            const float left = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + input_one_channel, capture_encoding);
            const float right = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + input_two_channel, capture_encoding);
            packet_peak = std::max({packet_peak, std::abs(left), std::abs(right)});
            packet_clips += std::abs(left) >= .999F ? 1U : 0U;
            packet_clips += std::abs(right) >= .999F ? 1U : 0U;
            ring->push(left, right);
          }
          publish_peak(input_peak, packet_peak);
          if (packet_clips != 0U)
            input_clips.fetch_add(packet_clips, std::memory_order_relaxed);
'''
host = replace_once(host, old_capture_loop, new_capture_loop, "batched capture telemetry")

host = replace_once(
    host,
    "    std::thread render_thread([&] {\n"
    "      set_realtime_thread();\n"
    "      float last_left = 0.F, last_right = 0.F;\n",
    "    std::thread render_thread([&] {\n"
    "      RealtimeThreadScope realtime;\n"
    "      render_mmcss.store(realtime.mmcss(), std::memory_order_relaxed);\n"
    "      calcotone::StreamRecovery recovery(sample_rate);\n",
    "render realtime scope and recovery",
)

old_render_input = '''          for (UINT32 frame = 0; frame < block; ++frame) {
            float left = 0.F, right = 0.F;
            if (ring->pull(left, right)) {
              last_left = left;
              last_right = right;
            } else {
              underruns.fetch_add(1, std::memory_order_relaxed);
              // Preserve waveform continuity when capture wakes late. A short
              // decay is much less audible than injecting a hard digital zero.
              last_left *= .995F;
              last_right *= .995F;
              left = last_left;
              right = last_right;
            }
            process->capture_input[frame * 2] = left; process->capture_input[frame * 2 + 1] = right;
          }
'''
new_render_input = '''          std::uint64_t block_underrun_frames = 0U;
          std::uint64_t block_underrun_events = 0U;
          for (UINT32 frame = 0; frame < block; ++frame) {
            float captured_left = 0.F, captured_right = 0.F;
            const bool pulled = ring->pull(captured_left, captured_right);
            const bool valid = pulled && std::isfinite(captured_left) && std::isfinite(captured_right);
            float left = 0.F, right = 0.F;
            if (recovery.process(valid, captured_left, captured_right, left, right))
              ++block_underrun_events;
            if (!valid) ++block_underrun_frames;
            process->capture_input[frame * 2] = left;
            process->capture_input[frame * 2 + 1] = right;
          }
          if (block_underrun_frames != 0U)
            underruns.fetch_add(block_underrun_frames, std::memory_order_relaxed);
          if (block_underrun_events != 0U)
            underrun_events.fetch_add(block_underrun_events, std::memory_order_relaxed);
'''
host = replace_once(host, old_render_input, new_render_input, "click-safe underrun recovery")

old_output_peak = '''          for (UINT32 frame = 0; frame < block; ++frame) {
            const float frame_peak = std::max(
                std::abs(process->mixed_output[frame * 2]),
                std::abs(process->mixed_output[frame * 2 + 1]));
            publish_peak(output_peak, frame_peak);
            for (WORD channel = 0; channel < render.format->nChannels; ++channel) {
'''
new_output_peak = '''          float block_output_peak = 0.F;
          for (UINT32 frame = 0; frame < block; ++frame) {
            block_output_peak = std::max({block_output_peak,
                std::abs(process->mixed_output[frame * 2]),
                std::abs(process->mixed_output[frame * 2 + 1])});
            for (WORD channel = 0; channel < render.format->nChannels; ++channel) {
'''
host = replace_once(host, old_output_peak, new_output_peak, "batched render peak")
host = replace_once(
    host,
    "          if (FAILED(render_service->ReleaseBuffer(block, 0)))\n"
    "            render_api_errors.fetch_add(1, std::memory_order_relaxed);\n",
    "          publish_peak(output_peak, block_output_peak);\n"
    "          if (FAILED(render_service->ReleaseBuffer(block, 0)))\n"
    "            render_api_errors.fetch_add(1, std::memory_order_relaxed);\n",
    "publish batched render peak",
)
host_path.write_text(host, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_once(
    cmake,
    "  src/elastic_stereo_fifo.cpp\n",
    "  src/elastic_stereo_fifo.cpp\n  src/stream_recovery.cpp\n",
    "stream recovery library source",
)
cmake = replace_once(
    cmake,
    "add_executable(elastic_stereo_fifo_test tests/elastic_stereo_fifo_test.cpp)\n"
    "target_link_libraries(elastic_stereo_fifo_test PRIVATE calcotone_dsp)\n",
    "add_executable(elastic_stereo_fifo_test tests/elastic_stereo_fifo_test.cpp)\n"
    "target_link_libraries(elastic_stereo_fifo_test PRIVATE calcotone_dsp)\n"
    "add_executable(stream_recovery_test tests/stream_recovery_test.cpp)\n"
    "target_link_libraries(stream_recovery_test PRIVATE calcotone_dsp)\n",
    "stream recovery test target",
)
cmake = replace_once(
    cmake,
    "add_test(NAME elastic_stereo_fifo_test COMMAND elastic_stereo_fifo_test)\n",
    "add_test(NAME elastic_stereo_fifo_test COMMAND elastic_stereo_fifo_test)\n"
    "add_test(NAME stream_recovery_test COMMAND stream_recovery_test)\n",
    "stream recovery CTest registration",
)
cmake_path.write_text(cmake, encoding="utf-8")
print("Materialized click-safe WASAPI continuity and batched realtime telemetry.")
