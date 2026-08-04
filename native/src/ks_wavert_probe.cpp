#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <ks.h>
#include <ksmedia.h>
#include <setupapi.h>

#include "calcotone/ks_wavert_probe.hpp"

#include <array>
#include <cstddef>
#include <vector>

namespace calcotone {

KsWaveRtProbe probe_ks_wavert_devices() noexcept {
  KsWaveRtProbe result;
  HDEVINFO devices = SetupDiGetClassDevsW(
      &KSCATEGORY_AUDIO, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (devices == INVALID_HANDLE_VALUE) {
    result.summary = "Windows did not expose any Kernel Streaming audio filters.";
    return result;
  }

  for (DWORD index = 0;; ++index) {
    SP_DEVICE_INTERFACE_DATA interface_data{};
    interface_data.cbSize = sizeof(interface_data);
    if (!SetupDiEnumDeviceInterfaces(devices, nullptr, &KSCATEGORY_AUDIO, index, &interface_data)) {
      if (GetLastError() == ERROR_NO_MORE_ITEMS) break;
      continue;
    }
    DWORD required = 0;
    SetupDiGetDeviceInterfaceDetailW(devices, &interface_data, nullptr, 0, &required, nullptr);
    if (required < sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W)) continue;
    std::vector<std::byte> storage(required);
    auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(storage.data());
    detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(devices, &interface_data, detail, required, nullptr, nullptr)) continue;

    HANDLE filter = CreateFileW(detail->DevicePath, GENERIC_READ | GENERIC_WRITE,
                                FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                                FILE_ATTRIBUTE_NORMAL, nullptr);
    if (filter == INVALID_HANDLE_VALUE) continue;
    ++result.filter_count;
    KSPROPERTY property{};
    property.Set = KSPROPSETID_Pin;
    property.Id = KSPROPERTY_PIN_CTYPES;
    property.Flags = KSPROPERTY_TYPE_GET;
    ULONG pins = 0;
    DWORD returned = 0;
    if (DeviceIoControl(filter, IOCTL_KS_PROPERTY, &property, sizeof(property),
                        &pins, sizeof(pins), &returned, nullptr) && returned >= sizeof(pins)) {
      result.pin_count += pins;
      result.kernel_streaming_available = result.kernel_streaming_available || pins > 0;
    }
    CloseHandle(filter);
  }
  SetupDiDestroyDeviceInfoList(devices);
  if (result.kernel_streaming_available) {
    result.summary = "Kernel Streaming filters detected; WaveRT pin negotiation is eligible.";
  } else {
    result.summary = "No directly accessible Kernel Streaming audio pins were detected.";
  }
  return result;
}

}  // namespace calcotone
#endif
