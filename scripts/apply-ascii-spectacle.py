from pathlib import Path

engine_path = Path('src/components/ascii/AsciiArtEngine.tsx')
engine = engine_path.read_text()

clamp_anchor = """function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
"""
insert = """function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

// High-fidelity module raster. Fidelity comes from spatial sampling and edge
// reconstruction, not a soup of novelty Unicode glyphs.
const MODULE_ART_OFF_WHITE = '#f2ead8';
const MODULE_SHADE_RAMP = ' .:-=+*#%@';
const MODULE_BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function moduleEdgeGlyph(gx: number, gy: number): string {
  const ax = Math.abs(gx);
  const ay = Math.abs(gy);
  if (ax > ay * 1.8) return '|';
  if (ay > ax * 1.8) return '-';
  return gx * gy >= 0 ? '/' : '\\\\';
}
"""
if clamp_anchor not in engine:
    raise SystemExit('clamp anchor missing')
engine = engine.replace(clamp_anchor, insert, 1)

old_grid = """  const loopAngle = loopAngleForTime(time);
  const columns = isModule
    ? Math.max(54, Math.min(104, Math.floor(width / 4.15)))
    : Math.max(38, Math.min(82, Math.floor(width / 6.6)));
  const cellWidth = width / columns;
  const fontSize = isModule
    ? Math.max(4.8, Math.min(7.4, cellWidth * 1.42))
    : Math.max(7, Math.min(11.5, cellWidth * 1.42));
  const lineHeight = fontSize * (isModule ? 1.04 : 1.12);
  const rows = Math.max(isModule ? 20 : 9, Math.floor(height / lineHeight));
"""
new_grid = """  const loopAngle = loopAngleForTime(time);
  const displayProfile = getDisplayProfile();
  // Core module screens are artwork-first. At the 1440p reference tier the
  // raster approaches image-to-ASCII generators while the shared scheduler can
  // still fall back automatically if a machine misses the frame budget.
  const columns = isModule
    ? displayProfile.reference1440p
      ? Math.max(84, Math.min(136, Math.floor(width / 3.15)))
      : Math.max(72, Math.min(118, Math.floor(width / 3.55)))
    : Math.max(38, Math.min(82, Math.floor(width / 6.6)));
  const cellWidth = width / columns;
  const fontSize = isModule
    ? displayProfile.reference1440p
      ? Math.max(3.9, Math.min(6.15, cellWidth * 1.36))
      : Math.max(4.2, Math.min(6.5, cellWidth * 1.38))
    : Math.max(7, Math.min(11.5, cellWidth * 1.42));
  const lineHeight = fontSize * (isModule ? 0.99 : 1.12);
  const rows = Math.max(isModule ? 26 : 9, Math.floor(height / lineHeight));
"""
if old_grid not in engine:
    raise SystemExit('grid anchor missing')
engine = engine.replace(old_grid, new_grid, 1)

logo_anchor = """  const moduleLogo = isModule
    ? createModuleLogoSampler(scene, loopAngle, audio, width / Math.max(1, height))
    : null;
"""
logo_replace = logo_anchor + """  const moduleStepX = 2 / Math.max(1, columns - 1);
  const moduleStepY = 2 / Math.max(1, rows - 1);
  const moduleLayer = isModule ? scene.layers[0] : undefined;
"""
if logo_anchor not in engine:
    raise SystemExit('module logo anchor missing')
engine = engine.replace(logo_anchor, logo_replace, 1)

engine = engine.replace("""  for (let row = 0; row < rows; row += 1) {
    let line: string;
    let lineIntensity = 0;
""", """  for (let row = 0; row < rows; row += 1) {
    let line: string;
    let accentLine: string | null = null;
    let lineIntensity = 0;
""", 1)

chars_anchor = """      const characters = Array.from({ length: columns }, () => ' ');
      if (!isModule) {
"""
chars_replace = """      const characters = Array.from({ length: columns }, () => ' ');
      const accents = isModule ? Array.from({ length: columns }, () => ' ') : null;
      if (!isModule) {
"""
if chars_anchor not in engine:
    raise SystemExit('characters anchor missing')
engine = engine.replace(chars_anchor, chars_replace, 1)

old_logo = """        if (moduleLogo) {
          let value = moduleLogo(normalizedX, normalizedY);
          const dust = hashNoise(column, row, seed);
          if (value < 0.025 && dust > 0.9975) value = 0.10 + audio.high * 0.08;
          if (value < 0.035) continue;
          const normalized = clamp01(Math.pow(value, 0.72) * (0.88 + audio.level * 0.12));
          const glyphIndex = Math.min(glyphs.length - 1, Math.floor(normalized * glyphs.length));
          characters[column] = glyphs[glyphIndex];
          lineIntensity = Math.max(lineIntensity, normalized);
          continue;
        }
"""
new_logo = """        if (moduleLogo) {
          // Five-tap supersampling preserves the curves and tiny circuit/cube
          // geometry that single-point cell sampling used to throw away.
          const center = moduleLogo(normalizedX, normalizedY);
          const left = moduleLogo(normalizedX - moduleStepX * 0.42, normalizedY);
          const right = moduleLogo(normalizedX + moduleStepX * 0.42, normalizedY);
          const up = moduleLogo(normalizedX, normalizedY - moduleStepY * 0.42);
          const down = moduleLogo(normalizedX, normalizedY + moduleStepY * 0.42);
          const supersampled = (center * 3 + left + right + up + down) / 7;
          const gx = right - left;
          const gy = down - up;
          const edge = Math.hypot(gx, gy);
          const semanticField = moduleLayer
            ? Math.max(0, sampleLayer(moduleLayer, normalizedX, normalizedY, loopAngle, audio))
            : 0;
          const dust = hashNoise(column, row, seed);
          const ordered = MODULE_BAYER_4[row & 3]![column & 3]! / 15 - 0.5;
          let normalized = clamp01(
            Math.pow(clamp01(supersampled * 0.94 + semanticField * 0.14), 0.76)
            * (0.90 + audio.level * 0.10)
            + ordered * 0.055,
          );
          if (normalized < 0.045 && dust > 0.9982) normalized = 0.11 + audio.high * 0.08;
          if (normalized < (scene.active ? 0.055 : 0.42)) continue;

          let glyph: string;
          if (edge > 0.13 && normalized > 0.18) {
            glyph = moduleEdgeGlyph(gx, gy);
          } else {
            const glyphIndex = Math.min(
              MODULE_SHADE_RAMP.length - 1,
              Math.round(normalized * (MODULE_SHADE_RAMP.length - 1)),
            );
            glyph = MODULE_SHADE_RAMP[glyphIndex] ?? ' ';
          }
          characters[column] = glyph;
          if (accents && normalized > 0.70 && (edge > 0.20 || (column + row + seed) % 19 === 0)) {
            accents[column] = glyph;
          }
          lineIntensity = Math.max(lineIntensity, normalized);
          continue;
        }
"""
if old_logo not in engine:
    raise SystemExit('module raster anchor missing')
engine = engine.replace(old_logo, new_logo, 1)

line_anchor = """      line = characters.join('');
    }

    context.globalAlpha = isModule
      ? (scene.active ? 0.68 + lineIntensity * 0.26 : 0.44)
      : (row === 0 || row === rows - 1 ? 0.86 : 0.52 + audio.level * 0.18);
    context.fillStyle = row % (isModule ? 6 : 5) === 0 ? theme.secondary : theme.primary;
    context.fillText(line, 0, row * lineHeight);
"""
line_replace = """      line = characters.join('');
      if (accents) accentLine = accents.join('');
    }

    if (isModule) {
      context.globalAlpha = scene.active ? 0.66 + lineIntensity * 0.30 : 0.28 + lineIntensity * 0.10;
      context.fillStyle = MODULE_ART_OFF_WHITE;
      context.shadowColor = MODULE_ART_OFF_WHITE;
      context.fillText(line, 0, row * lineHeight);
      if (accentLine) {
        context.globalAlpha = scene.active ? 0.72 + lineIntensity * 0.24 : 0.18;
        context.fillStyle = theme.primary;
        context.shadowColor = theme.primary;
        context.fillText(accentLine, 0, row * lineHeight);
      }
    } else {
      context.globalAlpha = row === 0 || row === rows - 1 ? 0.86 : 0.52 + audio.level * 0.18;
      context.fillStyle = row % 5 === 0 ? theme.secondary : theme.primary;
      context.shadowColor = theme.primary;
      context.fillText(line, 0, row * lineHeight);
    }
"""
if line_anchor not in engine:
    raise SystemExit('line rendering anchor missing')
engine = engine.replace(line_anchor, line_replace, 1)
engine_path.write_text(engine)

viewport_path = Path('src/components/effects/ModuleViewport.tsx')
viewport = viewport_path.read_text()
viewport = viewport.replace(
    "import { moduleModeKey } from '../ascii/AsciiArtEngine';\nimport { PressureStyleDisplay } from '../ascii/PressureStyleDisplay';",
    "import { AsciiArtEngine, moduleModeKey } from '../ascii/AsciiArtEngine';",
)
viewport = viewport.replace(
    '<PressureStyleDisplay module={module} visualState={visualState} />',
    '<AsciiArtEngine kind="module" module={module} className="module-spectacle-ascii" />',
)
viewport_path.write_text(viewport)

visual_path = Path('scripts/visual-audit.mjs')
visual = visual_path.read_text()
visual = visual.replace(
    "requireText(viewport, '<PressureStyleDisplay module={module}', 'Pressure-style module ASCII surface');",
    "requireText(viewport, '<AsciiArtEngine kind=\"module\" module={module}', 'High-fidelity module ASCII surface');\nrequireText(viewport, 'module-spectacle-ascii', 'Dedicated module spectacle surface');\nforbidText(viewport, 'PressureStyleDisplay', 'Retired low-density core module renderer');",
)
needle = "requireText(ascii, 'const verticalScale = height / gridHeight', 'Edge-to-edge ASCII height fit');"
extra = """requireText(ascii, "const MODULE_SHADE_RAMP = ' .:-=+*#%@'", 'High-fidelity ASCII density ramp');
requireText(ascii, 'const MODULE_BAYER_4', 'Ordered module ASCII dithering');
requireText(ascii, 'function moduleEdgeGlyph', 'Edge-aware ASCII reconstruction');
requireText(ascii, 'const supersampled = (center * 3 + left + right + up + down) / 7', 'Five-tap module supersampling');
requireText(ascii, "MODULE_ART_OFF_WHITE = '#f2ead8'", 'Calcotone off-white spectacle base');
requireText(ascii, 'Math.max(84, Math.min(136, Math.floor(width / 3.15)))', '1440p high-density module grid');
"""
if extra not in visual:
    visual = visual.replace(needle, needle + '\n' + extra.rstrip())
visual_path.write_text(visual)

ascii_audit_path = Path('scripts/ascii-landscape-audit.mjs')
audit = ascii_audit_path.read_text()
audit = audit.replace(
    "requireText(viewport, '<PressureStyleDisplay module={module}', 'Pressure-style module renderer');",
    "requireText(viewport, '<AsciiArtEngine kind=\"module\" module={module}', 'High-fidelity module renderer');\nforbidText(viewport, 'PressureStyleDisplay', 'Retired low-density core module renderer');",
)
summary_old = "console.log(`CALCOTONE ASCII landscape audit passed (${dropdownModeCount} deterministic dropdown identities; Pressure-style module displays; zero decoders).`);"
summary_new = "console.log(`CALCOTONE ASCII landscape audit passed (${dropdownModeCount} deterministic dropdown identities; high-fidelity spectacle module displays; zero decoders).`);"
audit = audit.replace(summary_old, summary_new)
ascii_audit_path.write_text(audit)
