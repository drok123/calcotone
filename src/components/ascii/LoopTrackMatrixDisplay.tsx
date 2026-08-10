import { useEffect, useRef } from 'react';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { canvasPixelRatio, getDisplayProfile, subscribeDisplayProfile } from '../../ui/displayProfile';
import {
  LOOP_VISIBLE_TRACK_COUNT,
  loopTrackProgress,
  useLoopState,
  type LoopState,
  type LoopTrackRuntime,
} from '../signal/loopStore';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import './PressureStyleDisplay.css';

interface LoopTrackMatrixDisplayProps {
  enabled: boolean;
  visualState: VisualAudioState;
  trimEditing?: boolean;
}

const OFF_WHITE = '#f2ead8';
const LOOP_PURPLE = '#d7c8ff';
const TAU = Math.PI * 2;
const SHADE_RAMP = ' .:-=+*#%@';
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function edgeGlyph(gx: number, gy: number): string {
  const ax = Math.abs(gx);
  const ay = Math.abs(gy);
  if (ax > ay * 1.8) return '|';
  if (ay > ax * 1.8) return '-';
  return gx * gy >= 0 ? '/' : '\\';
}

function trackStateLabel(state: LoopState, track: number): string {
  const bit = 1 << track;
  const occupied = (state.trackMask & bit) !== 0;
  if (track === state.selectedTrack && state.transport === 'recording') return 'REC';
  if (track === state.selectedTrack && state.transport === 'overdubbing') return 'DUB';
  if (!occupied) return 'EMPTY';
  if ((state.trackMuteMask & bit) !== 0) return 'MUTE';
  if ((state.trackSoloMask & bit) !== 0) return 'SOLO';
  return (state.trackActiveMask & bit) !== 0 ? 'PLAY' : 'STOP';
}

function trackMoving(state: LoopState, track: number): boolean {
  if (track === state.selectedTrack && (state.transport === 'recording' || state.transport === 'overdubbing')) return true;
  const bit = 1 << track;
  const transportRunning = state.transport === 'playing' || state.transport === 'recording' || state.transport === 'overdubbing';
  return (state.trackMask & bit) !== 0
    && (state.trackActiveMask & bit) !== 0
    && transportRunning;
}

function runningTrackProgress(state: LoopState, track: number, runtime: LoopTrackRuntime | undefined, stamp: number): number {
  if (!runtime || runtime.loopFrames <= 0) return 0;
  const siblingDuringWrite = track !== state.selectedTrack
    && (state.transport === 'recording' || state.transport === 'overdubbing')
    && (state.trackMask & (1 << track)) !== 0
    && (state.trackActiveMask & (1 << track)) !== 0;
  if (!siblingDuringWrite) return loopTrackProgress(track, stamp);
  const elapsedFrames = Math.max(0, stamp - runtime.updatedAtMs) * state.sampleRate / 1000;
  return clamp01(((runtime.position + elapsedFrames) % runtime.loopFrames) / runtime.loopFrames);
}

function fourBitMask(value: number): string {
  return value.toString(2).padStart(4, '0').slice(-4);
}

function drawMatrix(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  enabled: boolean,
  visualState: VisualAudioState,
  state: LoopState,
  trimEditing: boolean,
  stamp: number,
): void {
  const highDefinition = getDisplayProfile().reference1440p;

  // The old matrix packed 84-112 columns and a forced 24 rows into this small
  // display. That preserved detail but crushed the final glyphs after the canvas
  // was scaled back into the physical viewport. Loop deliberately spends pixels
  // on legibility instead: fewer, heavier cells with a bounded 16-20 row grid.
  const columns = highDefinition
    ? Math.max(62, Math.min(72, Math.floor(width / 5.4)))
    : Math.max(58, Math.min(68, Math.floor(width / 5.8)));
  const fontSize = highDefinition
    ? Math.max(6.4, Math.min(9.2, width / columns * 1.55))
    : Math.max(6.0, Math.min(8.6, width / columns * 1.50));
  const lineHeight = fontSize * 1.08;
  const rows = Math.max(16, Math.min(20, Math.floor(height / lineHeight)));
  const headerRows = 3;
  const footerRows = 1;
  const graphStart = headerRows;
  const graphRows = Math.max(10, rows - headerRows - footerRows);
  const cellWidth = Math.floor(columns / 2);
  const cellHeight = Math.floor(graphRows / 2);
  const chars = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ' '));
  const accents = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ' '));
  const activity = enabled ? clamp01(visualState.level * 0.72 + visualState.transient * 0.28) : 0;

  const title = 'L O O P  //  4 TRACK MEMORY';
  const status = trimEditing
    ? `TRIM T${state.selectedTrack + 1}  IN ${(state.trimStart * 100).toFixed(1)}%  OUT ${(state.trimEnd * 100).toFixed(1)}%`
    : 'CLICK REC/DUB  RMB STOP  CTRL MUTE  ALT SOLO  SHIFT CLEAR';
  const writeCentered = (row: number, text: string): void => {
    const value = text.slice(0, columns);
    const start = Math.max(0, Math.floor((columns - value.length) / 2));
    for (let index = 0; index < value.length; index += 1) chars[row]![start + index] = value[index]!;
  };
  writeCentered(0, title);
  writeCentered(1, status);
  for (let column = 0; column < columns; column += 1) chars[2]![column] = column % 2 === 0 ? '-' : ' ';

  for (let track = 0; track < LOOP_VISIBLE_TRACK_COUNT; track += 1) {
    const cellColumn = track % 2;
    const cellRow = Math.floor(track / 2);
    const left = cellColumn * cellWidth;
    const top = graphStart + cellRow * cellHeight;
    const right = cellColumn === 1 ? columns : left + cellWidth;
    const bottom = cellRow === 1 ? graphStart + graphRows : top + cellHeight;
    const localWidth = Math.max(12, right - left);
    const localHeight = Math.max(6, bottom - top);
    const centerColumn = left + (localWidth - 1) * 0.5;
    const centerRow = top + (localHeight - 1) * 0.5;
    const radiusX = Math.max(5.5, localWidth * 0.315);
    const radiusY = Math.max(2.0, localHeight * 0.37);
    const occupied = (state.trackMask & (1 << track)) !== 0;
    const recording = track === state.selectedTrack && state.transport === 'recording';
    const moving = trackMoving(state, track);
    const runtime = state.trackRuntime[track];
    const waveform = runtime?.waveform ?? [];
    const progress = recording ? ((stamp / 1000) % 4) / 4 : runningTrackProgress(state, track, runtime, stamp);
    const selected = track === state.selectedTrack;

    for (let row = top; row < bottom; row += 1) {
      for (let column = left; column < right; column += 1) {
        const nx = (column - centerColumn) / radiusX;
        const ny = (row - centerRow) / radiusY;
        const radius = Math.sqrt(nx * nx + ny * ny);
        const angle = Math.atan2(ny, nx);
        const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;
        const wiperDelta = Math.abs(((orbitPosition - progress + 1.5) % 1) - 0.5);
        const trailDelta = (progress - orbitPosition + 1) % 1;

        const outerRim = clamp01(1 - Math.abs(radius - 1.025) / 0.13);
        const rimBody = clamp01(1 - Math.abs(radius - 0.955) / 0.14) * 0.56;
        const innerGroove = clamp01(1 - Math.abs(radius - 0.855) / 0.075) * 0.72;
        const indexTick = Math.max(0, 1 - Math.abs(Math.sin(angle * 6)) / 0.14)
          * clamp01(1 - Math.abs(radius - 1.13) / 0.09) * 0.92;
        const ordered = BAYER_4[(row - top) & 3]![(column - left) & 3]! / 15 - 0.5;
        const shellIntensity = clamp01(Math.max(outerRim * 0.96, rimBody, innerGroove, indexTick) + ordered * 0.04);

        if (shellIntensity > 0.08) {
          chars[row]![column] = shellIntensity > 0.68
            ? edgeGlyph(nx, ny)
            : SHADE_RAMP[Math.min(
                SHADE_RAMP.length - 1,
                Math.max(1, Math.round(shellIntensity * (SHADE_RAMP.length - 1))),
              )] ?? '.';
        }

        const onOuterMotionBand = Math.abs(radius - 1.025) < 0.19;
        if ((occupied || recording) && moving && onOuterMotionBand && trailDelta < 0.105) {
          accents[row]![column] = trailDelta < 0.025 || wiperDelta < 0.018 ? '*' : '+';
        }
        if ((occupied || recording) && onOuterMotionBand && wiperDelta < 0.016) accents[row]![column] = '*';

        // TRIM stays on the selected orbit, but its active arc and boundary marks
        // are deliberately wider now so the display reads at a glance.
        if (trimEditing && selected && occupied && onOuterMotionBand) {
          const insideTrim = state.trimEnd >= state.trimStart
            ? orbitPosition >= state.trimStart && orbitPosition <= state.trimEnd
            : orbitPosition >= state.trimStart || orbitPosition <= state.trimEnd;
          if (insideTrim && accents[row]![column] === ' ') accents[row]![column] = '+';
          const inDelta = Math.abs(((orbitPosition - state.trimStart + 1.5) % 1) - 0.5);
          const outDelta = Math.abs(((orbitPosition - state.trimEnd + 1.5) % 1) - 0.5);
          if (inDelta < 0.022) accents[row]![column] = '[';
          if (outDelta < 0.022) accents[row]![column] = ']';
        }

        const waveLeft = centerColumn - radiusX * 0.72;
        const waveRight = centerColumn + radiusX * 0.72;
        if (column >= waveLeft && column <= waveRight && waveform.length > 0 && radius < 0.76) {
          const normalizedX = (column - waveLeft) / Math.max(1, waveRight - waveLeft);
          const waveformIndex = Math.min(waveform.length - 1, Math.floor(normalizedX * waveform.length));
          const amplitude = clamp01(waveform[waveformIndex] ?? 0);
          const normalizedDistance = Math.abs(row - centerRow) / Math.max(1, radiusY * 0.50);
          if (amplitude > 0.015 && normalizedDistance <= amplitude) {
            const waveIntensity = clamp01(1 - normalizedDistance / Math.max(0.06, amplitude));
            chars[row]![column] = waveIntensity > 0.72 ? '|' : waveIntensity > 0.36 ? '+' : ':';
          } else if (Math.abs(row - centerRow) < 0.45 && chars[row]![column] === ' ') {
            chars[row]![column] = '.';
          }
        }
      }
    }

    const label = `${selected ? '[' : ' '}T${track + 1} ${trackStateLabel(state, track)}${selected ? ']' : ' '}`;
    const labelRow = Math.max(top, Math.min(bottom - 1, Math.round(centerRow)));
    const labelStart = Math.max(left, Math.round(centerColumn - label.length / 2));
    for (let index = 0; index < label.length && labelStart + index < right; index += 1) {
      const column = labelStart + index;
      if (selected) {
        chars[labelRow]![column] = ' ';
        accents[labelRow]![column] = label[index]!;
      } else {
        chars[labelRow]![column] = label[index]!;
        accents[labelRow]![column] = ' ';
      }
    }
  }

  const footer = `${state.transport.toUpperCase()} // A:${fourBitMask(state.trackActiveMask)} M:${fourBitMask(state.trackMuteMask)} S:${fourBitMask(state.trackSoloMask)} // ${enabled ? 'ONLINE' : 'STANDBY'}`;
  writeCentered(rows - 1, footer);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#050706';
  context.fillRect(0, 0, width, height);
  context.font = `800 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
  const textWidth = Math.max(1, context.measureText('M'.repeat(columns)).width);
  const textHeight = Math.max(1, (rows - 1) * lineHeight + fontSize);
  context.setTransform(dpr * width / textWidth, 0, 0, dpr * height / textHeight, 0, 0);
  context.textBaseline = 'top';
  context.shadowBlur = enabled ? (highDefinition ? 1.4 : 1.8) : 0.6;

  for (let row = 0; row < rows; row += 1) {
    const structure = chars[row]!.join('');
    const motion = accents[row]!.join('');
    const textRow = row < headerRows || row === rows - 1;
    context.globalAlpha = enabled ? (textRow ? 0.94 : 0.72 + activity * 0.16) : 0.34;
    context.fillStyle = textRow ? LOOP_PURPLE : OFF_WHITE;
    context.shadowColor = textRow ? LOOP_PURPLE : OFF_WHITE;
    context.fillText(structure, 0, row * lineHeight);
    if (motion.trim()) {
      context.globalAlpha = enabled ? 0.94 + activity * 0.05 : 0.24;
      context.fillStyle = LOOP_PURPLE;
      context.shadowColor = LOOP_PURPLE;
      context.fillText(motion, 0, row * lineHeight);
    }
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

export function LoopTrackMatrixDisplay({ enabled, visualState, trimEditing = false }: LoopTrackMatrixDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = useLoopState();
  const stateRef = useRef(state);
  const propsRef = useRef({ enabled, visualState, trimEditing });
  stateRef.current = state;
  propsRef.current = { enabled, visualState, trimEditing };

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
      drawMatrix(
        context,
        width,
        height,
        dpr,
        current.enabled,
        current.visualState,
        stateRef.current,
        current.trimEditing,
        stamp,
      );
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
      className={`pressure-style-display rail-c-hardware-art loop-track-matrix ${enabled ? 'is-active' : 'is-standby'}`}
      data-pressure-variant="loop"
      aria-hidden="true"
    />
  );
}
