from pathlib import Path


display_path = Path('src/components/ascii/RailCHardwareDisplay.tsx')
s = display_path.read_text()

s = s.replace("    glyphs: ' ·◦○●█',", "    glyphs: ' .-|*#',")

old = """  const denseLoopTrim = props.kind === 'loop' && props.trimEditing;
  const columns = denseLoopTrim
    ? (highDefinition
        ? Math.max(88, Math.min(112, Math.floor(width / 3.15)))
        : Math.max(80, Math.min(104, Math.floor(width / 3.35))))
    : highDefinition
      ? Math.max(44, Math.min(76, Math.floor(width / 5.05)))
      : Math.max(42, Math.min(72, Math.floor(width / 5.25)));
  const fontSize = denseLoopTrim
    ? (highDefinition
        ? Math.max(4.4, Math.min(6.2, width / columns * 1.42))
        : Math.max(4.2, Math.min(5.9, width / columns * 1.38)))
    : highDefinition
      ? Math.max(6.2, Math.min(8.9, width / columns * 1.54))
      : Math.max(5.8, Math.min(8.4, width / columns * 1.5));"""
new = """  const denseLoopTrim = props.kind === 'loop' && props.trimEditing;
  const readableLoop = props.kind === 'loop' && !props.trimEditing;
  const columns = denseLoopTrim
    ? (highDefinition
        ? Math.max(88, Math.min(112, Math.floor(width / 3.15)))
        : Math.max(80, Math.min(104, Math.floor(width / 3.35))))
    : readableLoop
      ? (highDefinition
          ? Math.max(68, Math.min(92, Math.floor(width / 4.05)))
          : Math.max(62, Math.min(86, Math.floor(width / 4.25))))
      : highDefinition
        ? Math.max(44, Math.min(76, Math.floor(width / 5.05)))
        : Math.max(42, Math.min(72, Math.floor(width / 5.25)));
  const fontSize = denseLoopTrim
    ? (highDefinition
        ? Math.max(4.4, Math.min(6.2, width / columns * 1.42))
        : Math.max(4.2, Math.min(5.9, width / columns * 1.38)))
    : readableLoop
      ? (highDefinition
          ? Math.max(5.0, Math.min(7.0, width / columns * 1.46))
          : Math.max(4.8, Math.min(6.7, width / columns * 1.42)))
      : highDefinition
        ? Math.max(6.2, Math.min(8.9, width / columns * 1.54))
        : Math.max(5.8, Math.min(8.4, width / columns * 1.5));"""
if old not in s:
    raise SystemExit('display density anchor not found')
s = s.replace(old, new)

trim_old = """          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '┆' : '│') : '·';
          else if (Math.abs(localRow - center) < 0.6) chars[column] = inside ? '─' : '·';
          if (column === inColumn || column === outColumn) accents[column] = '┃';
          if (column === playColumn && inside && localRow === Math.round(center)) accents[column] = '●';"""
trim_new = """          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '|' : ':') : '.';
          else if (Math.abs(localRow - center) < 0.6) chars[column] = inside ? '-' : '.';
          if (column === inColumn) accents[column] = '[';
          if (column === outColumn) accents[column] = ']';
          if (column === playColumn && inside && localRow === Math.round(center)) accents[column] = '^';"""
if trim_old not in s:
    raise SystemExit('trim glyph anchor not found')
s = s.replace(trim_old, trim_new)

start_marker = "      } else if (props.kind === 'loop') {\n        const localRow = row - graphStart;"
end_marker = "      } else {\n        const y ="
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Loop normal renderer anchors not found')

replacement = """      } else if (props.kind === 'loop') {
        // The Loop screen is a transport instrument first and artwork second.
        // One large selected-track clock carries the real transient and real
        // playhead. The eight-track rail only communicates occupancy/activity;
        // it never invents positional motion for background loops.
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
        const radiusX = Math.max(8, innerWidth * 0.31);
        const radiusY = Math.max(2.5, clockRows * 0.43);

        if (localRow < clockRows) {
          for (let column = 0; column < innerWidth; column += 1) {
            const nx = (column - clockCenterColumn) / radiusX;
            const ny = (localRow - clockCenterRow) / radiusY;
            const radius = Math.sqrt(nx * nx + ny * ny);
            const ringDistance = Math.abs(radius - 1);
            const angle = Math.atan2(ny, nx);
            const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;
            const wiperDelta = Math.abs(((orbitPosition - selectedProgress + 1.5) % 1) - 0.5);

            if (ringDistance < 0.11) {
              const passed = selectedOccupied && playing && orbitPosition <= selectedProgress;
              chars[column] = recording ? (orbitPosition <= selectedProgress ? '#' : '.') : passed ? '=' : '-';
              intensity = Math.max(intensity, selectedOccupied || recording ? 0.86 : 0.5);
            }
            if ((selectedOccupied || recording) && ringDistance < 0.19 && wiperDelta < 0.022) {
              accents[column] = '*';
              intensity = 1;
            }

            // Real selected-track transient lives inside the clock instead of
            // becoming decorative orbit texture. ASCII stays intentionally plain.
            const waveLeft = clockCenterColumn - radiusX * 0.78;
            const waveRight = clockCenterColumn + radiusX * 0.78;
            if (column >= waveLeft && column <= waveRight && waveform.length > 0) {
              const normalizedX = (column - waveLeft) / Math.max(1, waveRight - waveLeft);
              const waveformIndex = Math.min(waveform.length - 1, Math.floor(normalizedX * waveform.length));
              const amplitude = clamp01(waveform[waveformIndex] ?? 0);
              const distance = Math.abs(localRow - clockCenterRow) / Math.max(1, radiusY * 0.58);
              if (distance <= amplitude && radius < 0.82) chars[column] = amplitude > 0.68 ? '|' : ':';
              else if (Math.abs(localRow - clockCenterRow) < 0.5 && radius < 0.82 && chars[column] === ' ') chars[column] = '-';
            }
          }

          const centerLabel = `T${loopSelectedTrack + 1} ${selectedState}`;
          const labelStart = Math.max(0, Math.round(clockCenterColumn - centerLabel.length / 2));
          if (localRow === Math.round(clockCenterRow)) {
            for (let index = 0; index < centerLabel.length && labelStart + index < innerWidth; index += 1) {
              chars[labelStart + index] = centerLabel[index]!;
              accents[labelStart + index] = centerLabel[index]!;
            }
          }
        } else {
          // Two rows of four tracks. A moving >/* pulse means PLAYING; '=' means
          // memory exists but transport is stopped; '.' means EMPTY. Selection
          // is wrapped in [] so the target is obvious before touching REC/DUB.
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
              if (selected || active) accents[startColumn + index] = label[index]!;
            }
          }
        }
"""
s = s[:start] + replacement + s[end:]

s = s.replace("          : (props.enabled ? 'CLIP ORBITS // 8 TRACK MEMORY' : 'MEMORY HELD // STANDBY')",
              "          : (props.enabled ? 'SELECTED CLOCK // TRACK RAIL // TRUE PLAYHEAD' : 'MEMORY HELD // STANDBY')")
display_path.write_text(s)

audit_path = Path('scripts/loop-audit.mjs')
a = audit_path.read_text()
a = a.replace("requireText(display, 'CLIP ORBITS // 8 TRACK MEMORY', 'Loop eight-orbit memory bank footer');",
              "requireText(display, 'SELECTED CLOCK // TRACK RAIL // TRUE PLAYHEAD', 'Loop readable transport footer');")
a = a.replace("requireText(display, \"accents[column] = selected ? '●' : '○'\", 'Loop all-track ASCII wipers');",
              "requireText(display, 'One large selected-track clock carries the real transient and real', 'Loop readable selected-track clock');\nrequireText(display, \"accents[column] = '*'\", 'Loop truthful selected-track playhead');\nrequireText(display, \"const activityMark = active ? ((pulse + track) % 2 === 0 ? '>' : '*')\", 'Loop all-track activity rail');")
a = a.replace("requireText(display, \"accents[column] = '┃'\", 'ASCII trim markers');",
              "requireText(display, \"accents[column] = '['\", 'ASCII trim IN marker');\nrequireText(display, \"accents[column] = ']'\", 'ASCII trim OUT marker');")
insert = "forbidText(display, \"glyphs: ' ·◦○●█'\", 'retired alien Loop glyph palette');\n"
marker = "requireText(random, \"RAIL_C_RANDOM_ORDER = ['stomp', 'chaos']\", 'Loop excluded from RANDOM registry');"
if insert not in a:
    a = a.replace(marker, insert + marker)
audit_path.write_text(a)
