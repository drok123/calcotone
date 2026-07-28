import { useEffect, useRef } from 'react';
import type { SignalLabState } from '../../audio/SignalLab';
import type { ModuleState } from '../../ui/types';
import { getLatestVisualAudioState, type VisualAudioState } from '../../visual/VisualEngine';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import './AsciiArtEngine.css';

type AsciiKind = 'module' | 'landscape';

export interface AsciiArtEngineProps {
  kind: AsciiKind;
  module?: ModuleState;
  modules?: ModuleState[];
  position?: { x: number; y: number };
  dragging?: boolean;
  pressure?: SignalLabState;
  patchCount?: number;
  className?: string;
}

interface SceneLayer {
  id: string;
  key: string;
  seed: number;
  weight: number;
}

interface PreparedScene extends AsciiArtEngineProps {
  active: boolean;
  label: string;
  sceneKey: string;
  layers: SceneLayer[];
}

interface ModuleTheme {
  primary: string;
  secondary: string;
  glyphs: string;
}

const THEMES: Record<string, ModuleTheme> = {
  saturation: { primary: '#ffbf69', secondary: '#fff1cf', glyphs: ' .:+=xX#@' },
  chorus: { primary: '#79d7e7', secondary: '#e4fbff', glyphs: ' .~-:=+*#' },
  delay: { primary: '#d6d9ff', secondary: '#fff0bd', glyphs: ' .:|/\\+X#' },
  reverb: { primary: '#c5b6ff', secondary: '#e7fbff', glyphs: ' .^/\\AVM#' },
  bitcrusher: { primary: '#9ee38d', secondary: '#ffe28a', glyphs: ' .`:+*%#@' },
  media: { primary: '#e7d4ad', secondary: '#e59abb', glyphs: ' ._-+=[]#' },
  landscape: { primary: '#b8e2d3', secondary: '#f3ead4', glyphs: ' .,:;+=x#@' },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function hashAsciiScene(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function moduleMode(module: ModuleState): string {
  switch (module.id) {
    case 'saturation': return module.emberMode ?? 'velvet';
    case 'chorus': return module.driftMode ?? 'chorus';
    case 'delay': return module.delayAlgorithm ?? 'tape';
    case 'reverb': return module.algorithm ?? 'hall';
    case 'bitcrusher': return module.grainMode ?? 'reconstruct';
    case 'media': return module.mediaMode ?? 'cassette';
    default: return 'default';
  }
}

export function moduleModeKey(module: ModuleState): string {
  return `${module.id}:${moduleMode(module)}`;
}

export function moduleModeLabel(module: ModuleState): string {
  return moduleMode(module).replace(/[-_]+/g, ' ').toUpperCase();
}

function moduleWeight(module: ModuleState): number {
  if (!module.enabled || !module.available) return 0;
  const mix = module.parameters.find((parameter) => parameter.id === 'mix')?.value ?? 0.55;
  const character = module.parameters.reduce((total, parameter) => total + parameter.value, 0) /
    Math.max(1, module.parameters.length);
  return 0.36 + clamp01(mix) * 0.42 + clamp01(character) * 0.22;
}

function prepareScene(props: AsciiArtEngineProps): PreparedScene {
  if (props.kind === 'module' && props.module) {
    const key = moduleModeKey(props.module);
    return {
      ...props,
      active: props.module.enabled && props.module.available,
      label: `${props.module.name.toUpperCase()} // ${moduleModeLabel(props.module)}`,
      sceneKey: key,
      layers: [{ id: props.module.id, key, seed: hashAsciiScene(key), weight: 1 }],
    };
  }

  const modules = props.modules ?? [];
  const layers = modules
    .map((module) => {
      const key = moduleModeKey(module);
      return { id: module.id, key, seed: hashAsciiScene(key), weight: moduleWeight(module) };
    })
    .filter((layer) => layer.weight > 0);
  const pressureKey = props.pressure?.enabled
    ? `pressure:${props.pressure.mode}:${props.pressure.style}`
    : 'pressure:off';
  const sceneKey = [...layers.map((layer) => layer.key), pressureKey].join('|') || 'landscape:idle';

  return {
    ...props,
    active: layers.length > 0 || Boolean(props.pressure?.enabled),
    label: props.pressure?.enabled
      ? `MOTION // ${props.pressure.mode.toUpperCase()} ${props.pressure.style.toUpperCase()}`
      : `MOTION // ${props.patchCount ?? 0} PATCH${props.patchCount === 1 ? '' : 'ES'}`,
    sceneKey,
    layers,
  };
}

function hashNoise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 0.000013) * 43758.5453123;
  return value - Math.floor(value);
}

function sampleLayer(
  layer: SceneLayer,
  u: number,
  v: number,
  time: number,
  audio: VisualAudioState,
): number {
  const variant = layer.seed % 17;
  const phase = time * (0.11 + (variant % 5) * 0.018) + audio.driftPhase * 2.4;
  const x = u + Math.sin(v * 3.1 + phase) * (0.018 + audio.mid * 0.025);
  const y = v + Math.sin(u * 4.3 - phase * 0.7) * (0.012 + audio.low * 0.024);
  const noise = hashNoise(Math.floor((x + 1) * 31), Math.floor((y + 1) * 23), layer.seed);
  let field = 0;

  switch (layer.id) {
    case 'saturation': {
      const radius = Math.hypot(x * (1.02 + variant * 0.008), y * 1.34);
      const rings = Math.cos(radius * (15 + variant * 0.45) - phase * 1.8);
      const flare = Math.cos(Math.atan2(y, x) * (4 + variant % 5) + phase) * 0.34;
      field = rings * 0.72 + flare + (1 - radius) * 0.45;
      break;
    }
    case 'chorus': {
      const reflection = Math.sin((y + Math.sin(x * (4 + variant * 0.12) + phase) * 0.16) * (12 + variant));
      const wake = Math.cos((x * 7 - y * 3) + phase * 1.4);
      field = reflection * 0.76 + wake * 0.28 - Math.abs(y) * 0.18;
      break;
    }
    case 'delay': {
      const echo = Math.cos((Math.abs(x) * (11 + variant * 0.32) + y * 3.2) - phase * 1.35);
      const towers = Math.cos((x + y * 0.18) * (8 + variant % 7));
      field = echo * 0.62 + towers * 0.34 + (1 - Math.abs(x)) * 0.16;
      break;
    }
    case 'reverb': {
      const mountain = 1 - Math.abs(y + 0.10 - Math.abs(Math.sin(x * (2.4 + variant * 0.08) + phase * 0.34)) * 0.56);
      const vault = Math.cos(Math.hypot(x * 0.78, y + 0.34) * (13 + variant * 0.22));
      field = mountain * 0.82 + vault * 0.42 - 0.58;
      break;
    }
    case 'bitcrusher': {
      const rain = Math.sin((y * (18 + variant) + Math.floor((x + 1) * (8 + variant % 4))) - phase * 2.2);
      const fracture = noise > 0.76 - audio.transient * 0.08 ? 0.9 : -0.22;
      field = rain * 0.42 + fracture + Math.cos(x * y * (18 + variant)) * 0.25;
      break;
    }
    case 'media': {
      const scan = Math.cos(y * (24 + variant) + phase * 0.8);
      const chassis = Math.cos(x * (6 + variant % 6)) * Math.cos(y * (5 + variant % 4));
      const dropout = noise > 0.88 ? -0.9 : 0.12;
      field = scan * 0.32 + chassis * 0.62 + dropout;
      break;
    }
    default:
      field = Math.cos(x * 8 + phase) * Math.sin(y * 9 - phase);
  }

  return field * layer.weight;
}

function pressureField(state: SignalLabState | undefined, u: number, v: number, time: number): number {
  if (!state?.enabled) return 0;
  const drive = clamp01(state.drive);
  const character = clamp01(state.character);
  switch (state.mode) {
    case 'fet':
      return Math.sin((u + v * 0.18) * (18 + drive * 10) - time * 0.8) * (0.12 + character * 0.18);
    case 'opto':
      return Math.cos(Math.hypot(u, v) * (11 + character * 7) - time * 0.28) * (0.10 + drive * 0.16);
    case 'varimu':
      return Math.sin(u * 8 + time * 0.21) * Math.cos(v * 7 - time * 0.17) * (0.12 + character * 0.16);
    case 'vca':
      return Math.cos((Math.abs(u) + Math.abs(v)) * (14 + drive * 8)) * (0.10 + character * 0.17);
  }
  return 0;
}

function framedLine(columns: number, label: string): string {
  const content = `[ ${label.slice(0, Math.max(0, columns - 8))} ]`;
  const remaining = Math.max(0, columns - content.length - 2);
  return `+${content}${'-'.repeat(remaining)}+`.slice(0, columns);
}

function drawAscii(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  scene: PreparedScene,
  stamp: number,
): void {
  const theme = scene.kind === 'module' && scene.module
    ? THEMES[scene.module.id] ?? THEMES.landscape
    : THEMES.landscape;
  const audio = getLatestVisualAudioState();
  const time = stamp / 1000;
  const columns = Math.max(scene.kind === 'landscape' ? 38 : 30, Math.min(scene.kind === 'landscape' ? 82 : 58, Math.floor(width / 6.6)));
  const cellWidth = width / columns;
  const fontSize = Math.max(7, Math.min(11.5, cellWidth * 1.42));
  const lineHeight = fontSize * 1.12;
  const rows = Math.max(9, Math.floor(height / lineHeight));
  const bodyRows = Math.max(1, rows - 2);
  const seed = hashAsciiScene(scene.sceneKey);
  const glyphs = theme.glyphs;
  const activeGain = scene.active ? 1 : 0.22;
  const cursorX = clamp01((scene.position?.x ?? 50) / 100);
  const cursorY = clamp01((scene.position?.y ?? 50) / 100);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#050706';
  context.fillRect(0, 0, width, height);
  context.font = `600 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`;
  context.textBaseline = 'top';
  context.shadowBlur = scene.active ? 4 : 1;
  context.shadowColor = theme.primary;

  for (let row = 0; row < rows; row += 1) {
    let line: string;
    if (row === 0) {
      line = framedLine(columns, scene.label);
    } else if (row === rows - 1) {
      const footer = `SEED ${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')} // ${scene.active ? 'ONLINE' : 'STANDBY'}`;
      line = framedLine(columns, footer);
    } else {
      const characters = new Array<string>(columns).fill(' ');
      characters[0] = '|';
      characters[columns - 1] = '|';
      const normalizedY = ((row - 1) / Math.max(1, bodyRows - 1)) * 2 - 1;

      for (let column = 1; column < columns - 1; column += 1) {
        const normalizedX = ((column - 1) / Math.max(1, columns - 3)) * 2 - 1;
        let value = 0;
        let totalWeight = 0;
        for (const layer of scene.layers) {
          value += sampleLayer(layer, normalizedX, normalizedY, time, audio);
          totalWeight += layer.weight;
        }
        if (totalWeight > 0) value /= Math.max(1, Math.sqrt(totalWeight));
        value += pressureField(scene.pressure, normalizedX, normalizedY, time);
        value += (hashNoise(column, row, seed) - 0.5) * (0.12 + audio.high * 0.12);

        if (scene.kind === 'landscape') {
          const dx = column / Math.max(1, columns - 1) - cursorX;
          const dy = (row - 1) / Math.max(1, bodyRows - 1) - (1 - cursorY);
          const reticle = Math.min(Math.abs(dx), Math.abs(dy));
          if (reticle < 0.008) value += scene.dragging ? 0.75 : 0.34;
        }

        const normalized = clamp01(0.48 + value * 0.42 + audio.level * 0.08);
        if (normalized < 0.25 || (!scene.active && normalized < 0.56)) continue;
        const glyphIndex = Math.min(glyphs.length - 1, Math.floor(normalized * glyphs.length));
        characters[column] = glyphs[glyphIndex];
      }
      line = characters.join('');
    }

    context.globalAlpha = activeGain * (row === 0 || row === rows - 1 ? 0.86 : 0.52 + audio.level * 0.18);
    context.fillStyle = row % 5 === 0 ? theme.secondary : theme.primary;
    context.fillText(line, 0, row * lineHeight);
  }

  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

export function AsciiArtEngine(props: AsciiArtEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<PreparedScene>(prepareScene(props));
  sceneRef.current = prepareScene(props);

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
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) canvas.width = pixelWidth;
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

    const render: ViewportRenderCallback = (stamp) => {
      if (!visible) return;
      const scene = sceneRef.current;
      const interval = scene.kind === 'landscape' && scene.dragging
        ? 1000 / 30
        : scene.active
          ? 1000 / 18
          : 250;
      if (stamp - lastDraw < interval) return;
      lastDraw = stamp;
      drawAscii(context, width, height, dpr, scene, stamp);
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
    };
  }, []);

  const scene = sceneRef.current;
  return (
    <canvas
      ref={canvasRef}
      className={`ascii-art-engine ${scene.active ? 'is-active' : 'is-standby'} ${props.className ?? ''}`}
      data-ascii-scene={scene.sceneKey}
      aria-hidden="true"
    />
  );
}
