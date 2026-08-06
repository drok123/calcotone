from pathlib import Path

path = Path("scripts/stack-amp-audit.mjs")
source = path.read_text(encoding="utf-8")
old_source = "const stackEffect = read('src/audio/effects/StackAmp.ts');\n"
new_source = old_source + "const railC = read('src/components/effects/RailCModules.tsx');\n"
if old_source not in source:
    raise RuntimeError("Stack audit source anchor missing")
source = source.replace(old_source, new_source, 1)
old = '''if (!stackEffect.includes("model: 'calcotone'") || !stackEffect.includes("cabinet: '4x12'")) {
  failures.push('web Stack model/cabinet defaults drifted');
}
'''
new = '''if (!stackEffect.includes("const MODEL: ParameterDefinition = { id: 'model', label: 'Amp', min: 0, max: STACK_AMP_MODELS.length - 1, defaultValue: 5")
    || !stackEffect.includes("const CABINET: ParameterDefinition = { id: 'cabinet', label: 'Cabinet', min: 0, max: STACK_CABINETS.length - 1, defaultValue: 2")
    || !railC.includes("model: 'calcotone' as StackAmpModel")
    || !railC.includes("cabinet: '4x12' as StackCabinet")) {
  failures.push('web Stack model/cabinet defaults drifted');
}
'''
if old not in source:
    raise RuntimeError("stale Stack default assertion missing")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Aligned Stack default audit with numeric worklet parameters and Rail C labels.")
