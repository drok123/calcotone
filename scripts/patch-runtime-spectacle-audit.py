from pathlib import Path

path = Path('scripts/runtime-audit.mjs')
s = path.read_text()
s = s.replace(
    "requireText(viewport, '<PressureStyleDisplay module={module}', 'Module ASCII wiring');",
    "requireText(viewport, '<AsciiArtEngine kind=\"module\" module={module}', 'High-fidelity module ASCII wiring');\nrequireText(viewport, 'module-spectacle-ascii', 'Dedicated spectacle module surface');\nforbidText(viewport, 'PressureStyleDisplay', 'Retired low-density module renderer');",
)
s = s.replace(
    "requireText(pressureDisplay, 'display.reference1440p ? 30 : 24', 'Module display adaptive cadence');\nrequireText(pressureDisplay, 'canvasPixelRatio(width, height, 5_400_000)', 'Module display bounded high-DPI budget');\nrequireText(pressureDisplay, 'subscribeViewportAnimation(render)', 'Module display shared scheduler');\nrequireText(pressureDisplay, 'if (canvas.width !== pixelWidth)', 'Module display resize allocation guard');",
    "requireText(ascii, \"const MODULE_SHADE_RAMP = ' .:-=+*#%@'\", 'Module spectacle density ramp');\nrequireText(ascii, 'const MODULE_BAYER_4', 'Module spectacle ordered dithering');\nrequireText(ascii, 'function moduleEdgeGlyph', 'Module spectacle edge reconstruction');\nrequireText(ascii, 'const supersampled = (center * 3 + left + right + up + down) / 7', 'Module spectacle supersampling');",
)
path.write_text(s)
