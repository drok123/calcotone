from pathlib import Path

path = Path('src/components/ascii/RailCHardwareDisplay.tsx')
source = path.read_text()
start_marker = """      } else if (props.kind === 'loop') {
        // The Loop screen is a transport instrument first and artwork second.
"""
end_marker = """      } else {
        const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;
"""
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Loop normal-view renderer anchors not found')

replacement = r'''      } else if (props.kind === 'loop') {
        // Loop keeps the transport-first hierarchy, but the selected clock now
        // shares Calcotone's spectacle raster language: a layered off-white
        // mechanical rim, inner groove, index ticks and real transient. Purple
        // is deliberately reserved for motion -- the truthful wiper/trail and
        // per-track activity pulses -- so state stays legible at a glance.
        const waveform = props.loopWaveform ?? [];
        const localRow = row - graphStart;
        const recording = loopTransport === 'recording';
        const overdubbing = loopTransport === 'overdubbing';
        const playing = loopTransport === 'playing' || recording || overdubbing;
        const selectedOccupied = (loopTrackMask & (1 << loopSelectedTrack)) !== 0;
        const selectedProgress = recording ? ((stamp / 1000) % 4) / 4 : loopSelectedProgress;
        const selectedState = recording ? 'REC' : overdubbing ? 'DUB' : selectedOccupied ? (playing ? 'PLAY' : 'STOP') : 'EMPTY';
        const railRows = Math.min(2, Math.max(0, graphRows - 7));
        const clockRows = Math.max(5, graphRows - railRows);
        const clockCenterRow = (clockRows - 1) * 0.5;
        const clockCenterColumn = (innerWidth - 1) * 0.5;
        const radiusX = Math.max(8, innerWidth * 0.315);
        const radiusY = Math.max(2.5, clockRows * 0.44);

        if (localRow < clockRows) {
          for (let column = 0; column < innerWidth; column += 1) {
            const nx = (column - clockCenterColumn) / radiusX;
            const ny = (localRow - clockCenterRow) / radiusY;
            const radius = Math.sqrt(nx * nx + ny * ny);
            const angle = Math.atan2(ny, nx);
            const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;
            const wiperDelta = Math.abs(((orbitPosition - selectedProgress + 1.5) % 1) - 0.5);
            const trailDelta = (selectedProgress - orbitPosition + 1) % 1;

            // Three nested contour bands make the clock read as a physical,
            // shaded object instead of a one-character outline. A tiny ordered
            // dither keeps curved shoulders from turning into giant blocks.
            const outerRim = clamp01(1 - Math.abs(radius - 1.025) / 0.115);
            const rimBody = clamp01(1 - Math.abs(radius - 0.955) / 0.125) * 0.56;
            const innerGroove = clamp01(1 - Math.abs(radius - 0.865) / 0.060) * 0.72;
            const indexTick = Math.max(0, 1 - Math.abs(Math.sin(angle * 6)) / 0.115)
              * clamp01(1 - Math.abs(radius - 1.13) / 0.075) * 0.92;
            const ordered = RAIL_BAYER_4[localRow & 3]![column & 3]! / 15 - 0.5;
            const shellIntensity = clamp01(Math.max(outerRim * 0.96, rimBody, innerGroove, indexTick) + ordered * 0.045);

            if (shellIntensity > 0.08) {
              const ringGlyph = shellIntensity > 0.68
                ? railEdgeGlyph(nx, ny)
                : RAIL_SHADE_RAMP[Math.min(
                    RAIL_SHADE_RAMP.length - 1,
                    Math.max(1, Math.round(shellIntensity * (RAIL_SHADE_RAMP.length - 1))),
                  )] ?? '.';
              chars[column] = ringGlyph;
              intensity = Math.max(intensity, 0.46 + shellIntensity * 0.44);
            }

            // Purple is motion, not structure. A short comet-like tail makes
            // direction obvious while the exact wiper remains the brightest bit.
            const onOuterMotionBand = Math.abs(radius - 1.025) < 0.17;
            if ((selectedOccupied || recording) && playing && onOuterMotionBand && trailDelta < 0.105) {
              accents[column] = trailDelta < 0.025 || wiperDelta < 0.018 ? '*' : '+';
              intensity = Math.max(intensity, 0.88 + (0.105 - trailDelta) * 1.1);
            }
            if ((selectedOccupied || recording) && onOuterMotionBand && wiperDelta < 0.016) {
              accents[column] = '*';
              intensity = 1;
            }

            // The selected track's real transient stays inside the mechanical
            // clock. It uses a small density ramp instead of chunky full blocks.
            const waveLeft = clockCenterColumn - radiusX * 0.74;
            const waveRight = clockCenterColumn + radiusX * 0.74;
            if (column >= waveLeft && column <= waveRight && waveform.length > 0 && radius < 0.78) {
              const normalizedX = (column - waveLeft) / Math.max(1, waveRight - waveLeft);
              const waveformIndex = Math.min(waveform.length - 1, Math.floor(normalizedX * waveform.length));
              const amplitude = clamp01(waveform[waveformIndex] ?? 0);
              const normalizedDistance = Math.abs(localRow - clockCenterRow) / Math.max(1, radiusY * 0.50);
              if (amplitude > 0.015 && normalizedDistance <= amplitude) {
                const waveIntensity = clamp01(1 - normalizedDistance / Math.max(0.06, amplitude));
                chars[column] = waveIntensity > 0.72 ? '|' : waveIntensity > 0.36 ? '+' : ':';
                intensity = Math.max(intensity, 0.48 + amplitude * 0.34);
              } else if (Math.abs(localRow - clockCenterRow) < 0.45 && chars[column] === ' ') {
                chars[column] = '.';
              }
            }
          }

          // State text stays cream/white. It is information, not animation.
          const centerLabel = `T${loopSelectedTrack + 1} ${selectedState}`;
          const labelStart = Math.max(0, Math.round(clockCenterColumn - centerLabel.length / 2));
          if (localRow === Math.round(clockCenterRow)) {
            for (let index = 0; index < centerLabel.length && labelStart + index < innerWidth; index += 1) {
              chars[labelStart + index] = centerLabel[index]!;
              accents[labelStart + index] = ' ';
            }
          }
        } else {
          // Two rows of four tracks. Only the changing activity mark is purple;
          // labels and selection brackets remain plain and instantly readable.
          const railRow = localRow - clockRows;
          const firstTrack = railRow * 4;
          const cellWidth = Math.max(8, Math.floor(innerWidth / 4));
          const pulse = Math.floor(stamp / 260);
          for (let cell = 0; cell < 4; cell += 1) {
            const track = firstTrack + cell;
            if (track >= LOOP_TRACK_COUNT) continue;
            const occupied = (loopTrackMask & (1 << track)) !== 0;
            const selected = track === loopSelectedTrack;
            const active = occupied && playing;
            const activityMark = active ? ((pulse + track) % 2 === 0 ? '>' : '*') : occupied ? '=' : '.';
            const label = selected ? `[T${track + 1}${activityMark}]` : ` T${track + 1}${activityMark} `;
            const startColumn = cell * cellWidth + Math.max(0, Math.floor((cellWidth - label.length) / 2));
            for (let index = 0; index < label.length && startColumn + index < innerWidth; index += 1) {
              chars[startColumn + index] = label[index]!;
            }
            if (active) {
              const markOffset = label.lastIndexOf(activityMark);
              if (markOffset >= 0 && startColumn + markOffset < innerWidth) accents[startColumn + markOffset] = activityMark;
            }
          }
        }
'''
source = source[:start] + replacement + source[end:]
path.write_text(source)

audit_path = Path('scripts/loop-audit.mjs')
audit = audit_path.read_text()
old = """requireText(display, 'One large selected-track clock carries the real transient and real', 'Loop readable selected-track clock');
requireText(display, \"accents[column] = '*'\", 'Loop truthful selected-track playhead');
requireText(display, \"const activityMark = active ? ((pulse + track) % 2 === 0 ? '>' : '*')\", 'Loop all-track activity rail');
"""
new = """requireText(display, 'shares Calcotone\\'s spectacle raster language', 'Loop spectacle/readability boundary');
requireText(display, 'const outerRim = clamp01', 'Loop layered spectacle outer rim');
requireText(display, 'const innerGroove = clamp01', 'Loop layered spectacle inner groove');
requireText(display, 'const indexTick = Math.max', 'Loop clock index detail');
requireText(display, 'const ringGlyph = shellIntensity > 0.68', 'Loop edge-aware ring reconstruction');
requireText(display, 'const trailDelta = (selectedProgress - orbitPosition + 1) % 1', 'Loop truthful purple motion trail');
requireText(display, \"accents[column] = trailDelta < 0.025 || wiperDelta < 0.018 ? '*' : '+'\", 'Loop purple rotating wiper/trail');
requireText(display, 'const waveIntensity = clamp01', 'Loop fine transient density');
requireText(display, \"const activityMark = active ? ((pulse + track) % 2 === 0 ? '>' : '*')\", 'Loop all-track activity rail');
requireText(display, 'Only the changing activity mark is purple', 'Loop activity-only accent contract');
"""
if old not in audit:
    raise SystemExit('Loop audit renderer expectations anchor not found')
audit = audit.replace(old, new, 1)
audit_path.write_text(audit)
