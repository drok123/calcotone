from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


config_header_path = Path("native/include/calcotone/audio_device_config.hpp")
config_header = config_header_path.read_text(encoding="utf-8")
config_header = replace_once(
    config_header,
    "  bool prefer_exclusive{true};\n",
    "  bool prefer_exclusive{true};\n  bool allow_shared_raw{true};\n",
    "shared RAW configuration field",
)
config_header_path.write_text(config_header, encoding="utf-8")

config_source_path = Path("native/src/audio_device_config.cpp")
config_source = config_source_path.read_text(encoding="utf-8")
config_source = replace_once(
    config_source,
    "unsigned channel_index(const char* name, unsigned fallback) noexcept {\n",
    "bool environment_flag(const char* name, bool fallback) noexcept {\n"
    "  const auto value = environment_string(name);\n"
    "  if (value.empty()) return fallback;\n"
    "  return value != \"0\" && value != \"false\" && value != \"off\" && value != \"no\";\n"
    "}\n\n"
    "unsigned channel_index(const char* name, unsigned fallback) noexcept {\n",
    "environment flag parser",
)
config_source = replace_once(
    config_source,
    "  config.prefer_exclusive = mode != \"shared\";\n",
    "  config.prefer_exclusive = mode != \"shared\";\n"
    "  config.allow_shared_raw = environment_flag(\"CALCOTONE_SHARED_RAW\", true);\n",
    "shared RAW environment option",
)
config_source_path.write_text(config_source, encoding="utf-8")

batch_path = Path("native/CALCOTONE-AUDIO-CONFIG.bat")
batch = batch_path.read_text(encoding="utf-8")
batch = replace_once(
    batch,
    "set \"CALCOTONE_AUDIO_MODE=shared\"\n",
    "set \"CALCOTONE_AUDIO_MODE=shared\"\n"
    "rem Shared fallback tries Pro Audio RAW first, then retries Pro Audio without RAW.\n"
    "rem Set this to 0 only for an endpoint whose driver rejects RAW stream creation.\n"
    "set \"CALCOTONE_SHARED_RAW=1\"\n",
    "shared RAW batch option",
)
batch_path.write_text(batch, encoding="utf-8")

host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
host = replace_once(
    host,
    '#include "calcotone/adaptive_fifo_safety.hpp"\n',
    '#include "calcotone/adaptive_fifo_safety.hpp"\n#include "calcotone/audio_client_property_plan.hpp"\n',
    "audio client property plan include",
)
host = replace_once(
    host,
    "  bool exclusive{};\n  std::string name;\n",
    "  bool exclusive{};\n  bool pro_audio{};\n  bool raw{};\n  std::string name;\n",
    "endpoint property telemetry",
)
host = replace_once(
    host,
    "        event(std::exchange(other.event, nullptr)), period_frames(other.period_frames), buffer_frames(other.buffer_frames), exclusive(other.exclusive),\n"
    "        name(std::move(other.name)), id(std::move(other.id)) {}\n",
    "        event(std::exchange(other.event, nullptr)), period_frames(other.period_frames), buffer_frames(other.buffer_frames),\n"
    "        exclusive(other.exclusive), pro_audio(other.pro_audio), raw(other.raw),\n"
    "        name(std::move(other.name)), id(std::move(other.id)) {}\n",
    "endpoint move properties",
)
host = replace_once(
    host,
    "Endpoint open_endpoint(IMMDeviceEnumerator* enumerator, EDataFlow flow, bool prefer_exclusive,\n"
    "                       std::string_view selector, std::uint32_t requested_frames,\n"
    "                       std::uint32_t requested_rate) {\n",
    "Endpoint open_endpoint(IMMDeviceEnumerator* enumerator, EDataFlow flow, bool prefer_exclusive,\n"
    "                       std::string_view selector, std::uint32_t requested_frames,\n"
    "                       std::uint32_t requested_rate, bool allow_shared_raw) {\n",
    "endpoint shared RAW signature",
)
old_activate = '''  const auto activate = [&]() {
    ComPtr<IAudioClient3> client;
    check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr, &client), "Activate IAudioClient3");
    AudioClientProperties properties{};
    properties.cbSize = sizeof(properties); properties.eCategory = AudioCategory_Media; properties.Options = AUDCLNT_STREAMOPTIONS_RAW;
    if (FAILED(client->SetClientProperties(&properties))) { properties.Options = AUDCLNT_STREAMOPTIONS_NONE; check(client->SetClientProperties(&properties), "SetClientProperties"); }
    return client;
  };
  endpoint.client = activate();
'''
new_activate = '''  const auto activate = [&](bool exclusive, bool allow_raw) {
    ComPtr<IAudioClient3> client;
    check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr, &client), "Activate IAudioClient3");
    endpoint.pro_audio = false;
    endpoint.raw = false;
    HRESULT last_result = E_FAIL;
    const auto plan = calcotone::audio_client_property_plan(exclusive, allow_raw);
    for (std::size_t attempt_index = 0; attempt_index < plan.count; ++attempt_index) {
      const auto attempt = plan.attempts[attempt_index];
      AudioClientProperties properties{};
      properties.cbSize = sizeof(properties);
      properties.bIsOffload = FALSE;
      properties.eCategory = AudioCategory_ProAudio;
      properties.Options = attempt == calcotone::AudioClientPropertyAttempt::ProAudioRaw
          ? AUDCLNT_STREAMOPTIONS_RAW : AUDCLNT_STREAMOPTIONS_NONE;
      last_result = client->SetClientProperties(&properties);
      if (SUCCEEDED(last_result)) {
        endpoint.pro_audio = true;
        endpoint.raw = properties.Options == AUDCLNT_STREAMOPTIONS_RAW;
        return client;
      }
    }
    check(last_result, "SetClientProperties");
    return client;
  };
  endpoint.client = activate(prefer_exclusive, allow_shared_raw);
'''
host = replace_once(host, old_activate, new_activate, "Pro Audio activation plan")
host = host.replace("endpoint.client = activate();", "endpoint.client = activate(true, false);")
old_shared = '''  if (!endpoint.exclusive) {
    // A failed exclusive Initialize can leave a driver-specific client in an
    // indeterminate state. Reactivate before the guaranteed shared fallback.
    endpoint.client = activate(true, false);
    UINT32 default_period{}, fundamental{}, minimum{}, maximum{};
    check(endpoint.client->GetSharedModeEnginePeriod(endpoint.format, &default_period, &fundamental, &minimum, &maximum), "GetSharedModeEnginePeriod");
    const UINT32 clamped = std::clamp<UINT32>(requested_frames, minimum, maximum);
    endpoint.period_frames = fundamental > 0
        ? minimum + ((clamped - minimum + fundamental - 1U) / fundamental) * fundamental
        : clamped;
    endpoint.period_frames = std::min(endpoint.period_frames, maximum);
    initialize = endpoint.client->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
    if (FAILED(initialize) && default_period != endpoint.period_frames) {
      endpoint.period_frames = default_period;
      initialize = endpoint.client->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
    }
    check(initialize, "InitializeSharedAudioStream");
  }
'''
new_shared = '''  if (!endpoint.exclusive) {
    // A failed exclusive Initialize can leave a driver-specific client in an
    // indeterminate state. Reactivate before the guaranteed shared fallback.
    const auto initialize_shared = [&](bool allow_raw) {
      endpoint.client = activate(false, allow_raw);
      UINT32 default_period{}, fundamental{}, minimum{}, maximum{};
      check(endpoint.client->GetSharedModeEnginePeriod(endpoint.format, &default_period, &fundamental, &minimum, &maximum), "GetSharedModeEnginePeriod");
      const UINT32 clamped = std::clamp<UINT32>(requested_frames, minimum, maximum);
      endpoint.period_frames = fundamental > 0
          ? minimum + ((clamped - minimum + fundamental - 1U) / fundamental) * fundamental
          : clamped;
      endpoint.period_frames = std::min(endpoint.period_frames, maximum);
      HRESULT shared_result = endpoint.client->InitializeSharedAudioStream(
          AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
      if (FAILED(shared_result) && default_period != endpoint.period_frames) {
        endpoint.period_frames = default_period;
        shared_result = endpoint.client->InitializeSharedAudioStream(
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
      }
      return shared_result;
    };
    initialize = initialize_shared(allow_shared_raw);
    if (FAILED(initialize) && endpoint.raw && allow_shared_raw) {
      std::ostringstream reason;
      reason << endpoint_name << " Pro Audio RAW initialization failed (HRESULT 0x"
             << std::hex << static_cast<unsigned long>(initialize)
             << "); retrying Pro Audio without RAW.";
      log_line(reason.str());
      initialize = initialize_shared(false);
    }
    check(initialize, "InitializeSharedAudioStream");
  }
'''
host = replace_once(host, old_shared, new_shared, "shared RAW initialization fallback")
host = replace_once(
    host,
    "        audio_config.capture_device, audio_config.buffer_frames, audio_config.sample_rate);\n",
    "        audio_config.capture_device, audio_config.buffer_frames, audio_config.sample_rate,\n"
    "        audio_config.allow_shared_raw);\n",
    "capture shared RAW option",
)
host = replace_once(
    host,
    "        audio_config.render_device, audio_config.buffer_frames, audio_config.sample_rate);\n",
    "        audio_config.render_device, audio_config.buffer_frames, audio_config.sample_rate,\n"
    "        audio_config.allow_shared_raw);\n",
    "render shared RAW option",
)
host = replace_once(
    host,
    "             \" frame period, \" + (capture.exclusive ? \"exclusive\" : \"shared\") + \" mode\");\n",
    "             \" frame period, \" + (capture.exclusive ? \"exclusive\" : \"shared\") + \" mode, \" +\n"
    "             (capture.pro_audio ? \"Pro Audio\" : \"default category\") +\n"
    "             (capture.raw ? \" RAW\" : \"\"));\n",
    "capture property log",
)
host = replace_once(
    host,
    "             \" frame period, \" + (render.exclusive ? \"exclusive\" : \"shared\") + \" mode\");\n",
    "             \" frame period, \" + (render.exclusive ? \"exclusive\" : \"shared\") + \" mode, \" +\n"
    "             (render.pro_audio ? \"Pro Audio\" : \"default category\") +\n"
    "             (render.raw ? \" RAW\" : \"\"));\n",
    "render property log",
)
host = replace_once(
    host,
    "               << \",\\\"audioMode\\\":\\\"\" << (render.exclusive ? \"exclusive\" : \"shared\") << \"\\\"\"\n",
    "               << \",\\\"audioMode\\\":\\\"\" << (render.exclusive ? \"exclusive\" : \"shared\") << \"\\\"\"\n"
    "               << \",\\\"sharedRawRequested\\\":\" << (audio_config.allow_shared_raw ? \"true\" : \"false\")\n"
    "               << \",\\\"captureProAudio\\\":\" << (capture.pro_audio ? \"true\" : \"false\")\n"
    "               << \",\\\"captureRaw\\\":\" << (capture.raw ? \"true\" : \"false\")\n"
    "               << \",\\\"renderProAudio\\\":\" << (render.pro_audio ? \"true\" : \"false\")\n"
    "               << \",\\\"renderRaw\\\":\" << (render.raw ? \"true\" : \"false\")\n",
    "Pro Audio health telemetry",
)
host_path.write_text(host, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_once(
    cmake,
    "  src/adaptive_fifo_safety.cpp\n",
    "  src/adaptive_fifo_safety.cpp\n  src/audio_client_property_plan.cpp\n",
    "audio client property source",
)
cmake = replace_once(
    cmake,
    "add_executable(audio_device_config_test tests/audio_device_config_test.cpp)\n"
    "target_link_libraries(audio_device_config_test PRIVATE calcotone_dsp)\n",
    "add_executable(audio_device_config_test tests/audio_device_config_test.cpp)\n"
    "target_link_libraries(audio_device_config_test PRIVATE calcotone_dsp)\n"
    "add_executable(audio_client_property_plan_test tests/audio_client_property_plan_test.cpp)\n"
    "target_link_libraries(audio_client_property_plan_test PRIVATE calcotone_dsp)\n",
    "audio client property test target",
)
cmake = replace_once(
    cmake,
    "add_test(NAME audio_device_config_test COMMAND audio_device_config_test)\n",
    "add_test(NAME audio_device_config_test COMMAND audio_device_config_test)\n"
    "add_test(NAME audio_client_property_plan_test COMMAND audio_client_property_plan_test)\n",
    "audio client property CTest registration",
)
cmake_path.write_text(cmake, encoding="utf-8")

latency_path = Path("scripts/latency-path-audit.mjs")
latency = latency_path.read_text(encoding="utf-8")
latency = replace_once(
    latency,
    "const audioConfig = readFileSync(resolve(root, 'native/src/audio_device_config.cpp'), 'utf8');\n",
    "const audioConfig = readFileSync(resolve(root, 'native/src/audio_device_config.cpp'), 'utf8');\n"
    "const audioClientPropertyPlan = readFileSync(resolve(root, 'native/src/audio_client_property_plan.cpp'), 'utf8');\n",
    "audio client property audit source",
)
latency = replace_once(
    latency,
    "requireText(audioConfig, 'CALCOTONE_BUFFER_FRAMES', 'Runtime buffer selection');\n",
    "requireText(audioConfig, 'CALCOTONE_BUFFER_FRAMES', 'Runtime buffer selection');\n"
    "requireText(audioConfig, 'CALCOTONE_SHARED_RAW', 'Runtime shared RAW opt-out');\n"
    "requireText(audioClientPropertyPlan, 'ProAudioRaw', 'Shared Pro Audio RAW first attempt');\n"
    "requireText(audioClientPropertyPlan, 'ProAudio', 'Shared Pro Audio standard fallback');\n"
    "requireText(nativeHost, 'AudioCategory_ProAudio', 'WASAPI Pro Audio category');\n"
    "requireText(nativeHost, 'AUDCLNT_STREAMOPTIONS_RAW', 'WASAPI RAW shared request');\n"
    "requireText(nativeHost, 'retrying Pro Audio without RAW', 'Whole-stream RAW initialization fallback');\n"
    "requireText(nativeHost, 'captureProAudio', 'Capture stream property telemetry');\n"
    "requireText(nativeHost, 'renderRaw', 'Render RAW telemetry');\n"
    "forbidText(nativeHost, 'AudioCategory_Media', 'Retired generic Media stream category');\n",
    "Pro Audio shared audit contracts",
)
latency_path.write_text(latency, encoding="utf-8")
print("Materialized Pro Audio shared RAW negotiation with whole-stream fallback.")
