#pragma once

#include <cstddef>
#include <memory>
#include <span>
#include <string_view>

namespace calcotone {

enum class RackModule : unsigned { Ember, Drift, Halo, Atmos, Grain, Artifact, Stomp, Count };

RackModule rack_module_from_name(std::string_view name) noexcept;
std::string_view rack_module_name(RackModule module) noexcept;

// Allocation-free, lock-free stereo processing rack. All delay/reverb memory is
// allocated by the constructor; control setters only publish atomic targets.
class NativeRack final {
 public:
  explicit NativeRack(float sample_rate = 48'000.F);
  ~NativeRack();
  NativeRack(const NativeRack&) = delete;
  NativeRack& operator=(const NativeRack&) = delete;

  void process(const float* input, float* output, std::size_t frames) noexcept;
  void process_module(RackModule module, float* data, std::size_t frames) noexcept;
  bool set_parameter(RackModule module, std::string_view parameter, float value) noexcept;
  void set_bypassed(RackModule module, bool bypassed) noexcept;
  void set_order(std::span<const RackModule> order) noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

// Post-rack dynamics station. Kept outside NativeRack because PRESSURE follows
// STACK in the browser topology and therefore must run after the amp insert.
class NativePressure final {
 public:
  explicit NativePressure(float sample_rate = 48'000.F);
  ~NativePressure();
  NativePressure(const NativePressure&) = delete;
  NativePressure& operator=(const NativePressure&) = delete;
  void process(float* data, std::size_t frames) noexcept;
  bool set_parameter(std::string_view parameter, float value) noexcept;
  void set_bypassed(bool bypassed) noexcept;
 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
