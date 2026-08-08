from pathlib import Path

path = Path('src/components/ascii/RailCHardwareDisplay.tsx')
s = path.read_text()

anchor = """const OFF_WHITE = '#f2ead8';
const TAU = Math.PI * 2;
"""
insert = """const OFF_WHITE = '#f2ead8';
const TAU = Math.PI * 2;
const RAIL_SHADE_RAMP = ' .:-=+*#%@';
const RAIL_BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function hashRailScene(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function railEdgeGlyph(gx: number, gy: number): string {
  const ax = Math.abs(gx);
  const ay = Math.abs(gy);
  if (ax > ay * 1.8) return '|';
  if (ay > ax * 1.8) return '-';
  return gx * gy >= 0 ? '/' : '\\\\';
}

function lineField(x: number, y: number, x1: number, y1: number, x2: number, y2: number, thickness: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2));
  const px = x1 + dx * t;
  const py = y1 + dy * t;
  return Math.max(0, 1 - Math.hypot(x - px, y - py) / thickness);
}

function railSpectacleSample(
  kind: 'stomp' | 'stack',
  x: number,
  y: number,
  phase: number,
  seed: number,
  audio: VisualAudioState,
): number {
  const activity = clamp01(audio.level * 0.62 + audio.transient * 0.38);
  const detail = 1 + (seed % 7) * 0.035;
  if (kind === 'stomp') {
    // A living analog schematic: signal enters at left, clips through a diode /
    // transistor network, then exits as an audio-reactive trace on the right.
    const wave = Math.max(-0.23, Math.min(0.23,
      Math.sin(x * (7.0 + (seed % 5) * 0.35) + phase * 1.35) * (0.25 + audio.low * 0.14)));
    let value = Math.max(0, 1 - Math.abs(y - wave) / 0.035) * 0.94;
    value = Math.max(value, lineField(x, y, -0.96, 0, -0.60, 0, 0.028));
    value = Math.max(value, lineField(x, y, 0.62, 0, 0.96, 0, 0.028));
    value = Math.max(value, lineField(x, y, -0.60, 0, -0.38, -0.34, 0.026));
    value = Math.max(value, lineField(x, y, -0.60, 0, -0.38, 0.34, 0.026));
    value = Math.max(value, lineField(x, y, -0.38, -0.34, -0.10, -0.34, 0.025));
    value = Math.max(value, lineField(x, y, -0.38, 0.34, -0.10, 0.34, 0.025));
    value = Math.max(value, lineField(x, y, -0.10, -0.48, -0.10, 0.48, 0.026));
    value = Math.max(value, lineField(x, y, 0.16, -0.48, 0.16, 0.48, 0.026));
    value = Math.max(value, lineField(x, y, 0.16, -0.34, 0.44, -0.12, 0.025));
    value = Math.max(value, lineField(x, y, 0.16, 0.34, 0.44, 0.12, 0.025));
    value = Math.max(value, lineField(x, y, 0.44, -0.12, 0.62, 0, 0.026));
    value = Math.max(value, lineField(x, y, 0.44, 0.12, 0.62, 0, 0.026));

    // Opposed diode junctions and transistor nodes pulse with transients.
    const diodeA = Math.abs(x + 0.10) < 0.11 && Math.abs(y + 0.34) < 0.11
      ? Math.max(0, 1 - Math.abs(Math.abs(x + 0.10) + Math.abs(y + 0.34) - 0.095) / 0.025)
      : 0;
    const diodeB = Math.abs(x + 0.10) < 0.11 && Math.abs(y - 0.34) < 0.11
      ? Math.max(0, 1 - Math.abs(Math.abs(x + 0.10) + Math.abs(y - 0.34) - 0.095) / 0.025)
      : 0;
    const nodeA = Math.max(0, 1 - Math.hypot(x - 0.16, y + 0.34) / (0.055 + audio.transient * 0.02));
    const nodeB = Math.max(0, 1 - Math.hypot(x - 0.16, y - 0.34) / (0.055 + audio.transient * 0.02));
    value = Math.max(value, diodeA * 0.92, diodeB * 0.92, nodeA, nodeB);

    // Fine PCB traces make the display feel fabricated rather than icon-like.
    const pcb = Math.max(
      lineField(x, y, -0.82, -0.62, -0.42, -0.62, 0.014),
      lineField(x, y, -0.42, -0.62, -0.42, -0.46, 0.014),
      lineField(x, y, 0.36, 0.58, 0.82, 0.58, 0.014),
      lineField(x, y, 0.36, 0.42, 0.36, 0.58, 0.014),
    );
    const scan = Math.max(0, 1 - Math.abs(y - Math.sin(phase + x * 2.2) * 0.65) / 0.018) * activity * 0.22;
    return clamp01(Math.max(value, pcb * (0.48 + detail * 0.12), scan));
  }

  // STACK becomes a cabinet cutaway: grille, large moving speaker, secondary
  // cone, amp/tube bank and energy wave. Cabinet/model selectors alter detail
  // deterministically through the scene hash without needing a second renderer.
  const aspectX = x * 0.78;
  const mainX = -0.17;
  const mainY = 0.18;
  const radius = Math.hypot((aspectX - mainX) / 0.62, (y - mainY) / 0.72);
  const cone = Math.max(0, 1 - Math.abs(radius - 0.72) / 0.055);
  const surround = Math.max(0, 1 - Math.abs(radius - 0.94) / 0.035);
  const dustcap = Math.max(0, 1 - Math.abs(radius - 0.28) / 0.045);
  const coneShade = radius < 0.90 ? clamp01((0.90 - radius) * (0.34 + audio.low * 0.28)) : 0;

  const smallRadius = Math.hypot((aspectX - 0.58) / 0.28, (y + 0.38) / 0.32);
  const smallCone = Math.max(0, 1 - Math.abs(smallRadius - 0.78) / 0.07) * 0.72;

  // Cabinet boundary and cloth grille.
  const cabinet = Math.max(
    lineField(x, y, -0.96, -0.86, 0.96, -0.86, 0.018),
    lineField(x, y, -0.96, 0.86, 0.96, 0.86, 0.018),
    lineField(x, y, -0.96, -0.86, -0.96, 0.86, 0.018),
    lineField(x, y, 0.96, -0.86, 0.96, 0.86, 0.018),
  );
  const grilleX = Math.abs(((x + 1) * (10 + seed % 5)) % 0.20 - 0.10) < 0.010 ? 0.20 : 0;
  const grilleY = Math.abs(((y + 1) * (8 + seed % 3)) % 0.22 - 0.11) < 0.010 ? 0.16 : 0;

  // Tube bank across the top, with a faint reactive glow/core.
  let tubes = 0;
  for (let index = 0; index < 4; index += 1) {
    const tx = -0.66 + index * 0.28;
    const body = Math.max(
      lineField(x, y, tx - 0.07, -0.72, tx - 0.07, -0.48, 0.016),
      lineField(x, y, tx + 0.07, -0.72, tx + 0.07, -0.48, 0.016),
      lineField(x, y, tx - 0.07, -0.72, tx + 0.07, -0.72, 0.016),
    );
    const glow = Math.max(0, 1 - Math.hypot((x - tx) / 0.09, (y + 0.58) / 0.15)) * (0.20 + activity * 0.22);
    tubes = Math.max(tubes, body * 0.72, glow);
  }

  const energyY = 0.18 + Math.sin(x * (5.4 + (seed % 4) * 0.35) - phase * 1.25) * (0.07 + audio.low * 0.06);
  const energy = Math.max(0, 1 - Math.abs(y - energyY) / 0.025) * (0.35 + activity * 0.42);
  return clamp01(Math.max(surround, cone * 0.94, dustcap * 0.86, coneShade, smallCone, cabinet * 0.72, grilleX, grilleY, tubes, energy));
}

function drawRailSpectacle(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  props: RailCHardwareDisplayProps,
  stamp: number,
): void {
  const kind = props.kind as 'stomp' | 'stack';
  const profile = PROFILES[kind];
  const highDefinition = getDisplayProfile().reference1440p;
  const columns = highDefinition
    ? Math.max(82, Math.min(126, Math.floor(width / 3.25)))
    : Math.max(70, Math.min(108, Math.floor(width / 3.65)));
  const fontSize = highDefinition
    ? Math.max(4.0, Math.min(6.2, width / columns * 1.38))
    : Math.max(4.2, Math.min(6.5, width / columns * 1.40));
  const lineHeight = fontSize * 1.0;
  const rows = Math.max(25, Math.floor(height / lineHeight));
  const phase = ((stamp / 1000) % 18) / 18 * TAU;
  const seed = hashRailScene(`${kind}:${props.modeLabel}:${props.detailLabel ?? ''}`);
  const stepX = 2 / Math.max(1, columns - 1);
  const stepY = 2 / Math.max(1, rows - 1);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#050706';
  context.fillRect(0, 0, width, height);
  context.font = `600 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
  const textWidth = Math.max(1, context.measureText('M'.repeat(columns)).width);
  const textHeight = Math.max(1, (rows - 1) * lineHeight + fontSize);
  context.setTransform(dpr * width / textWidth, 0, 0, dpr * height / textHeight, 0, 0);
  context.textBaseline = 'top';
  context.shadowBlur = props.enabled ? (highDefinition ? 2.0 : 2.6) : 1;

  for (let row = 0; row < rows; row += 1) {
    const chars = Array.from({ length: columns }, () => ' ');
    const accents = Array.from({ length: columns }, () => ' ');
    let intensity = 0;
    const y = (row / Math.max(1, rows - 1)) * 2 - 1;
    for (let column = 0; column < columns; column += 1) {
      const x = (column / Math.max(1, columns - 1)) * 2 - 1;
      const center = railSpectacleSample(kind, x, y, phase, seed, props.visualState);
      const left = railSpectacleSample(kind, x - stepX * 0.42, y, phase, seed, props.visualState);
      const right = railSpectacleSample(kind, x + stepX * 0.42, y, phase, seed, props.visualState);
      const up = railSpectacleSample(kind, x, y - stepY * 0.42, phase, seed, props.visualState);
      const down = railSpectacleSample(kind, x, y + stepY * 0.42, phase, seed, props.visualState);
      const value = (center * 3 + left + right + up + down) / 7;
      const gx = right - left;
      const gy = down - up;
      const edge = Math.hypot(gx, gy);
      const dither = RAIL_BAYER_4[row & 3]![column & 3]! / 15 - 0.5;
      const normalized = clamp01(Math.pow(value, 0.78) + dither * 0.05);
      if (normalized < (props.enabled ? 0.055 : 0.44)) continue;
      const glyph = edge > 0.13 && normalized > 0.18
        ? railEdgeGlyph(gx, gy)
        : RAIL_SHADE_RAMP[Math.min(RAIL_SHADE_RAMP.length - 1, Math.round(normalized * (RAIL_SHADE_RAMP.length - 1)))] ?? ' ';
      chars[column] = glyph;
      if (normalized > 0.72 && (edge > 0.21 || (column + row + seed) % 23 === 0)) accents[column] = glyph;
      intensity = Math.max(intensity, normalized);
    }

    context.globalAlpha = props.enabled ? 0.64 + intensity * 0.30 : 0.26 + intensity * 0.10;
    context.fillStyle = OFF_WHITE;
    context.shadowColor = OFF_WHITE;
    context.fillText(chars.join(''), 0, row * lineHeight);
    context.globalAlpha = props.enabled ? 0.68 + intensity * 0.26 : 0.16;
    context.fillStyle = profile.primary;
    context.shadowColor = profile.primary;
    context.fillText(accents.join(''), 0, row * lineHeight);
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}
"""
if anchor not in s:
    raise SystemExit('rail constants anchor missing')
s = s.replace(anchor, insert, 1)

draw_anchor = """  const profile = PROFILES[props.kind];
  const highDefinition = getDisplayProfile().reference1440p;
"""
draw_replace = """  const profile = PROFILES[props.kind];
  if (props.kind === 'stomp' || props.kind === 'stack') {
    drawRailSpectacle(context, width, height, dpr, props, stamp);
    return;
  }
  const highDefinition = getDisplayProfile().reference1440p;
"""
if draw_anchor not in s:
    raise SystemExit('draw early-route anchor missing')
s = s.replace(draw_anchor, draw_replace, 1)
path.write_text(s)

visual_path = Path('scripts/visual-audit.mjs')
visual = visual_path.read_text()
rail_decl = "const railC = read('src/components/effects/RailCModules.tsx');"
if "const railDisplay = read('src/components/ascii/RailCHardwareDisplay.tsx');" not in visual:
    visual = visual.replace(rail_decl, rail_decl + "\nconst railDisplay = read('src/components/ascii/RailCHardwareDisplay.tsx');")
needle = "requireText(railC, 'kind=\"loop\"', 'Loop shared hardware artwork');"
extra = """requireText(railDisplay, "const RAIL_SHADE_RAMP = ' .:-=+*#%@'", 'Rail C spectacle density ramp');
requireText(railDisplay, 'function railSpectacleSample', 'Stomp/Stack dedicated spectacle fields');
requireText(railDisplay, 'function drawRailSpectacle', 'Stomp/Stack high-density rasterizer');
requireText(railDisplay, 'const value = (center * 3 + left + right + up + down) / 7', 'Rail C five-tap supersampling');
requireText(railDisplay, "if (props.kind === 'stomp' || props.kind === 'stack')", 'Stomp/Stack spectacle routing');
requireText(railDisplay, "props.kind === 'loop' && props.trimEditing", 'Loop readability renderer remains separate');
"""
if extra not in visual:
    visual = visual.replace(needle, needle + '\n' + extra.rstrip())
visual_path.write_text(visual)
