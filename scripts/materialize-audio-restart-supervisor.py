from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing {label}")
    return text.replace(old, new, 1)


host_path = Path("native/src/wasapi_host.cpp")
host = host_path.read_text(encoding="utf-8")
host = replace_once(
    host,
    '#include "calcotone/audio_client_property_plan.hpp"\n',
    '#include "calcotone/audio_client_property_plan.hpp"\n#include "calcotone/audio_restart_policy.hpp"\n',
    "audio restart policy include",
)
host = replace_once(
    host,
    "#include <cstring>\n",
    "#include <cstring>\n#include <cstdio>\n",
    "cstdio include",
)
host = replace_once(
    host,
    "#include <string>\n",
    "#include <string>\n#include <stdexcept>\n",
    "stdexcept include",
)
host = replace_once(
    host,
    "constexpr std::size_t kProcessFrames = 2048;\n",
    "constexpr std::size_t kProcessFrames = 2048;\n"
    "constexpr DWORD kAudioRestartExitCode = 75U;\n",
    "audio restart exit code",
)
host = replace_once(
    host,
    "void check(HRESULT result, const char* operation);\n",
    "class HResultError final : public std::runtime_error {\n"
    " public:\n"
    "  HResultError(HRESULT result, std::string message)\n"
    "      : std::runtime_error(std::move(message)), result_(result) {}\n"
    "  [[nodiscard]] HRESULT result() const noexcept { return result_; }\n"
    " private:\n"
    "  HRESULT result_;\n"
    "};\n\n"
    "void check(HRESULT result, const char* operation);\n",
    "typed HRESULT error",
)
host = replace_once(
    host,
    "    throw std::runtime_error(message.str());\n",
    "    throw HResultError(result, message.str());\n",
    "typed check exception",
)
check_end = '''void check(HRESULT result, const char* operation) {
  if (FAILED(result)) {
    std::ostringstream message;
    message << operation << " failed (HRESULT 0x" << std::hex << static_cast<unsigned long>(result) << ')';
    throw HResultError(result, message.str());
  }
}
'''
helpers = check_end + '''
calcotone::AudioRuntimeFault classify_audio_runtime_fault(HRESULT result) noexcept {
  if (result == AUDCLNT_E_DEVICE_INVALIDATED)
    return calcotone::AudioRuntimeFault::DeviceInvalidated;
  if (result == AUDCLNT_E_RESOURCES_INVALIDATED)
    return calcotone::AudioRuntimeFault::ResourcesInvalidated;
  if (result == AUDCLNT_E_SERVICE_NOT_RUNNING)
    return calcotone::AudioRuntimeFault::ServiceStopped;
  if (result == AUDCLNT_E_BUFFER_ERROR)
    return calcotone::AudioRuntimeFault::BufferError;
  return calcotone::AudioRuntimeFault::Other;
}

[[noreturn]] void restart_audio_host(const char* operation, HRESULT result) noexcept {
  char message[320]{};
  const int count = std::snprintf(
      message, sizeof(message),
      "CALCOTONE audio stream requires recreation: %s (HRESULT 0x%08lx). "
      "The launcher will restart the native host.\r\n",
      operation, static_cast<unsigned long>(result));
  const DWORD bytes = static_cast<DWORD>(std::clamp(count, 0, static_cast<int>(sizeof(message) - 1U)));
  OutputDebugStringA(message);
  const HANDLE error_output = GetStdHandle(STD_ERROR_HANDLE);
  if (error_output && error_output != INVALID_HANDLE_VALUE) {
    DWORD written = 0U;
    WriteFile(error_output, message, bytes, &written, nullptr);
  }
  ExitProcess(kAudioRestartExitCode);
}

bool audio_call_succeeded(calcotone::AudioRestartPolicy& policy, HRESULT result,
                          const char* operation,
                          std::atomic<std::uint64_t>& error_counter) noexcept {
  if (SUCCEEDED(result)) {
    policy.observe_success();
    return true;
  }
  error_counter.fetch_add(1U, std::memory_order_relaxed);
  const auto decision = policy.observe(classify_audio_runtime_fault(result));
  if (decision.restart) restart_audio_host(operation, result);
  return false;
}
'''
host = replace_once(host, check_end, helpers, "audio restart helpers")
host = replace_once(
    host,
    "      bool pending_stream_discontinuity = false;\n",
    "      bool pending_stream_discontinuity = false;\n"
    "      calcotone::AudioRestartPolicy restart_policy;\n",
    "capture restart policy",
)
old_capture = '''        UINT32 packet = 0;
        while (SUCCEEDED(capture_service->GetNextPacketSize(&packet)) && packet) {
          BYTE* bytes = nullptr; UINT32 frames = 0; DWORD flags = 0;
          if (FAILED(capture_service->GetBuffer(&bytes, &frames, &flags, nullptr, nullptr))) {
            capture_api_errors.fetch_add(1, std::memory_order_relaxed);
            break;
          }
'''
new_capture = '''        UINT32 packet = 0;
        while (running.load(std::memory_order_relaxed)) {
          const HRESULT packet_result = capture_service->GetNextPacketSize(&packet);
          if (!audio_call_succeeded(restart_policy, packet_result,
                                    "capture GetNextPacketSize", capture_api_errors)) break;
          if (packet == 0U) break;
          BYTE* bytes = nullptr; UINT32 frames = 0; DWORD flags = 0;
          const HRESULT buffer_result = capture_service->GetBuffer(
              &bytes, &frames, &flags, nullptr, nullptr);
          if (!audio_call_succeeded(restart_policy, buffer_result,
                                    "capture GetBuffer", capture_api_errors)) break;
'''
host = replace_once(host, old_capture, new_capture, "capture API restart handling")
host = replace_once(
    host,
    "          if (FAILED(capture_service->ReleaseBuffer(frames)))\n"
    "            capture_api_errors.fetch_add(1, std::memory_order_relaxed);\n",
    "          const HRESULT release_result = capture_service->ReleaseBuffer(frames);\n"
    "          if (!audio_call_succeeded(restart_policy, release_result,\n"
    "                                    \"capture ReleaseBuffer\", capture_api_errors)) break;\n",
    "capture release restart handling",
)
host = replace_once(
    host,
    "      calcotone::StreamRecovery recovery(sample_rate);\n",
    "      calcotone::StreamRecovery recovery(sample_rate);\n"
    "      calcotone::AudioRestartPolicy restart_policy;\n",
    "render restart policy",
)
host = replace_once(
    host,
    "        UINT32 padding = 0;\n"
    "        if (FAILED(render.client->GetCurrentPadding(&padding))) {\n"
    "          render_api_errors.fetch_add(1, std::memory_order_relaxed);\n"
    "          continue;\n"
    "        }\n",
    "        UINT32 padding = 0;\n"
    "        const HRESULT padding_result = render.client->GetCurrentPadding(&padding);\n"
    "        if (!audio_call_succeeded(restart_policy, padding_result,\n"
    "                                  \"render GetCurrentPadding\", render_api_errors)) continue;\n",
    "render padding restart handling",
)
host = replace_once(
    host,
    "          BYTE* bytes = nullptr;\n"
    "          if (FAILED(render_service->GetBuffer(block, &bytes))) {\n"
    "            render_api_errors.fetch_add(1, std::memory_order_relaxed);\n"
    "            break;\n"
    "          }\n",
    "          BYTE* bytes = nullptr;\n"
    "          const HRESULT buffer_result = render_service->GetBuffer(block, &bytes);\n"
    "          if (!audio_call_succeeded(restart_policy, buffer_result,\n"
    "                                    \"render GetBuffer\", render_api_errors)) break;\n",
    "render buffer restart handling",
)
host = replace_once(
    host,
    "          if (FAILED(render_service->ReleaseBuffer(block, 0)))\n"
    "            render_api_errors.fetch_add(1, std::memory_order_relaxed);\n",
    "          const HRESULT release_result = render_service->ReleaseBuffer(block, 0);\n"
    "          if (!audio_call_succeeded(restart_policy, release_result,\n"
    "                                    \"render ReleaseBuffer\", render_api_errors)) break;\n",
    "render release restart handling",
)
old_catch = '''  } catch (const std::exception& error) {
    const std::string message = "CALCOTONE native host error: " + std::string(error.what());
    std::cerr << message << std::endl;
    if (native_log) native_log << message << std::endl;
    MessageBoxA(nullptr, message.c_str(), "CALCOTONE native host error", MB_OK | MB_ICONERROR);
    CoUninitialize(); return 1;
  }
'''
new_catch = '''  } catch (const HResultError& error) {
    calcotone::AudioRestartPolicy restart_policy;
    if (restart_policy.observe(classify_audio_runtime_fault(error.result())).restart) {
      const std::string message = "CALCOTONE audio endpoint became unavailable; requesting supervised restart: "
          + std::string(error.what());
      std::cerr << message << std::endl;
      if (native_log) native_log << message << std::endl;
      CoUninitialize();
      return static_cast<int>(kAudioRestartExitCode);
    }
    const std::string message = "CALCOTONE native host error: " + std::string(error.what());
    std::cerr << message << std::endl;
    if (native_log) native_log << message << std::endl;
    MessageBoxA(nullptr, message.c_str(), "CALCOTONE native host error", MB_OK | MB_ICONERROR);
    CoUninitialize(); return 1;
  } catch (const std::exception& error) {
    const std::string message = "CALCOTONE native host error: " + std::string(error.what());
    std::cerr << message << std::endl;
    if (native_log) native_log << message << std::endl;
    MessageBoxA(nullptr, message.c_str(), "CALCOTONE native host error", MB_OK | MB_ICONERROR);
    CoUninitialize(); return 1;
  }
'''
host = replace_once(host, old_catch, new_catch, "typed host restart catch")
host_path.write_text(host, encoding="utf-8")

launcher_path = Path("native/START-CALCOTONE-NATIVE.bat")
launcher = launcher_path.read_text(encoding="utf-8")
old_launch = '''@echo off
cd /d "%~dp0"
title CALCOTONE Desktop
echo Starting CALCOTONE desktop...
if exist "CALCOTONE-AUDIO-CONFIG.bat" call "CALCOTONE-AUDIO-CONFIG.bat"
if not defined CALCOTONE_AUDIO_MODE set "CALCOTONE_AUDIO_MODE=exclusive"
echo Starting the low-latency WASAPI path using the physical interface endpoints.
echo Exclusive mode is requested by default; CALCOTONE-AUDIO-CONFIG.bat may override it when required.
echo The native host automatically falls back safely when an endpoint rejects exclusive mode.
echo The faceplate will open inside CALCOTONE; no browser or StackBlitz is required.
echo.
calcotone_host.exe
set CALCOTONE_EXIT=%ERRORLEVEL%
echo.
echo CALCOTONE native host stopped with exit code %CALCOTONE_EXIT%.
echo Send calcotone-native.log when asking for help.
echo.
pause
'''
new_launch = '''@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title CALCOTONE Desktop
echo Starting CALCOTONE desktop...
if exist "CALCOTONE-AUDIO-CONFIG.bat" call "CALCOTONE-AUDIO-CONFIG.bat"
if not defined CALCOTONE_AUDIO_MODE set "CALCOTONE_AUDIO_MODE=exclusive"
echo Starting the low-latency WASAPI path using the physical interface endpoints.
echo Exclusive mode is requested by default; CALCOTONE-AUDIO-CONFIG.bat may override it when required.
echo The native host automatically falls back safely when an endpoint rejects exclusive mode.
echo Recoverable endpoint or Windows Audio service resets restart the host automatically.
echo The faceplate will open inside CALCOTONE; no browser or StackBlitz is required.
echo.
set /a CALCOTONE_RESTARTS=0
:launch
calcotone_host.exe
set "CALCOTONE_EXIT=!ERRORLEVEL!"
if "!CALCOTONE_EXIT!"=="75" (
  set /a CALCOTONE_RESTARTS+=1
  if !CALCOTONE_RESTARTS! LEQ 12 (
    set /a CALCOTONE_RESTART_DELAY=CALCOTONE_RESTARTS
    if !CALCOTONE_RESTART_DELAY! GTR 5 set /a CALCOTONE_RESTART_DELAY=5
    echo.
    echo Audio endpoint changed or the Windows Audio service reset.
    echo Restarting CALCOTONE in !CALCOTONE_RESTART_DELAY! second(s) ^(!CALCOTONE_RESTARTS!/12^)...
    timeout /t !CALCOTONE_RESTART_DELAY! /nobreak >nul
    goto launch
  )
  echo.
  echo CALCOTONE reached the supervised restart limit.
)
echo.
echo CALCOTONE native host stopped with exit code !CALCOTONE_EXIT!.
echo Send calcotone-native.log when asking for help.
echo.
pause
endlocal
'''
if launcher != old_launch:
    raise RuntimeError("launcher source drifted from expected canonical content")
launcher_path.write_text(new_launch, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_once(
    cmake,
    "  src/audio_client_property_plan.cpp\n",
    "  src/audio_client_property_plan.cpp\n  src/audio_restart_policy.cpp\n",
    "audio restart policy source",
)
cmake = replace_once(
    cmake,
    "add_executable(audio_client_property_plan_test tests/audio_client_property_plan_test.cpp)\n"
    "target_link_libraries(audio_client_property_plan_test PRIVATE calcotone_dsp)\n",
    "add_executable(audio_client_property_plan_test tests/audio_client_property_plan_test.cpp)\n"
    "target_link_libraries(audio_client_property_plan_test PRIVATE calcotone_dsp)\n"
    "add_executable(audio_restart_policy_test tests/audio_restart_policy_test.cpp)\n"
    "target_link_libraries(audio_restart_policy_test PRIVATE calcotone_dsp)\n",
    "audio restart policy test target",
)
cmake = replace_once(
    cmake,
    "add_test(NAME audio_client_property_plan_test COMMAND audio_client_property_plan_test)\n",
    "add_test(NAME audio_client_property_plan_test COMMAND audio_client_property_plan_test)\n"
    "add_test(NAME audio_restart_policy_test COMMAND audio_restart_policy_test)\n",
    "audio restart policy CTest registration",
)
cmake_path.write_text(cmake, encoding="utf-8")

latency_path = Path("scripts/latency-path-audit.mjs")
latency = latency_path.read_text(encoding="utf-8")
latency = replace_once(
    latency,
    "const audioClientPropertyPlan = readFileSync(resolve(root, 'native/src/audio_client_property_plan.cpp'), 'utf8');\n",
    "const audioClientPropertyPlan = readFileSync(resolve(root, 'native/src/audio_client_property_plan.cpp'), 'utf8');\n"
    "const audioRestartPolicy = readFileSync(resolve(root, 'native/src/audio_restart_policy.cpp'), 'utf8');\n",
    "audio restart audit source",
)
latency = replace_once(
    latency,
    "requireText(launcher, 'CALCOTONE_AUDIO_MODE=exclusive', 'Launcher exclusive-mode request');\n",
    "requireText(launcher, 'CALCOTONE_AUDIO_MODE=exclusive', 'Launcher exclusive-mode request');\n"
    "requireText(audioRestartPolicy, 'AudioRuntimeFault::DeviceInvalidated', 'Immediate device invalidation restart');\n"
    "requireText(audioRestartPolicy, 'AudioRuntimeFault::ResourcesInvalidated', 'Immediate resource invalidation restart');\n"
    "requireText(audioRestartPolicy, 'AudioRuntimeFault::ServiceStopped', 'Immediate audio service restart');\n"
    "requireText(audioRestartPolicy, 'consecutive_buffer_errors_ >= threshold_', 'Bounded repeated buffer-error restart');\n"
    "requireText(nativeHost, 'AUDCLNT_E_DEVICE_INVALIDATED', 'WASAPI device-invalidated classification');\n"
    "requireText(nativeHost, 'AUDCLNT_E_RESOURCES_INVALIDATED', 'WASAPI resource-invalidated classification');\n"
    "requireText(nativeHost, 'AUDCLNT_E_SERVICE_NOT_RUNNING', 'WASAPI service-stopped classification');\n"
    "requireText(nativeHost, 'ExitProcess(kAudioRestartExitCode)', 'Realtime-thread supervised restart exit');\n"
    "requireText(nativeHost, 'return static_cast<int>(kAudioRestartExitCode)', 'Startup supervised restart exit');\n"
    "requireText(launcher, 'if \"!CALCOTONE_EXIT!\"==\"75\"', 'Launcher recoverable restart branch');\n"
    "requireText(launcher, 'CALCOTONE_RESTARTS! LEQ 12', 'Launcher restart-loop bound');\n"
    "requireText(launcher, 'timeout /t !CALCOTONE_RESTART_DELAY!', 'Launcher bounded restart backoff');\n",
    "audio restart audit contracts",
)
latency_path.write_text(latency, encoding="utf-8")
print("Materialized supervised WASAPI endpoint and service recovery.")
