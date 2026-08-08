import { useEffect, useRef } from 'react';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { canvasPixelRatio, getDisplayProfile, subscribeDisplayProfile } from '../../ui/displayProfile';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import { getLoopState, LOOP_TRACK_COUNT } from '../signal/loopStore';
import './PressureStyleDisplay.css';

export type RailCHardwareKind = 'stomp' | 'stack' | 'loop';

interface RailCHardwareDisplayProps {
  kind: RailCHardwareKind;
  enabled: boolean;
  visualState: VisualAudioState;
  modeLabel: string;
  detailLabel?: string;
  loopWaveform?: readonly number[];
  trimStart?: number;
  trimEnd?: number;
  trimEditing?: boolean;
  loopProgress?: number;
}

type HardwareProfile = {
  title: string;
  subtitle: string;
  meterLabel: string;
  primary: string;
  glyphs: string;
};

const PROFILES: Record<RailCHardwareKind, HardwareProfile> = {
  stomp: {
    title: 'S T O M P',
    subtitle: 'ANALOG PEDAL MATRIX',
    meterLabel: 'DRIVE',
    primary: '#e9b57c',
    glyphs: ' ·─╪█',
  },
  stack: {
    title: 'S T A C K',
    subtitle: 'AMPLIFIER / CABINET',
    meterLabel: 'POWER',
    primary: '#9de8f2',
    glyphs: ' ·─≈█',
  },
  loop: {
    title: 'L O O P',
    subtitle: 'MEMORY TRANSPORT',
    meterLabel: 'BUF',
    primary: '#d7c8ff',
    glyphs: ' .-|*#',
  },
};

const OFF_WHITE = '#f2ead8';
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
  return gx * gy >= 0 ? '/' : '\\';
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function fitText(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function centerText(value: string, width: number): string {
  const fitted = fitText(value, width);
  const left = Math.max(0, Math.floor((width - fitted.length) / 2));
  return `${' '.repeat(left)}${fitted}${' '.repeat(Math.max(0, width - fitted.length - left))}`;
}

function meter(value: number, width: number): string {
  const active = Math.max(0, Math.min(width, Math.round(clamp01(value) * width)));
  return `${'█'.repeat(active)}${'░'.repeat(width - active)}`;
}

function field(kind: RailCHardwareKind, x: number, y: number, phase: number, audio: VisualAudioState): number {
  const activity = clamp01(audio.level * 0.7 + audio.transient * 0.3);
  if (kind === 'stomp') {
    const raw = Math.sin(x * 7.6 + phase) * (0.2 + audio.low * 0.17);
    const clipped = Math.max(-0.18, Math.min(0.18, raw));
    const diode = Math.abs(Math.abs(x) - 0.45) < 0.025 ? 0.28 : 0;
    return 0.9 - Math.abs(y - clipped) * 9.8 + diode + activity * 0.08;
  }
  if (kind === 'stack') {
    const fundamental = Math.sin(x * 5.4 + phase * 0.54) * (0.2 + audio.low * 0.12);
    const harmonic = Math.sin(x * 10.8 - phase * 0.28) * 0.075;
    const cabinet = Math.abs((x * 6) % 1 - 0.5) < 0.045 ? 0.16 : 0;
    return 0.9 - Math.abs(y - fundamental - harmonic) * 8.8 + cabinet + activity * 0.1;
  }

  // LOOP intentionally reads as stored/circular motion rather than another
  // waveform meter. The ring stays subtle and the playhead only brightens with
  // real signal activity, matching the rest of Calcotone's hardware screens.
  const radius = Math.sqrt(x * x + y * y);
  const angle = Math.atan2(y, x);
  const ring = 1 - Math.abs(radius - 0.56) * 16;
  const innerRing = 0.58 - Math.abs(radius - 0.34) * 12;
  const playheadAngle = Math.atan2(Math.sin(angle - phase), Math.cos(angle - phase));
  const playhead = Math.max(0, 1 - Math.abs(playheadAngle) * 7) * Math.max(0, 1 - Math.abs(radius - 0.56) * 24);
  const memoryTrace = Math.max(0, 0.62 - Math.abs(y - Math.sin(x * 8.5 + phase * 0.22) * (0.055 + audio.mid * 0.035)) * 11);
  return Math.max(ring * 0.76, innerRing * 0.42, memoryTrace * (0.7 + activity * 0.12), playhead * (0.82 + activity * 0.18));
}

function draw(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  props: RailCHardwareDisplayProps,
  stamp: number,
): void {
  const profile = PROFILES[props.kind];
  if (props.kind === 'stomp' || props.kind === 'stack') {
    drawRailSpectacle(context, width, height, dpr, props, stamp);
    return;
  }
  const highDefinition = getDisplayProfile().reference1440p;
  const denseLoopTrim = props.kind === 'loop' && props.trimEditing;
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
        : Math.max(5.8, Math.min(8.4, width / columns * 1.5));
  const lineHeight = fontSize * 1.08;
  const rows = Math.max(16, Math.floor(height / lineHeight));
  const innerWidth = columns - 2;
  const graphStart = 7;
  const graphEnd = Math.max(graphStart + 3, rows - 3);
  const graphRows = Math.max(1, graphEnd - graphStart);
  const phase = ((stamp / 1000) % 18) / 18 * TAU;
  const drawPhase = props.kind === 'loop' && Number.isFinite(props.loopProgress)
    ? clamp01(props.loopProgress ?? 0) * TAU
    : phase;
  const activity = props.enabled ? clamp01(props.visualState.level * 0.72 + props.visualState.transient * 0.28) : 0;
  // Loopy-inspired motion language, translated into Calcotone hardware ASCII:
  // eight circular clip orbits, one accurate selected-track wiper, and no
  // imitation of Loopy Pro's colors, controls, layout, or branded appearance.
  const loopState = props.kind === 'loop' ? getLoopState() : null;
  const loopSelectedTrack = loopState?.selectedTrack ?? 0;
  const loopTrackMask = loopState?.trackMask ?? 0;
  const loopTransport = loopState?.transport ?? 'empty';
  const loopSelectedProgress = clamp01(props.loopProgress ?? 0);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#050706';
  context.fillRect(0, 0, width, height);
  context.font = `700 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
  const textWidth = Math.max(1, context.measureText('M'.repeat(columns)).width);
  const textHeight = Math.max(1, (rows - 1) * lineHeight + fontSize);
  context.setTransform(dpr * width / textWidth, 0, 0, dpr * height / textHeight, 0, 0);
  context.textBaseline = 'top';
  context.shadowBlur = props.enabled ? (highDefinition ? 2.4 : 3) : 1;

  const levelMeter = meter(props.enabled ? 0.15 + activity * 0.85 : 0, Math.max(8, innerWidth - 12));
  const trimStart = clamp01(props.trimStart ?? 0);
  const trimEnd = Math.max(trimStart, clamp01(props.trimEnd ?? 1));
  const mode = fitText((props.kind === 'loop' && props.trimEditing ? 'TRIM EDIT' : props.modeLabel).toUpperCase(), Math.max(8, innerWidth - 6));
  const detailText = props.kind === 'loop' && props.trimEditing
    ? `IN ${(trimStart * 100).toFixed(1)}% // OUT ${(trimEnd * 100).toFixed(1)}%`
    : (props.detailLabel ?? '');
  const detail = fitText(detailText.toUpperCase(), Math.max(8, innerWidth - 6));

  for (let row = 0; row < rows; row += 1) {
    let line = '';
    let accentLine: string | null = null;
    let intensity = 0.45;

    if (row === 0) line = `╔${'═'.repeat(innerWidth)}╗`;
    else if (row === 1) line = `║${centerText(profile.title, innerWidth)}║`;
    else if (row === 2) line = `║${centerText(profile.subtitle, innerWidth)}║`;
    else if (row === 3) line = `╠${'═'.repeat(innerWidth)}╣`;
    else if (row === 4) line = `║${fitText(`${profile.meterLabel.padEnd(5)} ${levelMeter}`, innerWidth).padEnd(innerWidth)}║`;
    else if (row === 5) line = `║${fitText(`${props.kind === 'loop' ? 'STATE' : 'MODE '}  ${mode}`, innerWidth).padEnd(innerWidth)}║`;
    else if (row === 6 && detail) line = `║${fitText(`${props.kind === 'loop' ? 'TRACK' : 'PATH '}  ${detail}`, innerWidth).padEnd(innerWidth)}║`;
    else if (row >= graphStart && row < graphEnd) {
      const chars = Array.from({ length: innerWidth }, () => ' ');
      const accents = Array.from({ length: innerWidth }, () => ' ');
      if (props.kind === 'loop' && props.trimEditing) {
        const waveform = props.loopWaveform ?? [];
        const localRow = row - graphStart;
        const center = (graphRows - 1) * 0.5;
        const vertical = Math.abs(localRow - center) / Math.max(1, center);
        const inColumn = Math.round(trimStart * Math.max(1, innerWidth - 1));
        const outColumn = Math.round(trimEnd * Math.max(1, innerWidth - 1));
        const playColumn = Math.round(clamp01(props.loopProgress ?? 0) * Math.max(1, innerWidth - 1));
        for (let column = 0; column < innerWidth; column += 1) {
          const normalizedX = column / Math.max(1, innerWidth - 1);
          const waveformIndex = waveform.length > 0
            ? Math.min(waveform.length - 1, Math.floor(normalizedX * waveform.length))
            : 0;
          const amplitude = clamp01(waveform[waveformIndex] ?? 0);
          const inside = normalizedX >= trimStart && normalizedX <= trimEnd;
          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '|' : ':') : '.';
          else if (Math.abs(localRow - center) < 0.6) chars[column] = inside ? '-' : '.';
          if (column === inColumn) accents[column] = '[';
          if (column === outColumn) accents[column] = ']';
          if (column === playColumn && inside && localRow === Math.round(center)) accents[column] = '^';
          intensity = Math.max(intensity, amplitude);
        }
      } else if (props.kind === 'loop') {
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
      } else {
        const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;
        for (let column = 0; column < innerWidth; column += 1) {
          const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;
          const normalized = clamp01(field(props.kind, x, y, drawPhase, props.visualState));
          if (!props.enabled && normalized < 0.72) continue;
          if (normalized < 0.22) continue;
          const glyphIndex = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));
          chars[column] = profile.glyphs[glyphIndex] ?? ' ';
          if (normalized > 0.76 && (column + row) % 13 === 0) accents[column] = chars[column];
          intensity = Math.max(intensity, normalized);
        }
      }
      line = `║${chars.join('')}║`;
      accentLine = ` ${accents.join('')} `;
    } else if (row === rows - 2) {
      const footer = props.kind === 'loop'
        ? props.trimEditing
          ? 'TRANSIENT MEMORY // NON-DESTRUCTIVE TRIM'
          : (props.enabled ? 'SELECTED CLOCK // TRACK RAIL // TRUE PLAYHEAD' : 'MEMORY HELD // STANDBY')
        : (props.enabled ? 'ONLINE // SIGNAL LOCK' : 'BYPASS // STANDBY');
      line = `║${centerText(footer, innerWidth)}║`;
    } else if (row === rows - 1) line = `╚${'═'.repeat(innerWidth)}╝`;
    else line = `║${' '.repeat(innerWidth)}║`;

    const textRow = row <= 6 || row === rows - 2;
    context.globalAlpha = props.enabled ? 0.62 + intensity * 0.34 : 0.28 + intensity * 0.18;
    context.fillStyle = textRow ? profile.primary : OFF_WHITE;
    context.shadowColor = textRow ? profile.primary : OFF_WHITE;
    context.fillText(line, 0, row * lineHeight);
    if (accentLine) {
      context.fillStyle = profile.primary;
      context.shadowColor = profile.primary;
      context.fillText(accentLine, 0, row * lineHeight);
    }
  }

  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

export function RailCHardwareDisplay(props: RailCHardwareDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = canvasPixelRatio(1, 1, 5_400_000);
    let visible = true;
    let lastDraw = Number.NEGATIVE_INFINITY;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = canvasPixelRatio(width, height, 5_400_000);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      lastDraw = Number.NEGATIVE_INFINITY;
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const visibilityObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible) lastDraw = Number.NEGATIVE_INFINITY;
        }, { rootMargin: '80px' })
      : null;
    visibilityObserver?.observe(canvas);
    const unsubscribeProfile = subscribeDisplayProfile(resize);

    const render: ViewportRenderCallback = (stamp) => {
      if (!visible) return;
      const current = propsRef.current;
      const display = getDisplayProfile();
      const interval = current.enabled ? 1000 / (display.reference1440p ? 30 : 24) : 250;
      if (stamp - lastDraw < interval) return;
      lastDraw = stamp;
      draw(context, width, height, dpr, current, stamp);
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      unsubscribeProfile();
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pressure-style-display rail-c-hardware-art ${props.enabled ? 'is-active' : 'is-standby'}`}
      data-pressure-variant={props.kind}
      aria-hidden="true"
    />
  );
}
