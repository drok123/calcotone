#!/usr/bin/env python3
"""Route Ember specialty branches through dedicated native processors."""

from __future__ import annotations

import pathlib
import re
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: apply_ember_magnetic_route.py INPUT OUTPUT", file=sys.stderr)
        return 2

    input_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    source = input_path.read_text(encoding="utf-8")

    include_anchor = '#include "calcotone/ember_parity_processor.hpp"\n'
    specialty_includes = (
        '#include "calcotone/ember_magnetic_core_processor.hpp"\n'
        '#include "calcotone/ember_digital_capture_processor.hpp"\n'
    )
    if '#include "calcotone/ember_digital_capture_processor.hpp"' not in source:
        if include_anchor not in source:
            raise RuntimeError("Ember parity include anchor was not found")
        source = source.replace(include_anchor, include_anchor + specialty_includes, 1)

    replacement = r'''struct Ember {
  Params p{0.F, .14F, 9500.F, .18F, .22F, .38F, .22F};
  EmberParityProcessor processor;
  EmberMagneticCoreProcessor magnetic;
  EmberDigitalCaptureProcessor digital;
  int active_mode{-1};
  explicit Ember(float rate) : processor(rate), magnetic(rate), digital(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    const float mode_value = p.value[0];
    const int mode = std::clamp(static_cast<int>(std::lround(mode_value)), 0, 17);
    if (mode != active_mode) {
      if (mode == 3) magnetic.reset();
      else if (mode >= 12) digital.reset();
      else if (active_mode == 3 || active_mode >= 12) processor.reset();
      active_mode = mode;
    }

    const float drive = p.target[1].load(std::memory_order_relaxed);
    const float tone = p.target[2].load(std::memory_order_relaxed);
    const float heat = p.target[3].load(std::memory_order_relaxed);
    const float character = p.target[4].load(std::memory_order_relaxed);
    const float dynamics = p.target[5].load(std::memory_order_relaxed);
    const float mix = p.target[6].load(std::memory_order_relaxed);

    if (mode == 3) {
      magnetic.set_parameter("drive", drive);
      magnetic.set_parameter("tone", tone);
      magnetic.set_parameter("heat", heat);
      magnetic.set_parameter("character", character);
      magnetic.set_parameter("dynamics", dynamics);
      magnetic.set_parameter("mix", mix);
      magnetic.process(data, frames);
      return;
    }

    if (mode >= 12) {
      digital.set_parameter("mode", static_cast<float>(mode - 12));
      digital.set_parameter("drive", drive);
      digital.set_parameter("clock", std::clamp((tone - 200.F) / 17800.F, 0.F, 1.F));
      digital.set_parameter("character", std::clamp(heat * .82F + dynamics * .18F, 0.F, 1.F));
      digital.set_parameter("filter", std::clamp(character * .82F + dynamics * .18F, 0.F, 1.F));
      digital.set_parameter("mix", mix);
      digital.process(data, frames);
      return;
    }

    processor.set_parameter("mode", mode_value);
    processor.set_parameter("drive", drive);
    processor.set_parameter("tone", tone);
    processor.set_parameter("heat", heat);
    processor.set_parameter("character", character);
    processor.set_parameter("dynamics", dynamics);
    processor.set_parameter("mix", mix);
    processor.process(data, frames);
  }
};

float read_delay'''

    source, count = re.subn(
        r"struct Ember \{.*?\n\};\n\nfloat read_delay",
        replacement,
        source,
        count=1,
        flags=re.DOTALL,
    )
    if count != 1:
        raise RuntimeError(f"expected one generated Ember wrapper, replaced {count}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(source, encoding="utf-8", newline="\n")
    print(f"generated {output_path} with dedicated Ember magnetic and digital routing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
