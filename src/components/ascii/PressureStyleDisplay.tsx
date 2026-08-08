import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { canvasPixelRatio, getDisplayProfile, subscribeDisplayProfile } from '../../ui/displayProfile';
import { moduleModeKey, moduleModeLabel } from './AsciiArtEngine';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import './PressureStyleDisplay.css';

interface PressureStyleDisplayProps {
  module: ModuleState;
  visualState: VisualAudioState;
}

type DisplayProfile = {
  title: string;
  subtitle: string;
  primary: string;
  secondary: string;
  meterLabel: string;
  glyphs: string;
};

const PROFILES: Record<string, DisplayProfile> = {
  saturation: {
    title: 'E M B E R',
    subtitle: 'THERMIONIC DRIVE',
    primary: '#ffbf69',
    secondary: '#fff1cf',
    meterLabel: 'HEAT',
    glyphs: ' ·─═█',
  },
  chorus: {
    title: 'D R I F T',
    subtitle: 'MODULATION ARRAY',
    primary: '#79d7e7',
    secondary: '#e4fbff',
    meterLabel: 'WIDTH',
    glyphs: ' ·─≈█',
  },
  delay: {
    title: 'H A L O',
    subtitle: 'ECHO NETWORK',
    primary: '#d6d9ff',
    secondary: '#fff0bd',
    meterLabel: 'ECHO',
    glyphs: ' ·─○█',
  },
  reverb: {
    title: 'A T M O S',
    subtitle: 'SPATIAL CHAMBER',
    primary: '#c5b6ff',
    secondary: '#e7fbff',
    meterLabel: 'SPACE',
    glyphs: ' ·─┄█',
  },
  bitcrusher: {
    title: 'G R A I N',
    subtitle: 'PARTICLE MATRIX',
    primary: '#9ee38d',
    secondary: '#ffe28a',
    meterLabel: 'DENS',
    glyphs: ' ·▪▫█',
  },
  media: {
    title: 'A R T I F A C T',
    subtitle: 'MEDIA HARDWARE',
    primary: '#e7d4ad',
    secondary: '#e59abb',
    meterLabel: 'AGE',
    glyphs: ' ·─╪█',
  },
};

const TAU = Math.PI * 2;
const LOOP_SECONDS = 18;
const MODULE_ART_OFF_WHITE = '#f2ead8';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function noise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 0.000013) * 43758.5453123;
  return value - Math.floor(value);
}

function traceForModule(
  moduleId: string,
  x: number,
  phase: number,
  seed: number,
  audio: VisualAudioState,
): number {
  const offset = (seed % 17) * 0.021;
  switch (moduleId) {
    case 'saturation':
      return Math.sin(x * 7.2 + phase + offset) * (0.28 + audio.low * 0.2)
        + Math.sin(x * 14.4 - phase * 0.5) * 0.08;
    case 'chorus':
      return Math.sin(x * 5.6 + phase) * 0.23
        + Math.sin(x * 5.6 - phase * 0.72 + offset) * 0.17
        + audio.mid * 0.05;
    case 'delay': {
      const repeat = Math.sin(x * 8.4 - phase) * 0.18;
      const echo = Math.sin(x * 8.4 - phase - 1.1) * 0.1;
      return repeat + echo + audio.transient * 0.08;
    }
    case 'reverb':
      return Math.sin(x * 4.2 + phase * 0.34) * 0.13
        + Math.sin(x * 9.2 - phase * 0.22) * 0.07
        + audio.level * 0.06;
    case 'bitcrusher': {
      const steps = 7 + seed % 5;
      return Math.round(Math.sin(x * 6.6 + phase) * steps) / steps * 0.34;
    }
    case 'media':
      return Math.sin(x * 6.2 + phase * 0.45) * 0.16
        + Math.sin(x * 1.8 - phase * 0.18) * 0.08;
    default:
      return Math.sin(x * 7 + phase) * 0.2;
  }
}

function fieldForModule(
  moduleId: string,
  x: number,
  y: number,
  phase: number,
  seed: number,
  audio: VisualAudioState,
): number {
  const trace = traceForModule(moduleId, x, phase, seed, audio);
  const distance = Math.abs(y - trace);
  const activity = clamp01(audio.level * 0.72 + audio.transient * 0.28);
  const gridX = Math.abs((x * 8) % 1 - 0.5);
  const gridY = Math.abs((y * 6) % 1 - 0.5);
  const grid = Math.min(gridX, gridY) < 0.035 ? 0.2 : 0;

  switch (moduleId) {
    case 'saturation': {
      const threshold = 0.18 + audio.low * 0.08;
      const clipped = Math.abs(trace) > threshold ? 0.14 : 0;
      return 0.92 - distance * 8.8 + grid + clipped;
    }
    case 'chorus': {
      const secondTrace = traceForModule(moduleId, x, phase + 0.75, seed + 11, audio) + 0.16;
      return Math.max(0.9 - distance * 9.4, 0.82 - Math.abs(y - secondTrace) * 10.2) + grid * 0.5;
    }
    case 'delay': {
      const echoA = trace - 0.2;
      const echoB = trace - 0.38;
      return Math.max(
        0.94 - distance * 9.8,
        0.66 - Math.abs(y - echoA) * 11,
        0.42 - Math.abs(y - echoB) * 12,
      ) + grid * 0.45;
    }
    case 'reverb': {
      const envelope = Math.max(0, 0.42 - Math.abs(y) * 0.24);
      return 0.82 - distance * 8.2 + envelope * activity + grid * 0.75;
    }
    case 'bitcrusher': {
      const block = 0.94 - distance * 10.5;
      const sampleTick = Math.abs((x * 14 + phase * 0.35) % 1 - 0.5) < 0.055 ? 0.24 : 0;
      return block + sampleTick + grid * 0.45;
    }
    case 'media': {
      const dropout = noise(Math.floor((x + 1) * 24), Math.floor((y + 1) * 12), seed) > 0.95 ? -0.7 : 0;
      const scan = Math.abs((y * 10 + phase * 0.12) % 1 - 0.5) < 0.035 ? 0.2 : 0;
      return 0.78 - distance * 9.2 + scan + grid * 0.55 + dropout;
    }
    default:
      return 0.85 - distance * 9 + grid;
  }
}

function fitText(value: string, width: number): string {
  if (value.length <= width) return value;
  return value.slice(0, Math.max(0, width - 1)) + '…';
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

function drawDisplay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  module: ModuleState,
  audio: VisualAudioState,
  stamp: number,
): void {
  const profile = PROFILES[module.id] ?? PROFILES.media;
  const sceneKey = moduleModeKey(module);
  const seed = hashText(sceneKey);
  const phase = ((stamp / 1000) % LOOP_SECONDS) / LOOP_SECONDS * TAU;
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
  const graphStart = 6;
  const graphEnd = Math.max(graphStart + 3, rows - 3);
  const graphRows = Math.max(1, graphEnd - graphStart);
  const enabled = module.enabled && module.available;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#050706';
  context.fillRect(0, 0, width, height);
  context.font = `700 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
  const textWidth = Math.max(1, context.measureText('M'.repeat(columns)).width);
  const textHeight = Math.max(1, (rows - 1) * lineHeight + fontSize);
  context.setTransform(dpr * width / textWidth, 0, 0, dpr * height / textHeight, 0, 0);
  context.textBaseline = 'top';
  context.shadowColor = profile.primary;
  context.shadowBlur = enabled ? (highDefinition ? 2.4 : 3) : 1;

  const activity = enabled ? clamp01(audio.level * 0.72 + audio.transient * 0.28) : 0;
  const mode = moduleModeLabel(module);
  const levelMeter = meter(enabled ? 0.16 + activity * 0.84 : 0, Math.max(8, innerWidth - 12));

  for (let row = 0; row < rows; row += 1) {
    let line = '';
    let accentLine: string | null = null;
    let intensity = 0.5;

    if (row === 0) {
      line = `╔${'═'.repeat(innerWidth)}╗`;
      intensity = 0.9;
    } else if (row === 1) {
      line = `║${centerText(profile.title, innerWidth)}║`;
      intensity = 1;
    } else if (row === 2) {
      line = `║${centerText(profile.subtitle, innerWidth)}║`;
      intensity = 0.72;
    } else if (row === 3) {
      line = `╠${'═'.repeat(innerWidth)}╣`;
      intensity = 0.84;
    } else if (row === 4) {
      const label = `${profile.meterLabel.padEnd(5)} ${levelMeter}`;
      line = `║${fitText(label, innerWidth).padEnd(innerWidth)}║`;
      intensity = 0.78 + activity * 0.2;
    } else if (row === 5) {
      const label = `MODE  ${mode}`;
      line = `║${fitText(label, innerWidth).padEnd(innerWidth)}║`;
      intensity = 0.7;
    } else if (row >= graphStart && row < graphEnd) {
      const chars = Array.from({ length: innerWidth }, () => ' ');
      const accents = Array.from({ length: innerWidth }, () => ' ');
      const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;
      for (let column = 0; column < innerWidth; column += 1) {
        const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;
        let value = fieldForModule(module.id, x, y, phase, seed, audio);
        value += (noise(column, row, seed) - 0.5) * (0.035 + audio.high * 0.04);
        const normalized = clamp01(value);
        if (!enabled && normalized < 0.72) continue;
        if (normalized < 0.22) continue;
        const index = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));
        chars[column] = profile.glyphs[index] ?? ' ';
        if (normalized > 0.76 && (column + row + seed) % 17 === 0) {
          accents[column] = chars[column];
        }
        intensity = Math.max(intensity, normalized);
      }
      line = `║${chars.join('')}║`;
      accentLine = ` ${accents.join('')} `;
    } else if (row === rows - 2) {
      const status = `${enabled ? 'ONLINE' : 'BYPASS'} // ${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
      line = `║${centerText(status, innerWidth)}║`;
      intensity = enabled ? 0.76 : 0.38;
    } else if (row === rows - 1) {
      line = `╚${'═'.repeat(innerWidth)}╝`;
      intensity = 0.9;
    } else {
      line = `║${' '.repeat(innerWidth)}║`;
      intensity = 0.38;
    }

    context.globalAlpha = enabled ? 0.62 + intensity * 0.34 : 0.28 + intensity * 0.18;
    const graphRow = row >= graphStart && row < graphEnd;
    const textRow = row === 1 || row === 2 || row === 4 || row === 5 || row === rows - 2;
    context.fillStyle = textRow ? profile.primary : MODULE_ART_OFF_WHITE;
    context.shadowColor = textRow ? profile.primary : MODULE_ART_OFF_WHITE;
    context.fillText(line, 0, row * lineHeight);
    if (graphRow && accentLine) {
      context.fillStyle = profile.primary;
      context.shadowColor = profile.primary;
      context.fillText(accentLine, 0, row * lineHeight);
    }
  }

  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

export function PressureStyleDisplay({ module, visualState }: PressureStyleDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moduleRef = useRef(module);
  const audioRef = useRef(visualState);
  moduleRef.current = module;
  audioRef.current = visualState;

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
      const active = moduleRef.current.enabled && moduleRef.current.available;
      const display = getDisplayProfile();
      const interval = active ? 1000 / (display.reference1440p ? 30 : 24) : 250;
      if (stamp - lastDraw < interval) return;
      lastDraw = stamp;
      drawDisplay(context, width, height, dpr, moduleRef.current, audioRef.current, stamp);
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
      className={`pressure-style-display ${module.enabled ? 'is-active' : 'is-standby'}`}
      data-pressure-variant={module.id}
      aria-hidden="true"
    />
  );
}
