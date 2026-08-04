#pragma once

#ifdef _WIN32
#include <string>

namespace calcotone {

struct KsWaveRtProbe {
  bool kernel_streaming_available{};
  unsigned filter_count{};
  unsigned pin_count{};
  std::string summary;
};

// Read-only discovery only: no pin is instantiated and no audio device state is
// changed. A later transport can use this result before attempting WaveRT pin
// format/buffer negotiation.
KsWaveRtProbe probe_ks_wavert_devices() noexcept;

}  // namespace calcotone
#endif
