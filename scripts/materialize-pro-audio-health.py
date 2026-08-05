from pathlib import Path

path = Path("native/src/wasapi_host.cpp")
source = path.read_text(encoding="utf-8")
old = '''               << ",\\\"audioMode\\\":\\\"" << (capture.exclusive && render.exclusive ? "exclusive" : capture.exclusive || render.exclusive ? "mixed" : "shared") << '"'
'''
new = '''               << ",\\\"audioMode\\\":\\\"" << (capture.exclusive && render.exclusive ? "exclusive" : capture.exclusive || render.exclusive ? "mixed" : "shared") << '"'
               << ",\\\"sharedRawRequested\\\":" << (audio_config.allow_shared_raw ? "true" : "false")
               << ",\\\"captureProAudio\\\":" << (capture.pro_audio ? "true" : "false")
               << ",\\\"captureRaw\\\":" << (capture.raw ? "true" : "false")
               << ",\\\"renderProAudio\\\":" << (render.pro_audio ? "true" : "false")
               << ",\\\"renderRaw\\\":" << (render.raw ? "true" : "false")
'''
if old not in source:
    raise RuntimeError("missing mixed-mode audio health anchor")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Added Pro Audio and RAW endpoint telemetry to native health.")
