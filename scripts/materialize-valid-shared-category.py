from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
host = replace_required(
    host,
    "  bool pro_audio{};\n",
    "",
    "misleading endpoint Pro Audio field",
)
host = replace_required(
    host,
    "        exclusive(other.exclusive), pro_audio(other.pro_audio), raw(other.raw),\n",
    "        exclusive(other.exclusive), raw(other.raw),\n",
    "endpoint move property state",
)
host = replace_required(
    host,
    "    endpoint.pro_audio = false;\n",
    "",
    "endpoint Pro Audio reset",
)
host = replace_required(
    host,
    "      properties.eCategory = AudioCategory_ProAudio;\n",
    "      properties.eCategory = flow == eRender ? AudioCategory_Media : AudioCategory_Other;\n",
    "valid flow-specific stream category",
)
host = host.replace(
    "calcotone::AudioClientPropertyAttempt::ProAudioRaw",
    "calcotone::AudioClientPropertyAttempt::Raw",
)
host = host.replace(
    "calcotone::AudioClientPropertyAttempt::ProAudio",
    "calcotone::AudioClientPropertyAttempt::Standard",
)
host = replace_required(
    host,
    "        endpoint.pro_audio = true;\n",
    "",
    "endpoint Pro Audio success state",
)
host = host.replace(
    " Pro Audio RAW initialization failed",
    " RAW shared initialization failed",
)
host = host.replace(
    "; retrying Pro Audio without RAW.",
    "; retrying shared stream without RAW.",
)
host = replace_required(
    host,
    "             (capture.pro_audio ? \"Pro Audio\" : \"default category\") +\n"
    "             (capture.raw ? \" RAW\" : \"\"));\n",
    "             \"category Other\" + (capture.raw ? \" RAW\" : \"\"));\n",
    "capture category log",
)
host = replace_required(
    host,
    "             (render.pro_audio ? \"Pro Audio\" : \"default category\") +\n"
    "             (render.raw ? \" RAW\" : \"\"));\n",
    "             \"category Media\" + (render.raw ? \" RAW\" : \"\"));\n",
    "render category log",
)
if "AudioCategory_ProAudio" in host or ".pro_audio" in host:
    raise RuntimeError("invalid Pro Audio stream-category state remains")
host_path.write_text(host, encoding="utf-8")

latency_path = Path("scripts/latency-path-audit.mjs")
latency = latency_path.read_text(encoding="utf-8")
old_contracts = '''requireText(audioClientPropertyPlan, 'ProAudioRaw', 'Shared Pro Audio RAW first attempt');
requireText(audioClientPropertyPlan, 'ProAudio', 'Shared Pro Audio standard fallback');
requireText(nativeHost, 'AudioCategory_ProAudio', 'WASAPI Pro Audio category');
requireText(nativeHost, 'AUDCLNT_STREAMOPTIONS_RAW', 'WASAPI RAW shared request');
requireText(nativeHost, 'retrying Pro Audio without RAW', 'Whole-stream RAW initialization fallback');
requireText(nativeHost, 'captureProAudio', 'Capture stream property telemetry');
requireText(nativeHost, 'renderRaw', 'Render RAW telemetry');
forbidText(nativeHost, 'AudioCategory_Media', 'Retired generic Media stream category');
'''
new_contracts = '''requireText(audioClientPropertyPlan, 'AudioClientPropertyAttempt::Raw', 'Shared RAW first attempt');
requireText(audioClientPropertyPlan, 'AudioClientPropertyAttempt::Standard', 'Shared standard fallback');
requireText(nativeHost, 'flow == eRender ? AudioCategory_Media : AudioCategory_Other', 'Valid flow-specific stream categories');
requireText(nativeHost, 'AUDCLNT_STREAMOPTIONS_RAW', 'WASAPI RAW shared request');
requireText(nativeHost, 'retrying shared stream without RAW', 'Whole-stream RAW initialization fallback');
requireText(nativeHost, 'captureRaw', 'Capture RAW telemetry');
requireText(nativeHost, 'renderRaw', 'Render RAW telemetry');
requireText(nativeHost, 'AvSetMmThreadCharacteristicsW(L"Pro Audio"', 'Pro Audio MMCSS scheduling remains separate');
forbidText(nativeHost, 'AudioCategory_ProAudio', 'Nonexistent Pro Audio stream category');
forbidText(nativeHost, 'captureProAudio', 'Misleading capture Pro Audio category telemetry');
forbidText(nativeHost, 'renderProAudio', 'Misleading render Pro Audio category telemetry');
'''
latency = replace_required(
    latency,
    old_contracts,
    new_contracts,
    "valid shared category audit contracts",
)
latency_path.write_text(latency, encoding="utf-8")
print("Separated valid stream categories, RAW options, and Pro Audio MMCSS scheduling.")
