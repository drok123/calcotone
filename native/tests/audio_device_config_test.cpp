#include "calcotone/audio_device_config.hpp"

#include <cassert>
#include <cstdlib>
#include <iostream>
#include <string_view>

namespace {
void set_environment(const char* name, const char* value) {
#ifdef _WIN32
  assert(_putenv_s(name, value) == 0);
#else
  assert(setenv(name, value, 1) == 0);
#endif
}

void clear_environment(const char* name) {
#ifdef _WIN32
  assert(_putenv_s(name, "") == 0);
#else
  assert(unsetenv(name) == 0);
#endif
}
}  // namespace

int main() {
  clear_environment("CALCOTONE_SHARED_RAW");
  auto config = calcotone::audio_device_config_from_environment();
  assert(config.allow_shared_raw);

  for (const char* disabled : {"0", "false", "off", "no"}) {
    set_environment("CALCOTONE_SHARED_RAW", disabled);
    config = calcotone::audio_device_config_from_environment();
    assert(!config.allow_shared_raw);
  }

  for (const char* enabled : {"1", "true", "on", "yes"}) {
    set_environment("CALCOTONE_SHARED_RAW", enabled);
    config = calcotone::audio_device_config_from_environment();
    assert(config.allow_shared_raw);
  }
  clear_environment("CALCOTONE_SHARED_RAW");

  config = calcotone::audio_device_config_from_environment();
  assert(config.buffer_frames >= 16 && config.buffer_frames <= 4096);
  assert(config.sample_rate <= 384'000);
  assert(config.input_one_channel < 256 && config.input_two_channel < 256);
  assert(config.output_left_channel < 256 && config.output_right_channel < 256);
  assert(calcotone::audio_backend_name(calcotone::AudioBackend::Automatic) == std::string_view("auto"));
  assert(calcotone::audio_backend_name(calcotone::AudioBackend::KsWaveRt) == std::string_view("ks-wavert"));
  assert(calcotone::audio_backend_name(calcotone::AudioBackend::Wasapi) == std::string_view("wasapi"));
  std::cout << "audio device configuration passed\n";
}
