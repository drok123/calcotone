from pathlib import Path

path = Path('src/components/effects/EffectModule.tsx')
text = path.read_text()
replacements = [
    ('function renderKnob(parameter: ModuleParameter, index: number)', 'function renderKnob(parameter: ModuleParameter)'),
    ('if (!customFaceplate) return renderKnob(parameter, index);', 'if (!customFaceplate) return renderKnob(parameter);'),
    ('{renderKnob(parameter, index)}', '{renderKnob(parameter)}'),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old!r}')
    text = text.replace(old, new, 1)
path.write_text(text)
