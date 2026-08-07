from pathlib import Path

path = Path('scripts/tighten-loop.py')
text = path.read_text(encoding='utf-8')
old = '''    if old not in text:\n        raise RuntimeError(f'{path}: exact anchor not found: {old[:120]!r}')\n    target.write_text(text.replace(old, new, 1), encoding='utf-8')\n'''
new = '''    if old not in text:\n        if path == 'native/src/wasapi_host.cpp' and 'expected loop record|overdub|play|clear' in old:\n            pattern = r'      if \\(name == "loop"\\) \\{.*?\\n      \\}\\n(?=      if \\(name == "loopParam"\\))'\n            next_text, count = re.subn(pattern, new, text, count=1, flags=re.S)\n            if count != 1:\n                raise RuntimeError(f'{path}: fallback Loop command block matched {count} times')\n            target.write_text(next_text, encoding='utf-8')\n            return\n        raise RuntimeError(f'{path}: exact anchor not found: {old[:120]!r}')\n    target.write_text(text.replace(old, new, 1), encoding='utf-8')\n'''
if old not in text:
    raise SystemExit('replace_exact helper anchor not found')
text = text.replace(old, new, 1)
text = text.replace("forbidText(random, \"'pressure'\", 'Loop excluded from RANDOM registry');", "requireText(random, \"RAIL_C_RANDOM_ORDER = ['stomp', 'chaos']\", 'Loop excluded from RANDOM registry');")

marker = "print('Loop usability patch applied.')\n"
audit_patch = r'''# Teach the legacy signal audit that the four physical Loop knobs deliberately
# change legends while TRIM is active without changing the approved geometry.
replace_exact('scripts/signal-lab-audit.mjs',
'''requireText(railC, "const knobLabels = ['Track', 'Loop', 'Overdub', 'Fade']", 'Loop four macro controls');\n''',
'''requireText(railC, "['Track', 'Loop', 'Overdub', 'Fade']", 'Loop normal macro controls');\nrequireText(railC, "['IN', 'OUT', 'Track', 'Fade']", 'Loop trim macro controls');\nrequireText(railC, 'trimEditing ?', 'Loop trim macro switch');\n''')

'''
if marker not in text:
    raise SystemExit('Loop patch completion marker not found')
text = text.replace(marker, audit_patch + marker, 1)
path.write_text(text, encoding='utf-8')
print('Hardened Loop patch anchors and trim audit contract.')
