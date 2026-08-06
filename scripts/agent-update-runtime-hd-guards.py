#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/runtime-audit.mjs')
source = path.read_text(encoding='utf-8')

old = """requireText(ascii, '1000 / 18', 'ASCII bounded active cadence');
requireText(ascii, 'Math.min(1.35, window.devicePixelRatio', 'ASCII pixel-density cap');
"""
new = """requireText(ascii, 'profile.reference1440p ? 30 : 24', 'ASCII adaptive active cadence');
requireText(ascii, 'canvasPixelRatio(width, height, 6_400_000)', 'ASCII bounded high-DPI budget');
requireText(pressureDisplay, 'display.reference1440p ? 30 : 24', 'Module display adaptive cadence');
requireText(pressureDisplay, 'canvasPixelRatio(width, height, 5_400_000)', 'Module display bounded high-DPI budget');
"""

count = source.count(old)
if count != 1:
    raise RuntimeError(f'expected exactly one legacy runtime visual guard block, found {count}')
source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8', newline='\n')

Path('scripts/agent-update-runtime-hd-guards.py').unlink(missing_ok=True)
Path('.github/workflows/agent-update-runtime-hd-guards.yml').unlink(missing_ok=True)
print('updated runtime audit for adaptive HD visual limits')
