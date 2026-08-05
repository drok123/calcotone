from pathlib import Path

path = Path("scripts/materialize-pro-audio-shared.py")
source = path.read_text(encoding="utf-8")
old = '''host = replace_once(
    host,
    "               << \",\\\"audioMode\\\":\\\"\" << (render.exclusive ? \"exclusive\" : \"shared\") << \"\\\"\"\\n",
    "               << \",\\\"audioMode\\\":\\\"\" << (render.exclusive ? \"exclusive\" : \"shared\") << \"\\\"\"\\n"
    "               << \",\\\"sharedRawRequested\\\":\" << (audio_config.allow_shared_raw ? \"true\" : \"false\")\\n"
    "               << \",\\\"captureProAudio\\\":\" << (capture.pro_audio ? \"true\" : \"false\")\\n"
    "               << \",\\\"captureRaw\\\":\" << (capture.raw ? \"true\" : \"false\")\\n"
    "               << \",\\\"renderProAudio\\\":\" << (render.pro_audio ? \"true\" : \"false\")\\n"
    "               << \",\\\"renderRaw\\\":\" << (render.raw ? \"true\" : \"false\")\\n",
    "Pro Audio health telemetry",
)
'''
new = '''host = replace_once(
    host,
    "               << \",\\\"audioMode\\\":\\\"\" << (capture.exclusive && render.exclusive ? \"exclusive\" : capture.exclusive || render.exclusive ? \"mixed\" : \"shared\") << '\"'\\n",
    "               << \",\\\"audioMode\\\":\\\"\" << (capture.exclusive && render.exclusive ? \"exclusive\" : capture.exclusive || render.exclusive ? \"mixed\" : \"shared\") << '\"'\\n"
    "               << \",\\\"sharedRawRequested\\\":\" << (audio_config.allow_shared_raw ? \"true\" : \"false\")\\n"
    "               << \",\\\"captureProAudio\\\":\" << (capture.pro_audio ? \"true\" : \"false\")\\n"
    "               << \",\\\"captureRaw\\\":\" << (capture.raw ? \"true\" : \"false\")\\n"
    "               << \",\\\"renderProAudio\\\":\" << (render.pro_audio ? \"true\" : \"false\")\\n"
    "               << \",\\\"renderRaw\\\":\" << (render.raw ? \"true\" : \"false\")\\n",
    "Pro Audio health telemetry",
)
'''
if old not in source:
    raise RuntimeError("missing stale Pro Audio health telemetry materializer block")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Updated Pro Audio telemetry insertion to the mixed-mode health anchor.")
