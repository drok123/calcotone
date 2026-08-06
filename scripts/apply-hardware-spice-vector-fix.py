#!/usr/bin/env python3
"""Make the strict hardware calibration compare actual ngspice input/output vectors."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "circuits/modules/static-hardware-stage-template.cir"
HARNESS = ROOT / "scripts/hardware-spice-calibration.mjs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


template = TEMPLATE.read_text(encoding="utf-8")
template = replace_once(
    template,
    "wrdata {{OUTPUT_PATH}} v(out)",
    "wrdata {{OUTPUT_PATH}} v(in) v(out)",
    "SPICE input/output export",
)
TEMPLATE.write_text(template, encoding="utf-8", newline="\n")

harness = HARNESS.read_text(encoding="utf-8")
harness = replace_once(
    harness,
    "    if (values.length < 2 || values.some((value) => !Number.isFinite(value))) continue;",
    "    if (values.length < 3 || values.some((value) => !Number.isFinite(value))) continue;",
    "SPICE vector column guard",
)
harness = replace_once(
    harness,
    "    const actual = values.at(-1);\n    const input = Math.sin(Math.PI * 2 * testCase.frequency * time) * testCase.amplitude;",
    "    const input = values.at(-2);\n    const actual = values.at(-1);",
    "captured SPICE input comparison",
)
HARNESS.write_text(harness, encoding="utf-8", newline="\n")

if "wrdata {{OUTPUT_PATH}} v(in) v(out)" not in template:
    raise RuntimeError("SPICE deck did not retain both vectors")
if "const input = values.at(-2);" not in harness:
    raise RuntimeError("hardware calibration did not retain captured-input comparison")

print("Hardware SPICE calibration now compares captured v(in) against v(out).")
