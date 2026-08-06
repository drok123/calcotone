#pragma once

#include <array>

namespace calcotone {

// Generated from public/ember-tube-processor.js. Do not hand-edit.
struct EmberTubeElectricalProfile {
  float mu{};
  float supply{};
  float plate_load{};
  float bias{};
  float gain{};
  float softness{};
  float bias_memory{};
  float recovery{};
  float sag{};
  float plate_memory{};
  float character_range{};
  float cathode{};
  float blocking{};
  float grid_headroom{};
  float thermal{};
  float mismatch{};
  float supply_stiffness{};
  float sag_attack{};
  float color_base{};
  float color_drive{};
  float color_heat{};
  float color_character{};
  float color_ceiling{};
  float bias_attack{};
  float bias_attack_heat{};
  float bias_release{};
  float bias_release_dynamics{};
  float bias_release_recovery{};
  float static_bias{};
  float heat_curve{};
  float drive_curve{};
  float cathode_drive{};
  float cathode_drive_mod{};
  float cathode_attack{};
  float cathode_heat_attack{};
  float cathode_release{};
  float cathode_recovery{};
  float cathode_bias_base{};
  float cathode_bias_dynamics{};
  float blocking_attack{};
  float blocking_release{};
  float blocking_recovery{};
  float blocking_ceiling{};
  float blocking_bias{};
  float plate_current_scale{};
  float plate_cathode_coupling{};
  float plate_attack{};
  float plate_release{};
  float plate_compression{};
  float plate_compression_ceiling{};
  float local_sag_base{};
  float local_sag_dynamics{};
  float local_sag_cathode{};
  float local_sag_supply{};
  float local_sag_ceiling{};
  float harmonic_drive{};
  float even_harmonic{};
  float plate_follow_base{};
  float plate_follow_memory{};
};

inline constexpr std::array<EmberTubeElectricalProfile, 5> kEmberTubeElectricalProfiles{{
  {102.0F, 315.0F, 92000.0F, -1.42F, 1.12F, 1.02F, 0.5F, 0.9F, 0.3F, 0.4F, 0.05F, 0.42F, 0.3F, 0.98F, 0.32F, 0.0012F, 0.9F, 0.42F, 0.1F, 0.28F, 0.05F, 0.08F, 0.52F, 0.0052F, 0.0035F, 0.00055F, 0.00062F, 0.00034F, 0.001F, 0.05F, 0.1F, 0.5F, 0.4F, 0.00082F, 0.00042F, 0.00013F, 7e-05F, 0.0024F, 0.0045F, 0.012F, 0.00052F, 0.00022F, 0.012F, 0.015F, 0.52F, 0.2F, 0.0014F, 0.00016F, 0.022F, 0.065F, 0.004F, 0.014F, 0.006F, 0.5F, 0.075F, 0.1F, 0.02F, 0.88F, 0.07F},
  {96.0F, 285.0F, 112000.0F, -1.62F, 1.02F, 1.26F, 0.92F, 0.46F, 1.0F, 0.82F, 0.095F, 0.92F, 0.84F, 0.63F, 0.92F, 0.0036F, 0.28F, 0.88F, 0.14F, 0.38F, 0.11F, 0.1F, 0.7F, 0.0075F, 0.0058F, 0.00024F, 0.00115F, 0.00014F, -0.006F, 0.13F, 0.2F, 0.78F, 0.76F, 0.00145F, 0.001F, 5.5e-05F, 3.5e-05F, 0.0048F, 0.009F, 0.026F, 0.00026F, 0.0001F, 0.026F, 0.026F, 0.76F, 0.46F, 0.0021F, 8e-05F, 0.05F, 0.14F, 0.008F, 0.032F, 0.014F, 0.92F, 0.14F, 0.18F, 0.075F, 0.74F, 0.14F},
  {104.0F, 325.0F, 88000.0F, -1.36F, 1.05F, 0.94F, 0.34F, 1.0F, 0.2F, 0.26F, 0.032F, 0.3F, 0.2F, 1.08F, 0.24F, 0.0007F, 1.0F, 0.24F, 0.075F, 0.22F, 0.035F, 0.055F, 0.42F, 0.0045F, 0.0024F, 0.00072F, 0.00048F, 0.00042F, 0.0005F, 0.035F, 0.075F, 0.4F, 0.3F, 0.00062F, 0.0003F, 0.00017F, 9e-05F, 0.0018F, 0.0034F, 0.009F, 0.00065F, 0.00028F, 0.008F, 0.011F, 0.42F, 0.14F, 0.001F, 0.00022F, 0.014F, 0.045F, 0.003F, 0.01F, 0.004F, 0.38F, 0.055F, 0.07F, 0.01F, 0.91F, 0.05F},
  {101.0F, 300.0F, 101000.0F, -1.5F, 1.1F, 1.12F, 0.68F, 0.7F, 0.6F, 0.58F, 0.082F, 0.66F, 0.56F, 0.78F, 0.6F, 0.0026F, 0.56F, 0.61F, 0.12F, 0.34F, 0.075F, 0.13F, 0.62F, 0.0064F, 0.0044F, 0.00038F, 0.00086F, 0.00023F, 0.004F, 0.09F, 0.15F, 0.62F, 0.58F, 0.00105F, 0.00066F, 9e-05F, 5.5e-05F, 0.0035F, 0.0065F, 0.018F, 0.00039F, 0.00016F, 0.018F, 0.02F, 0.62F, 0.32F, 0.0017F, 0.00012F, 0.034F, 0.095F, 0.006F, 0.022F, 0.01F, 0.68F, 0.105F, 0.16F, 0.05F, 0.82F, 0.1F},
  {92.0F, 270.0F, 120000.0F, -1.72F, 1.16F, 1.34F, 1.0F, 0.34F, 1.14F, 0.94F, 0.11F, 1.0F, 1.0F, 0.54F, 1.0F, 0.0044F, 0.18F, 1.0F, 0.16F, 0.44F, 0.13F, 0.1F, 0.76F, 0.0085F, 0.0065F, 0.00018F, 0.00135F, 8e-05F, -0.01F, 0.15F, 0.24F, 0.88F, 0.88F, 0.0018F, 0.00125F, 4e-05F, 2.5e-05F, 0.0058F, 0.0105F, 0.032F, 0.0002F, 7e-05F, 0.032F, 0.03F, 0.84F, 0.55F, 0.0025F, 6.5e-05F, 0.06F, 0.17F, 0.01F, 0.038F, 0.017F, 1.0F, 0.16F, 0.22F, 0.095F, 0.7F, 0.17F}
}};

}  // namespace calcotone
