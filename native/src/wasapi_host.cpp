#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <audioclient.h>
#include <avrt.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>

#include "calcotone/stack_amp.hpp"
#include "calcotone/control_server.hpp"
#include "calcotone/input_router.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include <utility>

using Microsoft::WRL::ComPtr;
namespace {
constexpr std::size_t kRingFrames = 1U << 17U;
constexpr std::size_t kRingMask = kRingFrames - 1U;
constexpr std::size_t kProcessFrames = 2048;
std::ofstream native_log;

std::filesystem::path executable_directory() {
  std::array<wchar_t, 32'768> path{};
  const DWORD size = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
  if (size == 0 || size >= path.size()) return std::filesystem::current_path();
  return std::filesystem::path(path.data(), path.data() + size).parent_path();
}

void log_line(std::string_view message) {
  std::cout << message << std::endl;
  if (native_log) native_log << message << std::endl;
}

struct StereoRing {
  std::array<float, kRingFrames * 2> data{};
  std::atomic<std::uint64_t> write{};
  std::atomic<std::uint64_t> read{};
  std::atomic<std::uint64_t> overruns{};
  bool push(float left, float right) noexcept {
    const auto w = write.load(std::memory_order_relaxed);
    const auto r = read.load(std::memory_order_acquire);
    if (w - r >= kRingFrames) { overruns.fetch_add(1, std::memory_order_relaxed); return false; }
    const auto slot = static_cast<std::size_t>(w) & kRingMask;
    data[slot * 2] = left; data[slot * 2 + 1] = right;
    write.store(w + 1, std::memory_order_release);
    return true;
  }
  bool pop(float& left, float& right) noexcept {
    const auto r = read.load(std::memory_order_relaxed);
    if (r == write.load(std::memory_order_acquire)) return false;
    const auto slot = static_cast<std::size_t>(r) & kRingMask;
    left = data[slot * 2]; right = data[slot * 2 + 1];
    read.store(r + 1, std::memory_order_release);
    return true;
  }
};

struct ProcessBuffers {
  std::array<float, kProcessFrames * 2> capture_input{};
  std::array<float, kProcessFrames * 2> mixed_output{};
  std::array<float, kProcessFrames * 2> lane_one_input{};
  std::array<float, kProcessFrames * 2> lane_one_output{};
  std::array<float, kProcessFrames * 2> lane_two_input{};
  std::array<float, kProcessFrames * 2> lane_two_output{};
};

struct Endpoint {
  ComPtr<IAudioClient3> client;
  WAVEFORMATEX* format{};
  HANDLE event{};
  UINT32 period_frames{};
  UINT32 buffer_frames{};
  Endpoint() = default;
  Endpoint(const Endpoint&) = delete;
  Endpoint& operator=(const Endpoint&) = delete;
  Endpoint(Endpoint&& other) noexcept
      : client(std::move(other.client)), format(std::exchange(other.format, nullptr)),
        event(std::exchange(other.event, nullptr)), period_frames(other.period_frames), buffer_frames(other.buffer_frames) {}
  Endpoint& operator=(Endpoint&&) = delete;
  ~Endpoint() { if (event) CloseHandle(event); if (format) CoTaskMemFree(format); }
};

void check(HRESULT result, const char* operation) {
  if (FAILED(result)) {
    std::ostringstream message;
    message << operation << " failed (HRESULT 0x" << std::hex << static_cast<unsigned long>(result) << ')';
    throw std::runtime_error(message.str());
  }
}

bool float_format(const WAVEFORMATEX* format) noexcept {
  if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT && format->wBitsPerSample == 32) return true;
  if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE || format->cbSize < 22) return false;
  const auto* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
  return extensible->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && format->wBitsPerSample == 32;
}

Endpoint open_endpoint(IMMDeviceEnumerator* enumerator, EDataFlow flow) {
  Endpoint endpoint;
  ComPtr<IMMDevice> device;
  check(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device), "GetDefaultAudioEndpoint");
  check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr, &endpoint.client), "Activate IAudioClient3");
  AudioClientProperties properties{};
  properties.cbSize = sizeof(properties);
  properties.eCategory = AudioCategory_Media;
  properties.Options = AUDCLNT_STREAMOPTIONS_RAW;
  if (FAILED(endpoint.client->SetClientProperties(&properties))) {
    properties.Options = AUDCLNT_STREAMOPTIONS_NONE;
    check(endpoint.client->SetClientProperties(&properties), "SetClientProperties");
  }
  check(endpoint.client->GetMixFormat(&endpoint.format), "GetMixFormat");
  if (!float_format(endpoint.format)) throw std::runtime_error("Default endpoint is not 32-bit float; native format conversion is the next backend milestone.");
  UINT32 default_period{}, fundamental{}, minimum{}, maximum{};
  check(endpoint.client->GetSharedModeEnginePeriod(endpoint.format, &default_period, &fundamental, &minimum, &maximum), "GetSharedModeEnginePeriod");
  endpoint.period_frames = minimum;
  HRESULT initialize = endpoint.client->InitializeSharedAudioStream(
      AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
  if (FAILED(initialize) && default_period != minimum) {
    endpoint.period_frames = default_period;
    initialize = endpoint.client->InitializeSharedAudioStream(
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
  }
  check(initialize, "InitializeSharedAudioStream");
  endpoint.event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!endpoint.event) throw std::runtime_error("CreateEvent failed");
  check(endpoint.client->SetEventHandle(endpoint.event), "SetEventHandle");
  check(endpoint.client->GetBufferSize(&endpoint.buffer_frames), "GetBufferSize");
  return endpoint;
}

void set_realtime_thread() noexcept {
  DWORD task_index = 0;
  if (HANDLE task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task_index)) {
    AvSetMmThreadPriority(task, AVRT_PRIORITY_CRITICAL);
  }
}
}  // namespace

int main() {
  try {
    std::cout << std::unitbuf;
    std::cerr << std::unitbuf;
    native_log.open(executable_directory() / "calcotone-native.log", std::ios::out | std::ios::trunc);
    log_line("CALCOTONE native host starting...");
    log_line("Initializing Windows COM audio services...");
    check(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "CoInitializeEx");
    ComPtr<IMMDeviceEnumerator> enumerator;
    check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)), "Create device enumerator");
    log_line("Opening default Windows capture endpoint...");
    Endpoint capture = open_endpoint(enumerator.Get(), eCapture);
    log_line("Capture endpoint ready: " + std::to_string(capture.format->nSamplesPerSec) + " Hz, " +
             std::to_string(capture.format->nChannels) + " channels, " + std::to_string(capture.period_frames) + " frame period");
    log_line("Opening default Windows render endpoint...");
    Endpoint render = open_endpoint(enumerator.Get(), eRender);
    log_line("Render endpoint ready: " + std::to_string(render.format->nSamplesPerSec) + " Hz, " +
             std::to_string(render.format->nChannels) + " channels, " + std::to_string(render.period_frames) + " frame period");
    if (capture.format->nSamplesPerSec != render.format->nSamplesPerSec) throw std::runtime_error("Input/output sample rates differ; select matching Windows device formats first.");
    ComPtr<IAudioCaptureClient> capture_service;
    ComPtr<IAudioRenderClient> render_service;
    check(capture.client->GetService(IID_PPV_ARGS(&capture_service)), "Get capture service");
    check(render.client->GetService(IID_PPV_ARGS(&render_service)), "Get render service");

    const float sample_rate = static_cast<float>(render.format->nSamplesPerSec);
    calcotone::StackAmp stack_one(sample_rate);
    calcotone::StackAmp stack_two(sample_rate);
    // These blocks exceed Windows' default 1 MB stack when combined. Allocate
    // once during startup; the realtime threads never allocate or resize them.
    auto ring = std::make_unique<StereoRing>();
    auto process = std::make_unique<ProcessBuffers>();
    std::atomic<bool> running{true};
    std::atomic<std::uint64_t> underruns{};
    std::atomic<bool> audible{true};
    std::atomic<bool> stack_bypassed{false};
    std::atomic<unsigned> stack_input{1};
    std::atomic<float> input_gain{1.F};
    std::atomic<float> output_gain{0.72F};
    const auto apply_command = [&](std::string_view line) -> std::string {
      if (line == "health" || line == "stats") {
        std::ostringstream status;
        status << "{\"engine\":\"calcotone-native\",\"protocol\":1,\"sampleRate\":" << sample_rate
               << ",\"inputPeriodFrames\":" << capture.period_frames
               << ",\"outputBufferFrames\":" << render.buffer_frames
               << ",\"inputChannels\":" << capture.format->nChannels
               << ",\"outputChannels\":" << render.format->nChannels
               << ",\"estimatedPathMs\":" << (capture.period_frames + render.buffer_frames) / sample_rate * 1000.
               << ",\"underruns\":" << underruns.load() << ",\"overruns\":" << ring->overruns.load() << '}';
        return status.str();
      }
      std::istringstream command{std::string(line)}; std::string name; float value = 0.F; command >> name >> value;
      if (!command || !std::isfinite(value)) return R"({"error":"expected name and numeric value"})";
      if (name == "active") audible.store(value >= 0.5F); else if (name == "bypass") stack_bypassed.store(value >= 0.5F);
      else if (name == "stackInput") stack_input.store(std::min(2U, static_cast<unsigned>(std::max(0.F, value))));
      else if (name == "inputGain") input_gain.store(std::clamp(value, 0.F, 2.F));
      else if (name == "outputGain") output_gain.store(std::clamp(value, 0.F, 1.5F));
      else if (name == "drive") { stack_one.set_drive(value); stack_two.set_drive(value); }
      else if (name == "tone") { stack_one.set_tone(value); stack_two.set_tone(value); }
      else if (name == "sag") { stack_one.set_sag(value); stack_two.set_sag(value); }
      else if (name == "mix") { stack_one.set_mix(value); stack_two.set_mix(value); }
      else if (name == "model") {
        const auto model = static_cast<calcotone::AmpModel>(static_cast<unsigned>(value));
        stack_one.set_model(model); stack_two.set_model(model);
      } else if (name == "cab") {
        const auto cabinet = static_cast<calcotone::Cabinet>(static_cast<unsigned>(value));
        stack_one.set_cabinet(cabinet); stack_two.set_cabinet(cabinet);
      } else if (name == "quality") {
        stack_one.set_quality(static_cast<unsigned>(value)); stack_two.set_quality(static_cast<unsigned>(value));
      }
      else return R"({"error":"unknown command"})";
      return "{\"ok\":true,\"command\":\"" + name + "\"}";
    };

    calcotone::ControlServer control_server(
        apply_command, 48157, executable_directory() / "web");
    log_line("Binding native control bridge to 127.0.0.1:48157...");
    control_server.start();
    log_line("Native control bridge is listening on 127.0.0.1:48157.");

    std::thread capture_thread([&] {
      set_realtime_thread();
      while (running.load(std::memory_order_relaxed)) {
        if (WaitForSingleObject(capture.event, 1000) != WAIT_OBJECT_0) continue;
        UINT32 packet = 0;
        while (SUCCEEDED(capture_service->GetNextPacketSize(&packet)) && packet) {
          BYTE* bytes = nullptr; UINT32 frames = 0; DWORD flags = 0;
          if (FAILED(capture_service->GetBuffer(&bytes, &frames, &flags, nullptr, nullptr))) break;
          const auto* samples = reinterpret_cast<const float*>(bytes);
          for (UINT32 frame = 0; frame < frames; ++frame) {
            const float left = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F : samples[frame * capture.format->nChannels];
            const float right = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : samples[frame * capture.format->nChannels + std::min<WORD>(1, capture.format->nChannels - 1)];
            ring->push(left, right);
          }
          capture_service->ReleaseBuffer(frames);
          capture_service->GetNextPacketSize(&packet);
        }
      }
    });

    std::thread render_thread([&] {
      set_realtime_thread();
      while (running.load(std::memory_order_relaxed)) {
        if (WaitForSingleObject(render.event, 1000) != WAIT_OBJECT_0) continue;
        UINT32 padding = 0;
        if (FAILED(render.client->GetCurrentPadding(&padding))) continue;
        UINT32 remaining = render.buffer_frames - padding;
        while (remaining) {
          const UINT32 block = std::min<UINT32>(remaining, kProcessFrames);
          BYTE* bytes = nullptr;
          if (FAILED(render_service->GetBuffer(block, &bytes))) break;
          for (UINT32 frame = 0; frame < block; ++frame) {
            float left = 0.F, right = 0.F;
            if (!ring->pop(left, right)) underruns.fetch_add(1, std::memory_order_relaxed);
            process->capture_input[frame * 2] = left; process->capture_input[frame * 2 + 1] = right;
          }
          calcotone::split_dual_mono(
              process->capture_input.data(), process->lane_one_input.data(), process->lane_two_input.data(), block,
              input_gain.load(std::memory_order_relaxed));
          const bool bypassed = stack_bypassed.load(std::memory_order_relaxed);
          const auto source = static_cast<calcotone::StackInputSource>(stack_input.load(std::memory_order_relaxed));
          if (!bypassed && calcotone::stack_receives_lane(source, 0)) stack_one.process(process->lane_one_input.data(), process->lane_one_output.data(), block);
          else std::copy_n(process->lane_one_input.data(), block * 2, process->lane_one_output.data());
          if (!bypassed && calcotone::stack_receives_lane(source, 1)) stack_two.process(process->lane_two_input.data(), process->lane_two_output.data(), block);
          else std::copy_n(process->lane_two_input.data(), block * 2, process->lane_two_output.data());
          auto* destination = reinterpret_cast<float*>(bytes);
          const float gain = audible.load(std::memory_order_relaxed) ? output_gain.load(std::memory_order_relaxed) : 0.F;
          calcotone::mix_dual_mono(process->lane_one_output.data(), process->lane_two_output.data(), process->mixed_output.data(), block, gain);
          for (UINT32 frame = 0; frame < block; ++frame) for (WORD channel = 0; channel < render.format->nChannels; ++channel)
            destination[frame * render.format->nChannels + channel] = process->mixed_output[frame * 2 + std::min<WORD>(channel, 1)];
          render_service->ReleaseBuffer(block, 0);
          remaining -= block;
        }
      }
    });

    check(capture.client->Start(), "Start capture");
    check(render.client->Start(), "Start render");
    const std::wstring faceplate_url = L"http://127.0.0.1:" + std::to_wstring(control_server.port()) + L"/";
    log_line("Opening local native faceplate: http://127.0.0.1:" + std::to_string(control_server.port()) + "/");
    ShellExecuteW(nullptr, L"open", faceplate_url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    const double input_ms = capture.period_frames / sample_rate * 1000.;
    const double output_ms = render.buffer_frames / sample_rate * 1000.;
    std::ostringstream startup;
    startup << "CALCOTONE native audio active | " << sample_rate << " Hz | input period " << capture.period_frames
            << "f | output buffer " << render.buffer_frames << "f | estimated native path " << input_ms + output_ms << " ms";
    log_line(startup.str());
    log_line("Control bridge: http://127.0.0.1:" + std::to_string(control_server.port()) + " | GET /health | POST /command");
    log_line("Commands: active/bypass 0/1, stackInput 0/1/2, inputGain/outputGain, drive/tone/sag/mix, model, cab, quality, stats, quit");
    std::string line;
    while (std::getline(std::cin, line)) {
      std::istringstream command(line); std::string name; float value = 0.F; command >> name;
      if (name == "quit") break;
      std::cout << apply_command(line) << '\n';
    }
    control_server.stop();
    running.store(false); SetEvent(capture.event); SetEvent(render.event);
    capture_thread.join(); render_thread.join();
    capture.client->Stop(); render.client->Stop(); CoUninitialize();
    return 0;
  } catch (const std::exception& error) {
    const std::string message = "CALCOTONE native host error: " + std::string(error.what());
    std::cerr << message << std::endl;
    if (native_log) native_log << message << std::endl;
    MessageBoxA(nullptr, message.c_str(), "CALCOTONE native host error", MB_OK | MB_ICONERROR);
    CoUninitialize(); return 1;
  }
}
#else
#include <iostream>
int main() { std::cout << "calcotone_host is Windows-only; run make test for the portable DSP core.\n"; }
#endif
