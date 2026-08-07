from pathlib import Path

path = Path('src/components/ascii/RailCHardwareDisplay.tsx')
text = path.read_text(encoding='utf-8')

old_import = "import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';\nimport './PressureStyleDisplay.css';"
new_import = "import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';\nimport { getLoopState, LOOP_TRACK_COUNT } from '../signal/loopStore';\nimport './PressureStyleDisplay.css';"
if old_import not in text:
    raise SystemExit('Loop display import anchor missing')
text = text.replace(old_import, new_import, 1)

old_state = """  const activity = props.enabled ? clamp01(props.visualState.level * 0.72 + props.visualState.transient * 0.28) : 0;\n\n  context.setTransform(dpr, 0, 0, dpr, 0, 0);"""
new_state = """  const activity = props.enabled ? clamp01(props.visualState.level * 0.72 + props.visualState.transient * 0.28) : 0;\n  // Loopy-inspired motion language, translated into Calcotone hardware ASCII:\n  // eight circular clip orbits, one accurate selected-track wiper, and no\n  // imitation of Loopy Pro's colors, controls, layout, or branded appearance.\n  const loopState = props.kind === 'loop' ? getLoopState() : null;\n  const loopSelectedTrack = loopState?.selectedTrack ?? 0;\n  const loopTrackMask = loopState?.trackMask ?? 0;\n  const loopTransport = loopState?.transport ?? 'empty';\n  const loopSelectedProgress = clamp01(props.loopProgress ?? 0);\n\n  context.setTransform(dpr, 0, 0, dpr, 0, 0);"""
if old_state not in text:
    raise SystemExit('Loop display state anchor missing')
text = text.replace(old_state, new_state, 1)

old_block = """      } else {\n        const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;\n        for (let column = 0; column < innerWidth; column += 1) {\n          const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;\n          const normalized = clamp01(field(props.kind, x, y, drawPhase, props.visualState));\n          if (!props.enabled && normalized < 0.72) continue;\n          if (normalized < 0.22) continue;\n          const glyphIndex = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));\n          chars[column] = profile.glyphs[glyphIndex] ?? ' ';\n          if (normalized > 0.76 && (column + row) % 13 === 0) accents[column] = chars[column];\n          intensity = Math.max(intensity, normalized);\n        }\n      }"""
new_block = """      } else if (props.kind === 'loop') {\n        const localRow = row - graphStart;\n        const y = ((localRow) / Math.max(1, graphRows - 1)) * 2 - 1;\n        const recording = loopTransport === 'recording';\n        const overdubbing = loopTransport === 'overdubbing';\n        const playing = loopTransport === 'playing' || overdubbing;\n        const animatedWiper = recording ? ((phase / TAU) % 1) : loopSelectedProgress;\n\n        for (let column = 0; column < innerWidth; column += 1) {\n          const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;\n          for (let track = 0; track < LOOP_TRACK_COUNT; track += 1) {\n            const gridColumn = track % 4;\n            const gridRow = Math.floor(track / 4);\n            const centerX = -0.75 + gridColumn * 0.5;\n            const centerY = -0.5 + gridRow;\n            const ellipseX = (x - centerX) / 0.205;\n            const ellipseY = (y - centerY) / 0.335;\n            const radius = Math.sqrt(ellipseX * ellipseX + ellipseY * ellipseY);\n            const ringDistance = Math.abs(radius - 1);\n            const occupied = (loopTrackMask & (1 << track)) !== 0;\n            const selected = track === loopSelectedTrack;\n            const selectedActive = selected && (occupied || recording);\n            const angle = Math.atan2(ellipseY, ellipseX);\n            const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;\n            const wiperDelta = Math.abs(((orbitPosition - animatedWiper + 1.5) % 1) - 0.5);\n\n            if (ringDistance < 0.17) {\n              if (!occupied && !selectedActive) {\n                if ((column + localRow + track) % 2 === 0) chars[column] = '·';\n              } else if (selected) {\n                const passed = playing && orbitPosition <= loopSelectedProgress;\n                chars[column] = recording ? (orbitPosition <= animatedWiper ? '█' : '◦') : passed ? '●' : '○';\n              } else {\n                chars[column] = '◦';\n              }\n              intensity = Math.max(intensity, selected ? 0.9 : occupied ? 0.67 : 0.48);\n            }\n\n            // Selected-track wiper: this is the Loopy-style idea, expressed as\n            // a tiny Calcotone ASCII playhead rather than a copied clip widget.\n            if (selectedActive && ringDistance < 0.27 && wiperDelta < 0.035) {\n              accents[column] = '●';\n              intensity = 1;\n            }\n\n            // DUB grows a second inner memory orbit so layering is visible\n            // without turning the screen into a busy waveform visualizer.\n            if (selected && overdubbing && Math.abs(radius - 0.70) < 0.11) {\n              chars[column] = (column + localRow) % 2 === 0 ? '◦' : '·';\n              if ((column + localRow) % 7 === 0) accents[column] = '○';\n              intensity = Math.max(intensity, 0.88);\n            }\n          }\n        }\n\n        // Put the track number inside every clip orbit. Selected track number\n        // uses the sparse accent layer; all others remain Calcotone off-white.\n        for (let track = 0; track < LOOP_TRACK_COUNT; track += 1) {\n          const centerColumn = Math.round(((0.125 + (track % 4) * 0.25)) * Math.max(1, innerWidth - 1));\n          const centerRow = Math.round((0.25 + Math.floor(track / 4) * 0.5) * Math.max(1, graphRows - 1));\n          if (localRow !== centerRow || centerColumn < 0 || centerColumn >= innerWidth) continue;\n          chars[centerColumn] = String(track + 1);\n          if (track === loopSelectedTrack) accents[centerColumn] = String(track + 1);\n        }\n      } else {\n        const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;\n        for (let column = 0; column < innerWidth; column += 1) {\n          const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;\n          const normalized = clamp01(field(props.kind, x, y, drawPhase, props.visualState));\n          if (!props.enabled && normalized < 0.72) continue;\n          if (normalized < 0.22) continue;\n          const glyphIndex = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));\n          chars[column] = profile.glyphs[glyphIndex] ?? ' ';\n          if (normalized > 0.76 && (column + row) % 13 === 0) accents[column] = chars[column];\n          intensity = Math.max(intensity, normalized);\n        }\n      }"""
if old_block not in text:
    raise SystemExit('Loop display graph anchor missing')
text = text.replace(old_block, new_block, 1)

old_footer = """          : (props.enabled ? 'MEMORY ONLINE // 8 TRACKS' : 'MEMORY HELD // STANDBY')"""
new_footer = """          : (props.enabled ? 'CLIP ORBITS // 8 TRACK MEMORY' : 'MEMORY HELD // STANDBY')"""
if old_footer not in text:
    raise SystemExit('Loop footer anchor missing')
text = text.replace(old_footer, new_footer, 1)

path.write_text(text, encoding='utf-8')

# Lock the new normal-mode visual vocabulary while preserving the existing trim contract.
audit = Path('scripts/loop-audit.mjs')
audit_text = audit.read_text(encoding='utf-8')
anchor = "requireText(display, 'TRANSIENT MEMORY // NON-DESTRUCTIVE TRIM', 'ASCII transient trim view');\n"
addition = anchor + "requireText(display, 'Loopy-inspired motion language', 'Loop circular clip-orbit motion language');\nrequireText(display, 'CLIP ORBITS // 8 TRACK MEMORY', 'Loop eight-orbit memory bank footer');\nrequireText(display, \"accents[column] = '●'\", 'Loop selected-track ASCII wiper');\n"
if anchor not in audit_text:
    raise SystemExit('Loop audit display anchor missing')
audit.write_text(audit_text.replace(anchor, addition, 1), encoding='utf-8')

print('Applied Calcotone Loop clip-orbit animation pass.')
