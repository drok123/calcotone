from pathlib import Path

path = Path("scripts/materialize-pro-audio-shared.py")
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)

label_index = next(
    (index for index, line in enumerate(lines)
     if '"Pro Audio health telemetry"' in line),
    -1,
)
if label_index < 0:
    raise RuntimeError("missing Pro Audio health telemetry label")

start = label_index
while start >= 0 and lines[start].strip() != "host = replace_once(":
    start -= 1
if start < 0:
    raise RuntimeError("missing Pro Audio health telemetry block start")

end = label_index + 1
while end < len(lines) and lines[end].strip() != ")":
    end += 1
if end >= len(lines):
    raise RuntimeError("missing Pro Audio health telemetry block end")
end += 1

replacement = '''host = replace_once(
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
'''.splitlines(keepends=True)

path.write_text("".join(lines[:start] + replacement + lines[end:]), encoding="utf-8")
print("Updated Pro Audio telemetry insertion using its semantic label.")
