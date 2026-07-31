import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
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
    glyphs: ' ░▒▓█',
  },
  chorus: {
    title: 'D R I F T',
    subtitle: 'MODULATION ARRAY',
    primary: '#79d7e7',
    secondary: '#e4fbff',
    meterLabel: 'WIDTH',
    glyphs: ' ·≈≋▓█',
  },
  delay: {
    title: 'H A L O',
    subtitle: 'ECHO NETWORK',
    primary: '#d6d9ff',
    secondary: '#fff0bd',
    meterLabel: 'ECHO',
    glyphs: ' ·○◉▓█',
  },
  reverb: {
    title: 'A T M O S',
    subtitle: 'SPATIAL CHAMBER',
    primary: '#c5b6ff',
    secondary: '#e7fbff',
    meterLabel: 'SPACE',
    glyphs: ' ·░▒▓█',
  },
  bitcrusher: {
    title: 'G R A I N',
    subtitle: 'PARTICLE MATRIX',
    primary: '#9ee38d',
    secondary: '#ffe28a',
    meterLabel: 'DENS',
    glyphs: ' ·▪▫▓█',
  },
  media: {
    title: 'A R T I F A C T',
    subtitle: 'MEDIA HARDWARE',
    primary: '#e7d4ad',
    secondary: '#e59abb',
    meterLabel: 'AGE',
    glyphs: ' ·─╪▓█',
  },
};

const TAU = Math.PI * 2;
const LOOP_SECONDS = 18;

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

function fieldForModule(
  moduleId: string,
  x: number,
  y: number,
  phase: number,
  seed: number,
  audio: VisualAudioState,
): number {
  const detail = 3 + seed % 9;
  const sway = Math.sin(phase + (seed % 31) * 0.08);
  const counter = Math.cos(phase * 2 - (seed % 23) * 0.07);
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);

  switch (moduleId) {
    case 'saturation': {
      const flame = Math.sin((y + 1.05) * (5.4 + detail * 0.18) - Math.abs(x) * 4.2 + sway * 0.7);
      const core = Math.max(0, 1 - Math.hypot(x * 1.65, y - 0.32));
      return flame * (0.42 + core * 0.36) + core * 0.72 + audio.low * 0.18;
    }
    case 'chorus': {
      const left = Math.sin(y * (7 + detail * 0.28) + x * 2.4 + sway * 0.7);
      const right = Math.sin(y * (8.5 + detail * 0.22) - x * 2.8 - sway * 0.6);
      return (left + right) * 0.44 + Math.cos(x * 4 + counter * 0.4) * 0.22 + audio.mid * 0.2;
    }
    case 'delay': {
      const ringA = Math.cos((radius - 0.18) * (11 + detail * 0.5) - sway * 0.65);
      const ringB = Math.cos((Math.hypot(x * 0.72, y) - 0.5) * (8 + detail * 0.28) + counter * 0.4);
      return ringA * 0.55 + ringB * 0.32 + (1 - radius) * 0.2 + audio.transient * 0.18;
    }
    case 'reverb': {
      const vault = Math.cos(Math.hypot(x * 0.76, y + 0.42) * (10 + detail * 0.34) - sway * 0.38);
      const cloud = Math.sin(x * 3.4 + sway * 0.4) * Math.cos(y * 4.2 - counter * 0.3);
      return vault * 0.48 + cloud * 0.38 + (1 - Math.abs(y)) * 0.18 + audio.level * 0.2;
    }
    case 'bitcrusher': {
      const gridX = Math.floor((x + 1) * (5 + detail % 5));
      const gridY = Math.floor((y + 1) * (4 + detail % 4));
      const block = Math.cos(gridX + gridY + sway * 0.45);
      const fracture = noise(gridX, gridY, seed) > 0.68 - audio.transient * 0.08 ? 0.9 : -0.2;
      return block * 0.38 + fracture + Math.cos(x * y * 18 + counter * 0.4) * 0.2;
    }
    case 'media': {
      const scan = Math.cos(y * (18 + detail) + sway * 0.5);
      const chassis = Math.cos(x * (5 + detail % 6)) * Math.cos(y * (4 + detail % 5));
      const dropout = noise(Math.floor(x * 21), Math.floor(y * 17), seed) > 0.91 ? -1.1 : 0.08;
      return scan * 0.3 + chassis * 0.55 + dropout + Math.cos(angle * 2 + counter * 0.3) * 0.12;
    }
    default:
      return Math.cos(x * 8 + sway * 0.4) * Math.sin(y * 9 - counter * 0.3);
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
  const columns = Math.max(42, Math.min(72, Math.floor(width / 5.25)));
  const fontSize = Math.max(5.8, Math.min(8.4, width / columns * 1.5));
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
  context.shadowBlur = enabled ? 3 : 1;

  const activity = enabled ? clamp01(audio.level * 0.72 + audio.transient * 0.28) : 0;
  const mode = moduleModeLabel(module);
  const levelMeter = meter(enabled ? 0.16 + activity * 0.84 : 0, Math.max(8, innerWidth - 12));

  for (let row = 0; row < rows; row += 1) {
    let line = '';
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
      const y = ((row - graphStart) / Math.max(1, graphRows - 1)) * 2 - 1;
      for (let column = 0; column < innerWidth; column += 1) {
        const x = (column / Math.max(1, innerWidth - 1)) * 2 - 1;
        let value = fieldForModule(module.id, x, y, phase, seed, audio);
        value += (noise(column, row, seed) - 0.5) * (0.1 + audio.high * 0.12);
        const normalized = clamp01(0.42 + value * 0.38 + activity * 0.1);
        if (!enabled && normalized < 0.68) continue;
        if (normalized < 0.31) continue;
        const index = Math.min(profile.glyphs.length - 1, Math.floor(normalized * profile.glyphs.length));
        chars[column] = profile.glyphs[index] ?? ' ';
        intensity = Math.max(intensity, normalized);
      }
      line = `║${chars.join('')}║`;
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
    context.fillStyle = row % 5 === 0 ? profile.secondary : profile.primary;
    context.fillText(line, 0, row * lineHeight);
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
    let dpr = Math.min(1.35, window.devicePixelRatio || 1);
    let visible = true;
    let lastDraw = Number.NEGATIVE_INFINITY;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(1.35, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
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

    const render: ViewportRenderCallback = (stamp) => {
      if (!visible) return;
      const active = moduleRef.current.enabled && moduleRef.current.available;
      const interval = active ? 1000 / 18 : 250;
      if (stamp - lastDraw < interval) return;
      lastDraw = stamp;
      drawDisplay(context, width, height, dpr, moduleRef.current, audioRef.current, stamp);
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
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
