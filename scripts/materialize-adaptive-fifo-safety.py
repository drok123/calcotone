from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


header_path = Path("native/include/calcotone/elastic_stereo_fifo.hpp")
header = header_path.read_text(encoding="utf-8")
header = replace_once(
    header,
    "  void trim_to_target() noexcept;\n\n"
    "  std::uint64_t available() const noexcept;\n"
    "  std::uint64_t target_frames() const noexcept { return target_frames_; }\n",
    "  void trim_to_target() noexcept;\n"
    "  // Consumer-thread-only. The producer never reads the target.\n"
    "  void set_target_frames(std::uint64_t target_frames) noexcept;\n\n"
    "  std::uint64_t available() const noexcept;\n"
    "  std::uint64_t target_frames() const noexcept { return published_target_frames_.load(std::memory_order_relaxed); }\n",
    "dynamic FIFO target API",
)
header = replace_once(
    header,
    "  std::uint64_t target_frames_{};\n"
    "  double phase_{};\n",
    "  std::uint64_t target_frames_{};\n"
    "  std::atomic<std::uint64_t> published_target_frames_{};\n"
    "  double phase_{};\n",
    "published FIFO target",
)
header_path.write_text(header, encoding="utf-8")

source_path = Path("native/src/elastic_stereo_fifo.cpp")
source = source_path.read_text(encoding="utf-8")
source = replace_once(
    source,
    "    : target_frames_(std::clamp<std::uint64_t>(target_frames, 16U, capacity_frames / 4U)),\n"
    "      filtered_depth_(static_cast<double>(target_frames_)) {}\n",
    "    : target_frames_(std::clamp<std::uint64_t>(target_frames, 16U, capacity_frames / 4U)),\n"
    "      published_target_frames_(target_frames_),\n"
    "      filtered_depth_(static_cast<double>(target_frames_)) {}\n",
    "published FIFO target construction",
)
source = replace_once(
    source,
    "void ElasticStereoFifo::trim_to_target() noexcept {\n",
    "void ElasticStereoFifo::set_target_frames(std::uint64_t target_frames) noexcept {\n"
    "  target_frames_ = std::clamp<std::uint64_t>(target_frames, 16U, capacity_frames / 4U);\n"
    "  published_target_frames_.store(target_frames_, std::memory_order_release);\n"
    "}\n\n"
    "void ElasticStereoFifo::trim_to_target() noexcept {\n",
    "FIFO target setter",
)
source_path.write_text(source, encoding="utf-8")

host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
host = replace_once(
    host,
    '#include "calcotone/audio_device_config.hpp"\n',
    '#include "calcotone/adaptive_fifo_safety.hpp"\n#include "calcotone/audio_device_config.hpp"\n',
    "adaptive FIFO include",
)
host = replace_once(
    host,
    "    const auto fifo_target_frames = static_cast<std::uint64_t>(\n"
    "        2U * std::max(capture.period_frames, render.buffer_frames));\n",
    "    const auto fifo_period_frames = static_cast<std::uint64_t>(\n"
    "        std::max(capture.period_frames, render.buffer_frames));\n"
    "    const auto fifo_target_frames = 2U * fifo_period_frames;\n",
    "FIFO base period",
)
host = replace_once(
    host,
    "    auto ring = std::make_unique<calcotone::ElasticStereoFifo>(fifo_target_frames);\n"
    "    auto process = std::make_unique<ProcessBuffers>();\n",
    "    auto ring = std::make_unique<calcotone::ElasticStereoFifo>(fifo_target_frames);\n"
    "    calcotone::AdaptiveFifoSafety fifo_safety(\n"
    "        fifo_target_frames, fifo_period_frames, sample_rate);\n"
    "    auto process = std::make_unique<ProcessBuffers>();\n",
    "adaptive FIFO policy construction",
)
host = replace_once(
    host,
    "    std::atomic<bool> capture_mmcss{};\n"
    "    std::atomic<bool> render_mmcss{};\n",
    "    std::atomic<bool> capture_mmcss{};\n"
    "    std::atomic<bool> render_mmcss{};\n"
    "    std::atomic<std::uint64_t> adaptive_fifo_target{fifo_target_frames};\n"
    "    std::atomic<std::uint64_t> adaptive_fifo_maximum{fifo_safety.maximum_target_frames()};\n"
    "    std::atomic<std::uint64_t> adaptive_fifo_raises{};\n"
    "    std::atomic<std::uint64_t> adaptive_fifo_relaxations{};\n"
    "    std::atomic<std::uint64_t> adaptive_fifo_instability{};\n"
    "    std::atomic<double> adaptive_fifo_stable_seconds{};\n",
    "adaptive FIFO telemetry",
)
host = replace_once(
    host,
    "               << \",\\\"estimatedPathMs\\\":\" << (capture.period_frames + render.buffer_frames + fifo_target_frames) / sample_rate * 1000.\n",
    "               << \",\\\"estimatedPathMs\\\":\" << (capture.period_frames + render.buffer_frames + adaptive_fifo_target.load()) / sample_rate * 1000.\n",
    "dynamic estimated path",
)
host = replace_once(
    host,
    "               << \",\\\"fifoTargetFrames\\\":\" << fifo_target_frames\n",
    "               << \",\\\"fifoBaseTargetFrames\\\":\" << fifo_target_frames\n"
    "               << \",\\\"fifoTargetFrames\\\":\" << adaptive_fifo_target.load()\n"
    "               << \",\\\"fifoMaximumTargetFrames\\\":\" << adaptive_fifo_maximum.load()\n"
    "               << \",\\\"fifoSafetyRaises\\\":\" << adaptive_fifo_raises.load()\n"
    "               << \",\\\"fifoSafetyRelaxations\\\":\" << adaptive_fifo_relaxations.load()\n"
    "               << \",\\\"fifoInstabilityEvents\\\":\" << adaptive_fifo_instability.load()\n"
    "               << \",\\\"fifoStableSeconds\\\":\" << adaptive_fifo_stable_seconds.load()\n",
    "adaptive FIFO health telemetry",
)
host = replace_once(
    host,
    "      calcotone::StreamRecovery recovery(sample_rate);\n"
    "      const auto render_deadline_micros = static_cast<std::uint64_t>(\n",
    "      calcotone::StreamRecovery recovery(sample_rate);\n"
    "      std::uint64_t observed_overruns = ring->overruns();\n"
    "      const auto publish_fifo_safety = [&] {\n"
    "        const auto state = fifo_safety.state();\n"
    "        adaptive_fifo_target.store(state.target_frames, std::memory_order_relaxed);\n"
    "        adaptive_fifo_maximum.store(state.maximum_target_frames, std::memory_order_relaxed);\n"
    "        adaptive_fifo_raises.store(state.raises, std::memory_order_relaxed);\n"
    "        adaptive_fifo_relaxations.store(state.relaxations, std::memory_order_relaxed);\n"
    "        adaptive_fifo_instability.store(state.instability_events, std::memory_order_relaxed);\n"
    "        adaptive_fifo_stable_seconds.store(state.stable_seconds, std::memory_order_relaxed);\n"
    "      };\n"
    "      publish_fifo_safety();\n"
    "      const auto render_deadline_micros = static_cast<std::uint64_t>(\n",
    "adaptive FIFO render state",
)
host = replace_once(
    host,
    "        UINT32 remaining = render.buffer_frames - padding;\n"
    "        while (remaining) {\n",
    "        UINT32 remaining = render.buffer_frames - padding;\n"
    "        while (remaining) {\n",
    "render remaining anchor",
)
host = replace_once(
    host,
    "          if (block_stream_recoveries != 0U)\n"
    "            stream_recovery_events.fetch_add(block_stream_recoveries, std::memory_order_relaxed);\n"
    "          processor.process(process->capture_input.data(), process->mixed_output.data(), block);\n",
    "          if (block_stream_recoveries != 0U)\n"
    "            stream_recovery_events.fetch_add(block_stream_recoveries, std::memory_order_relaxed);\n"
    "          const auto current_overruns = ring->overruns();\n"
    "          const auto block_overruns = current_overruns - observed_overruns;\n"
    "          observed_overruns = current_overruns;\n"
    "          if (fifo_safety.observe_block(block, block_underrun_events,\n"
    "                  block_stream_recoveries, block_overruns))\n"
    "            ring->set_target_frames(fifo_safety.target_frames());\n"
    "          processor.process(process->capture_input.data(), process->mixed_output.data(), block);\n",
    "adaptive FIFO block observation",
)
host = replace_once(
    host,
    "        if (render_micros >= render_deadline_micros)\n"
    "          render_deadline_misses.fetch_add(1, std::memory_order_relaxed);\n",
    "        if (render_micros >= render_deadline_micros) {\n"
    "          render_deadline_misses.fetch_add(1, std::memory_order_relaxed);\n"
    "          if (fifo_safety.observe_deadline_miss())\n"
    "            ring->set_target_frames(fifo_safety.target_frames());\n"
    "        }\n"
    "        publish_fifo_safety();\n",
    "adaptive FIFO deadline observation",
)
host_path.write_text(host, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_once(
    cmake,
    "  src/stream_recovery.cpp\n",
    "  src/stream_recovery.cpp\n  src/adaptive_fifo_safety.cpp\n",
    "adaptive FIFO source",
)
cmake = replace_once(
    cmake,
    "add_executable(stream_recovery_test tests/stream_recovery_test.cpp)\n"
    "target_link_libraries(stream_recovery_test PRIVATE calcotone_dsp)\n",
    "add_executable(stream_recovery_test tests/stream_recovery_test.cpp)\n"
    "target_link_libraries(stream_recovery_test PRIVATE calcotone_dsp)\n"
    "add_executable(adaptive_fifo_safety_test tests/adaptive_fifo_safety_test.cpp)\n"
    "target_link_libraries(adaptive_fifo_safety_test PRIVATE calcotone_dsp)\n",
    "adaptive FIFO test target",
)
cmake = replace_once(
    cmake,
    "add_test(NAME stream_recovery_test COMMAND stream_recovery_test)\n",
    "add_test(NAME stream_recovery_test COMMAND stream_recovery_test)\n"
    "add_test(NAME adaptive_fifo_safety_test COMMAND adaptive_fifo_safety_test)\n",
    "adaptive FIFO CTest registration",
)
cmake_path.write_text(cmake, encoding="utf-8")

latency_path = Path("scripts/latency-path-audit.mjs")
latency = latency_path.read_text(encoding="utf-8")
latency = replace_once(
    latency,
    "const streamRecovery = readFileSync(resolve(root, 'native/src/stream_recovery.cpp'), 'utf8');\n",
    "const streamRecovery = readFileSync(resolve(root, 'native/src/stream_recovery.cpp'), 'utf8');\n"
    "const adaptiveFifoHeader = readFileSync(resolve(root, 'native/include/calcotone/adaptive_fifo_safety.hpp'), 'utf8');\n"
    "const adaptiveFifo = readFileSync(resolve(root, 'native/src/adaptive_fifo_safety.cpp'), 'utf8');\n",
    "adaptive FIFO audit sources",
)
latency = replace_once(
    latency,
    "requireText(nativeHost, 'streamRecoveryEvents', 'Discontinuity recovery telemetry');\n",
    "requireText(nativeHost, 'streamRecoveryEvents', 'Discontinuity recovery telemetry');\n"
    "requireText(adaptiveFifoHeader, 'class AdaptiveFifoSafety final', 'Bounded adaptive FIFO policy');\n"
    "requireText(adaptiveFifo, 'sample_rate_) * .020', 'Twenty-millisecond adaptive latency ceiling');\n"
    "requireText(adaptiveFifo, 'sample_rate_) * 30.0', 'Thirty-second stable relaxation window');\n"
    "requireText(adaptiveFifo, 'target_frames_ = next', 'Adaptive target step control');\n"
    "requireText(elasticFifoHeader, 'void set_target_frames', 'Consumer-thread FIFO target setter');\n"
    "requireText(nativeHost, 'fifo_safety.observe_block', 'Realtime FIFO stability observation');\n"
    "requireText(nativeHost, 'fifo_safety.observe_deadline_miss()', 'Deadline preemption safety raise');\n"
    "requireText(nativeHost, 'fifoBaseTargetFrames', 'User-requested FIFO baseline telemetry');\n"
    "requireText(nativeHost, 'fifoMaximumTargetFrames', 'Adaptive FIFO ceiling telemetry');\n"
    "requireText(nativeHost, 'fifoSafetyRaises', 'Adaptive FIFO raise telemetry');\n"
    "requireText(nativeHost, 'fifoSafetyRelaxations', 'Adaptive FIFO relaxation telemetry');\n",
    "adaptive FIFO audit contracts",
)
latency_path.write_text(latency, encoding="utf-8")
print("Materialized bounded adaptive FIFO safety.")
