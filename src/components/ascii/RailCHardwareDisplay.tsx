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
    glyphs: ' ·◦○●█',
  },
};

const OFF_WHITE = '#f2ead8';
const TAU = Math.PI * 2;

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
  const highDefinition = getDisplayProfile().reference1440p;
  const columns = highDefinition
    ? Math.max(44, Math.min(76, Math.floor(width / 5.05)))
    : Math.max(42, Math.min(72, Math.floor(width / 5.25)));
  const fontSize = highDefinition
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
          if (vertical <= amplitude * 0.92) chars[column] = inside ? (amplitude > 0.72 ? '█' : '│') : '·';
          else if (Math.abs(localRow - center) < 0.6) chars[column] = inside ? '─' : '·';
          if (column === inColumn || column === outColumn) accents[column] = '┃';
          if (column === playColumn && inside && localRow === Math.round(center)) accents[column] = '●';
          intensity = Math.max(intensity, amplitude);
        }
      } else if (props.kind === 'loop') {
        const localRow = row - graphStart;
        const y = ((localRow) / Math.max(1, graphRows - 1)) * 2 - 1;
        const recording = loopTransport === 'recording';
        const overdubbing = loopTransport === 'overdubbing';
        const playing = loopTransport === 'playing' || overdubbing;
        const animatedWiper = recording ? ((phase / TAU) % 1) : loopSelectedProgress;

        for (let column = 0; column < innerWidth; column += 1) {
          const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;
          for (let track = 0; track < LOOP_TRACK_COUNT; track += 1) {
            const gridColumn = track % 4;
            const gridRow = Math.floor(track / 4);
            const centerX = -0.75 + gridColumn * 0.5;
            const centerY = -0.5 + gridRow;
            const ellipseX = (x - centerX) / 0.205;
            const ellipseY = (y - centerY) / 0.335;
            const radius = Math.sqrt(ellipseX * ellipseX + ellipseY * ellipseY);
            const ringDistance = Math.abs(radius - 1);
            const occupied = (loopTrackMask & (1 << track)) !== 0;
            const selected = track === loopSelectedTrack;
            const selectedActive = selected && (occupied || recording);
            const angle = Math.atan2(ellipseY, ellipseX);
            const orbitPosition = ((angle + Math.PI * 0.5 + TAU) % TAU) / TAU;
            const wiperDelta = Math.abs(((orbitPosition - animatedWiper + 1.5) % 1) - 0.5);

            if (ringDistance < 0.17) {
              if (!occupied && !selectedActive) {
                if ((column + localRow + track) % 2 === 0) chars[column] = '·';
              } else if (selected) {
                const passed = playing && orbitPosition <= loopSelectedProgress;
                chars[column] = recording ? (orbitPosition <= animatedWiper ? '█' : '◦') : passed ? '●' : '○';
              } else {
                chars[column] = '◦';
              }
              intensity = Math.max(intensity, selected ? 0.9 : occupied ? 0.67 : 0.48);
            }

            // Selected-track wiper: this is the Loopy-style idea, expressed as
            // a tiny Calcotone ASCII playhead rather than a copied clip widget.
            if (selectedActive && ringDistance < 0.27 && wiperDelta < 0.035) {
              accents[column] = '●';
              intensity = 1;
            }

            // DUB grows a second inner memory orbit so layering is visible
            // without turning the screen into a busy waveform visualizer.
            if (selected && overdubbing && Math.abs(radius - 0.70) < 0.11) {
              chars[column] = (column + localRow) % 2 === 0 ? '◦' : '·';
              if ((column + localRow) % 7 === 0) accents[column] = '○';
              intensity = Math.max(intensity, 0.88);
            }
          }
        }

        // Put the track number inside every clip orbit. Selected track number
        // uses the sparse accent layer; all others remain Calcotone off-white.
        for (let track = 0; track < LOOP_TRACK_COUNT; track += 1) {
          const centerColumn = Math.round(((0.125 + (track % 4) * 0.25)) * Math.max(1, innerWidth - 1));
          const centerRow = Math.round((0.25 + Math.floor(track / 4) * 0.5) * Math.max(1, graphRows - 1));
          if (localRow !== centerRow || centerColumn < 0 || centerColumn >= innerWidth) continue;
          chars[centerColumn] = String(track + 1);
          if (track === loopSelectedTrack) accents[centerColumn] = String(track + 1);
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
          : (props.enabled ? 'CLIP ORBITS // 8 TRACK MEMORY' : 'MEMORY HELD // STANDBY')
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
