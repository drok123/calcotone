#!/usr/bin/env python3
from pathlib import Path

path = Path('src/components/ascii/AsciiArtEngine.tsx')
source = path.read_text(encoding='utf-8')

replacements = [
    (
        "import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';\n",
        "import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';\n"
        "import { canvasPixelRatio, getDisplayProfile } from '../../ui/displayProfile';\n",
        'display profile import',
    ),
    (
        "    let dpr = Math.min(1.35, window.devicePixelRatio || 1);\n",
        "    let dpr = canvasPixelRatio(1, 1, 6_400_000);\n",
        'initial DPR',
    ),
    (
        "      dpr = Math.min(1.35, window.devicePixelRatio || 1);\n",
        "      dpr = canvasPixelRatio(width, height, 6_400_000);\n",
        'resize DPR',
    ),
    (
        "      const scene = sceneRef.current;\n"
        "      const interval = scene.kind === 'landscape' && scene.dragging\n"
        "        ? 1000 / 30\n"
        "        : scene.active\n"
        "          ? 1000 / 18\n"
        "          : 250;\n",
        "      const scene = sceneRef.current;\n"
        "      const profile = getDisplayProfile();\n"
        "      const interval = scene.kind === 'landscape' && scene.dragging\n"
        "        ? 1000 / profile.visualFps\n"
        "        : scene.active\n"
        "          ? 1000 / (profile.reference1440p ? 30 : 24)\n"
        "          : 250;\n",
        'adaptive render interval',
    ),
]

for old, new, label in replacements:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one {label}, found {count}')
    source = source.replace(old, new, 1)

path.write_text(source, encoding='utf-8', newline='\n')
Path('scripts/agent-apply-hd-ascii-patch.py').unlink(missing_ok=True)
Path('.github/workflows/agent-apply-hd-ascii-patch.yml').unlink(missing_ok=True)
print('patched AsciiArtEngine for adaptive high-DPI rendering')
