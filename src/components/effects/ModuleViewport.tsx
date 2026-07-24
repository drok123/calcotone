import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';

const WORLD_WIDTH = 240;
const WORLD_HEIGHT = 150;
const TAU = Math.PI * 2;

type RGB = readonly [number, number, number];
type ModulePalette = {
  primary: RGB;
  secondary: RGB;
  warm: RGB;
  pale: RGB;
};

type DrawKit = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  cx: number;
  cy: number;
  time: number;
  mix: number;
  energy: number;
  transient: number;
  palette: ModulePalette;
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string;
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void;
  glow: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void;
  orb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const hash = (value: number) => {
  const n = Math.sin(value * 127.1) * 43758.5453123;
  return n - Math.floor(n);
};

export function ModuleViewport({
  module,
  visualState,
}: {
  module: ModuleState;
  visualState: VisualAudioState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moduleRef = useRef(module);
  const visualRef = useRef(visualState);
  moduleRef.current = module;
  visualRef.current = visualState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let cssWidth = 1;
    let cssHeight = 1;
    let pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);

    const resizeCanvas = (): void => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    const render: ViewportRenderCallback = (time) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const currentModule = moduleRef.current;
      const currentParams: Record<string, number> = {};
      for (const parameter of currentModule.parameters) currentParams[parameter.id] = parameter.value;
      drawModuleViewport(
        context,
        cssWidth,
        cssHeight,
        currentModule,
        visualRef.current,
        currentParams,
        time / 1000
      );
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
    };
  }, [module.id]);

  return (
    <div className={`dsp-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}>
      <div className="viewport-glass" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="viewport-caption">{getViewportCaption(module)}</span>
    </div>
  );
}

function getViewportCaption(module: ModuleState): string {
  if (module.id === 'saturation') {
    const mode = module.emberMode ?? 'velvet';
    const captions: Record<string, string> = {
      goldlion: 'B759 · GOLD LION FIELD',
      mullard: 'ECC83 · MULLARD HEAT',
      telefunken: 'ECC83 · TELEFUNKEN GRID',
      bugleboy: '12AX7 · BUGLE BOY AIR',
      rcablack: '12AX7 · RCA BLACK PLATE',
    };
    return captions[mode] ?? 'THERMAL REACTOR';
  }
  if (module.id === 'chorus') {
    if (module.driftMode === 'ce1') return 'CE-1 · BBD CHORUS';
    if (module.driftMode === 'dimensiond') return 'DIMENSION D · PHASE MATRIX';
    return 'PHASE CURRENT';
  }
  if (module.id === 'delay') {
    if (module.delayAlgorithm === 're201') return 'RE-201 · TAPE ECHO';
    return formatAlgorithmName(module.delayAlgorithm ?? 'tape');
  }
  if (module.id === 'reverb') {
    if (module.algorithm === 'emt140') return 'EMT 140 · PLATE FIELD';
    if (module.algorithm === 'lexicon224') return '224 · DIGITAL SPACE';
    return (module.algorithm ?? 'hall').toUpperCase();
  }
  if (module.id === 'bitcrusher') {
    if (module.grainMode === 'sp1200') return 'SP-1200 · 26.04 KHZ';
    if (module.grainMode === 'mpc60') return 'MPC60 · 40 KHZ';
    if (module.grainMode === 'mirage') return 'MIRAGE · 8 BIT';
    return (module.grainMode ?? 'reconstruct').toUpperCase();
  }
  if (module.id === 'media') {
    if (module.mediaMode === 'tascam424') return 'PORTASTUDIO 424 · 4 TRACK';
    return (module.mediaMode ?? 'cassette').toUpperCase();
  }
  return 'SIGNAL WORLD';
}

function drawModuleViewport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  module: ModuleState,
  audio: VisualAudioState,
  params: Record<string, number>,
  time: number
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#010304';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  if (!module.enabled) {
    ctx.fillStyle = '#020405';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const mix = clamp01(params.mix ?? 0.5);
  const palette = paletteForModule(module.id);
  const energy = clamp01(audio.level * 1.55 + audio.low * 0.25 + audio.mid * 0.2);
  const transient = clamp01(audio.transient * 1.2);
  drawCanvasBackdrop(ctx, width, height, palette, mix, energy, time);

  const margin = 9;
  const scale = Math.max(
    0.01,
    Math.min((width - margin * 2) / WORLD_WIDTH, (height - margin * 2) / WORLD_HEIGHT)
  );
  const offsetX = (width - WORLD_WIDTH * scale) / 2;
  const offsetY = (height - WORLD_HEIGHT * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const whiteMix = 0.12 + mix * 0.44 + energy * 0.08;
  const rgba = (color: RGB, alpha: number, whiten = false) => {
    const blend = whiten ? whiteMix : 0;
    const r = Math.round(color[0] + (255 - color[0]) * blend);
    const g = Math.round(color[1] + (255 - color[1]) * blend);
    const b = Math.round(color[2] + (255 - color[2]) * blend);
    return `rgba(${r},${g},${b},${clamp01(alpha)})`;
  };
  const stroke = (color: RGB, alpha = 0.3, lineWidth = 1, whiten = true) => {
    ctx.strokeStyle = rgba(color, alpha, whiten);
    ctx.lineWidth = lineWidth;
  };
  const glow = (x: number, y: number, radius = 1.4, alpha = 0.45, color = palette.primary) => {
    ctx.save();
    ctx.fillStyle = rgba(color, alpha, true);
    ctx.shadowColor = rgba(color, Math.min(0.48, alpha));
    ctx.shadowBlur = 3 + radius * 2.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
  const orb = (x: number, y: number, radius: number, color: RGB, alpha: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, alpha, true));
    gradient.addColorStop(0.28, rgba(color, alpha * 0.32));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  };

  const kit: DrawKit = {
    ctx,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    cx: WORLD_WIDTH / 2,
    cy: WORLD_HEIGHT / 2,
    time,
    mix,
    energy,
    transient,
    palette,
    rgba,
    stroke,
    glow,
    orb,
  };

  drawWorldGrid(kit);
  const mode = currentMode(module);
  if (module.id === 'saturation') drawEmber(kit, mode, params);
  else if (module.id === 'chorus') drawDrift(kit, mode, params);
  else if (module.id === 'delay') drawHalo(kit, mode, params);
  else if (module.id === 'reverb') drawAtmos(kit, mode, params);
  else if (module.id === 'media') drawArtifact(kit, mode, params);
  else drawGrain(kit, mode, params);

  ctx.restore();
  drawOpticalFinish(ctx, width, height, palette, time);
}

function currentMode(module: ModuleState): string {
  if (module.id === 'saturation') return module.emberMode ?? 'velvet';
  if (module.id === 'chorus') return module.driftMode ?? 'chorus';
  if (module.id === 'delay') return module.delayAlgorithm ?? 'tape';
  if (module.id === 'reverb') return module.algorithm ?? 'hall';
  if (module.id === 'media') return module.mediaMode ?? 'cassette';
  return module.grainMode ?? 'reconstruct';
}

function paletteForModule(moduleId: string): ModulePalette {
  if (moduleId === 'saturation') return { primary: [244, 152, 67], secondary: [219, 76, 151], warm: [255, 194, 104], pale: [244, 236, 220] };
  if (moduleId === 'chorus') return { primary: [87, 208, 226], secondary: [132, 121, 255], warm: [233, 210, 130], pale: [226, 246, 246] };
  if (moduleId === 'delay') return { primary: [164, 130, 255], secondary: [78, 218, 223], warm: [252, 182, 101], pale: [234, 236, 250] };
  if (moduleId === 'reverb') return { primary: [90, 151, 255], secondary: [97, 224, 209], warm: [240, 187, 116], pale: [229, 242, 240] };
  if (moduleId === 'media') return { primary: [213, 154, 93], secondary: [80, 210, 214], warm: [250, 190, 108], pale: [239, 232, 215] };
  return { primary: [226, 108, 202], secondary: [83, 218, 216], warm: [245, 184, 105], pale: [234, 241, 237] };
}

function drawCanvasBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ModulePalette,
  mix: number,
  energy: number,
  time: number
): void {
  const rgba = (color: RGB, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${clamp01(alpha)})`;
  const cx = width / 2;
  const cy = height / 2;
  const radial = ctx.createRadialGradient(cx, cy * 0.92, 4, cx, cy, Math.max(width, height) * 0.7);
  radial.addColorStop(0, rgba(palette.primary, 0.09 + mix * 0.035 + energy * 0.035));
  radial.addColorStop(0.35, rgba(palette.secondary, 0.035 + energy * 0.02));
  radial.addColorStop(0.72, 'rgba(4,8,11,.985)');
  radial.addColorStop(1, '#010203');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  const horizon = ctx.createLinearGradient(0, height * 0.42, 0, height * 0.82);
  horizon.addColorStop(0, 'rgba(0,0,0,0)');
  horizon.addColorStop(0.52, rgba(palette.primary, 0.025 + energy * 0.015));
  horizon.addColorStop(0.58, rgba(palette.secondary, 0.035 + mix * 0.015));
  horizon.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i += 1) {
    const seed = hash(i * 7.17 + palette.primary[0]);
    const x = width * (0.05 + seed * 0.9) + Math.sin(time * 0.02 + i) * 2;
    const y = height * (0.08 + hash(i * 3.31 + palette.secondary[1]) * 0.72);
    const radius = 0.4 + hash(i * 4.7) * 1.2;
    ctx.fillStyle = i % 2 ? rgba(palette.primary, 0.04 + energy * 0.03) : rgba(palette.secondary, 0.035 + mix * 0.025);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawWorldGrid(kit: DrawKit): void {
  const { ctx, width, height, cx, cy, stroke, palette, time, energy } = kit;
  stroke(palette.primary, 0.055 + energy * 0.025, 0.55, false);
  for (let row = 0; row < 5; row += 1) {
    const p = row / 4;
    const y = cy + 18 + p * 46;
    const half = 92 - p * 24;
    ctx.beginPath();
    ctx.moveTo(cx - half, y);
    ctx.quadraticCurveTo(cx, y - 2 - Math.sin(time * 0.08 + row) * 0.8, cx + half, y);
    ctx.stroke();
  }
  for (let col = -4; col <= 4; col += 1) {
    const topX = cx + col * 15;
    const bottomX = cx + col * 22;
    ctx.beginPath();
    ctx.moveTo(topX, cy + 18);
    ctx.lineTo(bottomX, height + 2);
    ctx.stroke();
  }
}

function drawEmber(kit: DrawKit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, rgba, time, energy, transient } = kit;
  const drive = clamp01(params.drive ?? 0.2);
  const heat = clamp01(params.heat ?? 0.2);
  const character = clamp01(params.character ?? 0.3);
  const hardware = ['goldlion', 'mullard', 'telefunken', 'bugleboy', 'rcablack'].includes(mode);
  if (hardware) {
    drawTubeHardware(kit, mode, drive, heat, character);
    return;
  }

  orb(cx, cy - 4, 49 + heat * 12, palette.secondary, 0.055 + heat * 0.035 + energy * 0.025);
  orb(cx, cy - 8, 34 + drive * 12, palette.primary, 0.08 + drive * 0.06 + transient * 0.03);
  const coreR = 15 + drive * 10 + heat * 5;
  const core = ctx.createRadialGradient(cx - 4, cy - 15, 1, cx, cy - 7, coreR);
  core.addColorStop(0, rgba(palette.warm, 0.48 + heat * 0.18, true));
  core.addColorStop(0.34, rgba(palette.primary, 0.28 + drive * 0.12));
  core.addColorStop(0.76, rgba(palette.secondary, 0.07 + character * 0.07));
  core.addColorStop(1, rgba(palette.primary, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, coreR * 1.25, coreR * 0.78, Math.sin(time * 0.08) * 0.05, 0, TAU);
  ctx.fill();

  if (mode === 'tube') {
    for (let i = -1; i <= 1; i += 1) {
      const x = cx + i * 43;
      drawTubeEnvelope(kit, x, cy - 7, 13, 48, 0.32, palette.warm);
      const heaterY = cy - 24 + ((time * (8 + heat * 4) + i * 17) % 38);
      glow(x, heaterY, 1.6 + drive, 0.45 + heat * 0.22, palette.warm);
    }
  } else if (mode === 'transformer') {
    for (const side of [-1, 1]) {
      for (let band = -2; band <= 2; band += 1) {
        stroke(side < 0 ? palette.primary : palette.secondary, 0.16 + (2 - Math.abs(band)) * 0.04, 1.1);
        ctx.beginPath();
        for (let step = 0; step <= 46; step += 1) {
          const p = step / 46;
          const x = cx + side * 39 - 28 + p * 56;
          const y = cy - 5 + band * 10 + Math.sin(p * Math.PI * 12 + time * 0.15 * side) * 3.5;
          step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    glow(cx, cy - 5, 2.4, 0.48 + transient * 0.22, palette.warm);
  } else if (mode === 'console') {
    for (let row = -4; row <= 4; row += 1) {
      const y = cy - 7 + row * 9;
      const bend = Math.sin(time * 0.12 + row) * (1.2 + character * 3);
      stroke(row % 2 ? palette.secondary : palette.primary, 0.16 + (4 - Math.abs(row)) * 0.015, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 92, y);
      ctx.lineTo(cx - 42, y);
      ctx.quadraticCurveTo(cx, y + bend, cx + 36, y);
      ctx.lineTo(cx + 74, y);
      ctx.lineTo(cx + 74, cy + 33);
      ctx.stroke();
      glow(cx - 42, y, 0.9, 0.24 + energy * 0.08, palette.primary);
    }
  } else if (mode === 'furnace') {
    for (let i = -5; i <= 5; i += 1) {
      const x = cx + i * 16;
      const bend = Math.sin(time * 0.34 + i) * heat * 5;
      stroke(i % 2 ? palette.secondary : palette.primary, 0.19 + drive * 0.1, 1.15);
      ctx.beginPath();
      ctx.moveTo(x, cy - 42);
      ctx.lineTo(x - 7, cy - 15 + bend);
      ctx.lineTo(x, cy - 2);
      ctx.lineTo(x + 7, cy + 14 - bend);
      ctx.lineTo(x, cy + 37);
      ctx.stroke();
      if (i % 2 === 0) glow(x, cy - 2, 1.3 + heat, 0.3 + heat * 0.2, palette.warm);
    }
  } else if (mode === 'exciter') {
    for (let branch = -6; branch <= 6; branch += 1) {
      const y = cy - 7 + branch * 7;
      stroke(branch % 2 ? palette.secondary : palette.primary, 0.11 + (6 - Math.abs(branch)) * 0.014, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 92, cy - 4);
      ctx.quadraticCurveTo(cx - 36, y, cx + 16, y + Math.sin(time * 0.42 + branch) * 4 * character);
      ctx.quadraticCurveTo(cx + 54, y, cx + 92, cy - 4);
      ctx.stroke();
    }
  } else if (mode === 'broken') {
    for (let i = 0; i < 18; i += 1) {
      const row = i % 9;
      const y = cy - 41 + row * 10;
      const gap = 12 + (i * 7) % 25;
      stroke(i % 3 ? palette.primary : palette.secondary, 0.12 + (i % 4) * 0.035, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 94, y);
      ctx.lineTo(cx - gap, y);
      ctx.moveTo(cx + gap, y + (i % 2 ? 5 : -5));
      ctx.lineTo(cx + 92, y + (i % 2 ? 5 : -5));
      ctx.stroke();
      if (Math.sin(time * 0.45 + i * 2.7) > 0.72) glow(cx - gap, y, 1.2, 0.33, palette.secondary);
    }
  } else {
    for (let row = -4; row <= 4; row += 1) {
      const y = cy - 7 + row * 10;
      const breathe = Math.sin(time * 0.24 + row) * (2 + heat * 3.4);
      stroke(row % 2 ? palette.secondary : palette.primary, 0.14 + drive * 0.07, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 91, y);
      ctx.bezierCurveTo(cx - 44, y, cx - 26, y + breathe, cx, y + breathe);
      ctx.bezierCurveTo(cx + 28, y + breathe, cx + 48, y, cx + 91, y);
      ctx.stroke();
    }
  }
}

function drawTubeHardware(kit: DrawKit, mode: string, drive: number, heat: number, character: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy, transient } = kit;
  const profiles: Record<string, { plate: RGB; heater: RGB; spacing: number; tilt: number }> = {
    goldlion: { plate: [246, 196, 92], heater: [255, 211, 118], spacing: 45, tilt: 0.02 },
    mullard: { plate: [225, 117, 73], heater: [255, 174, 95], spacing: 40, tilt: -0.035 },
    telefunken: { plate: [183, 218, 228], heater: [255, 202, 120], spacing: 43, tilt: 0 },
    bugleboy: { plate: [241, 181, 96], heater: [255, 228, 153], spacing: 48, tilt: 0.045 },
    rcablack: { plate: [177, 112, 91], heater: [255, 126, 66], spacing: 38, tilt: -0.02 },
  };
  const profile = profiles[mode] ?? profiles.goldlion;
  orb(cx, cy - 6, 62, profile.plate, 0.055 + heat * 0.045 + energy * 0.03);
  orb(cx, cy + 4, 44, palette.secondary, 0.025 + character * 0.025);

  for (let tube = -1; tube <= 1; tube += 1) {
    const x = cx + tube * profile.spacing;
    drawTubeEnvelope(kit, x, cy - 7, 15, 55, 0.24 + drive * 0.11, profile.plate);
    stroke(profile.plate, 0.19 + heat * 0.1, 0.9);
    for (let grid = -2; grid <= 2; grid += 1) {
      const yy = cy - 7 + grid * 10;
      ctx.beginPath();
      ctx.moveTo(x - 8, yy);
      ctx.lineTo(x + 8, yy + Math.sin(time * 0.12 + tube + grid) * character * 1.4);
      ctx.stroke();
    }
    const heaterPhase = (time * (0.35 + heat * 0.25) + tube * 0.17) % 1;
    const heaterY = cy + 17 - heaterPhase * 42;
    glow(x, heaterY, 1.5 + drive * 0.7, 0.46 + heat * 0.24 + transient * 0.13, profile.heater);
  }

  if (mode === 'goldlion') {
    stroke(profile.plate, 0.22, 1.2);
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - 8, 34 + i * 14, 16 + i * 6, time * 0.012 * (i % 2 ? -1 : 1), 0, TAU);
      ctx.stroke();
    }
  } else if (mode === 'mullard') {
    for (let i = -5; i <= 5; i += 1) {
      stroke(i % 2 ? palette.secondary : profile.plate, 0.105 + (5 - Math.abs(i)) * 0.014, 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - 86, cy + i * 7);
      ctx.bezierCurveTo(cx - 32, cy + i * 8 + Math.sin(time * 0.15 + i) * 3, cx + 32, cy + i * 5, cx + 86, cy + i * 7);
      ctx.stroke();
    }
  } else if (mode === 'telefunken') {
    stroke(profile.plate, 0.3, 1.1);
    ctx.save();
    ctx.translate(cx, cy - 7);
    ctx.rotate(Math.PI / 4 + Math.sin(time * 0.05) * 0.02);
    for (let i = 0; i < 4; i += 1) ctx.strokeRect(-14 - i * 8, -14 - i * 8, 28 + i * 16, 28 + i * 16);
    ctx.restore();
  } else if (mode === 'bugleboy') {
    for (let i = 0; i < 18; i += 1) {
      const a = i * 2.399 + time * 0.045;
      const r = 18 + (i % 6) * 12;
      glow(cx + Math.cos(a) * r, cy - 7 + Math.sin(a * 1.13) * r * 0.45, 0.8 + (i % 3) * 0.3, 0.17 + energy * 0.08, i % 2 ? profile.plate : palette.secondary);
    }
  } else if (mode === 'rcablack') {
    ctx.save();
    ctx.fillStyle = 'rgba(2,2,2,.28)';
    for (const x of [cx - 34, cx + 34]) ctx.fillRect(x - 11, cy - 39, 22, 66);
    ctx.restore();
    stroke(profile.heater, 0.22 + heat * 0.1, 1.15);
    ctx.beginPath();
    ctx.moveTo(cx - 78, cy + 31);
    ctx.quadraticCurveTo(cx, cy + 45 + Math.sin(time * 0.18) * 2, cx + 78, cy + 31);
    ctx.stroke();
  }
}

function drawTubeEnvelope(kit: DrawKit, x: number, y: number, radius: number, height: number, alpha: number, color: RGB): void {
  const { ctx, stroke } = kit;
  stroke(color, alpha, 1.1);
  ctx.beginPath();
  ctx.roundRect(x - radius, y - height / 2, radius * 2, height, radius * 0.72);
  ctx.stroke();
  stroke(color, alpha * 0.45, 0.75, false);
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.65, y + height / 2);
  ctx.lineTo(x - radius * 0.45, y + height / 2 + 7);
  ctx.moveTo(x + radius * 0.65, y + height / 2);
  ctx.lineTo(x + radius * 0.45, y + height / 2 + 7);
  ctx.stroke();
}

function drawDrift(kit: DrawKit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  const depth = clamp01((params.depth ?? 0.3) * 110);
  const rate = 0.22 + clamp01((params.rate ?? 0.2) / 2.5) * 0.75;
  const spread = clamp01(params.spread ?? 0.5);
  const motion = clamp01(params.motion ?? 0.3);

  if (mode === 'ce1') {
    drawCE1(kit, rate, clamp01(params.shape ?? 0.35), motion);
    return;
  }
  if (mode === 'dimensiond') {
    drawDimensionD(kit, clamp01(params.shape ?? 0.35));
    return;
  }

  orb(cx - 41, cy - 7, 45, palette.primary, 0.04 + depth * 0.035 + energy * 0.02);
  orb(cx + 43, cy - 4, 45, palette.secondary, 0.04 + motion * 0.03);
  for (let ribbon = 0; ribbon < 4; ribbon += 1) {
    const phase = time * rate * (0.5 + ribbon * 0.05) + ribbon * 1.5;
    ctx.beginPath();
    for (let step = 0; step <= 54; step += 1) {
      const p = step / 54;
      const x = cx - 99 + p * 198;
      let y = cy - 7 + (ribbon - 1.5) * 18;
      y += Math.sin(p * Math.PI * 2.4 + phase) * (6 + depth * 9);
      if (mode === 'liquid') y += Math.sin(p * Math.PI * 6 - time * 0.2 + ribbon) * 6 * motion;
      if (mode === 'dimension') y += (p - 0.5) * (ribbon - 1.5) * 13 * spread;
      if (mode === 'vibrato') y += Math.sin(p * Math.PI * 8 + time * rate * 2) * (3 + depth * 5);
      step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    stroke(ribbon % 2 ? palette.secondary : palette.primary, 0.18 + ribbon * 0.025 + energy * 0.04, 1.15);
    ctx.stroke();
  }

  if (mode === 'rotary' || mode === 'orbit') {
    const rings = mode === 'orbit' ? 6 : 4;
    for (let i = 0; i < rings; i += 1) {
      const angle = time * rate * (i % 2 ? -0.16 : 0.13);
      stroke(i % 2 ? palette.secondary : palette.primary, 0.18 + i * 0.02, 1);
      ctx.beginPath();
      ctx.ellipse(cx, cy - 7, 24 + i * 12, 10 + i * 6, angle, 0, TAU);
      ctx.stroke();
      const a = time * rate * 1.8 + i * 1.3;
      glow(cx + Math.cos(a) * (24 + i * 12), cy - 7 + Math.sin(a) * (10 + i * 6), 1.1, 0.34, i % 2 ? palette.pale : palette.primary);
    }
  } else if (mode === 'doppler') {
    const sourceX = cx + Math.sin(time * rate * 0.85) * 62;
    glow(sourceX, cy - 7, 2.4, 0.54, palette.pale);
    for (let i = 0; i < 8; i += 1) {
      const rr = 10 + i * 13 + (time * rate * 10) % 13;
      stroke(i % 2 ? palette.secondary : palette.primary, Math.max(0.05, 0.2 - i * 0.018), 1);
      ctx.beginPath();
      ctx.arc(sourceX, cy - 7, rr, Math.PI * 0.68, Math.PI * 1.32);
      ctx.stroke();
    }
  } else if (mode === 'ensemble') {
    for (let i = 0; i < 12; i += 1) {
      const angle = time * (0.11 + i * 0.004) + i * 0.72;
      glow(cx + Math.cos(angle) * (25 + i * 5), cy - 7 + Math.sin(angle * 0.91) * (11 + i * 2.6), 0.8 + (i % 3) * 0.25, 0.19 + i * 0.012, i % 2 ? palette.secondary : palette.primary);
    }
  }
}

function drawCE1(kit: DrawKit, rate: number, intensity: number, preamp: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, transient } = kit;
  orb(cx, cy - 8, 58, palette.primary, 0.05 + intensity * 0.035);
  const scan = (Math.sin(time * rate * 1.6) + 1) * 0.5;
  for (let lane = 0; lane < 2; lane += 1) {
    const y = cy - 25 + lane * 35;
    stroke(lane ? palette.secondary : palette.primary, 0.28, 1.2);
    ctx.beginPath();
    ctx.moveTo(cx - 91, y);
    for (let step = 1; step <= 48; step += 1) {
      const p = step / 48;
      const x = cx - 91 + p * 182;
      const wobble = Math.sin(p * Math.PI * 5 + time * rate + lane * Math.PI) * (3 + intensity * 10);
      ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }
  stroke(palette.warm, 0.18 + preamp * 0.16, 1.1);
  ctx.strokeRect(cx - 86, cy + 29, 172, 13);
  const ledX = cx - 78 + scan * 156;
  glow(ledX, cy + 35.5, 1.8 + transient, 0.48 + transient * 0.25, palette.warm);
  for (let i = 0; i < 8; i += 1) {
    const x = cx - 70 + i * 20;
    stroke(i % 2 ? palette.secondary : palette.primary, 0.095, 0.8, false);
    ctx.beginPath();
    ctx.moveTo(x, cy - 46);
    ctx.lineTo(x, cy + 20);
    ctx.stroke();
  }
}

function drawDimensionD(kit: DrawKit, modeValue: number): void {
  const { ctx, cx, cy, palette, stroke, glow, time } = kit;
  const active = Math.max(0, Math.min(6, Math.floor(modeValue * 7)));
  const lanes = 4;
  for (let lane = 0; lane < lanes; lane += 1) {
    const y = cy - 42 + lane * 25;
    const phase = lane * Math.PI * 0.5;
    stroke(lane % 2 ? palette.secondary : palette.primary, 0.18 + lane * 0.03, 1.1);
    ctx.beginPath();
    for (let step = 0; step <= 60; step += 1) {
      const p = step / 60;
      const x = cx - 96 + p * 192;
      const yy = y + Math.sin(p * Math.PI * 2 + time * 0.24 + phase) * 5.5;
      step === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.stroke();
    glow(cx - 86, y, 1.1, lane === active % 4 ? 0.52 : 0.18, lane % 2 ? palette.secondary : palette.primary);
  }
  stroke(palette.pale, 0.16, 1);
  for (let button = 0; button < 4; button += 1) {
    const x = cx - 46 + button * 31;
    ctx.strokeRect(x - 9, cy + 37, 18, 9);
    if (button === active % 4 || (active > 3 && button === 3)) glow(x, cy + 41.5, 1.8, 0.5, palette.pale);
  }
}

function drawHalo(kit: DrawKit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  const feedback = clamp01(params.feedback ?? 0.3);
  const character = clamp01(params.character ?? 0.2);
  const widthParam = clamp01(params.width ?? 0.5);
  if (mode === 're201') {
    drawRE201(kit, feedback, character, widthParam);
    return;
  }

  orb(cx, cy - 9, 62, palette.primary, 0.045 + feedback * 0.04 + energy * 0.02);
  const depth = 7 + Math.round(feedback * 5);
  for (let i = depth - 1; i >= 0; i -= 1) {
    const k = i / Math.max(1, depth - 1);
    const scale = 0.24 + (1 - k) * 0.88;
    const w = 170 * scale * (0.9 + widthParam * 0.14);
    const h = 92 * scale;
    const x = cx + Math.sin(time * 0.04 + i * 0.7) * character * 4;
    const y = cy - 8 + (k - 0.5) * 8;
    stroke(i % 2 ? palette.secondary : palette.primary, 0.08 + (1 - k) * 0.17, 1);
    ctx.beginPath();
    if (mode === 'diffuse' || mode === 'constellation') ctx.ellipse(x, y, w / 2, h / 2, 0, 0, TAU);
    else ctx.roundRect(x - w / 2, y - h / 2, w, h, 5 + scale * 5);
    ctx.stroke();
  }
  glow(cx, cy - 8, 2.4, 0.5, palette.warm);

  if (mode === 'pingpong') {
    let x = cx - 82;
    let y = cy - 48;
    for (let i = 0; i < 10; i += 1) {
      const nx = i % 2 ? cx - 66 + i * 4 : cx + 66 - i * 4;
      const ny = cy - 45 + i * 10;
      stroke(i % 2 ? palette.secondary : palette.primary, 0.31 - i * 0.02, 1.1);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      glow(nx, ny, 1.1, 0.34 - i * 0.02, i % 2 ? palette.secondary : palette.primary);
      x = nx; y = ny;
    }
  } else if (mode === 'scatter') {
    for (let i = 0; i < 22; i += 1) {
      const angle = i * 4.13 + time * 0.08;
      const length = 30 + (i % 7) * 9;
      stroke(i % 2 ? palette.secondary : palette.primary, 0.08 + (i % 5) * 0.024, 0.9);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx + Math.sin(angle * 1.7) * length, cy - 7 + Math.cos(angle * 0.83) * length * 0.62);
      ctx.stroke();
    }
  } else if (mode === 'constellation' || mode === 'diffuse') {
    const count = mode === 'constellation' ? 24 : 16;
    const points: Array<readonly [number, number]> = [];
    for (let i = 0; i < count; i += 1) {
      const angle = i * 2.399 + time * 0.035;
      const radius = 14 + (i % 8) * 10;
      const point = [cx + Math.cos(angle) * radius, cy - 7 + Math.sin(angle) * radius * 0.48] as const;
      points.push(point);
      glow(point[0], point[1], 0.8 + (i % 3) * 0.25, 0.18 + (i % 5) * 0.025, i % 2 ? palette.secondary : palette.primary);
    }
    if (mode === 'constellation') {
      stroke(palette.primary, 0.085, 0.75, false);
      ctx.beginPath();
      points.forEach(([px, py], index) => index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.stroke();
    }
  } else if (mode === 'bbd') {
    stroke(palette.secondary, 0.11, 0.8, false);
    for (let x = cx - 88; x <= cx + 88; x += 15) {
      ctx.beginPath(); ctx.moveTo(x, cy - 49); ctx.lineTo(x, cy + 38); ctx.stroke();
    }
  }
}

function drawRE201(kit: DrawKit, feedback: number, age: number, modeValue: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  orb(cx, cy - 6, 68, palette.warm, 0.04 + feedback * 0.04 + energy * 0.02);
  const left = [cx - 66, cy - 18] as const;
  const right = [cx + 66, cy - 18] as const;
  const bottom = [cx, cy + 40] as const;
  stroke(palette.warm, 0.34, 1.4);
  ctx.beginPath();
  ctx.moveTo(left[0], left[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.lineTo(bottom[0], bottom[1]);
  ctx.closePath();
  ctx.stroke();

  const spin = time * (0.8 + feedback * 0.55);
  for (const [x, y] of [left, right]) {
    stroke(palette.primary, 0.32, 1.15);
    ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.stroke();
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const a = spin + spoke * TAU / 6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17); ctx.stroke();
    }
  }
  stroke(palette.secondary, 0.24 + age * 0.1, 1.1);
  const heads = 3 + Math.round(modeValue * 4);
  for (let i = 0; i < heads; i += 1) {
    const p = i / Math.max(1, heads - 1);
    const x = cx - 54 + p * 108;
    const y = cy + 13 + Math.sin(p * Math.PI) * 17;
    ctx.strokeRect(x - 5, y - 4, 10, 8);
    if ((Math.floor(time * 2 + i) % heads) === i) glow(x, y, 1.4, 0.48, palette.secondary);
  }
  for (let i = 0; i < 5; i += 1) {
    const p = (time * (0.07 + feedback * 0.04) + i / 5) % 1;
    const x = cx - 66 + p * 132;
    const y = cy - 18 + Math.sin(p * Math.PI) * (58 + age * 4);
    glow(x, y, 0.8, (1 - Math.abs(p - 0.5)) * 0.18, palette.warm);
  }
}

function drawAtmos(kit: DrawKit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  const size = 0.58 + clamp01(params.size ?? 0.5) * 0.42;
  const motion = clamp01(params.motion ?? 0.2);
  const diffusion = clamp01(params.diffusion ?? 0.5);
  if (mode === 'emt140') {
    drawEMT140(kit, size, diffusion);
    return;
  }
  if (mode === 'lexicon224') {
    drawLexicon224(kit, size, motion, diffusion);
    return;
  }

  orb(cx - 36, cy - 14, 65 * size, palette.primary, 0.035 + diffusion * 0.03 + energy * 0.02);
  orb(cx + 42, cy - 5, 58 * size, palette.secondary, 0.03 + motion * 0.025);
  if (mode === 'room' || mode === 'hall' || mode === 'cinema') {
    const columns = mode === 'cinema' ? 9 : mode === 'hall' ? 7 : 5;
    const roomScale = (mode === 'room' ? 0.72 : mode === 'hall' ? 0.88 : 1) * size;
    stroke(palette.primary, 0.13, 1);
    ctx.strokeRect(cx - 94 * roomScale, cy - 52 * roomScale, 188 * roomScale, 92 * roomScale);
    for (let i = 0; i < columns; i += 1) {
      const x = cx + (-82 + i * (164 / Math.max(1, columns - 1))) * roomScale;
      stroke(i % 2 ? palette.secondary : palette.primary, 0.14 + diffusion * 0.06, 1);
      ctx.beginPath(); ctx.moveTo(x, cy - 48 * roomScale); ctx.lineTo(x, cy + 36 * roomScale); ctx.stroke();
    }
  } else if (mode === 'plate') {
    stroke(palette.primary, 0.34, 1.3);
    ctx.strokeRect(cx - 92 * size, cy - 49 * size, 184 * size, 91 * size);
    for (let i = 0; i < 10; i += 1) {
      ctx.beginPath();
      for (let step = 0; step <= 48; step += 1) {
        const p = step / 48;
        const x = cx - 92 * size + p * 184 * size;
        const y = cy - 4 + (i - 4.5) * 8 + Math.sin(p * Math.PI * 5 + time * 0.2 + i) * (2 + motion * 6);
        step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      stroke(i % 2 ? palette.secondary : palette.primary, 0.1 + i * 0.012, 0.9);
      ctx.stroke();
    }
  } else if (mode === 'cloud' || mode === 'nebula') {
    const count = mode === 'nebula' ? 42 : 28;
    for (let i = 0; i < count; i += 1) {
      const angle = i * 2.399 + time * (0.02 + motion * 0.025);
      const radius = 10 + (i % 10) * 8 * size;
      glow(cx + Math.cos(angle) * radius, cy - 7 + Math.sin(angle * 1.13) * radius * 0.48, 0.7 + (i % 3) * 0.3, 0.09 + (i % 6) * 0.018, i % 3 ? palette.primary : palette.secondary);
    }
  } else if (mode === 'freeze') {
    for (let i = 0; i < 12; i += 1) {
      stroke(i % 2 ? palette.secondary : palette.primary, 0.1 + i * 0.016, 1);
      ctx.beginPath(); ctx.ellipse(cx, cy - 7, 10 + i * 8, 5 + i * 4.2, Math.sin(i) * 0.15, 0, TAU); ctx.stroke();
    }
    glow(cx, cy - 7, 2.6, 0.48, palette.pale);
  } else if (mode === 'celestial') {
    glow(cx, cy - 12, 3, 0.52, palette.pale);
    for (let i = -5; i <= 5; i += 1) {
      const yy = cy + i * 10 + Math.sin(time * 0.11 + i) * 3;
      stroke(i % 2 ? palette.secondary : palette.primary, 0.11 + (5 - Math.abs(i)) * 0.012, 1);
      ctx.beginPath(); ctx.moveTo(cx - 95, yy); ctx.lineTo(cx + 95, yy - 12 * Math.sin(i)); ctx.stroke();
    }
  } else if (mode === 'aurora') {
    for (let i = 0; i < 10; i += 1) {
      ctx.beginPath();
      for (let step = 0; step <= 60; step += 1) {
        const x = cx - 99 + step * 3.3;
        const y = cy + (i - 4.5) * 9 + Math.sin((x - cx) * 0.04 + time * 0.19 + i * 0.5) * (5 + motion * 9);
        step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      stroke(i % 2 ? palette.secondary : palette.primary, 0.1 + i * 0.013, 1);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 11; i += 1) {
      const k = i / 10;
      const y = cy - 53 + k * 99;
      const half = 100 * (1 - k * 0.7);
      stroke(i % 2 ? palette.secondary : palette.primary, 0.18 - k * 0.1, 1);
      ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
    }
  }
}

function drawEMT140(kit: DrawKit, size: number, diffusion: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  orb(cx, cy - 6, 70, palette.primary, 0.045 + diffusion * 0.035 + energy * 0.02);
  const w = 190 * size;
  const h = 98 * size;
  stroke(palette.primary, 0.36, 1.35);
  ctx.strokeRect(cx - w / 2, cy - h / 2 - 5, w, h);
  for (const [x, y] of [[cx - w / 2, cy - h / 2 - 5], [cx + w / 2, cy - h / 2 - 5], [cx - w / 2, cy + h / 2 - 5], [cx + w / 2, cy + h / 2 - 5]] as const) {
    glow(x, y, 1.5, 0.42, palette.warm);
  }
  for (let row = 0; row < 13; row += 1) {
    const baseY = cy - h / 2 + row * (h / 12) - 5;
    ctx.beginPath();
    for (let step = 0; step <= 64; step += 1) {
      const p = step / 64;
      const x = cx - w / 2 + p * w;
      const y = baseY + Math.sin(p * Math.PI * 6 + time * 0.22 + row * 0.65) * (1.2 + diffusion * 4.8);
      step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    stroke(row % 2 ? palette.secondary : palette.primary, 0.075 + row * 0.007, 0.75);
    ctx.stroke();
  }
  const sweep = (time * 0.08) % 1;
  stroke(palette.pale, 0.18, 1);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + sweep * w, cy - h / 2 - 5);
  ctx.lineTo(cx - w / 2 + sweep * w, cy + h / 2 - 5);
  ctx.stroke();
}

function drawLexicon224(kit: DrawKit, size: number, motion: number, diffusion: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time } = kit;
  orb(cx, cy - 8, 68, palette.secondary, 0.04 + motion * 0.03);
  const cols = 12;
  const rows = 7;
  const cellW = 14 * size;
  const cellH = 11 * size;
  const startX = cx - (cols * cellW) / 2;
  const startY = cy - (rows * cellH) / 2 - 8;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const phase = Math.sin(time * 0.7 + row * 1.3 + col * 0.73);
      const alpha = 0.055 + Math.max(0, phase) * (0.08 + diffusion * 0.08);
      ctx.fillStyle = kit.rgba((row + col) % 3 ? palette.primary : palette.secondary, alpha, true);
      ctx.fillRect(startX + col * cellW + 1, startY + row * cellH + 1, cellW - 2, cellH - 2);
    }
  }
  stroke(palette.pale, 0.18, 1);
  ctx.strokeRect(startX, startY, cols * cellW, rows * cellH);
  const scanCol = Math.floor((time * (1.2 + motion)) % cols);
  for (let row = 0; row < rows; row += 1) glow(startX + scanCol * cellW + cellW / 2, startY + row * cellH + cellH / 2, 0.9, 0.26, palette.pale);
  for (let i = 0; i < 4; i += 1) {
    const p = (time * 0.055 + i * 0.24) % 1;
    stroke(i % 2 ? palette.secondary : palette.primary, (1 - p) * 0.18, 1);
    ctx.beginPath(); ctx.ellipse(cx, cy - 8, 15 + p * 92, 8 + p * 44, 0, 0, TAU); ctx.stroke();
  }
}

function drawGrain(kit: DrawKit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  const density = clamp01(params.density ?? 0.4);
  const chaos = clamp01(params.chaos ?? 0.2);
  const bloom = clamp01(params.bloom ?? 0.3);
  const pitch = clamp01(params.pitch ?? 0.38);
  if (mode === 'sp1200') {
    drawSP1200(kit, density, chaos);
    return;
  }
  if (mode === 'mpc60') {
    drawMPC60(kit, density, bloom);
    return;
  }
  if (mode === 'mirage') {
    drawMirage(kit, density, pitch, chaos);
    return;
  }

  orb(cx, cy - 7, 60, palette.primary, 0.04 + bloom * 0.035 + energy * 0.02);
  stroke(palette.secondary, 0.06, 0.7, false);
  for (let i = -5; i <= 5; i += 1) {
    ctx.beginPath(); ctx.moveTo(cx - 95, cy + i * 9); ctx.lineTo(cx + 95, cy + i * 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + i * 18, cy - 52); ctx.lineTo(cx + i * 18, cy + 45); ctx.stroke();
  }
  const count = 22 + Math.round(density * 34);
  for (let i = 0; i < count; i += 1) {
    const seed = i * 12.9898;
    let orbit = time * (0.07 + chaos * 0.12) + seed;
    let radiusX = 22 + (i % 9) * 8;
    let radiusY = 10 + (i % 7) * 5;
    if (mode === 'shatter') { radiusX *= 1.18; radiusY *= 1.18; }
    if (mode === 'smear') radiusX *= 1.32;
    if (mode === 'stutter') orbit = Math.floor(orbit * 4) / 4;
    const x = cx + Math.sin(seed * 1.7 + orbit) * radiusX;
    const y = cy - 7 + Math.cos(seed * 0.9 + orbit * 1.2) * radiusY;
    const size = 1 + (i % 4) * 0.65 + bloom * 1.4;
    const angle = seed + time * (0.05 + pitch * 0.08) * (i % 2 ? -1 : 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = kit.rgba(mode === 'prism' && i % 3 === 0 ? palette.pale : i % 2 ? palette.secondary : palette.primary, 0.13 + bloom * 0.05, true);
    ctx.beginPath();
    if (mode === 'ruin') {
      ctx.moveTo(-size * 1.7, size);
      ctx.lineTo(size * 0.2, -size * 2.2);
      ctx.lineTo(size * 2, size * 0.4);
    } else {
      ctx.moveTo(0, -size * 2);
      ctx.lineTo(size * 1.5, 0);
      ctx.lineTo(0, size * 1.8);
      ctx.lineTo(-size * 1.5, 0);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  if (mode === 'reconstruct') {
    stroke(palette.pale, 0.14, 1);
    ctx.beginPath(); ctx.ellipse(cx, cy - 7, 35 + Math.sin(time * 0.08) * 3, 17, 0, 0, TAU); ctx.stroke();
  }
}

function drawSP1200(kit: DrawKit, density: number, filterEnv: number): void {
  const { ctx, cx, cy, palette, stroke, glow, time, transient } = kit;
  const blocks = 8;
  const blockW = 20;
  for (let i = 0; i < blocks; i += 1) {
    const x = cx - 80 + i * 23;
    const level = 12 + ((i * 17) % 29) + Math.sin(time * 0.9 + i) * (4 + density * 8);
    stroke(i % 2 ? palette.secondary : palette.primary, 0.24, 1);
    ctx.strokeRect(x, cy - 42, blockW, 70);
    ctx.fillStyle = kit.rgba(i % 2 ? palette.secondary : palette.primary, 0.08 + density * 0.06, true);
    ctx.fillRect(x + 3, cy + 24 - level, blockW - 6, level);
    if ((Math.floor(time * 3.2) + i) % blocks === 0) glow(x + blockW / 2, cy + 34, 1.7 + transient, 0.55, palette.warm);
  }
  stroke(palette.warm, 0.16 + filterEnv * 0.1, 1);
  ctx.beginPath();
  for (let step = 0; step <= 64; step += 1) {
    const p = step / 64;
    const x = cx - 91 + p * 182;
    const quant = Math.round(Math.sin(p * Math.PI * 4 + time * 0.35) * 6) / 2;
    const y = cy + 48 + quant;
    step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawMPC60(kit: DrawKit, density: number, bloom: number): void {
  const { ctx, cx, cy, palette, stroke, glow, time, energy } = kit;
  const size = 23;
  const gap = 5;
  const startX = cx - (4 * size + 3 * gap) / 2;
  const startY = cy - 55;
  const activePad = Math.floor(time * (2.2 + density * 1.5)) % 16;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const index = row * 4 + col;
      const x = startX + col * (size + gap);
      const y = startY + row * (size + gap);
      stroke(index === activePad ? palette.pale : (index % 2 ? palette.secondary : palette.primary), index === activePad ? 0.44 : 0.16, index === activePad ? 1.4 : 1);
      ctx.roundRect(x, y, size, size, 3);
      ctx.stroke();
      if (index === activePad) {
        ctx.fillStyle = kit.rgba(palette.warm, 0.08 + bloom * 0.08 + energy * 0.04, true);
        ctx.fill();
        glow(x + size / 2, y + size / 2, 1.5, 0.5, palette.warm);
      }
    }
  }
  stroke(palette.secondary, 0.13, 0.9, false);
  for (let i = 0; i < 5; i += 1) {
    const y = cy + 47 + i * 4;
    ctx.beginPath(); ctx.moveTo(cx - 80, y); ctx.lineTo(cx + 80, y + Math.sin(time * 0.17 + i) * 2); ctx.stroke();
  }
}

function drawMirage(kit: DrawKit, drive: number, rate: number, resonance: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time } = kit;
  orb(cx, cy - 8, 58, palette.secondary, 0.035 + resonance * 0.03);
  stroke(palette.primary, 0.24, 1.1);
  ctx.strokeRect(cx - 96, cy - 50, 192, 88);
  ctx.beginPath();
  for (let step = 0; step <= 72; step += 1) {
    const p = step / 72;
    const x = cx - 91 + p * 182;
    const raw = Math.sin(p * Math.PI * (3 + rate * 5) + time * (0.3 + rate * 0.45)) * (18 + drive * 18);
    const quantized = Math.round(raw / 5) * 5;
    const y = cy - 7 + quantized;
    step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  stroke(palette.pale, 0.26 + resonance * 0.1, 1.2);
  ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const x = cx - 78 + i * 22;
    const lit = (Math.floor(time * 4) + i) % 8 === 0;
    glow(x, cy + 48, lit ? 1.7 : 0.8, lit ? 0.52 : 0.12, lit ? palette.warm : palette.primary);
  }
}

function drawArtifact(kit: DrawKit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  const wear = clamp01(params.wear ?? 0.25);
  const wow = clamp01(params.wow ?? 0.16);
  const noise = clamp01(params.noise ?? 0.1);
  const tone = clamp01(params.tone ?? 0.62);
  if (mode === 'tascam424') {
    drawTascam424(kit, wear, wow, noise, tone);
    return;
  }

  orb(cx - 30, cy - 7, 60, palette.primary, 0.035 + wear * 0.025 + energy * 0.02);
  orb(cx + 38, cy, 54, palette.secondary, 0.025 + wow * 0.03);
  if (mode === 'cassette' || mode === 'reel') {
    const shellW = mode === 'cassette' ? 184 : 176;
    const shellH = mode === 'cassette' ? 92 : 88;
    stroke(palette.primary, 0.32, 1.2);
    ctx.strokeRect(cx - shellW / 2, cy - shellH / 2 - 5, shellW, shellH);
    const reelRadius = mode === 'cassette' ? 20 : 29;
    const spin = time * (0.65 + wear * 0.7);
    for (const x of [cx - 47, cx + 47]) {
      stroke(palette.secondary, 0.27, 1.1);
      ctx.beginPath(); ctx.arc(x, cy - 7, reelRadius, 0, TAU); ctx.stroke();
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const a = spin + spoke * TAU / 6;
        ctx.beginPath(); ctx.moveTo(x, cy - 7); ctx.lineTo(x + Math.cos(a) * (reelRadius - 4), cy - 7 + Math.sin(a) * (reelRadius - 4)); ctx.stroke();
      }
    }
    stroke(palette.warm, 0.18 + wear * 0.08, 1);
    ctx.beginPath(); ctx.moveTo(cx - 47, cy + 13); ctx.quadraticCurveTo(cx, cy + 39 + wow * 7, cx + 47, cy + 13); ctx.stroke();
  } else if (mode === 'vinyl' || mode === 'wax') {
    const radius = mode === 'wax' ? 56 : 49;
    stroke(palette.primary, 0.31, 1.2);
    for (let ring = 0; ring < 8; ring += 1) {
      ctx.beginPath(); ctx.arc(cx - 12, cy - 7, radius - ring * 5, 0, TAU); ctx.stroke();
    }
    const angle = time * (0.8 + wow * 0.4);
    const needleX = cx - 12 + Math.cos(angle * 0.07) * 38;
    const needleY = cy - 7 + Math.sin(angle * 0.07) * 38;
    stroke(palette.warm, 0.34, 1.2);
    ctx.beginPath(); ctx.moveTo(cx + 78, cy - 48); ctx.lineTo(needleX, needleY); ctx.stroke();
    glow(needleX, needleY, 1.5, 0.5, palette.warm);
  } else if (mode === 'vhs' || mode === 'radio' || mode === 'archive') {
    const bands = mode === 'radio' ? 10 : 14;
    for (let row = 0; row < bands; row += 1) {
      const y = cy - 52 + row * (96 / Math.max(1, bands - 1));
      const shift = Math.sin(time * (0.4 + wow) + row * 1.7) * (2 + wear * 8);
      stroke(row % 2 ? palette.secondary : palette.primary, 0.09 + (row % 4) * 0.025, 0.9);
      ctx.beginPath(); ctx.moveTo(cx - 96 + shift, y); ctx.lineTo(cx + 96 - shift * 0.4, y); ctx.stroke();
    }
    if (mode === 'radio') {
      const sweep = ((time * 0.08) % 1) * 184;
      glow(cx - 92 + sweep, cy + 42, 1.8, 0.5, palette.warm);
    }
  } else {
    for (let i = 0; i < 22; i += 1) {
      const y = cy - 48 + (i % 11) * 9;
      const jitter = (hash(i * 5.7 + Math.floor(time * 2)) - 0.5) * (4 + wear * 16);
      stroke(i % 3 ? palette.primary : palette.secondary, 0.09 + noise * 0.08, 0.9);
      ctx.beginPath(); ctx.moveTo(cx - 96, y); ctx.lineTo(cx - 12 + jitter, y); ctx.moveTo(cx + 10 + jitter, y + (i % 2 ? 3 : -3)); ctx.lineTo(cx + 96, y + (i % 2 ? 3 : -3)); ctx.stroke();
    }
  }
}

function drawTascam424(kit: DrawKit, trim: number, low: number, high: number, drive: number): void {
  const { ctx, cx, cy, palette, stroke, glow, orb, time, energy } = kit;
  orb(cx, cy - 3, 66, palette.warm, 0.04 + drive * 0.035 + energy * 0.02);
  const channelW = 39;
  const gap = 7;
  const startX = cx - (4 * channelW + 3 * gap) / 2;
  for (let channel = 0; channel < 4; channel += 1) {
    const x = startX + channel * (channelW + gap);
    stroke(channel % 2 ? palette.secondary : palette.primary, 0.2, 1.05);
    ctx.roundRect(x, cy - 55, channelW, 92, 4);
    ctx.stroke();
    const meterLevel = clamp01(0.18 + trim * 0.46 + Math.sin(time * (0.7 + channel * 0.08) + channel) * 0.13 + energy * 0.3);
    const segments = 8;
    for (let segment = 0; segment < segments; segment += 1) {
      const lit = segment / segments < meterLevel;
      const y = cy - 47 + (segments - 1 - segment) * 6;
      ctx.fillStyle = kit.rgba(segment > 5 ? palette.warm : channel % 2 ? palette.secondary : palette.primary, lit ? 0.42 : 0.055, true);
      ctx.fillRect(x + 6, y, channelW - 12, 3);
    }
    const faderY = cy + 28 - drive * 27 + channel * 0.6;
    stroke(palette.pale, 0.13, 0.8, false);
    ctx.beginPath(); ctx.moveTo(x + channelW / 2, cy - 2); ctx.lineTo(x + channelW / 2, cy + 32); ctx.stroke();
    ctx.fillStyle = kit.rgba(palette.pale, 0.24, true);
    ctx.fillRect(x + channelW / 2 - 6, faderY - 2, 12, 4);
  }
  stroke(palette.warm, 0.16 + low * 0.08 + high * 0.08, 1);
  ctx.beginPath();
  for (let step = 0; step <= 60; step += 1) {
    const p = step / 60;
    const x = cx - 94 + p * 188;
    const y = cy + 49 + Math.sin(p * Math.PI * 4 + time * (0.18 + low * 0.2)) * (2 + high * 4);
    step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let channel = 0; channel < 4; channel += 1) {
    if ((Math.floor(time * 2.5) + channel) % 4 === 0) glow(startX + channel * (channelW + gap) + channelW / 2, cy - 60, 1.2, 0.42, palette.warm);
  }
}

function drawOpticalFinish(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ModulePalette,
  time: number
): void {
  const rgba = (color: RGB, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${clamp01(alpha)})`;
  ctx.save();
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.22, width / 2, height / 2, Math.max(width, height) * 0.67);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.72, 'rgba(0,0,0,.08)');
  vignette.addColorStop(1, 'rgba(0,0,0,.66)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const sheen = ctx.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0, 'rgba(255,255,255,.035)');
  sheen.addColorStop(0.25, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.72, rgba(palette.secondary, 0.015));
  sheen.addColorStop(1, 'rgba(255,255,255,.012)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.035;
  ctx.fillStyle = rgba(palette.primary, 0.22);
  const scanY = ((time * 7) % (height + 8)) - 4;
  ctx.fillRect(0, scanY, width, 1);
  ctx.restore();
}
