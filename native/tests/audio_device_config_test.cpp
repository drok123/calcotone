#include "calcotone/audio_device_config.hpp"

#include <cassert>
#include <iostream>

int main() {
  const auto config = calcotone::audio_device_config_from_environment();
  assert(config.buffer_frames >= 16 && config.buffer_frames <= 4096);
  assert(config.sample_rate <= 384'000);
  assert(config.input_one_channel < 256 && config.input_two_channel < 256);
  assert(config.output_left_channel < 256 && config.output_right_channel < 256);
  assert(calcotone::audio_backend_name(calcotone::AudioBackend::Automatic) == std::string_view("auto"));
  assert(calcotone::audio_backend_name(calcotone::AudioBackend::KsWaveRt) == std::string_view("ks-wavert"));
  assert(calcotone::audio_backend_name(calcotone::AudioBackend::Wasapi) == std::string_view("wasapi"));
  std::cout << "audio device configuration passed\n";
}
