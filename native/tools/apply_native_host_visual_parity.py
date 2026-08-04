#!/usr/bin/env python3
from __future__ import annotations
import pathlib
import sys


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"expected one {label} anchor, found {count}")
    return source.replace(old, new, 1)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: apply_native_host_visual_parity.py INPUT OUTPUT", file=sys.stderr)
        return 2
    source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    source = replace_once(
        source,
        '#include "calcotone/native_processor.hpp"\n',
        '#include "calcotone/native_processor.hpp"\n#include "calcotone/native_visual_spectrum.hpp"\n',
        'visual include',
    )
    source = replace_once(
        source,
        '    calcotone::NativeProcessor processor(sample_rate);\n    NativeRecorder recorder(sample_rate);',
        '    calcotone::NativeProcessor processor(sample_rate);\n    calcotone::NativeVisualSpectrum visual_spectrum;\n    NativeRecorder recorder(sample_rate);',
        'visual instance',
    )
    source = replace_once(
        source,
        '      if (line == "health" || line == "stats") {',
        '      if (line == "spectrum") return visual_spectrum.json();\n      if (line == "health" || line == "stats") {',
        'spectrum command',
    )
    source = replace_once(
        source,
        '          processor.process(process->capture_input.data(), process->mixed_output.data(), block);\n          recorder.capture(process->mixed_output.data(), block);',
        '          processor.process(process->capture_input.data(), process->mixed_output.data(), block);\n          visual_spectrum.publish(process->mixed_output.data(), block);\n          recorder.capture(process->mixed_output.data(), block);',
        'spectrum publish',
    )
    pathlib.Path(sys.argv[2]).write_text(source, encoding="utf-8", newline="\n")
    print(f"generated {sys.argv[2]} with native visual spectrum parity")
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
