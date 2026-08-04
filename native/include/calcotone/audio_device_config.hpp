#pragma once

#include <cstdint>
#include <string>

namespace calcotone {

enum class AudioBackend { Automatic, KsWaveRt, Wasapi };

struct AudioDeviceConfig {
  AudioBackend backend{AudioBackend::Automatic};
  std::string capture_device;
  std::string render_device;
  std::uint32_t buffer_frames{64};
  std::uint32_t sample_rate{};  // zero follows the device
  unsigned input_one_channel{};
  unsigned input_two_channel{1};
  unsigned output_left_channel{};
  unsigned output_right_channel{1};
  bool prefer_exclusive{true};
};

AudioDeviceConfig audio_device_config_from_environment() noexcept;
const char* audio_backend_name(AudioBackend backend) noexcept;

}  // namespace calcotone
