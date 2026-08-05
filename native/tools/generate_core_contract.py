#!/usr/bin/env python3
"""Generate the native CALCOTONE core contract directly from the canonical JSON manifest."""

from __future__ import annotations

import json
import pathlib
import sys


def cpp_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def cpp_float(value: object) -> str:
    literal = f"{float(value):.9g}"
    if "." not in literal and "e" not in literal.lower():
        literal += ".0"
    return literal + "F"


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_core_contract.py <manifest.json> <output.hpp>", file=sys.stderr)
        return 2

    manifest_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    modules = manifest.get("modules")
    rails = manifest.get("rails")
    if not isinstance(modules, list) or not isinstance(rails, dict):
        raise ValueError("manifest must contain modules[] and rails{}")

    seen_ids: set[str] = set()
    module_rail_by_id: dict[str, str] = {}
    module_rows: list[str] = []
    model_arrays: list[str] = []
    control_arrays: list[str] = []

    for module in modules:
        module_id = module["id"]
        if module_id in seen_ids:
            raise ValueError(f"duplicate module id: {module_id}")
        seen_ids.add(module_id)
        module_rail_by_id[module_id] = module["rail"]

        models = module["models"]
        controls = module["controls"]
        default_model = module["defaultModel"]
        if default_model not in models:
            raise ValueError(f"{module_id}: defaultModel is not present in models")
        default_index = models.index(default_model)

        symbol = "k" + "".join(part.capitalize() for part in module_id.replace("-", "_").split("_"))
        model_arrays.append(
            f"inline constexpr std::array<std::string_view, {len(models)}> {symbol}Models{{{{\n"
            + "\n".join(f"  {cpp_string(model)}," for model in models)
            + "\n}};"
        )
        control_arrays.append(
            f"inline constexpr std::array<ControlContract, {len(controls)}> {symbol}Controls{{{{\n"
            + "\n".join(
                f"  {{{cpp_string(control['id'])}, {cpp_float(control['defaultUi'])}}},"
                for control in controls
            )
            + "\n}};"
        )
        module_rows.append(
            "  {"
            f"{cpp_string(module_id)}, {cpp_string(module['name'])}, '{module['rail']}', "
            f"{len(models)}, {default_index}, {len(controls)}"
            "},"
        )

    rail_arrays: list[str] = []
    rail_module_ids: list[str] = []
    for rail_name in ("A", "B", "C"):
        values = rails.get(rail_name)
        if not isinstance(values, list):
            raise ValueError(f"missing rail {rail_name}")
        for module_id in values:
            if module_id not in seen_ids:
                raise ValueError(f"rail {rail_name} references undefined module: {module_id}")
            if module_rail_by_id[module_id] != rail_name:
                raise ValueError(
                    f"rail {rail_name} contains {module_id}, declared for rail {module_rail_by_id[module_id]}"
                )
            rail_module_ids.append(module_id)
        rail_arrays.append(
            f"inline constexpr std::array<std::string_view, {len(values)}> kRail{rail_name}{{{{\n"
            + "\n".join(f"  {cpp_string(value)}," for value in values)
            + "\n}};"
        )

    if len(rail_module_ids) != len(set(rail_module_ids)):
        raise ValueError("a module appears in more than one rail slot")
    missing_from_rails = seen_ids.difference(rail_module_ids)
    if missing_from_rails:
        raise ValueError(f"modules missing from rails: {sorted(missing_from_rails)}")

    contract_version = f"manifest-v{manifest.get('schemaVersion', 0)}"
    source = f'''#pragma once

#include <array>
#include <cstddef>
#include <string_view>

namespace calcotone::contract {{

inline constexpr std::string_view kContractVersion = {cpp_string(contract_version)};

struct ModuleContract {{
  std::string_view id;
  std::string_view name;
  char rail;
  std::size_t model_count;
  std::size_t default_model_index;
  std::size_t control_count;
}};

struct ControlContract {{
  std::string_view id;
  float default_ui;
}};

{chr(10).join(model_arrays)}

{chr(10).join(control_arrays)}

inline constexpr std::array<ModuleContract, {len(modules)}> kCoreModules{{{{
{chr(10).join(module_rows)}
}}}};

{chr(10).join(rail_arrays)}

constexpr const ModuleContract* find_module(std::string_view id) noexcept {{
  for (const auto& module : kCoreModules) {{
    if (module.id == id) return &module;
  }}
  return nullptr;
}}

static_assert(kRailC.size() == 3);
static_assert(kRailC[0] == "stomp" && kRailC[1] == "chaos" && kRailC[2] == "pressure");

}}  // namespace calcotone::contract
'''

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(source, encoding="utf-8", newline="\n")
    print(f"Generated native core contract from {manifest_path} -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
