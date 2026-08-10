#!/usr/bin/env python3
"""Generate native_rack.cpp with the remaining completed parity processors wired live.

Atmos is now wired canonically in native/src/native_rack.cpp and is intentionally
left untouched here. The legacy filename is retained for build compatibility while
Ember, Drift, Halo, Grain, Artifact, and Stomp continue through the established
parity-wrapper generation path.
"""

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
        '#include "calcotone/ember_parity_processor.hpp"\n'
        '#include "calcotone/drift_parity_processor.hpp"\n'
        '#include "calcotone/halo_parity_processor.hpp"\n'
        '#include "calcotone/grain_parity_processor.hpp"\n'
        '#include "calcotone/artifact_parity_processor.hpp"\n'
        '#include "calcotone/stomp_parity_processor.hpp"\n'
    )
    if '#include "calcotone/ember_parity_processor.hpp"' not in source:
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
};'''
    source = replace_once(
        source,
        r"struct Halo \{.*?\n\};(?=\n\n// Atmos DSP is owned exclusively)",
        halo_replacement,
        "Halo",
    )

    # Atmos is deliberately not rewritten here. native/src/native_rack.cpp owns the
    # canonical AtmosParityProcessor instance and routes both parameters and audio to it.

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
  ArtifactParityProcessor processor;
  explicit Artifact(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("wear", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("wow", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("noise", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("tone", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[5].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};

struct Stomp {'''
    source = replace_once(source, r"struct Artifact \{.*?\n\};\n\nstruct Stomp \{", artifact_replacement, "Artifact")

    stomp_replacement = r'''struct Stomp {
  Params p{0.F, .38F, .54F, .68F, .42F, .52F, 1.F};
  StompParityProcessor processor;
  explicit Stomp(float rate) : processor(rate) {}
  void process(float* data, std::size_t frames, float) noexcept {
    processor.set_parameter("mode", p.target[0].load(std::memory_order_relaxed));
    processor.set_parameter("drive", p.target[1].load(std::memory_order_relaxed));
    processor.set_parameter("tone", p.target[2].load(std::memory_order_relaxed));
    processor.set_parameter("level", p.target[3].load(std::memory_order_relaxed));
    processor.set_parameter("character", p.target[4].load(std::memory_order_relaxed));
    processor.set_parameter("body", p.target[5].load(std::memory_order_relaxed));
    processor.set_parameter("mix", p.target[6].load(std::memory_order_relaxed));
    processor.process(data, frames);
  }
};'''
    source = replace_once(source, r"struct Stomp \{.*?\n\};\n\}  // namespace", stomp_replacement + "\n}  // namespace", "Stomp")
    source = source.replace("artifact(sample_rate) {", "artifact(sample_rate), stomp(sample_rate) {", 1)

    source = source.replace(
        "explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), drift(sample_rate)",
        "explicit Impl(float rate) : sample_rate(std::clamp(rate, 8000.F, 384000.F)), ember(sample_rate), drift(sample_rate)",
        1,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(source, encoding="utf-8", newline="\n")
    print(f"generated {output_path} with live Ember, Drift, Halo, Grain, Artifact, and Stomp parity; Atmos remains canonical source")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
