#!/usr/bin/env python3
"""Generate the native Ember tube profile table from the canonical AudioWorklet.

The JavaScript worklet remains the calibration source of truth. This generator
extracts its numeric TUBE_PROFILES array and emits a constexpr C++ header so the
Windows engine cannot silently drift to a second set of tube constants.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

FIELDS = (
    "mu", "supply", "plateLoad", "bias",
    "gain", "softness", "biasMemory", "recovery", "sag", "plateMemory", "characterRange",
    "cathode", "blocking", "gridHeadroom", "thermal", "mismatch",
    "supplyStiffness", "sagAttack", "colorBase", "colorDrive", "colorHeat", "colorCharacter", "colorCeiling",
    "biasAttack", "biasAttackHeat", "biasRelease", "biasReleaseDynamics", "biasReleaseRecovery",
    "staticBias", "heatCurve", "driveCurve",
    "cathodeDrive", "cathodeDriveMod", "cathodeAttack", "cathodeHeatAttack", "cathodeRelease", "cathodeRecovery",
    "cathodeBiasBase", "cathodeBiasDynamics", "blockingAttack", "blockingRelease", "blockingRecovery", "blockingCeiling", "blockingBias",
    "plateCurrentScale", "plateCathodeCoupling", "plateAttack", "plateRelease", "plateCompression", "plateCompressionCeiling",
    "localSagBase", "localSagDynamics", "localSagCathode", "localSagSupply", "localSagCeiling",
    "harmonicDrive", "evenHarmonic", "plateFollowBase", "plateFollowMemory",
)


def extract_profiles(source: str) -> list[dict[str, float]]:
    marker = "const TUBE_PROFILES = ["
    start = source.find(marker)
    if start < 0:
        raise RuntimeError("TUBE_PROFILES marker was not found")
    start += len("const TUBE_PROFILES = ")
    end = source.find("\n];", start)
    if end < 0:
        raise RuntimeError("TUBE_PROFILES closing bracket was not found")
    payload = source[start:end + 2]
    payload = re.sub(r"//[^\n]*", "", payload)
    payload = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', payload)
    payload = re.sub(r",\s*([}\]])", r"\1", payload)
    parsed = json.loads(payload)
    if not isinstance(parsed, list) or len(parsed) != 5:
        raise RuntimeError(f"expected five tube profiles, found {len(parsed) if isinstance(parsed, list) else 'non-list'}")
    for index, profile in enumerate(parsed):
        if not isinstance(profile, dict):
            raise RuntimeError(f"profile {index} is not an object")
        missing = [field for field in FIELDS if field not in profile]
        extra = sorted(set(profile) - set(FIELDS))
        if missing or extra:
            raise RuntimeError(f"profile {index} schema mismatch; missing={missing}, extra={extra}")
        if any(not isinstance(profile[field], (int, float)) for field in FIELDS):
            raise RuntimeError(f"profile {index} contains a non-numeric calibration value")
    return parsed


def cpp_float(value: float) -> str:
    rendered = format(float(value), ".10g")
    if "e" not in rendered.lower() and "." not in rendered:
        rendered += ".0"
    return rendered + "F"


def generate(profiles: list[dict[str, float]]) -> str:
    field_lines = "\n".join(f"  float {re.sub(r'(?<!^)(?=[A-Z])', '_', field).lower()}{{}};" for field in FIELDS)
    rows = []
    for profile in profiles:
        values = ", ".join(cpp_float(profile[field]) for field in FIELDS)
        rows.append(f"  {{{values}}}")
    rows_text = ",\n".join(rows)
    return f'''#pragma once

#include <array>

namespace calcotone {{

// Generated from public/ember-tube-processor.js. Do not hand-edit.
struct EmberTubeElectricalProfile {{
{field_lines}
}};

inline constexpr std::array<EmberTubeElectricalProfile, 5> kEmberTubeElectricalProfiles{{{{
{rows_text}
}}}};

}}  // namespace calcotone
'''


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_ember_tube_profiles.py INPUT_JS OUTPUT_HPP", file=sys.stderr)
        return 2
    source_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    profiles = extract_profiles(source_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(generate(profiles), encoding="utf-8", newline="\n")
    print(f"generated {output_path} from {source_path} ({len(profiles)} profiles)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
