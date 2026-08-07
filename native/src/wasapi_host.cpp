#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <audioclient.h>
#include <avrt.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>
#include <wrl/client.h>

#include "calcotone/adaptive_fifo_safety.hpp"
#include "calcotone/audio_client_property_plan.hpp"
#include "calcotone/audio_restart_policy.hpp"
#include "calcotone/audio_device_config.hpp"
#include "calcotone/control_server.hpp"
#include "calcotone/desktop_shell.hpp"
#include "calcotone/elastic_stereo_fifo.hpp"
#include "calcotone/ks_wavert_probe.hpp"
#include "calcotone/native_processor.hpp"
#include "calcotone/stream_recovery.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

using Microsoft::WRL::ComPtr;
namespace {
constexpr std::size_t kProcessFrames = 2048;
constexpr DWORD kAudioRestartExitCode = 75U;
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

void publish_peak(std::atomic<float>& destination, float value) noexcept {
  value = std::abs(value);
  auto previous = destination.load(std::memory_order_relaxed);
  while (value > previous && !destination.compare_exchange_weak(
      previous, value, std::memory_order_relaxed, std::memory_order_relaxed)) {}
}

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
};

struct Endpoint {
  ComPtr<IAudioClient3> client;
  WAVEFORMATEX* format{};
  HANDLE event{};
  UINT32 period_frames{};
  UINT32 buffer_frames{};
  bool exclusive{};
  bool raw{};
  std::string name;
  std::string id;
  Endpoint() = default;
  Endpoint(const Endpoint&) = delete;
  Endpoint& operator=(const Endpoint&) = delete;
  Endpoint(Endpoint&& other) noexcept
      : client(std::move(other.client)), format(std::exchange(other.format, nullptr)),
        event(std::exchange(other.event, nullptr)), period_frames(other.period_frames), buffer_frames(other.buffer_frames),
        exclusive(other.exclusive), raw(other.raw),
        name(std::move(other.name)), id(std::move(other.id)) {}
  Endpoint& operator=(Endpoint&&) = delete;
  ~Endpoint() { if (event) CloseHandle(event); if (format) CoTaskMemFree(format); }
};

class HResultError final : public std::runtime_error {
 public:
  HResultError(HRESULT result, std::string message)
      : std::runtime_error(std::move(message)), result_(result) {}
  [[nodiscard]] HRESULT result() const noexcept { return result_; }
 private:
  HRESULT result_;
};

void check(HRESULT result, const char* operation);

std::string utf8_from_wide(std::wstring_view text) {
  if (text.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string result(static_cast<std::size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring wide_from_utf8(std::string_view text) {
  if (text.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(static_cast<std::size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
  return result;
}

std::wstring lowercase(std::wstring value) {
  std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) {
    return static_cast<wchar_t>(std::towlower(character));
  });
  return value;
}

std::string json_escape(std::string_view value) {
  std::string result;
  result.reserve(value.size() + 8);
  for (const char character : value) {
    if (character == '"' || character == '\\') result.push_back('\\');
    if (character == '\n') { result += "\\n"; continue; }
    if (character == '\r') continue;
    result.push_back(character);
  }
  return result;
}

void describe_device(IMMDevice* device, std::string& id, std::string& name) {
  LPWSTR device_id = nullptr;
  check(device->GetId(&device_id), "Get device id");
  id = utf8_from_wide(device_id ? std::wstring_view(device_id) : std::wstring_view{});
  if (device_id) CoTaskMemFree(device_id);
  ComPtr<IPropertyStore> properties;
  if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &properties))) {
    PROPVARIANT friendly;
    PropVariantInit(&friendly);
    if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &friendly)) && friendly.vt == VT_LPWSTR && friendly.pwszVal)
      name = utf8_from_wide(friendly.pwszVal);
    PropVariantClear(&friendly);
  }
  if (name.empty()) name = id;
}

ComPtr<IMMDevice> select_device(IMMDeviceEnumerator* enumerator, EDataFlow flow, std::string_view selector) {
  ComPtr<IMMDevice> selected;
  if (selector.empty() || selector == "default") {
    check(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &selected), "GetDefaultAudioEndpoint");
    return selected;
  }
  ComPtr<IMMDeviceCollection> devices;
  check(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices), "EnumAudioEndpoints");
  UINT count = 0;
  check(devices->GetCount(&count), "Get audio endpoint count");
  const auto wanted = lowercase(wide_from_utf8(selector));
  std::string choices;
  for (UINT index = 0; index < count; ++index) {
    ComPtr<IMMDevice> candidate;
    if (FAILED(devices->Item(index, &candidate))) continue;
    std::string id, name;
    describe_device(candidate.Get(), id, name);
    if (!choices.empty()) choices += ", ";
    choices += name;
    if (lowercase(wide_from_utf8(id)) == wanted || lowercase(wide_from_utf8(name)).find(wanted) != std::wstring::npos) {
      selected = candidate;
      break;
    }
  }
  if (!selected) throw std::runtime_error("Audio device selector '" + std::string(selector) + "' did not match an active endpoint. Available: " + choices);
  return selected;
}

void log_device_list(IMMDeviceEnumerator* enumerator, EDataFlow flow, std::string_view heading) {
  log_line(std::string(heading));
  ComPtr<IMMDeviceCollection> devices;
  check(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices), "EnumAudioEndpoints");
  UINT count = 0;
  check(devices->GetCount(&count), "Get audio endpoint count");
  for (UINT index = 0; index < count; ++index) {
    ComPtr<IMMDevice> device;
    if (FAILED(devices->Item(index, &device))) continue;
    std::string id, name;
    describe_device(device.Get(), id, name);
    log_line("  [" + std::to_string(index + 1U) + "] " + name + " | " + id);
  }
  if (count == 0) log_line("  (none)");
}

void check(HRESULT result, const char* operation) {
  if (FAILED(result)) {
    std::ostringstream message;
    message << operation << " failed (HRESULT 0x" << std::hex << static_cast<unsigned long>(result) << ')';
    throw HResultError(result, message.str());
  }
}

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

enum class SampleEncoding { Float32, Pcm16, Pcm24, Pcm24In32, Pcm32, Unsupported };

SampleEncoding sample_encoding(const WAVEFORMATEX* format) noexcept {
  const bool extensible = format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && format->cbSize >= 22;
  const GUID subtype = extensible ? reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat
                                  : format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
                                  : format->wFormatTag == WAVE_FORMAT_PCM ? KSDATAFORMAT_SUBTYPE_PCM : GUID{};
  if (subtype == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && format->wBitsPerSample == 32) return SampleEncoding::Float32;
  if (subtype != KSDATAFORMAT_SUBTYPE_PCM) return SampleEncoding::Unsupported;
  if (format->wBitsPerSample == 16) return SampleEncoding::Pcm16;
  if (format->wBitsPerSample == 24) return SampleEncoding::Pcm24;
  if (format->wBitsPerSample == 32) {
    const WORD valid_bits = extensible
        ? reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->Samples.wValidBitsPerSample
        : 32;
    return valid_bits > 0 && valid_bits <= 24 ? SampleEncoding::Pcm24In32 : SampleEncoding::Pcm32;
  }
  return SampleEncoding::Unsupported;
}

std::string format_description(const WAVEFORMATEX* format) {
  const char* encoding = sample_encoding(format) == SampleEncoding::Float32 ? "float"
      : sample_encoding(format) == SampleEncoding::Pcm16 ? "PCM16"
      : sample_encoding(format) == SampleEncoding::Pcm24 ? "PCM24"
      : sample_encoding(format) == SampleEncoding::Pcm24In32 ? "PCM24-in-32"
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
  if (encoding == SampleEncoding::Pcm24In32 || encoding == SampleEncoding::Pcm32) { std::int32_t value{}; std::memcpy(&value, bytes + sample * 4, 4); return static_cast<float>(value) / 2'147'483'648.F; }
  return 0.F;
}

void encode_sample(BYTE* bytes, std::size_t sample, SampleEncoding encoding, float input) noexcept {
  const float value = std::clamp(input, -1.F, .999999F);
  if (encoding == SampleEncoding::Float32) { std::memcpy(bytes + sample * 4, &value, 4); return; }
  if (encoding == SampleEncoding::Pcm16) { const auto pcm=static_cast<std::int16_t>(std::lrint(value*32767.F)); std::memcpy(bytes+sample*2,&pcm,2); return; }
  if (encoding == SampleEncoding::Pcm24) { const auto pcm=static_cast<std::int32_t>(std::lrint(value*8'388'607.F)); BYTE* p=bytes+sample*3; p[0]=pcm&255; p[1]=(pcm>>8)&255; p[2]=(pcm>>16)&255; return; }
  if (encoding == SampleEncoding::Pcm24In32) { const auto pcm=static_cast<std::int32_t>(static_cast<std::int64_t>(std::lrint(value*8'388'607.F))*256); std::memcpy(bytes+sample*4,&pcm,4); return; }
  if (encoding == SampleEncoding::Pcm32) { const auto pcm=static_cast<std::int32_t>(std::llrint(static_cast<double>(value)*2'147'483'647.)); std::memcpy(bytes+sample*4,&pcm,4); }
}

WAVEFORMATEXTENSIBLE pcm_candidate(const WAVEFORMATEX* basis, WORD container_bits, WORD valid_bits,
                                   std::uint32_t requested_rate = 0) noexcept {
  WAVEFORMATEXTENSIBLE format{};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE; format.Format.nChannels = basis->nChannels;
  format.Format.nSamplesPerSec = requested_rate ? requested_rate : basis->nSamplesPerSec;
  format.Format.wBitsPerSample = container_bits;
  format.Format.nBlockAlign = static_cast<WORD>(basis->nChannels * container_bits / 8);
  format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
  format.Format.cbSize = 22; format.Samples.wValidBitsPerSample = valid_bits;
  format.dwChannelMask = basis->nChannels == 1 ? SPEAKER_FRONT_CENTER : basis->nChannels == 2 ? SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT : 0;
  if (basis->wFormatTag == WAVE_FORMAT_EXTENSIBLE && basis->cbSize >= 22)
    format.dwChannelMask = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(basis)->dwChannelMask;
  format.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
  return format;
}

Endpoint open_endpoint(IMMDeviceEnumerator* enumerator, EDataFlow flow, bool prefer_exclusive,
                       std::string_view selector, std::uint32_t requested_frames,
                       std::uint32_t requested_rate, bool allow_shared_raw) {
  Endpoint endpoint;
  ComPtr<IMMDevice> device = select_device(enumerator, flow, selector);
  describe_device(device.Get(), endpoint.id, endpoint.name);
  const auto activate = [&](bool exclusive, bool allow_raw) {
    ComPtr<IAudioClient3> client;
    check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr, &client), "Activate IAudioClient3");
    endpoint.raw = false;
    HRESULT last_result = E_FAIL;
    const auto plan = calcotone::audio_client_property_plan(exclusive, allow_raw);
    for (std::size_t attempt_index = 0; attempt_index < plan.count; ++attempt_index) {
      const auto attempt = plan.attempts[attempt_index];
      AudioClientProperties properties{};
      properties.cbSize = sizeof(properties);
      properties.bIsOffload = FALSE;
      properties.eCategory = flow == eRender ? AudioCategory_Media : AudioCategory_Other;
      properties.Options = attempt == calcotone::AudioClientPropertyAttempt::Raw
          ? AUDCLNT_STREAMOPTIONS_RAW : AUDCLNT_STREAMOPTIONS_NONE;
      last_result = client->SetClientProperties(&properties);
      if (SUCCEEDED(last_result)) {
        endpoint.raw = properties.Options == AUDCLNT_STREAMOPTIONS_RAW;
        return client;
      }
    }
    check(last_result, "SetClientProperties");
    return client;
  };
  endpoint.client = activate(prefer_exclusive, allow_shared_raw);
  check(endpoint.client->GetMixFormat(&endpoint.format), "GetMixFormat");
  const std::string endpoint_name = flow == eCapture ? "Capture" : "Render";
  HRESULT initialize = E_FAIL;
  if (prefer_exclusive) {
    auto pcm32 = pcm_candidate(endpoint.format, 32, 24, requested_rate);
    auto pcm24 = pcm_candidate(endpoint.format, 24, 24, requested_rate);
    auto pcm16 = pcm_candidate(endpoint.format, 16, 16, requested_rate);
    const std::array<const WAVEFORMATEX*, 4> candidates{
        requested_rate ? &pcm32.Format : endpoint.format,
        requested_rate ? &pcm24.Format : &pcm32.Format,
        requested_rate ? &pcm16.Format : &pcm24.Format,
        requested_rate ? endpoint.format : &pcm16.Format};
    for (const auto* candidate : candidates) {
      const HRESULT support = endpoint.client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, candidate, nullptr);
      if (support != S_OK) {
        std::ostringstream reason; reason << endpoint_name << " exclusive format rejected: " << format_description(candidate)
            << " (HRESULT 0x" << std::hex << static_cast<unsigned long>(support) << ')'; log_line(reason.str());
        continue;
      }
      REFERENCE_TIME default_period_hns{}, minimum_period_hns{};
      if (FAILED(endpoint.client->GetDevicePeriod(&default_period_hns, &minimum_period_hns))) continue;
      const auto desired_hns = static_cast<REFERENCE_TIME>(requested_frames * 10'000'000.0 / candidate->nSamplesPerSec);
      const auto period_hns = std::max(minimum_period_hns, desired_hns);
      initialize = endpoint.client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
          period_hns, period_hns, candidate, nullptr);
      if (initialize == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
        UINT32 aligned_frames{};
        if (SUCCEEDED(endpoint.client->GetBufferSize(&aligned_frames)) && aligned_frames > 0) {
          endpoint.client = activate(true, false);
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
      endpoint.client = activate(true, false);
    }
  }
  if (!endpoint.exclusive) {
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
      reason << endpoint_name << " RAW shared initialization failed (HRESULT 0x"
             << std::hex << static_cast<unsigned long>(initialize)
             << "); retrying shared stream without RAW.";
      log_line(reason.str());
      initialize = initialize_shared(false);
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


class RealtimeThreadScope final {
 public:
  RealtimeThreadScope() noexcept {
    task_ = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task_index_);
    if (task_) {
      mmcss_ = true;
      AvSetMmThreadPriority(task_, AVRT_PRIORITY_CRITICAL);
    } else {
      SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
    }
  }
  ~RealtimeThreadScope() {
    if (task_) AvRevertMmThreadCharacteristics(task_);
  }
  RealtimeThreadScope(const RealtimeThreadScope&) = delete;
  RealtimeThreadScope& operator=(const RealtimeThreadScope&) = delete;
  [[nodiscard]] bool mmcss() const noexcept { return mmcss_; }
 private:
  HANDLE task_{};
  DWORD task_index_{};
  bool mmcss_{};
};
}  // namespace

int main(int argc, char** argv) {
  try {
    std::cout << std::unitbuf;
    std::cerr << std::unitbuf;
    native_log.open(executable_directory() / "calcotone-native.log", std::ios::out | std::ios::trunc);
    log_line("CALCOTONE native host starting...");
    log_line("Initializing Windows COM audio services...");
    check(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "CoInitializeEx");
    ComPtr<IMMDeviceEnumerator> enumerator;
    check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)), "Create device enumerator");
    const bool list_devices = std::any_of(argv + 1, argv + argc, [](const char* argument) {
      return std::string_view(argument) == "--list-devices";
    });
    if (list_devices) {
      log_device_list(enumerator.Get(), eCapture, "Active capture devices:");
      log_device_list(enumerator.Get(), eRender, "Active render devices:");
      CoUninitialize();
      return 0;
    }
    const auto audio_config = calcotone::audio_device_config_from_environment();
    const auto ks_probe = audio_config.backend == calcotone::AudioBackend::Wasapi
        ? calcotone::KsWaveRtProbe{} : calcotone::probe_ks_wavert_devices();
    log_line("Audio request: backend " + std::string(calcotone::audio_backend_name(audio_config.backend)) +
             " | " + std::to_string(audio_config.buffer_frames) + " frames | " +
             (audio_config.sample_rate ? std::to_string(audio_config.sample_rate) + " Hz" : "device sample rate"));
    if (audio_config.backend != calcotone::AudioBackend::Wasapi)
      log_line("KS/WaveRT probe: " + ks_probe.summary + " Filters " +
               std::to_string(ks_probe.filter_count) + ", pins " + std::to_string(ks_probe.pin_count) + '.');
    if (audio_config.backend == calcotone::AudioBackend::KsWaveRt)
      log_line("KS/WaveRT streaming is experimental and not armed in this build; continuing with safe WASAPI fallback.");
    log_line("Opening Windows capture endpoint...");
    Endpoint capture = open_endpoint(enumerator.Get(), eCapture, audio_config.prefer_exclusive,
        audio_config.capture_device, audio_config.buffer_frames, audio_config.sample_rate,
        audio_config.allow_shared_raw);
    log_line("Capture endpoint ready: " + capture.name + " | " + std::to_string(capture.format->nSamplesPerSec) + " Hz, " +
             std::to_string(capture.format->nChannels) + " channels, " + std::to_string(capture.period_frames) +
             " frame period, " + (capture.exclusive ? "exclusive" : "shared") + " mode, " +
             "category Other" + (capture.raw ? " RAW" : ""));
    log_line("Opening Windows render endpoint...");
    Endpoint render = open_endpoint(enumerator.Get(), eRender, audio_config.prefer_exclusive,
        audio_config.render_device, audio_config.buffer_frames, audio_config.sample_rate,
        audio_config.allow_shared_raw);
    log_line("Render endpoint ready: " + render.name + " | " + std::to_string(render.format->nSamplesPerSec) + " Hz, " +
             std::to_string(render.format->nChannels) + " channels, " + std::to_string(render.period_frames) +
             " frame period, " + (render.exclusive ? "exclusive" : "shared") + " mode, " +
             "category Media" + (render.raw ? " RAW" : ""));
    if (capture.format->nSamplesPerSec != render.format->nSamplesPerSec) throw std::runtime_error("Input/output sample rates differ; select matching Windows device formats first.");
    ComPtr<IAudioCaptureClient> capture_service;
    ComPtr<IAudioRenderClient> render_service;
    check(capture.client->GetService(IID_PPV_ARGS(&capture_service)), "Get capture service");
    check(render.client->GetService(IID_PPV_ARGS(&render_service)), "Get render service");
    const auto capture_encoding = sample_encoding(capture.format);
    const auto render_encoding = sample_encoding(render.format);
    const auto input_one_channel = std::min<unsigned>(audio_config.input_one_channel, capture.format->nChannels - 1U);
    const auto input_two_channel = std::min<unsigned>(audio_config.input_two_channel, capture.format->nChannels - 1U);
    const auto output_left_channel = std::min<unsigned>(audio_config.output_left_channel, render.format->nChannels - 1U);
    const auto output_right_channel = std::min<unsigned>(audio_config.output_right_channel, render.format->nChannels - 1U);
    log_line("Channel map: inputs " + std::to_string(input_one_channel + 1U) + "/" +
             std::to_string(input_two_channel + 1U) + " -> outputs " +
             std::to_string(output_left_channel + 1U) + "/" + std::to_string(output_right_channel + 1U));

    const float sample_rate = static_cast<float>(render.format->nSamplesPerSec);
    calcotone::NativeProcessor processor(sample_rate);
    NativeRecorder recorder(sample_rate);
    const auto fifo_period_frames = static_cast<std::uint64_t>(
        std::max(capture.period_frames, render.buffer_frames));
    const auto fifo_target_frames = 2U * fifo_period_frames;
    // These blocks exceed Windows' default 1 MB stack when combined. Allocate
    // once during startup; the realtime threads never allocate or resize them.
    auto ring = std::make_unique<calcotone::ElasticStereoFifo>(fifo_target_frames);
    calcotone::AdaptiveFifoSafety fifo_safety(
        fifo_target_frames, fifo_period_frames, sample_rate);
    auto process = std::make_unique<ProcessBuffers>();
    std::atomic<bool> running{true};
    std::atomic<std::uint64_t> underruns{};
    std::atomic<std::uint64_t> underrun_events{};
    std::atomic<std::uint64_t> stream_recovery_events{};
    std::atomic<std::uint64_t> render_deadline_misses{};
    std::atomic<std::uint64_t> max_render_micros{};
    std::atomic<std::uint64_t> capture_discontinuities{};
    std::atomic<std::uint64_t> capture_timestamp_errors{};
    std::atomic<std::uint64_t> capture_silent_packets{};
    std::atomic<std::uint64_t> capture_api_errors{};
    std::atomic<std::uint64_t> render_api_errors{};
    std::atomic<std::uint64_t> input_clips{};
    std::atomic<float> input_peak{};
    std::atomic<float> output_peak{};
    std::atomic<bool> capture_mmcss{};
    std::atomic<bool> render_mmcss{};
    std::atomic<std::uint64_t> adaptive_fifo_target{fifo_target_frames};
    std::atomic<std::uint64_t> adaptive_fifo_maximum{fifo_safety.maximum_target_frames()};
    std::atomic<std::uint64_t> adaptive_fifo_raises{};
    std::atomic<std::uint64_t> adaptive_fifo_relaxations{};
    std::atomic<std::uint64_t> adaptive_fifo_instability{};
    std::atomic<double> adaptive_fifo_stable_seconds{};
    const auto apply_command = [&](std::string_view line) -> std::string {
      if (line == "health" || line == "stats") {
        std::ostringstream status;
        status << "{\"engine\":\"calcotone-native\",\"protocol\":1,\"sampleRate\":" << sample_rate
               << ",\"transport\":\"wasapi\",\"requestedBackend\":\"" << calcotone::audio_backend_name(audio_config.backend) << '"'
               << ",\"ksAvailable\":" << (ks_probe.kernel_streaming_available ? "true" : "false")
               << ",\"ksFilterCount\":" << ks_probe.filter_count << ",\"ksPinCount\":" << ks_probe.pin_count
               << ",\"audioMode\":\"" << (capture.exclusive && render.exclusive ? "exclusive" : capture.exclusive || render.exclusive ? "mixed" : "shared") << '"'
               << ",\"sharedRawRequested\":" << (audio_config.allow_shared_raw ? "true" : "false")
               << ",\"captureRaw\":" << (capture.raw ? "true" : "false")
               << ",\"renderRaw\":" << (render.raw ? "true" : "false")
               << ",\"captureDevice\":\"" << json_escape(capture.name) << '"'
               << ",\"renderDevice\":\"" << json_escape(render.name) << '"'
               << ",\"requestedBufferFrames\":" << audio_config.buffer_frames
               << ",\"inputPeriodFrames\":" << capture.period_frames
               << ",\"outputBufferFrames\":" << render.buffer_frames
               << ",\"inputChannels\":" << capture.format->nChannels
               << ",\"outputChannels\":" << render.format->nChannels
               << ",\"estimatedPathMs\":" << (capture.period_frames + render.buffer_frames + adaptive_fifo_target.load()) / sample_rate * 1000.
               << ",\"underruns\":" << underruns.load()
               << ",\"underrunEvents\":" << underrun_events.load()
               << ",\"streamRecoveryEvents\":" << stream_recovery_events.load()
               << ",\"captureMmcss\":" << (capture_mmcss.load() ? "true" : "false")
               << ",\"renderMmcss\":" << (render_mmcss.load() ? "true" : "false")
               << ",\"overruns\":" << ring->overruns()
               << ",\"ringFrames\":" << ring->available()
               << ",\"fifoBaseTargetFrames\":" << fifo_target_frames
               << ",\"fifoTargetFrames\":" << adaptive_fifo_target.load()
               << ",\"fifoMaximumTargetFrames\":" << adaptive_fifo_maximum.load()
               << ",\"fifoSafetyRaises\":" << adaptive_fifo_raises.load()
               << ",\"fifoSafetyRelaxations\":" << adaptive_fifo_relaxations.load()
               << ",\"fifoInstabilityEvents\":" << adaptive_fifo_instability.load()
               << ",\"fifoStableSeconds\":" << adaptive_fifo_stable_seconds.load()
               << ",\"ringHighWaterFrames\":" << ring->high_water_frames()
               << ",\"clockCorrections\":" << ring->resampled_frames()
               << ",\"fifoReadRatio\":" << ring->read_ratio()
               << ",\"captureDiscontinuities\":" << capture_discontinuities.load()
               << ",\"captureTimestampErrors\":" << capture_timestamp_errors.load()
               << ",\"captureSilentPackets\":" << capture_silent_packets.load()
               << ",\"captureApiErrors\":" << capture_api_errors.load()
               << ",\"renderApiErrors\":" << render_api_errors.load()
               << ",\"inputClips\":" << input_clips.load()
               << ",\"outputClips\":" << processor.output_limited_samples()
               << ",\"inputPeak\":" << input_peak.load()
               << ",\"outputPeak\":" << output_peak.load()
               << ",\"preLimiterPeak\":" << processor.pre_limiter_peak()
               << ",\"renderDeadlineMisses\":" << render_deadline_misses.load()
               << ",\"maxRenderMicros\":" << max_render_micros.load()
               << ",\"recording\":" << (recorder.active() ? "true" : "false")
               << ",\"recordingFrames\":" << recorder.frames()
               << ",\"recordingPeak\":" << recorder.peak()
               << ",\"loopTransport\":" << static_cast<unsigned>(processor.loop_transport())
               << ",\"loopTrack\":" << processor.loop_selected_track()
               << ",\"loopTrackMask\":" << processor.loop_track_mask()
               << ",\"loopFrames\":" << processor.loop_frames()
               << ",\"loopPosition\":" << processor.loop_position()
               << ",\"tunerHz\":" << processor.tuner_frequency()
               << ",\"tunerLevel\":" << processor.tuner_level() << '}';
        return status.str();
      }
      std::istringstream command{std::string(line)}; std::string name; command >> name;
      if (name == "recordStart") return recorder.start() ? R"({"ok":true,"command":"recordStart"})" : R"({"error":"recording already active"})";
      if (name == "recordStop") {
        const bool saved = recorder.stop(executable_directory() / "web" / "calcotone-recording.wav");
        return saved ? R"({"ok":true,"command":"recordStop"})" : R"({"error":"native recording was empty or could not be saved"})";
      }
      if (name == "recordCancel") { recorder.cancel(); return R"({"ok":true,"command":"recordCancel"})"; }
      if (name == "loop") {
        std::string action; command >> action;
        if (!command) return R"({"error":"expected loop record|overdub|play|clear"})";
        if (action == "record") processor.loop_command(calcotone::LoopCommand::Record);
        else if (action == "overdub") processor.loop_command(calcotone::LoopCommand::Overdub);
        else if (action == "play") processor.loop_command(calcotone::LoopCommand::Play);
        else if (action == "clear") processor.loop_command(calcotone::LoopCommand::Clear);
        else return R"({"error":"unknown loop command"})";
        return R"({"ok":true,"command":"loop"})";
      }
      if (name == "loopParam") {
        std::string parameter; float value = 0.F; command >> parameter >> value;
        if (!command || !std::isfinite(value)) return R"({"error":"expected loopParam parameter value"})";
        if (parameter == "enabled") processor.set_loop_enabled(value >= .5F);
        else if (parameter == "track") processor.set_loop_selected_track(static_cast<unsigned>(std::max(0.F, value)));
        else if (parameter == "masterLevel") processor.set_loop_master_level(value);
        else if (parameter == "overdub") processor.set_loop_overdub(value);
        else if (parameter == "fade") processor.set_loop_fade(value);
        else return R"({"error":"unknown loop parameter"})";
        return R"({"ok":true,"command":"loopParam"})";
      }
      if (name == "loopTrackLevel") {
        unsigned track = 0U; float value = 0.F; command >> track >> value;
        if (!command || !std::isfinite(value) || track >= calcotone::kLoopTrackCount) return R"({"error":"expected loopTrackLevel track value"})";
        processor.set_loop_track_level(track, value);
        return R"({"ok":true,"command":"loopTrackLevel"})";
      }
      if (name == "param") {
        std::string module_name, parameter; float value = 0.F;
        command >> module_name >> parameter >> value;
        if (module_name == "pressure") {
          if (!command || !processor.set_pressure_parameter(parameter, value))
            return R"({"error":"unknown native pressure parameter"})";
          return R"({"ok":true,"command":"param"})";
        }
        const auto module = calcotone::rack_module_from_name(module_name);
        if (!command || module == calcotone::RackModule::Count || !std::isfinite(value)) return R"({"error":"expected param module parameter value"})";
        if (!processor.set_module_parameter(module, parameter, value)) return R"({"error":"unknown native parameter"})";
        return R"({"ok":true,"command":"param"})";
      }
      if (name == "moduleBypass") {
        std::string module_name; float value = 0.F; command >> module_name >> value;
        if (module_name == "pressure") {
          if (!command || !std::isfinite(value)) return R"({"error":"expected moduleBypass pressure 0/1"})";
          processor.set_pressure_bypassed(value >= .5F);
          return R"({"ok":true,"command":"moduleBypass"})";
        }
        const auto module = calcotone::rack_module_from_name(module_name);
        if (!command || module == calcotone::RackModule::Count || !std::isfinite(value)) return R"({"error":"expected moduleBypass module 0/1"})";
        processor.set_module_bypassed(module, value >= .5F);
        return R"({"ok":true,"command":"moduleBypass"})";
      }
      if (name == "order") {
        std::array<std::string, static_cast<unsigned>(calcotone::RackModule::Count) + 1U> names{};
        std::array<std::string_view, names.size()> stages{};
        std::size_t count = 0;
        while (count < names.size() && command >> names[count]) { stages[count] = names[count]; ++count; }
        if (!processor.set_serial_order(std::span(stages.data(), count))) return R"({"error":"order needs native module names"})";
        return R"({"ok":true,"command":"order"})";
      }
      float value = 0.F; command >> value;
      if (!command || !std::isfinite(value)) return R"({"error":"expected name and numeric value"})";
      if (name == "active") processor.set_active(value >= 0.5F); else if (name == "bypass") processor.set_stack_bypassed(value >= 0.5F);
      else if (name == "stackInput") processor.set_stack_input(static_cast<unsigned>(std::max(0.F, value)));
      else if (name == "stompInput") processor.set_stomp_input(static_cast<unsigned>(std::max(0.F, value)));
      else if (name == "inputGain") processor.set_input_gain(value);
      else if (name == "outputGain") processor.set_output_gain(value);
      else if (name == "drive") processor.set_stack_drive(value);
      else if (name == "tone") processor.set_stack_tone(value);
      else if (name == "sag") processor.set_stack_sag(value);
      else if (name == "mix") processor.set_stack_mix(value);
      else if (name == "model") {
        const auto model = static_cast<calcotone::AmpModel>(static_cast<unsigned>(value));
        processor.set_stack_model(model);
      } else if (name == "cab") {
        const auto cabinet = static_cast<calcotone::Cabinet>(static_cast<unsigned>(value));
        processor.set_stack_cabinet(cabinet);
      } else if (name == "quality") {
        processor.set_stack_quality(static_cast<unsigned>(value));
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
      RealtimeThreadScope realtime;
      capture_mmcss.store(realtime.mmcss(), std::memory_order_relaxed);
      bool pending_stream_discontinuity = false;
      calcotone::AudioRestartPolicy restart_policy;
      while (running.load(std::memory_order_relaxed)) {
        if (WaitForSingleObject(capture.event, 1000) != WAIT_OBJECT_0) continue;
        UINT32 packet = 0;
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
          if (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) {
            capture_discontinuities.fetch_add(1, std::memory_order_relaxed);
            pending_stream_discontinuity = true;
          }
          if (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) {
            capture_timestamp_errors.fetch_add(1, std::memory_order_relaxed);
            pending_stream_discontinuity = true;
          }
          if (flags & AUDCLNT_BUFFERFLAGS_SILENT)
            capture_silent_packets.fetch_add(1, std::memory_order_relaxed);
          float packet_peak = 0.F;
          std::uint64_t packet_clips = 0U;
          for (UINT32 frame = 0; frame < frames; ++frame) {
            const float left = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + input_one_channel, capture_encoding);
            const float right = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0.F
                : decode_sample(bytes, frame * capture.format->nChannels + input_two_channel, capture_encoding);
            packet_peak = std::max({packet_peak, std::abs(left), std::abs(right)});
            packet_clips += std::abs(left) >= .999F ? 1U : 0U;
            packet_clips += std::abs(right) >= .999F ? 1U : 0U;
            const bool mark_discontinuity = pending_stream_discontinuity;
            if (ring->push(left, right, mark_discontinuity)) {
              if (mark_discontinuity) pending_stream_discontinuity = false;
            } else {
              // Carry an overrun boundary to the first sample that is
              // successfully accepted after the full ring recovers.
              pending_stream_discontinuity = true;
            }
          }
          publish_peak(input_peak, packet_peak);
          if (packet_clips != 0U)
            input_clips.fetch_add(packet_clips, std::memory_order_relaxed);
          const HRESULT release_result = capture_service->ReleaseBuffer(frames);
          if (!audio_call_succeeded(restart_policy, release_result,
                                    "capture ReleaseBuffer", capture_api_errors)) break;
        }
      }
    });

    std::thread render_thread([&] {
      RealtimeThreadScope realtime;
      render_mmcss.store(realtime.mmcss(), std::memory_order_relaxed);
      calcotone::StreamRecovery recovery(sample_rate);
      calcotone::AudioRestartPolicy restart_policy;
      std::uint64_t observed_overruns = ring->overruns();
      const auto publish_fifo_safety = [&] {
        const auto state = fifo_safety.state();
        adaptive_fifo_target.store(state.target_frames, std::memory_order_relaxed);
        adaptive_fifo_maximum.store(state.maximum_target_frames, std::memory_order_relaxed);
        adaptive_fifo_raises.store(state.raises, std::memory_order_relaxed);
        adaptive_fifo_relaxations.store(state.relaxations, std::memory_order_relaxed);
        adaptive_fifo_instability.store(state.instability_events, std::memory_order_relaxed);
        adaptive_fifo_stable_seconds.store(state.stable_seconds, std::memory_order_relaxed);
      };
      publish_fifo_safety();
      const auto render_deadline_micros = static_cast<std::uint64_t>(
          render.period_frames / sample_rate * 1'000'000.);
      while (running.load(std::memory_order_relaxed)) {
        if (WaitForSingleObject(render.event, 1000) != WAIT_OBJECT_0) continue;
        const auto render_started = std::chrono::steady_clock::now();
        UINT32 padding = 0;
        const HRESULT padding_result = render.client->GetCurrentPadding(&padding);
        if (!audio_call_succeeded(restart_policy, padding_result,
                                  "render GetCurrentPadding", render_api_errors)) continue;
        if (padding > render.buffer_frames) {
          render_api_errors.fetch_add(1, std::memory_order_relaxed);
          continue;
        }
        UINT32 remaining = render.buffer_frames - padding;
        while (remaining) {
          const UINT32 block = std::min<UINT32>(remaining, kProcessFrames);
          BYTE* bytes = nullptr;
          const HRESULT buffer_result = render_service->GetBuffer(block, &bytes);
          if (!audio_call_succeeded(restart_policy, buffer_result,
                                    "render GetBuffer", render_api_errors)) break;
          std::uint64_t block_underrun_frames = 0U;
          std::uint64_t block_underrun_events = 0U;
          std::uint64_t block_stream_recoveries = 0U;
          for (UINT32 frame = 0; frame < block; ++frame) {
            float captured_left = 0.F, captured_right = 0.F;
            bool stream_discontinuity = false;
            const bool pulled = ring->pull(captured_left, captured_right, &stream_discontinuity);
            const bool valid = pulled && std::isfinite(captured_left) && std::isfinite(captured_right);
            if (stream_discontinuity) {
              recovery.mark_discontinuity();
              ++block_stream_recoveries;
            }
            float left = 0.F, right = 0.F;
            if (recovery.process(valid, captured_left, captured_right, left, right))
              ++block_underrun_events;
            if (!valid) ++block_underrun_frames;
            process->capture_input[frame * 2] = left;
            process->capture_input[frame * 2 + 1] = right;
          }
          if (block_underrun_frames != 0U)
            underruns.fetch_add(block_underrun_frames, std::memory_order_relaxed);
          if (block_underrun_events != 0U)
            underrun_events.fetch_add(block_underrun_events, std::memory_order_relaxed);
          if (block_stream_recoveries != 0U)
            stream_recovery_events.fetch_add(block_stream_recoveries, std::memory_order_relaxed);
          const auto current_overruns = ring->overruns();
          const auto block_overruns = current_overruns - observed_overruns;
          observed_overruns = current_overruns;
          if (fifo_safety.observe_block(block, block_underrun_events,
                  block_stream_recoveries, block_overruns))
            ring->set_target_frames(fifo_safety.target_frames());
          processor.process(process->capture_input.data(), process->mixed_output.data(), block);
          recorder.capture(process->mixed_output.data(), block);
          float block_output_peak = 0.F;
          for (UINT32 frame = 0; frame < block; ++frame) {
            block_output_peak = std::max({block_output_peak,
                std::abs(process->mixed_output[frame * 2]),
                std::abs(process->mixed_output[frame * 2 + 1])});
            for (WORD channel = 0; channel < render.format->nChannels; ++channel) {
              float value = 0.F;
              if (output_left_channel == output_right_channel && channel == output_left_channel)
                value = (process->mixed_output[frame * 2] + process->mixed_output[frame * 2 + 1]) * .70710678F;
              else if (channel == output_left_channel) value = process->mixed_output[frame * 2];
              else if (channel == output_right_channel) value = process->mixed_output[frame * 2 + 1];
              encode_sample(bytes, frame * render.format->nChannels + channel, render_encoding, value);
            }
          }
          publish_peak(output_peak, block_output_peak);
          const HRESULT release_result = render_service->ReleaseBuffer(block, 0);
          if (!audio_call_succeeded(restart_policy, release_result,
                                    "render ReleaseBuffer", render_api_errors)) break;
          remaining -= block;
        }
        const auto render_micros = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now() - render_started).count());
        auto previous_max = max_render_micros.load(std::memory_order_relaxed);
        while (render_micros > previous_max && !max_render_micros.compare_exchange_weak(
            previous_max, render_micros, std::memory_order_relaxed, std::memory_order_relaxed)) {}
        if (render_micros >= render_deadline_micros) {
          render_deadline_misses.fetch_add(1, std::memory_order_relaxed);
          if (fifo_safety.observe_deadline_miss())
            ring->set_target_frames(fifo_safety.target_frames());
        }
        publish_fifo_safety();
      }
    });

    check(capture.client->Start(), "Start capture");
    const auto prime_deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(250);
    while (ring->available() < fifo_target_frames && std::chrono::steady_clock::now() < prime_deadline) Sleep(1);
    ring->trim_to_target();
    const auto primed_frames = ring->available();
    std::ostringstream primed;
    primed << "Primed native FIFO: " << primed_frames << " frames ("
           << primed_frames / sample_rate * 1000. << " ms safety; target " << fifo_target_frames << "f)";
    log_line(primed.str());
    check(render.client->Start(), "Start render");
    const std::wstring faceplate_url = L"http://127.0.0.1:" + std::to_wstring(control_server.port()) + L"/";
    const std::wstring desktop_faceplate_url = faceplate_url + L"?native-shell=1";
    const double input_ms = capture.period_frames / sample_rate * 1000.;
    const double output_ms = render.buffer_frames / sample_rate * 1000.;
    std::ostringstream startup;
    startup << "CALCOTONE native audio active | " << sample_rate << " Hz | input period " << capture.period_frames
            << "f | output buffer " << render.buffer_frames << "f | FIFO safety " << primed_frames
            << "f | estimated native path " << input_ms + output_ms + primed_frames / sample_rate * 1000. << " ms";
    log_line(startup.str());
    log_line("Control bridge: http://127.0.0.1:" + std::to_string(control_server.port()) + " | GET /health | POST /command");
    log_line("Commands: param/moduleBypass/order, active/bypass, stackInput, inputGain/outputGain, STACK controls, stats, quit");
    bool browser_mode = false;
    for (int argument = 1; argument < argc; ++argument)
      browser_mode = browser_mode || std::string_view(argv[argument]) == "--browser";
    std::array<char, 32> ui_mode{};
    GetEnvironmentVariableA("CALCOTONE_UI_MODE", ui_mode.data(), static_cast<DWORD>(ui_mode.size()));
    browser_mode = browser_mode || std::string_view(ui_mode.data()) == "browser";

    if (!browser_mode) {
      log_line("Opening embedded CALCOTONE desktop faceplate...");
      std::string shell_error;
      int shell_result = -1;
      // WASAPI lives in this thread's multithreaded COM apartment. WebView2
      // requires a dedicated single-threaded apartment and Windows message pump.
      std::thread shell_thread([&] {
        shell_result = calcotone::run_desktop_shell(desktop_faceplate_url, shell_error);
      });
      shell_thread.join();
      if (shell_result < 0) {
        log_line("Embedded faceplate failed: " + shell_error);
        log_line("Falling back to the local diagnostic browser faceplate.");
        browser_mode = true;
      }
    }
    if (browser_mode) {
      log_line("Opening diagnostic browser faceplate: http://127.0.0.1:" + std::to_string(control_server.port()) + "/");
      ShellExecuteW(nullptr, L"open", faceplate_url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
      std::string line;
      while (std::getline(std::cin, line)) {
        std::istringstream command(line); std::string name; float value = 0.F; command >> name;
        if (name == "quit") break;
        std::cout << apply_command(line) << '\n';
      }
    }
    control_server.stop();
    recorder.cancel();
    running.store(false); SetEvent(capture.event); SetEvent(render.event);
    capture_thread.join(); render_thread.join();
    capture.client->Stop(); render.client->Stop(); CoUninitialize();
    return 0;
  } catch (const HResultError& error) {
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
}
#else
#include <iostream>
int main() { std::cout << "calcotone_host is Windows-only; run make test for the portable DSP core.\n"; }
#endif
