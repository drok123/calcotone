from __future__ import annotations

import json
from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


manifest_path = Path("contracts/calcotone-core-manifest.json")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["schemaVersion"] = 2
existing = {module["id"] for module in manifest["modules"]}
rail_c_modules = [
    {
        "id": "stomp",
        "name": "Stomp",
        "rail": "C",
        "defaultModel": "808 Overdrive",
        "modelOrderSymbol": "STOMP_MODE_LABELS",
        "models": [
            "808 Overdrive", "RAT Distortion", "Big Muff", "Fuzz Face", "DS-1 Distortion",
            "Blues Driver", "Gold Horse", "Swedish Chainsaw", "Metal Zone", "Octavia",
            "Rangemaster", "Cry Baby Wah", "Whammy Octave", "Dyna Comp",
        ],
        "controls": [
            {"id": "drive", "defaultUi": 0.38},
            {"id": "tone", "defaultUi": 0.54},
            {"id": "level", "defaultUi": 0.68},
            {"id": "character", "defaultUi": 0.42},
            {"id": "body", "defaultUi": 0.52},
            {"id": "mix", "defaultUi": 1.0},
        ],
    },
    {
        "id": "chaos",
        "name": "Stack",
        "rail": "C",
        "defaultModel": "calcotone",
        "modelOrderSymbol": "STACK_AMP_MODELS",
        "models": ["blackface", "ac30", "plexi", "svt", "model-t", "calcotone"],
        "controls": [
            {"id": "cabinet", "defaultUi": 2.0},
            {"id": "drive", "defaultUi": 0.36},
            {"id": "tone", "defaultUi": 0.52},
            {"id": "sag", "defaultUi": 0.34},
            {"id": "mix", "defaultUi": 0.62},
        ],
    },
    {
        "id": "pressure",
        "name": "Pressure",
        "rail": "C",
        "defaultModel": "fet",
        "modelOrderSymbol": "SIGNAL_LAB_MODES",
        "models": ["fet", "opto", "varimu", "vca"],
        "controls": [
            {"id": "style", "defaultUi": 2.0},
            {"id": "drive", "defaultUi": 0.42},
            {"id": "time", "defaultUi": 0.46},
            {"id": "character", "defaultUi": 0.38},
            {"id": "mix", "defaultUi": 0.72},
        ],
    },
]
for module in rail_c_modules:
    if module["id"] not in existing:
        manifest["modules"].append(module)
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


generator_path = Path("native/tools/generate_core_contract.py")
generator = generator_path.read_text(encoding="utf-8")
generator = replace_required(
    generator,
    "    seen_ids: set[str] = set()\n    module_rows: list[str] = []\n",
    "    seen_ids: set[str] = set()\n    module_rail_by_id: dict[str, str] = {}\n    module_rows: list[str] = []\n",
    "module rail map",
)
generator = replace_required(
    generator,
    "        seen_ids.add(module_id)\n\n        models = module[\"models\"]\n",
    "        seen_ids.add(module_id)\n        module_rail_by_id[module_id] = module[\"rail\"]\n\n        models = module[\"models\"]\n",
    "record module rail",
)
generator = replace_required(
    generator,
    "    rail_arrays: list[str] = []\n    for rail_name in (\"A\", \"B\", \"C\"):\n",
    "    rail_arrays: list[str] = []\n    rail_module_ids: list[str] = []\n    for rail_name in (\"A\", \"B\", \"C\"):\n",
    "rail membership accumulator",
)
generator = replace_required(
    generator,
    "        if not isinstance(values, list):\n            raise ValueError(f\"missing rail {rail_name}\")\n        rail_arrays.append(\n",
    "        if not isinstance(values, list):\n            raise ValueError(f\"missing rail {rail_name}\")\n        for module_id in values:\n            if module_id not in seen_ids:\n                raise ValueError(f\"rail {rail_name} references undefined module: {module_id}\")\n            if module_rail_by_id[module_id] != rail_name:\n                raise ValueError(\n                    f\"rail {rail_name} contains {module_id}, declared for rail {module_rail_by_id[module_id]}\"\n                )\n            rail_module_ids.append(module_id)\n        rail_arrays.append(\n",
    "validate rail references",
)
generator = replace_required(
    generator,
    "    contract_version = f\"manifest-v{manifest.get('schemaVersion', 0)}\"\n",
    "    if len(rail_module_ids) != len(set(rail_module_ids)):\n        raise ValueError(\"a module appears in more than one rail slot\")\n    missing_from_rails = seen_ids.difference(rail_module_ids)\n    if missing_from_rails:\n        raise ValueError(f\"modules missing from rails: {sorted(missing_from_rails)}\")\n\n    contract_version = f\"manifest-v{manifest.get('schemaVersion', 0)}\"\n",
    "complete rail membership validation",
)
generator_path.write_text(generator, encoding="utf-8")


audit = r'''import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const compact = (source) => source.replace(/\s+/g, '');
const manifest = JSON.parse(read('contracts/calcotone-core-manifest.json'));
const app = read('src/App.tsx');
const nativeRack = read('native/src/native_rack.cpp');
const railC = read('src/components/effects/RailCModules.tsx');
const stackSource = read('src/audio/effects/StackAmp.ts');
const pressureSource = read('src/audio/SignalLab.ts');
const stompNative = read('native/src/stomp_parity_processor.cpp');
const stompHeader = read('native/include/calcotone/stomp_parity_processor.hpp');
const stackNative = read('native/src/stack_amp.cpp');

const sourceByModule = {
  saturation: read('src/audio/effects/Saturation.ts'),
  chorus: read('src/audio/effects/Chorus.ts'),
  delay: read('src/audio/effects/Delay.ts'),
  reverb: read('src/audio/effects/Reverb.ts'),
  bitcrusher: read('src/audio/effects/Bitcrusher.ts'),
  media: read('src/audio/effects/Media.ts'),
  stomp: railC,
  chaos: stackSource,
  pressure: pressureSource,
};

const modelFieldByModule = {
  saturation: 'emberMode', chorus: 'driftMode', delay: 'delayAlgorithm',
  reverb: 'algorithm', bitcrusher: 'grainMode', media: 'mediaMode',
};
const nativeStructByModule = {
  saturation: 'Ember', chorus: 'Drift', delay: 'Halo', reverb: 'Atmos',
  bitcrusher: 'Grain', media: 'Artifact',
};

const failures = [];
const pass = [];
const check = (condition, label) => (condition ? pass : failures).push(label);
const quotedValues = (source) => [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
function extractOrder(source, symbol) {
  const pattern = new RegExp(`export const ${symbol}[^=]*=\\s*\\[([\\s\\S]*?)\\](?:\\s*as const)?;`);
  const match = source.match(pattern);
  return match ? quotedValues(match[1]) : null;
}
function extractModuleBlock(moduleId) {
  const marker = `id: '${moduleId}',`;
  const start = app.indexOf(marker);
  if (start < 0) return null;
  const next = app.indexOf("\n  {\n    id: '", start + marker.length);
  return app.slice(start, next < 0 ? app.length : next);
}
const arraysEqual = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

const manifestById = new Map(manifest.modules.map((module) => [module.id, module]));
const railMembers = [];
for (const [rail, expected] of Object.entries(manifest.rails)) {
  const symbol = `DEFAULT_RAIL_${rail}_ORDER`;
  const match = app.match(new RegExp(`const ${symbol} = \\[([^\\]]+)\\] as const;`));
  const actual = match ? quotedValues(match[1]) : [];
  check(arraysEqual(actual, expected), `${symbol} matches canonical manifest`);
  for (const moduleId of expected) {
    railMembers.push(moduleId);
    const module = manifestById.get(moduleId);
    check(Boolean(module), `rail ${rail} module ${moduleId} is defined`);
    if (module) check(module.rail === rail, `${moduleId} declares rail ${rail}`);
  }
}
check(new Set(railMembers).size === railMembers.length, 'each module occupies one rail slot');
check(manifest.modules.every((module) => railMembers.includes(module.id)), 'every manifest module occupies a rail slot');

for (const module of manifest.modules) {
  const source = sourceByModule[module.id];
  check(Boolean(source), `${module.name} canonical source exists`);
  const order = source ? extractOrder(source, module.modelOrderSymbol) : null;
  check(Array.isArray(order), `${module.name} exports ${module.modelOrderSymbol}`);
  if (order) check(arraysEqual(order, module.models), `${module.name} model order and stable indices`);

  if (module.rail !== 'C') {
    const block = extractModuleBlock(module.id);
    check(Boolean(block), `${module.name} exists in INITIAL_MODULES`);
    if (block) {
      const field = modelFieldByModule[module.id];
      check(block.includes(`${field}: '${module.defaultModel}'`), `${module.name} default model`);
      check(block.includes(`name: '${module.name}'`), `${module.name} product label`);
      for (const control of module.controls) {
        const escaped = String(control.defaultUi).replace('.', '\\.');
        const pattern = new RegExp(`id: '${control.id}'[\\s\\S]{0,90}?value: ${escaped}(?:[,}])`);
        check(pattern.test(block), `${module.name}.${control.id} UI default ${control.defaultUi}`);
      }
    }
    const nativeStruct = nativeStructByModule[module.id];
    check(nativeRack.includes(`struct ${nativeStruct}`), `${module.name} native processor exists`);
    check(nativeRack.includes(`std::min(${module.models.length - 1}U`)
      || nativeRack.includes(`std::min(${module.models.length - 1}u`),
      `${module.name} native model-index ceiling ${module.models.length - 1}`);
    continue;
  }

  if (module.id === 'stomp') {
    check(railC.includes('name="Stomp"'), 'Stomp product label');
    check(compact(railC).includes("mode:0,inputSource:'input-2'asStackInputSource,presetId:'classic',values:[.38,.54,.68,.42,.52,1]"), 'Stomp UI defaults');
    check(module.defaultModel === module.models[0], 'Stomp default model index 0');
    check(stompHeader.includes('kStompModeCount = 14U'), 'Stomp native model count 14');
    check(stompNative.includes('std::clamp(std::round(value), 0.F, 13.F)'), 'Stomp native model-index ceiling 13');
    check(stompNative.includes("target{0.F,.38F,.54F,.68F,.42F,.52F,1.F}"), 'Stomp native control defaults');
  } else if (module.id === 'chaos') {
    check(railC.includes('name="Stack"'), 'Stack product label');
    check(compact(railC).includes("model:'calcotone'asStackAmpModel,cabinet:'4x12'asStackCabinet,inputSource:'input-2'asStackInputSource,values:[0.36,0.52,0.34,0.62]"), 'Stack UI defaults');
    check(stackNative.includes('std::min(static_cast<unsigned>(value), 5U)'), 'Stack native model-index ceiling 5');
    check(stackNative.includes('std::min(static_cast<unsigned>(value), 4U)'), 'Stack native cabinet-index ceiling 4');
    check(stackNative.includes('std::copy(kModels[5]') && stackNative.includes('std::copy(kCabs[2]'), 'Stack native model and cabinet defaults');
  } else if (module.id === 'pressure') {
    check(railC.includes('name="Pressure"'), 'Pressure product label');
    check(compact(pressureSource).includes("enabled:false,mode:'fet',style:'glue',drive:0.42,time:0.46,character:0.38,mix:0.72"), 'Pressure UI defaults');
    check(nativeRack.includes('struct NativePressure::Impl'), 'Pressure native processor exists');
    check(nativeRack.includes('Params p{0.F, 2.F, .42F, .46F, .38F, .72F}'), 'Pressure native defaults');
    check(nativeRack.includes('std::min(3U') && nativeRack.includes('name=="style"'), 'Pressure native model/style ceilings');
  }
}

check(!app.includes("moduleId === 'synth'"), 'retired Synth module branch absent from checked-in App');
check(!app.includes('SynthModule'), 'retired Synth component absent from checked-in App');
check(!app.includes('onSynthEnabledChange'), 'retired Synth callback contract absent from checked-in App');
check(app.includes("DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure']"), 'Rail C is Stomp → Stack → Pressure');

for (const label of pass) console.log(`PASS: ${label}`);
if (failures.length) {
  for (const label of failures) console.error(`FAIL: ${label}`);
  console.error(`Core contract parity audit failed: ${failures.length} mismatch(es).`);
  process.exit(1);
}
console.log(`Core contract parity audit passed (${pass.length} contracts).`);
'''
Path("scripts/core-contract-parity-audit.mjs").write_text(audit, encoding="utf-8")


core_test = r'''#include "calcotone/core_contract.hpp"

#include <cmath>
#include <cstdlib>
#include <iostream>

namespace {
bool near(float left, float right, float tolerance = 1.0e-6F) {
  return std::abs(left - right) <= tolerance;
}
}  // namespace

int main() {
  using namespace calcotone::contract;

  if (kContractVersion != "manifest-v2") return EXIT_FAILURE;
  if (kCoreModules.size() != 9) return EXIT_FAILURE;
  if (kRailA.size() != 3 || kRailB.size() != 3 || kRailC.size() != 3) return EXIT_FAILURE;

  const auto* ember = find_module("saturation");
  const auto* drift = find_module("chorus");
  const auto* halo = find_module("delay");
  const auto* atmos = find_module("reverb");
  const auto* grain = find_module("bitcrusher");
  const auto* artifact = find_module("media");
  const auto* stomp = find_module("stomp");
  const auto* stack = find_module("chaos");
  const auto* pressure = find_module("pressure");

  if (!ember || ember->name != "Ember" || ember->model_count != 18 || ember->control_count != 6) return EXIT_FAILURE;
  if (!drift || drift->name != "Drift" || drift->model_count != 22 || drift->control_count != 6) return EXIT_FAILURE;
  if (!halo || halo->name != "Halo" || halo->model_count != 12 || halo->default_model_index != 1) return EXIT_FAILURE;
  if (!atmos || atmos->name != "Atmos" || atmos->model_count != 12 || atmos->default_model_index != 2) return EXIT_FAILURE;
  if (!grain || grain->name != "Grain" || grain->model_count != 12 || grain->default_model_index != 2) return EXIT_FAILURE;
  if (!artifact || artifact->name != "Artifact" || artifact->model_count != 14 || artifact->control_count != 5) return EXIT_FAILURE;
  if (!stomp || stomp->name != "Stomp" || stomp->rail != 'C' || stomp->model_count != 14 || stomp->default_model_index != 0) return EXIT_FAILURE;
  if (!stack || stack->name != "Stack" || stack->rail != 'C' || stack->model_count != 6 || stack->default_model_index != 5) return EXIT_FAILURE;
  if (!pressure || pressure->name != "Pressure" || pressure->rail != 'C' || pressure->model_count != 4 || pressure->default_model_index != 0) return EXIT_FAILURE;

  if (kSaturationModels.front() != "velvet" || kSaturationModels.back() != "fairlightiix") return EXIT_FAILURE;
  if (kChorusModels[8] != "ce1" || kChorusModels.back() != "pn2") return EXIT_FAILURE;
  if (kDelayModels[1] != "tape" || kDelayModels.back() != "AMS DMX 15-80 S") return EXIT_FAILURE;
  if (kReverbModels[2] != "hall" || kReverbModels.back() != "lexicon224") return EXIT_FAILURE;
  if (kBitcrusherModels[2] != "smear" || kBitcrusherModels.back() != "microcosm") return EXIT_FAILURE;
  if (kMediaModels.front() != "cassette" || kMediaModels.back() != "Neve BCM10") return EXIT_FAILURE;
  if (kStompModels.front() != "808 Overdrive" || kStompModels.back() != "Dyna Comp") return EXIT_FAILURE;
  if (kChaosModels.front() != "blackface" || kChaosModels.back() != "calcotone") return EXIT_FAILURE;
  if (kPressureModels.front() != "fet" || kPressureModels.back() != "vca") return EXIT_FAILURE;

  if (kSaturationControls[0].id != "drive" || !near(kSaturationControls[0].default_ui, .14F)) return EXIT_FAILURE;
  if (kMediaControls.size() != 5 || kMediaControls.back().id != "mix" || !near(kMediaControls.back().default_ui, .26F)) return EXIT_FAILURE;
  if (kStompControls.size() != 6 || kStompControls[0].id != "drive" || !near(kStompControls[0].default_ui, .38F)) return EXIT_FAILURE;
  if (kChaosControls.size() != 5 || kChaosControls[0].id != "cabinet" || !near(kChaosControls[0].default_ui, 2.F)) return EXIT_FAILURE;
  if (kPressureControls.size() != 5 || kPressureControls[0].id != "style" || !near(kPressureControls[0].default_ui, 2.F)) return EXIT_FAILURE;

  if (kRailC[0] != "stomp" || kRailC[1] != "chaos" || kRailC[2] != "pressure") return EXIT_FAILURE;
  if (find_module("synth") != nullptr) return EXIT_FAILURE;

  std::cout << "CALCOTONE generated native full-rack contract " << kContractVersion << " passed\n";
  return EXIT_SUCCESS;
}
'''
Path("native/tests/core_contract_test.cpp").write_text(core_test, encoding="utf-8")

print("Expanded the canonical generated contract to all nine rack modules.")
