#!/usr/bin/env python3
"""Generate native_rack.cpp with completed parity processors wired live."""

from __future__ import annotations

import pathlib
import re
import sys


def replace_once(source: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, source, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"expected exactly one legacy {label} block, replaced {count}")
    return result


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: apply_atmos_parity.py INPUT OUTPUT", file=sys.stderr)
        return 2

    source_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    source = source_path.read_text(encoding="utf-8")

    include_anchor = '#include "calcotone/native_rack.hpp"\n'
    parity_includes = (
        '#include "calcotone/atmos_parity_processor.hpp"\n'
        '#include "calcotone/ember_parity_processor.hpp"\n'
        '#include "calcotone/drift_parity_processor.hpp"\n'
        '#include "calcotone/halo_parity_processor.hpp"\n'
        '#include "calcotone/grain_parity_processor.hpp"\n'
    )
    if '#include "calcotone/atmos_parity_processor.hpp"' not in source:
        if include_anchor not in source:
            raise RuntimeError("native rack include anchor was not found")
        source = source.replace(include_anchor, include_anchor + parity_includes, 1)

    # Params owns the UI-facing atomics, while each parity processor owns its own
    # sample-rate smoothing. Feed the atomic targets directly. The former wrapper
    # called Params::glide only once per host block, then smoothed a second time in
    # the processor; model changes could take seconds and rounded indices appeared
    # unresponsive at normal callback sizes.
    ember_replacement = r'''struct Ember {
  Params p{0.F, .14F, 9500.F, .18F, .22F, .38F, .22F};
  EmberParityProcessor processor;
  explicit Ember(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("drive", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("tone", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("heat", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("character", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("dynamics", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

float read_delay'''
    source = replace_once(source, r"struct Ember \{.*?\n\};\n\nfloat read_delay", ember_replacement, "Ember")

    drift_replacement = r'''struct Drift {
  Params p{0.F, .28F, .0022F, .35F, .62F, .32F, .14F};
  DriftParityProcessor processor;
  explicit Drift(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("rate", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("depth", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("shape", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("spread", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("motion", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Halo {'''
    source = replace_once(source, r"struct Drift \{.*?\n\};\n\nstruct Halo \{", drift_replacement, "Drift")

    halo_replacement = r'''struct Halo {
  Params p{1.F, .36F, .22F, .42F, .14F, .58F, .14F};
  HaloParityProcessor processor;
  explicit Halo(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("algorithm", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("time", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("feedback", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("color", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("character", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("width", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Atmos {'''
    source = replace_once(source, r"struct Halo \{.*?\n\};\n\nstruct Atmos \{", halo_replacement, "Halo")

    atmos_replacement = r'''struct Atmos {
  Params p{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  AtmosParityProcessor processor;
  explicit Atmos(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("algorithm", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("decay", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("size", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("color", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("diffusion", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("motion", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Grain {'''
    source = replace_once(source, r"struct Atmos \{.*?\n\};\n\nstruct Grain \{", atmos_replacement, "Atmos")

    grain_replacement = r'''struct Grain {
  Params p{2.F, 13.F, .42F, .38F, .16F, .36F, .12F};
  GrainParityProcessor processor;
  explicit Grain(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("bits", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("density", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("pitch", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("chaos", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("bloom", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Artifact {'''
    source = replace_once(source, r"struct Grain \{.*?\n\};\n\nstruct Artifact \{", grain_replacement, "Grain")

    artifact_replacement = r'''struct Artifact {
  Params p{0.F, .162F, .16F, .10F, .62F, .26F};
  std::array<std::vector<float>, 2> transport;
  std::array<float, 2> low{}, dc_in{}, dc_out{}, envelope{};
  std::size_t write{};
  float wow_phase{}, flutter_phase{};
  std::uint32_t random_state{0xA471FAC7U};
  explicit Artifact(float rate) {
    const auto size = static_cast<std::size_t>(rate * .075F) + 16;
    transport[0].assign(size, 0.F); transport[1].assign(size, 0.F);
  }
  float noise() noexcept {
    random_state ^= random_state << 13; random_state ^= random_state >> 17; random_state ^= random_state << 5;
    return static_cast<float>(random_state & 0xffffU) / 32767.5F - 1.F;
  }
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .055F));
    for (std::size_t frame = 0; frame < frames; ++frame) {
      p.glide(glide);
      const unsigned mode = std::min(13U, static_cast<unsigned>(std::round(p.value[0])));
      const float wear = clamp01(p.value[1]), wow = clamp01(p.value[2]);
      const float hiss = clamp01(p.value[3]), tone_value = clamp01(p.value[4]), mix = clamp01(p.value[5]);
      const bool console_mode = (mode >= 8 && mode <= 11) || mode == 13;
      const bool atr = mode == 12;
      const bool narrow = mode == 4 || mode == 7;
      const bool broken = mode == 6;
      const float wow_hz = mode == 1 ? .18F : mode == 3 ? .72F : broken ? .91F : .32F;
      const float flutter_hz = mode == 1 ? 3.2F : mode == 3 ? 7.4F : broken ? 9.1F : 4.8F;
      wow_phase += 2.F * kPi * wow_hz / rate; flutter_phase += 2.F * kPi * flutter_hz / rate;
      if (wow_phase >= 2.F*kPi) wow_phase -= 2.F*kPi;
      if (flutter_phase >= 2.F*kPi) flutter_phase -= 2.F*kPi;
      const float delay = console_mode ? 1.F : (atr ? .0012F : .0035F) * rate +
          (std::sin(wow_phase) + std::sin(flutter_phase) * .22F) * wow * (broken ? .0042F : .0022F) * rate;
      const float cutoff = narrow ? 4'600.F + tone_value * 2'100.F : console_mode ? 10'500.F + tone_value * 6'500.F : 5'800.F + tone_value * 10'200.F;
      const float g = filter_coefficient(cutoff, rate);
      for (unsigned ch = 0; ch < 2; ++ch) {
        const auto i = frame * 2 + ch; const float dry = data[i];
        transport[ch][write] = dry;
        envelope[ch] += (std::abs(dry) - envelope[ch]) * .0012F;
        float wet = console_mode ? dry : read_delay(transport[ch], write, std::max(1.F, delay + ch * 1.7F));
        const float drive = console_mode ? (mode == 13 ? 1.8F + wear * 3.4F : 1.25F + wear * 2.2F)
            : atr ? 1.35F + wear * 2.8F : 1.F + wear * (broken ? 7.F : 4.2F);
        const float shaped = fast_shape(wet * drive + (mode == 13 ? .018F : .006F) * wear);
        wet = wet + (shaped / std::max(1.F, drive * .72F) - wet) * (console_mode ? .42F : .28F + wear * .34F);
        wet = one_pole(wet, low[ch], g);
        if (!console_mode) wet += noise() * hiss * envelope[ch] * (mode == 2 || mode == 5 ? .055F : .018F);
        const float dc = wet - dc_in[ch] + .995F * dc_out[ch]; dc_in[ch]=wet; dc_out[ch]=dc;
        const float trim = mode == 13 ? .91F : console_mode ? .96F : atr ? .94F : 1.F;
        data[i] = std::clamp(dry + (dc * trim - dry) * mix, -1.2F, 1.2F);
      }
      write = (write + 1) % transport[0].size();
    }
  }
};

struct Stomp {'''
    source = replace_once(source, r"struct Artifact \{.*?\n\};\n\nstruct Stomp \{", artifact_replacement, "Artifact")


    source = source.replace(
        "explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), drift(sample_rate)",
        "explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), ember(sample_rate), drift(sample_rate)",
        1,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(source, encoding="utf-8", newline="\n")
    print(f"generated {output_path} with live Ember, Drift, Halo, Atmos, Grain, and Artifact processing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
