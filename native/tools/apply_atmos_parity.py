#!/usr/bin/env python3
"""Generate native_rack.cpp with the canonical Atmos parity processor wired live.

The legacy rack is intentionally monolithic. Until the remaining modules are split
into dedicated processors, this build-time transform replaces only its Atmos
implementation while leaving every other module byte-for-byte unchanged.
"""

from __future__ import annotations

import pathlib
import re
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: apply_atmos_parity.py INPUT OUTPUT", file=sys.stderr)
        return 2

    source_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    source = source_path.read_text(encoding="utf-8")

    include_anchor = '#include "calcotone/native_rack.hpp"\n'
    parity_include = '#include "calcotone/atmos_parity_processor.hpp"\n'
    if parity_include not in source:
        if include_anchor not in source:
            raise RuntimeError("native rack include anchor was not found")
        source = source.replace(include_anchor, include_anchor + parity_include, 1)

    replacement = r'''struct Atmos {
  Params p{2.F, 2.4F, .52F, .42F, .74F, .18F, .13F};
  AtmosParityProcessor processor;

  explicit Atmos(float rate) : processor(rate) {}

  void process(float* data, std::size_t frames, float rate) noexcept {
    const float glide = 1.F - std::exp(-1.F / (rate * .16F));
    p.glide(glide);
    processor.set_parameter("algorithm", p.value[0]);
    processor.set_parameter("decay", p.value[1]);
    processor.set_parameter("size", p.value[2]);
    processor.set_parameter("color", p.value[3]);
    processor.set_parameter("diffusion", p.value[4]);
    processor.set_parameter("motion", p.value[5]);
    processor.set_parameter("mix", p.value[6]);
    processor.process(data, frames);
  }
};

struct Grain {'''

    pattern = re.compile(r"struct Atmos \{.*?\n\};\n\nstruct Grain \{", re.DOTALL)
    source, count = pattern.subn(replacement, source, count=1)
    if count != 1:
        raise RuntimeError(f"expected exactly one legacy Atmos block, replaced {count}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(source, encoding="utf-8", newline="\n")
    print(f"generated {output_path} with live Atmos parity processing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
