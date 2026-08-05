from pathlib import Path

host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
old = '''               << ",\\\"audioMode\\\":\\\"" << (capture.exclusive && render.exclusive ? "exclusive" : capture.exclusive || render.exclusive ? "mixed" : "shared") << '"'
'''
new = '''               << ",\\\"audioMode\\\":\\\"" << (capture.exclusive && render.exclusive ? "exclusive" : capture.exclusive || render.exclusive ? "mixed" : "shared") << '"'
               << ",\\\"sharedRawRequested\\\":" << (audio_config.allow_shared_raw ? "true" : "false")
               << ",\\\"captureRaw\\\":" << (capture.raw ? "true" : "false")
               << ",\\\"renderRaw\\\":" << (render.raw ? "true" : "false")
'''
if old not in host:
    raise RuntimeError("missing mixed-mode audio health anchor")
host_path.write_text(host.replace(old, new, 1), encoding="utf-8")

latency_path = Path("scripts/latency-path-audit.mjs")
latency = latency_path.read_text(encoding="utf-8")
stale = "requireText(nativeHost, 'endpoint.client = activate()', 'Clean client reactivation after exclusive rejection');\n"
current = (
    "requireText(nativeHost, 'endpoint.client = activate(true, false)', 'Clean exclusive client reactivation after rejection');\n"
    "requireText(nativeHost, 'endpoint.client = activate(false, allow_raw)', 'Clean shared client reactivation for selected RAW policy');\n"
)
if stale not in latency:
    raise RuntimeError("missing stale client reactivation audit")
latency_path.write_text(latency.replace(stale, current, 1), encoding="utf-8")
print("Added shared RAW endpoint telemetry and migrated client-reactivation audit.")
