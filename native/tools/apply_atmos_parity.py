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
    )
    if '#include "calcotone/halo_parity_processor.hpp"' not in source:
        if include_anchor not in source:
            raise RuntimeError("native rack include anchor was not found")
        source = source.replace(include_anchor, include_anchor + parity_includes, 1)

    ember_replacement = r'''struct Ember {
  Params p{0.F, .14F, 9500.F, .18F, .22F, .38F, .22F};
  EmberParityProcessor processor;
  explicit Ember(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .045F)); p.glide(glide);
    processor.set_parameter("mode", p.value[0]); processor.set_parameter("drive", p.value[1]);
    processor.set_parameter("tone", p.value[2]); processor.set_parameter("heat", p.value[3]);
    processor.set_parameter("character", p.value[4]); processor.set_parameter("dynamics", p.value[5]);
    processor.set_parameter("mix", p.value[6]); processor.process(data, frames);
  }
};

float read_delay'''
    source = replace_once(source, r"struct Ember \{.*?\n\};\n\nfloat read_delay", ember_replacement, "Ember")

    drift_replacement = r'''struct Drift {
  Params p{0.F, .28F, .0022F, .35F, .62F, .32F, .14F};
  DriftParityProcessor processor;
  explicit Drift(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .04F)); p.glide(glide);
    processor.set_parameter("mode", p.value[0]); processor.set_parameter("rate", p.value[1]);
    processor.set_parameter("depth", p.value[2]); processor.set_parameter("shape", p.value[3]);
    processor.set_parameter("spread", p.value[4]); processor.set_parameter("motion", p.value[5]);
    processor.set_parameter("mix", p.value[6]); processor.process(data, frames);
  }
};

struct Halo {'''
    source = replace_once(source, r"struct Drift \{.*?\n\};\n\nstruct Halo \{", drift_replacement, "Drift")

    halo_replacement = r'''struct Halo {
  Params p{1.F, .36F, .22F, .42F, .14F, .58F, .14F};
  HaloParityProcessor processor;
  explicit Halo(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .12F)); p.glide(glide);
    processor.set_parameter("algorithm", p.value[0]); processor.set_parameter("time", p.value[1]);
    processor.set_parameter("feedback", p.value[2]); processor.set_parameter("color", p.value[3]);
    processor.set_parameter("character", p.value[4]); processor.set_parameter("width", p.value[5]);
    processor.set_parameter("mix", p.value[6]); processor.process(data, frames);
  }
};

struct Atmos {'''
    source = replace_once(source, r"struct Halo \{.*?\n\};\n\nstruct Atmos \{", halo_replacement, "Halo")

    atmos_replacement = r'''struct Atmos {
  Params p{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  AtmosParityProcessor processor;
  explicit Atmos(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .16F)); p.glide(glide);
    processor.set_parameter("algorithm", p.value[0]); processor.set_parameter("decay", p.value[1]);
    processor.set_parameter("size", p.value[2]); processor.set_parameter("color", p.value[3]);
    processor.set_parameter("diffusion", p.value[4]); processor.set_parameter("motion", p.value[5]);
    processor.set_parameter("mix", p.value[6]); processor.process(data, frames);
  }
};

struct Grain {'''
    source = replace_once(source, r"struct Atmos \{.*?\n\};\n\nstruct Grain \{", atmos_replacement, "Atmos")

    source = source.replace(
        "explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), drift(sample_rate)",
        "explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), ember(sample_rate), drift(sample_rate), halo(sample_rate)",
        1,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(source, encoding="utf-8", newline="\n")
    print(f"generated {output_path} with live Ember, Drift, Halo, and Atmos parity processing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
