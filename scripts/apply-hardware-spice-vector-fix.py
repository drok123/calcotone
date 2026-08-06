#!/usr/bin/env python3
"""Make strict hardware calibration sample-accurate and ngspice-parser stable."""

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
harness = replace_once(
    harness,
    "  return `min(1,max(-1,v(in)-${spiceNumber(comp)}*v(in)^3+${spiceNumber(asym)}*v(in)^2*(1-abs(v(in)))))`;",
    "  return `min(1,max(-1,v(in)-${spiceNumber(comp)}*v(in)*v(in)*v(in)+${spiceNumber(asym)}*v(in)*v(in)*(1-abs(v(in)))))`;",
    "summing-bus polynomial",
)
harness = replace_once(
    harness,
    "  const asymmetricSquare = `max(0,v(in))^2-0.42*max(0,-v(in))^2`;",
    "  const asymmetricSquare = `max(0,v(in))*max(0,v(in))-0.42*max(0,-v(in))*max(0,-v(in))`;",
    "transformer asymmetric square",
)
harness = replace_once(
    harness,
    "  return `min(1,max(-1,(tanh((v(in)+${spiceNumber(quantizedBias * 0.035)}+v(in)^2*${spiceNumber(even)})*${spiceNumber(safeDrive)})/tanh(${spiceNumber(safeDrive)}))*(1-min(0.085,abs(v(in))*${spiceNumber(0.045 * safeDrive)}))))`;",
    "  return `min(1,max(-1,(tanh((v(in)+${spiceNumber(quantizedBias * 0.035)}+v(in)*v(in)*${spiceNumber(even)})*${spiceNumber(safeDrive)})/tanh(${spiceNumber(safeDrive)}))*(1-min(0.085,abs(v(in))*${spiceNumber(0.045 * safeDrive)}))))`;",
    "ATR tape even-order term",
)
HARNESS.write_text(harness, encoding="utf-8", newline="\n")

required = (
    "wrdata {{OUTPUT_PATH}} v(in) v(out)",
    "const input = values.at(-2);",
    "v(in)*v(in)*v(in)",
    "max(0,v(in))*max(0,v(in))",
)
combined = template + "\n" + harness
missing = [token for token in required if token not in combined]
if missing:
    raise RuntimeError("hardware SPICE parser-stable contract missing: " + ", ".join(missing))

print("Hardware SPICE calibration uses captured vectors and explicit polynomial products.")
