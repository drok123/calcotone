#include "calcotone/audio_device_config.hpp"

#include <algorithm>
#include <charconv>
#include <cstdlib>
#include <string_view>

namespace calcotone {
namespace {
std::string environment_string(const char* name) {
  const char* value = std::getenv(name);
  return value ? value : "";
}

std::uint32_t environment_number(const char* name, std::uint32_t fallback,
                                 std::uint32_t minimum, std::uint32_t maximum) noexcept {
  const char* text = std::getenv(name);
  if (!text || !*text) return fallback;
  std::uint32_t value{};
  const auto [end, error] = std::from_chars(text, text + std::char_traits<char>::length(text), value);
  if (error != std::errc{} || *end != '\0') return fallback;
  return std::clamp(value, minimum, maximum);
}

bool environment_flag(const char* name, bool fallback) noexcept {
  const auto value = environment_string(name);
  if (value.empty()) return fallback;
  return value != "0" && value != "false" && value != "off" && value != "no";
}

unsigned channel_index(const char* name, unsigned fallback) noexcept {
  // User-facing channel numbers are one-based. Internally they are zero-based.
  const auto value = environment_number(name, fallback + 1U, 1U, 256U);
  return static_cast<unsigned>(value - 1U);
}
}

AudioDeviceConfig audio_device_config_from_environment() noexcept {
  AudioDeviceConfig config;
  const auto backend = environment_string("CALCOTONE_AUDIO_BACKEND");
  if (backend == "ks" || backend == "wavert" || backend == "ks-wavert")
    config.backend = AudioBackend::KsWaveRt;
  else if (backend == "wasapi") config.backend = AudioBackend::Wasapi;
  config.capture_device = environment_string("CALCOTONE_CAPTURE_DEVICE");
  config.render_device = environment_string("CALCOTONE_RENDER_DEVICE");
  config.buffer_frames = environment_number("CALCOTONE_BUFFER_FRAMES", 64, 16, 4096);
  config.sample_rate = environment_number("CALCOTONE_SAMPLE_RATE", 0, 0, 384'000);
  config.input_one_channel = channel_index("CALCOTONE_INPUT_1_CHANNEL", 0);
  config.input_two_channel = channel_index("CALCOTONE_INPUT_2_CHANNEL", 1);
  config.output_left_channel = channel_index("CALCOTONE_OUTPUT_LEFT_CHANNEL", 0);
  config.output_right_channel = channel_index("CALCOTONE_OUTPUT_RIGHT_CHANNEL", 1);
  const auto mode = environment_string("CALCOTONE_AUDIO_MODE");
  config.prefer_exclusive = mode != "shared";
  config.allow_shared_raw = environment_flag("CALCOTONE_SHARED_RAW", true);
  return config;
}

const char* audio_backend_name(AudioBackend backend) noexcept {
  switch (backend) {
    case AudioBackend::KsWaveRt: return "ks-wavert";
    case AudioBackend::Wasapi: return "wasapi";
    default: return "auto";
  }
}

}  // namespace calcotone
