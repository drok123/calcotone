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
#include "calcotone/native_rack.hpp"
#include "calcotone/pitch_tracker.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

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
  std::atomic<std::uint64_t> high_water{};
  bool push(float left, float right) noexcept {
    const auto w = write.load(std::memory_order_relaxed);
    const auto r = read.load(std::memory_order_acquire);
    if (w - r >= kRingFrames) { overruns.fetch_add(1, std::memory_order_relaxed); return false; }
    const auto slot = static_cast<std::size_t>(w) & kRingMask;
    data[slot * 2] = left; data[slot * 2 + 1] = right;
    write.store(w + 1, std::memory_order_release);
    const auto depth = w + 1 - r;
    auto peak = high_water.load(std::memory_order_relaxed);
    while (depth > peak && !high_water.compare_exchange_weak(
        peak, depth, std::memory_order_relaxed, std::memory_order_relaxed)) {}
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
  std::uint64_t available() const noexcept {
    const auto w = write.load(std::memory_order_acquire);
    const auto r = read.load(std::memory_order_acquire);
    return w - r;
  }
};

class NativeRecorder {
 public:
  explicit NativeRecorder(float rate)
      : sample_rate_(static_cast<std::uint32_t>(rate)), max_frames_(sample_rate_ * 120U), samples_(max_frames_ * 2U) {}
  bool start() noexcept {
    if (active_.exchange(true, std::memory_order_acq_rel)) return false;
    frames_.store(0, std::memory_order_release); peak_.store(0.F, std::memory_order_release);
    return true;
  }
  void capture(const float* stereo, std::size_t count) noexcept {
    if (!active_.load(std::memory_order_acquire)) return;
    writers_.fetch_add(1, std::memory_order_acq_rel);
    if (active_.load(std::memory_order_acquire)) {
      const auto start = frames_.load(std::memory_order_relaxed);
      const auto accepted = std::min<std::size_t>(count, max_frames_ - std::min<std::size_t>(start, max_frames_));
      float peak = peak_.load(std::memory_order_relaxed);
      for (std::size_t frame = 0; frame < accepted; ++frame) {
        samples_[(start + frame) * 2] = stereo[frame * 2];
        samples_[(start + frame) * 2 + 1] = stereo[frame * 2 + 1];
        peak = std::max({peak, std::abs(stereo[frame * 2]), std::abs(stereo[frame * 2 + 1])});
      }
      frames_.store(start + accepted, std::memory_order_release);
      peak_.store(peak, std::memory_order_relaxed);
      if (start + accepted >= max_frames_) active_.store(false, std::memory_order_release);
    }
    writers_.fetch_sub(1, std::memory_order_release);
  }
  bool stop(const std::filesystem::path& path) noexcept {
    active_.store(false, std::memory_order_release);
    while (writers_.load(std::memory_order_acquire) != 0) Sleep(0);
    const auto frames = frames_.load(std::memory_order_acquire);
    if (frames == 0) return false;
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    if (!file) return false;
    const std::uint32_t data_bytes = static_cast<std::uint32_t>(frames * 6U);
    file.write("RIFF", 4); write_u32(file, 36U + data_bytes); file.write("WAVEfmt ", 8);
    write_u32(file, 16); write_u16(file, 1); write_u16(file, 2); write_u32(file, sample_rate_);
    write_u32(file, sample_rate_ * 6U); write_u16(file, 6); write_u16(file, 24);
    file.write("data", 4); write_u32(file, data_bytes);
    for (std::size_t i = 0; i < frames * 2U; ++i) {
      const auto sample = static_cast<std::int32_t>(std::round(std::clamp(samples_[i], -1.F, .999999F) * 8'388'607.F));
      const char bytes[3]{static_cast<char>(sample & 0xff), static_cast<char>((sample >> 8) & 0xff), static_cast<char>((sample >> 16) & 0xff)};
      file.write(bytes, 3);
    }
    return static_cast<bool>(file);
  }
  void cancel() noexcept { active_.store(false, std::memory_order_release); frames_.store(0, std::memory_order_release); }
  bool active() const noexcept { return active_.load(std::memory_order_acquire); }
  std::uint64_t frames() const noexcept { return frames_.load(std::memory_order_acquire); }
  float peak() const noexcept { return peak_.load(std::memory_order_relaxed); }
 private:
  static void write_u16(std::ofstream& file, std::uint16_t value) {
    const char bytes[2]{static_cast<char>(value & 0xff), static_cast<char>((value >> 8) & 0xff)}; file.write(bytes, 2);
  }
  static void write_u32(std::ofstream& file, std::uint32_t value) {
    const char bytes[4]{static_cast<char>(value & 0xff), static_cast<char>((value >> 8) & 0xff), static_cast<char>((value >> 16) & 0xff), static_cast<char>((value >> 24) & 0xff)}; file.write(bytes, 4);
  }
  std::uint32_t sample_rate_, max_frames_;
  std::vector<float> samples_;
  std::atomic<std::uint64_t> frames_{};
  std::atomic<float> peak_{};
  std::atomic<unsigned> writers_{};
  std::atomic<bool> active_{};
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
  bool exclusive{};
  Endpoint() = default;
  Endpoint(const Endpoint&) = delete;
  Endpoint& operator=(const Endpoint&) = delete;
  Endpoint(Endpoint&& other) noexcept
      : client(std::move(other.client)), format(std::exchange(other.format, nullptr)),
        event(std::exchange(other.event, nullptr)), period_frames(other.period_frames), buffer_frames(other.buffer_frames), exclusive(other.exclusive) {}
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

enum class SampleEncoding { Float32, Pcm16, Pcm24, Pcm32, Unsupported };

SampleEncoding sample_encoding(const WAVEFORMATEX* format) noexcept {
  const bool extensible = format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && format->cbSize >= 22;
  const GUID subtype = extensible ? reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat
                                  : format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
                                  : format->wFormatTag == WAVE_FORMAT_PCM ? KSDATAFORMAT_SUBTYPE_PCM : GUID{};
  if (subtype == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && format->wBitsPerSample == 32) return SampleEncoding::Float32;
  if (subtype != KSDATAFORMAT_SUBTYPE_PCM) return SampleEncoding::Unsupported;
  if (format->wBitsPerSample == 16) return SampleEncoding::Pcm16;
  if (format->wBitsPerSample == 24) return SampleEncoding::Pcm24;
  if (format->wBitsPerSample == 32) return SampleEncoding::Pcm32;
  return SampleEncoding::Unsupported;
}

std::string format_description(const WAVEFORMATEX* format) {
  const char* encoding = sample_encoding(format) == SampleEncoding::Float32 ? "float"
      : sample_encoding(format) == SampleEncoding::Pcm16 ? "PCM16"
      : sample_encoding(format) == SampleEncoding::Pcm24 ? "PCM24"
      : sample_encoding(format) == SampleEncoding::Pcm32 ? "PCM32" : "unsupported";
  return std::to_string(format->nSamplesPerSec) + " Hz " + std::to_string(format->nChannels) + " ch " + encoding;
}

float decode_sample(const BYTE* bytes, std::size_t sample, SampleEncoding encoding) noexcept {
  if (encoding == SampleEncoding::Float32) { float value{}; std::memcpy(&value, bytes + sample * 4, 4); return value; }
  if (encoding == SampleEncoding::Pcm16) { std::int16_t value{}; std::memcpy(&value, bytes + sample * 2, 2); return static_cast<float>(value) / 32768.F; }
  if (encoding == SampleEncoding::Pcm24) {
    const BYTE* p = bytes + sample * 3; std::int32_t value = p[0] | (p[1] << 8) | (p[2] << 16);
    if (value & 0x800000) value |= ~0xFFFFFF;
    return static_cast<float>(value) / 8'388'608.F;
  }
  if (encoding == SampleEncoding::Pcm32) { std::int32_t value{}; std::memcpy(&value, bytes + sample * 4, 4); return static_cast<float>(value) / 2'147'483'648.F; }
  return 0.F;
}

void encode_sample(BYTE* bytes, std::size_t sample, SampleEncoding encoding, float input) noexcept {
  const float value = std::clamp(input, -1.F, .999999F);
  if (encoding == SampleEncoding::Float32) { std::memcpy(bytes + sample * 4, &value, 4); return; }
  if (encoding == SampleEncoding::Pcm16) { const auto pcm=static_cast<std::int16_t>(std::lrint(value*32767.F)); std::memcpy(bytes+sample*2,&pcm,2); return; }
  if (encoding == SampleEncoding::Pcm24) { const auto pcm=static_cast<std::int32_t>(std::lrint(value*8'388'607.F)); BYTE* p=bytes+sample*3; p[0]=pcm&255; p[1]=(pcm>>8)&255; p[2]=(pcm>>16)&255; return; }
  if (encoding == SampleEncoding::Pcm32) { const auto pcm=static_cast<std::int32_t>(std::llrint(static_cast<double>(value)*2'147'483'647.)); std::memcpy(bytes+sample*4,&pcm,4); }
}

WAVEFORMATEXTENSIBLE pcm_candidate(const WAVEFORMATEX* basis, WORD container_bits, WORD valid_bits) noexcept {
  WAVEFORMATEXTENSIBLE format{};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE; format.Format.nChannels = basis->nChannels;
  format.Format.nSamplesPerSec = basis->nSamplesPerSec; format.Format.wBitsPerSample = container_bits;
  format.Format.nBlockAlign = static_cast<WORD>(basis->nChannels * container_bits / 8);
  format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
  format.Format.cbSize = 22; format.Samples.wValidBitsPerSample = valid_bits;
  format.dwChannelMask = basis->nChannels == 1 ? SPEAKER_FRONT_CENTER : basis->nChannels == 2 ? SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT : 0;
  if (basis->wFormatTag == WAVE_FORMAT_EXTENSIBLE && basis->cbSize >= 22)
    format.dwChannelMask = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(basis)->dwChannelMask;
  format.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
  return format;
}

Endpoint open_endpoint(IMMDeviceEnumerator* enumerator, EDataFlow flow, bool prefer_exclusive) {
  Endpoint endpoint;
  ComPtr<IMMDevice> device;
  check(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device), "GetDefaultAudioEndpoint");
  const auto activate = [&]() {
    ComPtr<IAudioClient3> client;
    check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr, &client), "Activate IAudioClient3");
    AudioClientProperties properties{};
    properties.cbSize = sizeof(properties); properties.eCategory = AudioCategory_Media; properties.Options = AUDCLNT_STREAMOPTIONS_RAW;
    if (FAILED(client->SetClientProperties(&properties))) { properties.Options = AUDCLNT_STREAMOPTIONS_NONE; check(client->SetClientProperties(&properties), "SetClientProperties"); }
    return client;
  };
  endpoint.client = activate();
  check(endpoint.client->GetMixFormat(&endpoint.format), "GetMixFormat");
  const std::string endpoint_name = flow == eCapture ? "Capture" : "Render";
  HRESULT initialize = E_FAIL;
  if (prefer_exclusive) {
    auto pcm32 = pcm_candidate(endpoint.format, 32, 24);
    auto pcm24 = pcm_candidate(endpoint.format, 24, 24);
    auto pcm16 = pcm_candidate(endpoint.format, 16, 16);
    const std::array<const WAVEFORMATEX*, 4> candidates{
        endpoint.format, &pcm32.Format, &pcm24.Format, &pcm16.Format};
    for (const auto* candidate : candidates) {
      const HRESULT support = endpoint.client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, candidate, nullptr);
      if (support != S_OK) {
        std::ostringstream reason; reason << endpoint_name << " exclusive format rejected: " << format_description(candidate)
            << " (HRESULT 0x" << std::hex << static_cast<unsigned long>(support) << ')'; log_line(reason.str());
        continue;
      }
      REFERENCE_TIME default_period_hns{}, minimum_period_hns{};
      if (FAILED(endpoint.client->GetDevicePeriod(&default_period_hns, &minimum_period_hns))) continue;
      const auto desired_hns = static_cast<REFERENCE_TIME>(64.0 * 10'000'000.0 / candidate->nSamplesPerSec);
      const auto period_hns = std::max(minimum_period_hns, desired_hns);
      initialize = endpoint.client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
          period_hns, period_hns, candidate, nullptr);
      if (initialize == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
        UINT32 aligned_frames{};
        if (SUCCEEDED(endpoint.client->GetBufferSize(&aligned_frames)) && aligned_frames > 0) {
          endpoint.client = activate();
          const auto aligned_hns = static_cast<REFERENCE_TIME>(
              std::ceil(10'000'000.0 * aligned_frames / candidate->nSamplesPerSec));
          initialize = endpoint.client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
              aligned_hns, aligned_hns, candidate, nullptr);
        }
      }
      if (SUCCEEDED(initialize)) {
        endpoint.exclusive = true;
        if (candidate != endpoint.format) {
          const std::size_t bytes = sizeof(WAVEFORMATEX) + candidate->cbSize;
          auto* replacement = static_cast<WAVEFORMATEX*>(CoTaskMemAlloc(bytes));
          if (!replacement) throw std::bad_alloc();
          std::memcpy(replacement, candidate, bytes); CoTaskMemFree(endpoint.format); endpoint.format = replacement;
        }
        log_line(endpoint_name + " exclusive format accepted: " + format_description(endpoint.format));
        break;
      }
      std::ostringstream reason; reason << endpoint_name << " exclusive initialization failed for " << format_description(candidate)
          << " (HRESULT 0x" << std::hex << static_cast<unsigned long>(initialize) << ')'; log_line(reason.str());
      endpoint.client = activate();
    }
  }
  if (!endpoint.exclusive) {
    // A failed exclusive Initialize can leave a driver-specific client in an
    // indeterminate state. Reactivate before the guaranteed shared fallback.
    endpoint.client = activate();
    UINT32 default_period{}, fundamental{}, minimum{}, maximum{};
    check(endpoint.client->GetSharedModeEnginePeriod(endpoint.format, &default_period, &fundamental, &minimum, &maximum), "GetSharedModeEnginePeriod");
    endpoint.period_frames = minimum;
    initialize = endpoint.client->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
    if (FAILED(initialize) && default_period != minimum) {
      endpoint.period_frames = default_period;
      initialize = endpoint.client->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, endpoint.period_frames, endpoint.format, nullptr);
    }
    check(initialize, "InitializeSharedAudioStream");
  }
  if (sample_encoding(endpoint.format) == SampleEncoding::Unsupported)
    throw std::runtime_error(endpoint_name + " format is unsupported by the native converter: " + format_description(endpoint.format));
  endpoint.event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!endpoint.event) throw std::runtime_error("CreateEvent failed");
  check(endpoint.client->SetEventHandle(endpoint.event), "SetEventHandle");
  check(endpoint.client->GetBufferSize(&endpoint.buffer_frames), "GetBufferSize");
  if (endpoint.exclusive) endpoint.period_frames = endpoint.buffer_frames;
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
    std::array<char, 32> audio_mode{};
    GetEnvironmentVariableA("CALCOTONE_AUDIO_MODE", audio_mode.data(), static_cast<DWORD>(audio_mode.size()));
    const bool prefer_exclusive = std::string_view(audio_mode.data()) == "exclusive";
    log_line("Opening default Windows capture endpoint...");
    Endpoint capture = open_endpoint(enumerator.Get(), eCapture, prefer_exclusive);
    log_line("Capture endpoint ready: " + std::to_string(capture.format->nSamplesPerSec) + " Hz, " +
             std::to_string(capture.format->nChannels) + " channels, " + std::to_string(capture.period_frames) +
             " frame period, " + (capture.exclusive ? "exclusive" : "shared") + " mode");
    log_line("Opening default Windows render endpoint...");
    Endpoint render = open_endpoint(enumerator.Get(), eRender, prefer_exclusive);
    log_line("Render endpoint ready: " + std::to_string(render.format->nSamplesPerSec) + " Hz, " +
             std::to_string(render.format->nChannels) + " channels, " + std::to_string(render.period_frames) +
             " frame period, " + (render.exclusive ? "exclusive" : "shared") + " mode");
    if (capture.format->nSamplesPerSec != render.format->nSamplesPerSec) throw std::runtime_error("Input/output sample rates differ; select matching Windows device formats first.");
    ComPtr<IAudioCaptureClient> capture_service;
    ComPtr<IAudioRenderClient> render_service;
    check(capture.client->GetService(IID_PPV_ARGS(&capture_service)), "Get capture service");
    check(render.client->GetService(IID_PPV_ARGS(&render_service)), "Get render service");
    const auto capture_encoding = sample_encoding(capture.format);
    const auto render_encoding = sample_encoding(render.format);

    const float sample_rate = static_cast<float>(render.format->nSamplesPerSec);
    calcotone::PitchTracker tuner(sample_rate);
    calcotone::StackAmp stack_one(sample_rate);
    calcotone::StackAmp stack_two(sample_rate);
    calcotone::NativeRack rack_one(sample_rate);
    calcotone::NativeRack rack_two(sample_rate);
    calcotone::NativePressure pressure_one(sample_rate);
    calcotone::NativePressure pressure_two(sample_rate);
    calcotone::NativeDreamBuffer dream_one(sample_rate);
    calcotone::NativeDreamBuffer dream_two(sample_rate);
    NativeRecorder recorder(sample_rate);
    // These blocks exceed Windows' default 1 MB stack when combined. Allocate
    // once during startup; the realtime threads never allocate or resize them.
    auto ring = std::make_unique<StereoRing>();
    auto process = std::make_unique<ProcessBuffers>();
    std::atomic<bool> running{true};
    std::atomic<std::uint64_t> underruns{};
    std::atomic<std::uint64_t> clock_corrections{};
    std::atomic<std::uint64_t> render_deadline_misses{};
    std::atomic<std::uint64_t> max_render_micros{};
    const auto fifo_target_frames = static_cast<std::uint64_t>(
        2U * std::max(capture.period_frames, render.buffer_frames));
    const auto fifo_guard_frames = static_cast<std::uint64_t>(
        std::max(capture.period_frames, render.buffer_frames));
    std::atomic<bool> audible{true};
    std::atomic<bool> stack_bypassed{false};
    std::atomic<unsigned> stack_input{1};
    std::atomic<bool> stomp_bypassed{true};
    std::atomic<unsigned> stomp_input{1};
    std::atomic<float> input_gain{1.F};
    std::atomic<float> output_gain{0.72F};
    constexpr unsigned kStackOrderToken = static_cast<unsigned>(calcotone::RackModule::Count);
    constexpr unsigned kNativeOrderSlots = kStackOrderToken + 1U;
    std::array<std::atomic<unsigned>, kNativeOrderSlots> native_order{};
    for (unsigned slot = 0; slot < kNativeOrderSlots; ++slot) native_order[slot].store(slot);
    const auto apply_stomp_route = [&] {
      const bool bypassed = stomp_bypassed.load(std::memory_order_relaxed);
      const auto source = static_cast<calcotone::StackInputSource>(stomp_input.load(std::memory_order_relaxed));
      rack_one.set_bypassed(calcotone::RackModule::Stomp, bypassed || !calcotone::stack_receives_lane(source, 0));
      rack_two.set_bypassed(calcotone::RackModule::Stomp, bypassed || !calcotone::stack_receives_lane(source, 1));
    };
    const auto apply_command = [&](std::string_view line) -> std::string {
      if (line == "health" || line == "stats") {
        std::ostringstream status;
        status << "{\"engine\":\"calcotone-native\",\"protocol\":1,\"sampleRate\":" << sample_rate
               << ",\"audioMode\":\"" << (capture.exclusive && render.exclusive ? "exclusive" : capture.exclusive || render.exclusive ? "mixed" : "shared") << '"'
               << ",\"inputPeriodFrames\":" << capture.period_frames
               << ",\"outputBufferFrames\":" << render.buffer_frames
               << ",\"inputChannels\":" << capture.format->nChannels
               << ",\"outputChannels\":" << render.format->nChannels
               << ",\"estimatedPathMs\":" << (capture.period_frames + render.buffer_frames + fifo_target_frames) / sample_rate * 1000.
               << ",\"underruns\":" << underruns.load() << ",\"overruns\":" << ring->overruns.load()
               << ",\"ringFrames\":" << ring->available()
               << ",\"fifoTargetFrames\":" << fifo_target_frames
               << ",\"ringHighWaterFrames\":" << ring->high_water.load()
               << ",\"clockCorrections\":" << clock_corrections.load()
               << ",\"renderDeadlineMisses\":" << render_deadline_misses.load()
               << ",\"maxRenderMicros\":" << max_render_micros.load()
               << ",\"recording\":" << (recorder.active() ? "true" : "false")
               << ",\"recordingFrames\":" << recorder.frames()
               << ",\"recordingPeak\":" << recorder.peak()
               << ",\"tunerHz\":" << tuner.frequency()
               << ",\"tunerLevel\":" << tuner.level() << '}';
        return status.str();
      }
      std::istringstream command{std::string(line)}; std::string name; command >> name;
      if (name == "recordStart") return recorder.start() ? R"({"ok":true,"command":"recordStart"})" : R"({"error":"recording already active"})";
      if (name == "recordStop") {
        const bool saved = recorder.stop(executable_directory() / "web" / "calcotone-recording.wav");
        return saved ? R"({"ok":true,"command":"recordStop"})" : R"({"error":"native recording was empty or could not be saved"})";
      }
      if (name == "recordCancel") { recorder.cancel(); return R"({"ok":true,"command":"recordCancel"})"; }
      if (name == "param") {
        std::string module_name, parameter; float value = 0.F;
        command >> module_name >> parameter >> value;
        if (module_name == "pressure") {
          if (!command || !std::isfinite(value) || !pressure_one.set_parameter(parameter, value) || !pressure_two.set_parameter(parameter, value))
            return R"({"error":"unknown native pressure parameter"})";
          return R"({"ok":true,"command":"param"})";
        }
        const auto module = calcotone::rack_module_from_name(module_name);
        if (!command || module == calcotone::RackModule::Count || !std::isfinite(value)) return R"({"error":"expected param module parameter value"})";
        if (!rack_one.set_parameter(module, parameter, value) || !rack_two.set_parameter(module, parameter, value)) return R"({"error":"unknown native parameter"})";
        return R"({"ok":true,"command":"param"})";
      }
      if (name == "moduleBypass") {
        std::string module_name; float value = 0.F; command >> module_name >> value;
        if (module_name == "pressure") {
          if (!command || !std::isfinite(value)) return R"({"error":"expected moduleBypass pressure 0/1"})";
          pressure_one.set_bypassed(value >= .5F); pressure_two.set_bypassed(value >= .5F);
          return R"({"ok":true,"command":"moduleBypass"})";
        }
        const auto module = calcotone::rack_module_from_name(module_name);
        if (!command || module == calcotone::RackModule::Count || !std::isfinite(value)) return R"({"error":"expected moduleBypass module 0/1"})";
        if (module == calcotone::RackModule::Stomp) {
          stomp_bypassed.store(value >= .5F); apply_stomp_route();
        } else {
          rack_one.set_bypassed(module, value >= .5F); rack_two.set_bypassed(module, value >= .5F);
        }
        return R"({"ok":true,"command":"moduleBypass"})";
      }
      if (name == "order") {
        std::array<unsigned, kNativeOrderSlots> modules{};
        std::array<bool, kNativeOrderSlots> used{};
        std::size_t count = 0; std::string module_name;
        while (command >> module_name) {
          const auto rack_module = calcotone::rack_module_from_name(module_name);
          const unsigned module = module_name == "chaos" ? kStackOrderToken : static_cast<unsigned>(rack_module);
          if (module < kNativeOrderSlots && !used[module]) { used[module] = true; modules[count++] = module; }
        }
        if (count == 0) return R"({"error":"order needs native module names"})";
        for (unsigned module = 0; module < kNativeOrderSlots; ++module)
          if (!used[module]) modules[count++] = module;
        for (unsigned slot = 0; slot < kNativeOrderSlots; ++slot)
          native_order[slot].store(modules[slot], std::memory_order_relaxed);
        return R"({"ok":true,"command":"order"})";
      }
      float value = 0.F; command >> value;
      if (!command || !std::isfinite(value)) return R"({"error":"expected name and numeric value"})";
      if (name == "active") audible.store(value >= 0.5F); else if (name == "bypass") stack_bypassed.store(value >= 0.5F);
      else if (name == "stackInput") stack_input.store(std::min(2U, static_cast<unsigned>(std::max(0.F, value))));
      else if (name == "stompInput") { stomp_input.store(std::min(2U, static_cast<unsigned>(std::max(0.F, value)))); apply_stomp_route(); }
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
          for (UINT32 frame = 0; frame < frames; ++frame) {
            const float left = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels, capture_encoding);
            const float right = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + std::min<WORD>(1, capture.format->nChannels - 1), capture_encoding);
            tuner.push(right);
            ring->push(left, right);
          }
          capture_service->ReleaseBuffer(frames);
          capture_service->GetNextPacketSize(&packet);
        }
      }
    });

    std::thread render_thread([&] {
      set_realtime_thread();
      float last_left = 0.F, last_right = 0.F;
      unsigned correction_countdown = 0;
      const auto render_deadline_micros = static_cast<std::uint64_t>(
          render.period_frames / sample_rate * 1'000'000.);
      while (running.load(std::memory_order_relaxed)) {
        if (WaitForSingleObject(render.event, 1000) != WAIT_OBJECT_0) continue;
        const auto render_started = std::chrono::steady_clock::now();
        UINT32 padding = 0;
        if (FAILED(render.client->GetCurrentPadding(&padding))) continue;
        UINT32 remaining = render.buffer_frames - padding;
        while (remaining) {
          const UINT32 block = std::min<UINT32>(remaining, kProcessFrames);
          BYTE* bytes = nullptr;
          if (FAILED(render_service->GetBuffer(block, &bytes))) break;
          for (UINT32 frame = 0; frame < block; ++frame) {
            float left = 0.F, right = 0.F;
            if (ring->pop(left, right)) {
              const auto excess = ring->available() > fifo_target_frames
                  ? ring->available() - fifo_target_frames : 0;
              if (excess > fifo_guard_frames) {
                const unsigned correction_interval = excess > fifo_guard_frames * 8 ? 16U
                    : excess > fifo_guard_frames * 4 ? 32U : 64U;
                if (++correction_countdown >= correction_interval) {
                  float next_left = 0.F, next_right = 0.F;
                  if (ring->pop(next_left, next_right)) {
                    // Merge adjacent input frames while consuming the tiny clock
                    // surplus. This avoids a hard discontinuity during correction.
                    left = (left + next_left) * .5F;
                    right = (right + next_right) * .5F;
                    clock_corrections.fetch_add(1, std::memory_order_relaxed);
                  }
                  correction_countdown = 0;
                }
              } else {
                correction_countdown = 0;
              }
              last_left = left;
              last_right = right;
            } else {
              underruns.fetch_add(1, std::memory_order_relaxed);
              // Preserve waveform continuity when capture wakes late. A short
              // decay is much less audible than injecting a hard digital zero.
              last_left *= .995F;
              last_right *= .995F;
              left = last_left;
              right = last_right;
            }
            process->capture_input[frame * 2] = left; process->capture_input[frame * 2 + 1] = right;
          }
          calcotone::split_dual_mono(
              process->capture_input.data(), process->lane_one_input.data(), process->lane_two_input.data(), block,
              input_gain.load(std::memory_order_relaxed));
          std::copy_n(process->lane_one_input.data(), block * 2, process->lane_one_output.data());
          std::copy_n(process->lane_two_input.data(), block * 2, process->lane_two_output.data());
          const bool bypassed = stack_bypassed.load(std::memory_order_relaxed);
          const auto source = static_cast<calcotone::StackInputSource>(stack_input.load(std::memory_order_relaxed));
          for (unsigned slot = 0; slot < kNativeOrderSlots; ++slot) {
            const unsigned module = native_order[slot].load(std::memory_order_relaxed);
            if (module == kStackOrderToken) {
              if (!bypassed && calcotone::stack_receives_lane(source, 0)) stack_one.process(process->lane_one_output.data(), process->lane_one_output.data(), block);
              if (!bypassed && calcotone::stack_receives_lane(source, 1)) stack_two.process(process->lane_two_output.data(), process->lane_two_output.data(), block);
            } else if (module < kStackOrderToken) {
              rack_one.process_module(static_cast<calcotone::RackModule>(module), process->lane_one_output.data(), block);
              rack_two.process_module(static_cast<calcotone::RackModule>(module), process->lane_two_output.data(), block);
            }
          }
          pressure_one.process(process->lane_one_output.data(), block);
          pressure_two.process(process->lane_two_output.data(), block);
          dream_one.process(process->lane_one_output.data(), block);
          dream_two.process(process->lane_two_output.data(), block);
          const float gain = audible.load(std::memory_order_relaxed) ? output_gain.load(std::memory_order_relaxed) : 0.F;
          calcotone::mix_dual_mono(process->lane_one_output.data(), process->lane_two_output.data(), process->mixed_output.data(), block, gain);
          recorder.capture(process->mixed_output.data(), block);
          for (UINT32 frame = 0; frame < block; ++frame) for (WORD channel = 0; channel < render.format->nChannels; ++channel)
            encode_sample(bytes, frame * render.format->nChannels + channel, render_encoding,
                process->mixed_output[frame * 2 + std::min<WORD>(channel, 1)]);
          render_service->ReleaseBuffer(block, 0);
          remaining -= block;
        }
        const auto render_micros = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now() - render_started).count());
        auto previous_max = max_render_micros.load(std::memory_order_relaxed);
        while (render_micros > previous_max && !max_render_micros.compare_exchange_weak(
            previous_max, render_micros, std::memory_order_relaxed, std::memory_order_relaxed)) {}
        if (render_micros >= render_deadline_micros)
          render_deadline_misses.fetch_add(1, std::memory_order_relaxed);
      }
    });

    check(capture.client->Start(), "Start capture");
    const auto prime_deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(250);
    while (ring->available() < fifo_target_frames && std::chrono::steady_clock::now() < prime_deadline) Sleep(1);
    float discarded_left = 0.F, discarded_right = 0.F;
    while (ring->available() > fifo_target_frames && ring->pop(discarded_left, discarded_right)) {}
    const auto primed_frames = ring->available();
    std::ostringstream primed;
    primed << "Primed native FIFO: " << primed_frames << " frames ("
           << primed_frames / sample_rate * 1000. << " ms safety; target " << fifo_target_frames << "f)";
    log_line(primed.str());
    check(render.client->Start(), "Start render");
    const std::wstring faceplate_url = L"http://127.0.0.1:" + std::to_wstring(control_server.port()) + L"/";
    log_line("Opening local native faceplate: http://127.0.0.1:" + std::to_string(control_server.port()) + "/");
    ShellExecuteW(nullptr, L"open", faceplate_url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    const double input_ms = capture.period_frames / sample_rate * 1000.;
    const double output_ms = render.buffer_frames / sample_rate * 1000.;
    std::ostringstream startup;
    startup << "CALCOTONE native audio active | " << sample_rate << " Hz | input period " << capture.period_frames
            << "f | output buffer " << render.buffer_frames << "f | FIFO safety " << primed_frames
            << "f | estimated native path " << input_ms + output_ms + primed_frames / sample_rate * 1000. << " ms";
    log_line(startup.str());
    log_line("Control bridge: http://127.0.0.1:" + std::to_string(control_server.port()) + " | GET /health | POST /command");
    log_line("Commands: param/moduleBypass/order, active/bypass, stackInput, inputGain/outputGain, STACK controls, stats, quit");
    std::string line;
    while (std::getline(std::cin, line)) {
      std::istringstream command(line); std::string name; float value = 0.F; command >> name;
      if (name == "quit") break;
      std::cout << apply_command(line) << '\n';
    }
    control_server.stop();
    recorder.cancel();
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
