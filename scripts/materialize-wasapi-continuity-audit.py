from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


path = Path("scripts/latency-path-audit.mjs")
source = path.read_text(encoding="utf-8")
source = replace_once(
    source,
    "const nativeDreamCore = readFileSync(resolve(root, 'native/src/dream_buffer_parity_processor.cpp'), 'utf8');\n",
    "const nativeDreamCore = readFileSync(resolve(root, 'native/src/dream_buffer_parity_processor.cpp'), 'utf8');\n"
    "const streamRecoveryHeader = readFileSync(resolve(root, 'native/include/calcotone/stream_recovery.hpp'), 'utf8');\n"
    "const streamRecovery = readFileSync(resolve(root, 'native/src/stream_recovery.cpp'), 'utf8');\n",
    "stream recovery audit sources",
)
source = replace_once(
    source,
    "requireText(nativeHost, 'last_left *= .995F', 'Click-safe capture-underrun decay');\n",
    "requireText(streamRecoveryHeader, 'class StreamRecovery final', 'Click-safe stream recovery component');\n"
    "requireText(streamRecoveryHeader, 'recovery_seconds = .002F', 'Two-millisecond capture resume bridge');\n"
    "requireText(streamRecovery, 'decay_ = std::exp(std::log(.001F) / (sample_rate * .03F))', 'Sample-rate-independent starvation decay');\n"
    "requireText(streamRecovery, 'const float blend = smoothstep(position)', 'Smoothstep capture resume crossfade');\n"
    "requireText(nativeHost, 'calcotone::StreamRecovery recovery(sample_rate)', 'WASAPI render continuity bridge');\n"
    "requireText(nativeHost, 'underrunEvents', 'WASAPI starvation episode telemetry');\n"
    "requireText(nativeHost, 'class RealtimeThreadScope final', 'RAII MMCSS realtime scope');\n"
    "requireText(nativeHost, 'AvRevertMmThreadCharacteristics(task_)', 'MMCSS cleanup');\n"
    "requireText(nativeHost, 'publish_peak(input_peak, packet_peak)', 'Packet-batched capture telemetry');\n"
    "requireText(nativeHost, 'publish_peak(output_peak, block_output_peak)', 'Block-batched render telemetry');\n"
    "forbidText(nativeHost, 'last_left *= .995F', 'Retired hardcoded underrun decay');\n"
    "forbidText(nativeHost, 'void set_realtime_thread()', 'Retired non-RAII realtime helper');\n",
    "retired underrun assertion",
)
path.write_text(source, encoding="utf-8")
print("Migrated latency audit to the tested StreamRecovery continuity contract.")
