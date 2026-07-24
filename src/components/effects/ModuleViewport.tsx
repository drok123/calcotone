import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';

const WORLD_W = 240;
const WORLD_H = 150;
const TAU = Math.PI * 2;

type RGB = readonly [number, number, number];
type Palette = { primary: RGB; secondary: RGB; warm: RGB; pale: RGB };
type Kit = {
  ctx: CanvasRenderingContext2D;
  cx: number;
  cy: number;
  time: number;
  energy: number;
  transient: number;
  palette: Palette;
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string;
  stroke: (color: RGB, alpha?: number, width?: number, whiten?: boolean) => void;
  glow: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void;
  orb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const hash = (value: number) => {
  const n = Math.sin(value * 127.1) * 43758.5453123;
  return n - Math.floor(n);
};

export function ModuleViewport({ module, visualState }: { module: ModuleState; visualState: VisualAudioState }) {
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

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(cssWidth * pixelRatio));
      const height = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render: ViewportRenderCallback = (timestamp) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const current = moduleRef.current;
      const params: Record<string, number> = {};
      for (const parameter of current.parameters) params[parameter.id] = parameter.value;
      drawViewport(context, cssWidth, cssHeight, current, visualRef.current, params, timestamp / 1000);
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [module.id]);

  return (
    <div className={`dsp-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}>
      <div className="viewport-glass" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="viewport-caption">{captionFor(module)}</span>
    </div>
  );
}

function captionFor(module: ModuleState): string {
  if (module.id === 'saturation') {
    const mode = module.emberMode ?? 'velvet';
    const names: Record<string, string> = {
      goldlion: 'B759 · GOLD LION FIELD', mullard: 'ECC83 · MULLARD HEAT',
      telefunken: 'ECC83 · TELEFUNKEN GRID', bugleboy: '12AX7 · BUGLE BOY AIR',
      rcablack: '12AX7 · RCA BLACK PLATE',
    };
    return names[mode] ?? 'THERMAL REACTOR';
  }
  if (module.id === 'chorus') {
    if (module.driftMode === 'ce1') return 'CE-1 · BBD CHORUS';
    if (module.driftMode === 'dimensiond') return 'DIMENSION D · PHASE MATRIX';
    return 'PHASE CURRENT';
  }
  if (module.id === 'delay') return module.delayAlgorithm === 're201' ? 'RE-201 · TAPE ECHO' : formatAlgorithmName(module.delayAlgorithm ?? 'tape');
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
  if (module.id === 'media') return module.mediaMode === 'tascam424' ? 'PORTASTUDIO 424 · 4 TRACK' : (module.mediaMode ?? 'cassette').toUpperCase();
  return 'SIGNAL WORLD';
}

function modeFor(module: ModuleState): string {
  if (module.id === 'saturation') return module.emberMode ?? 'velvet';
  if (module.id === 'chorus') return module.driftMode ?? 'chorus';
  if (module.id === 'delay') return module.delayAlgorithm ?? 'tape';
  if (module.id === 'reverb') return module.algorithm ?? 'hall';
  if (module.id === 'media') return module.mediaMode ?? 'cassette';
  return module.grainMode ?? 'reconstruct';
}

function paletteFor(id: string): Palette {
  if (id === 'saturation') return { primary: [244, 152, 67], secondary: [219, 76, 151], warm: [255, 194, 104], pale: [244, 236, 220] };
  if (id === 'chorus') return { primary: [87, 208, 226], secondary: [132, 121, 255], warm: [233, 210, 130], pale: [226, 246, 246] };
  if (id === 'delay') return { primary: [164, 130, 255], secondary: [78, 218, 223], warm: [252, 182, 101], pale: [234, 236, 250] };
  if (id === 'reverb') return { primary: [90, 151, 255], secondary: [97, 224, 209], warm: [240, 187, 116], pale: [229, 242, 240] };
  if (id === 'media') return { primary: [213, 154, 93], secondary: [80, 210, 214], warm: [250, 190, 108], pale: [239, 232, 215] };
  return { primary: [226, 108, 202], secondary: [83, 218, 216], warm: [245, 184, 105], pale: [234, 241, 237] };
}

function drawViewport(
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
  if (!module.enabled) return;

  const palette = paletteFor(module.id);
  const mix = clamp01(params.mix ?? 0.5);
  const energy = clamp01(audio.level * 1.55 + audio.low * 0.25 + audio.mid * 0.2);
  const transient = clamp01(audio.transient * 1.2);
  drawBackdrop(ctx, width, height, palette, mix, energy, time);

  const margin = 9;
  const scale = Math.max(0.01, Math.min((width - margin * 2) / WORLD_W, (height - margin * 2) / WORLD_H));
  ctx.save();
  ctx.translate((width - WORLD_W * scale) / 2, (height - WORLD_H * scale) / 2);
  ctx.scale(scale, scale);

  const whiteMix = 0.12 + mix * 0.44 + energy * 0.08;
  const rgba = (color: RGB, alpha: number, whiten = false) => {
    const blend = whiten ? whiteMix : 0;
    return `rgba(${Math.round(color[0] + (255 - color[0]) * blend)},${Math.round(color[1] + (255 - color[1]) * blend)},${Math.round(color[2] + (255 - color[2]) * blend)},${clamp01(alpha)})`;
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
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill(); ctx.restore();
  };
  const orb = (x: number, y: number, radius: number, color: RGB, alpha: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, alpha, true));
    gradient.addColorStop(0.3, rgba(color, alpha * 0.3));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  };
  const kit: Kit = { ctx, cx: WORLD_W / 2, cy: WORLD_H / 2, time, energy, transient, palette, rgba, stroke, glow, orb };
  drawGrid(kit);
  const mode = modeFor(module);
  if (!drawHardware(kit, module.id, mode, params)) drawCreative(kit, module.id, mode, params);
  ctx.restore();
  drawGlassFinish(ctx, width, height, palette, time);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette, mix: number, energy: number, time: number): void {
  const color = (rgb: RGB, a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp01(a)})`;
  const cx = width / 2;
  const cy = height / 2;
  const gradient = ctx.createRadialGradient(cx, cy * 0.9, 4, cx, cy, Math.max(width, height) * 0.7);
  gradient.addColorStop(0, color(palette.primary, 0.09 + mix * 0.035 + energy * 0.035));
  gradient.addColorStop(0.4, color(palette.secondary, 0.03 + energy * 0.02));
  gradient.addColorStop(0.76, 'rgba(4,8,11,.985)');
  gradient.addColorStop(1, '#010203');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i += 1) {
    const seed = hash(i * 7.17 + palette.primary[0]);
    ctx.fillStyle = i % 2 ? color(palette.primary, 0.035 + energy * 0.03) : color(palette.secondary, 0.03 + mix * 0.025);
    ctx.beginPath();
    ctx.arc(width * (0.06 + seed * 0.88) + Math.sin(time * 0.02 + i) * 2, height * (0.1 + hash(i * 3.31) * 0.7), 0.5 + hash(i * 4.7), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawGrid({ ctx, cx, cy, time, energy, palette, stroke }: Kit): void {
  stroke(palette.primary, 0.05 + energy * 0.025, 0.55, false);
  for (let row = 0; row < 5; row += 1) {
    const p = row / 4;
    const y = cy + 18 + p * 46;
    const half = 92 - p * 24;
    ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.quadraticCurveTo(cx, y - 2 - Math.sin(time * 0.08 + row), cx + half, y); ctx.stroke();
  }
  for (let col = -4; col <= 4; col += 1) {
    ctx.beginPath(); ctx.moveTo(cx + col * 15, cy + 18); ctx.lineTo(cx + col * 22, WORLD_H + 2); ctx.stroke();
  }
}

function drawHardware(kit: Kit, moduleId: string, mode: string, params: Record<string, number>): boolean {
  if (moduleId === 'saturation' && ['goldlion', 'mullard', 'telefunken', 'bugleboy', 'rcablack'].includes(mode)) {
    drawNamedTube(kit, mode, clamp01(params.drive ?? 0.2), clamp01(params.heat ?? 0.2)); return true;
  }
  if (moduleId === 'chorus' && mode === 'ce1') { drawCE1(kit, clamp01(params.shape ?? 0.35), clamp01(params.motion ?? 0.3)); return true; }
  if (moduleId === 'chorus' && mode === 'dimensiond') { drawDimensionD(kit, clamp01(params.shape ?? 0.35)); return true; }
  if (moduleId === 'delay' && mode === 're201') { drawRE201(kit, clamp01(params.feedback ?? 0.3), clamp01(params.character ?? 0.2), clamp01(params.width ?? 0.5)); return true; }
  if (moduleId === 'reverb' && mode === 'emt140') { drawEMT140(kit, clamp01(params.diffusion ?? 0.6)); return true; }
  if (moduleId === 'reverb' && mode === 'lexicon224') { drawLexicon224(kit, clamp01(params.motion ?? 0.2), clamp01(params.diffusion ?? 0.6)); return true; }
  if (moduleId === 'bitcrusher' && mode === 'sp1200') { drawSP1200(kit, clamp01(params.density ?? 0.4), clamp01(params.chaos ?? 0.2)); return true; }
  if (moduleId === 'bitcrusher' && mode === 'mpc60') { drawMPC60(kit, clamp01(params.density ?? 0.4), clamp01(params.bloom ?? 0.3)); return true; }
  if (moduleId === 'bitcrusher' && mode === 'mirage') { drawMirage(kit, clamp01(params.density ?? 0.4), clamp01(params.pitch ?? 0.38)); return true; }
  if (moduleId === 'media' && mode === 'tascam424') { drawTascam424(kit, clamp01(params.wear ?? 0.25), clamp01(params.tone ?? 0.6)); return true; }
  return false;
}

function drawNamedTube(kit: Kit, mode: string, drive: number, heat: number): void {
  const { ctx, cx, cy, time, energy, transient, palette, stroke, glow, orb } = kit;
  const profiles: Record<string, { plate: RGB; heater: RGB; spacing: number }> = {
    goldlion: { plate: [246, 196, 92], heater: [255, 222, 126], spacing: 45 },
    mullard: { plate: [225, 117, 73], heater: [255, 174, 95], spacing: 40 },
    telefunken: { plate: [183, 218, 228], heater: [255, 202, 120], spacing: 43 },
    bugleboy: { plate: [241, 181, 96], heater: [255, 228, 153], spacing: 48 },
    rcablack: { plate: [177, 112, 91], heater: [255, 126, 66], spacing: 38 },
  };
  const profile = profiles[mode] ?? profiles.goldlion;
  orb(cx, cy - 6, 64, profile.plate, 0.055 + heat * 0.045 + energy * 0.03);
  for (let tube = -1; tube <= 1; tube += 1) {
    const x = cx + tube * profile.spacing;
    stroke(profile.plate, 0.25 + drive * 0.12, 1.1);
    ctx.beginPath(); ctx.roundRect(x - 15, cy - 36, 30, 58, 11); ctx.stroke();
    for (let grid = -2; grid <= 2; grid += 1) {
      const y = cy - 7 + grid * 10;
      stroke(profile.plate, 0.17 + heat * 0.08, 0.85);
      ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y + Math.sin(time * 0.12 + tube + grid) * 1.4); ctx.stroke();
    }
    const phase = (time * (0.35 + heat * 0.25) + tube * 0.17) % 1;
    glow(x, cy + 15 - phase * 42, 1.5 + drive * 0.7, 0.45 + heat * 0.22 + transient * 0.14, profile.heater);
  }
  if (mode === 'goldlion') {
    for (let ring = 0; ring < 4; ring += 1) { stroke(profile.plate, 0.18, 1); ctx.beginPath(); ctx.ellipse(cx, cy - 7, 35 + ring * 14, 15 + ring * 7, time * 0.012 * (ring % 2 ? -1 : 1), 0, TAU); ctx.stroke(); }
  } else if (mode === 'mullard') {
    for (let row = -5; row <= 5; row += 1) { stroke(row % 2 ? palette.secondary : profile.plate, 0.1 + (5 - Math.abs(row)) * 0.014, 0.9); ctx.beginPath(); ctx.moveTo(cx - 86, cy + row * 7); ctx.bezierCurveTo(cx - 32, cy + row * 8 + Math.sin(time * 0.15 + row) * 3, cx + 32, cy + row * 5, cx + 86, cy + row * 7); ctx.stroke(); }
  } else if (mode === 'telefunken') {
    ctx.save(); ctx.translate(cx, cy - 7); ctx.rotate(Math.PI / 4 + Math.sin(time * 0.05) * 0.02); stroke(profile.plate, 0.28, 1.05); for (let i = 0; i < 4; i += 1) ctx.strokeRect(-14 - i * 8, -14 - i * 8, 28 + i * 16, 28 + i * 16); ctx.restore();
  } else if (mode === 'bugleboy') {
    for (let i = 0; i < 18; i += 1) { const a = i * 2.399 + time * 0.045; const r = 18 + (i % 6) * 12; glow(cx + Math.cos(a) * r, cy - 7 + Math.sin(a * 1.13) * r * 0.45, 0.8 + (i % 3) * 0.3, 0.16 + energy * 0.08, i % 2 ? profile.plate : palette.secondary); }
  } else {
    ctx.fillStyle = 'rgba(2,2,2,.26)'; ctx.fillRect(cx - 45, cy - 39, 22, 66); ctx.fillRect(cx + 23, cy - 39, 22, 66);
  }
}

function drawCE1(kit: Kit, intensity: number, preamp: number): void {
  const { ctx, cx, cy, time, transient, palette, stroke, glow, orb } = kit;
  orb(cx, cy - 8, 58, palette.primary, 0.05 + intensity * 0.035);
  for (let lane = 0; lane < 2; lane += 1) {
    const y = cy - 25 + lane * 35;
    stroke(lane ? palette.secondary : palette.primary, 0.28, 1.2); ctx.beginPath(); ctx.moveTo(cx - 91, y);
    for (let step = 1; step <= 48; step += 1) { const p = step / 48; ctx.lineTo(cx - 91 + p * 182, y + Math.sin(p * Math.PI * 5 + time * 0.7 + lane * Math.PI) * (3 + intensity * 10)); } ctx.stroke();
  }
  stroke(palette.warm, 0.18 + preamp * 0.16, 1.1); ctx.strokeRect(cx - 86, cy + 29, 172, 13);
  glow(cx - 78 + ((Math.sin(time * 1.1) + 1) * 0.5) * 156, cy + 35.5, 1.8 + transient, 0.5, palette.warm);
}

function drawDimensionD(kit: Kit, modeValue: number): void {
  const { ctx, cx, cy, time, palette, stroke, glow } = kit;
  const active = Math.max(0, Math.min(6, Math.floor(modeValue * 7)));
  for (let lane = 0; lane < 4; lane += 1) {
    const y = cy - 42 + lane * 25; stroke(lane % 2 ? palette.secondary : palette.primary, 0.18 + lane * 0.03, 1.1); ctx.beginPath();
    for (let step = 0; step <= 60; step += 1) { const p = step / 60; const x = cx - 96 + p * 192; const yy = y + Math.sin(p * Math.PI * 2 + time * 0.24 + lane * Math.PI * 0.5) * 5.5; step === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.stroke();
    glow(cx - 86, y, 1.1, lane === active % 4 ? 0.52 : 0.18, lane % 2 ? palette.secondary : palette.primary);
  }
  stroke(palette.pale, 0.16, 1); for (let button = 0; button < 4; button += 1) { const x = cx - 46 + button * 31; ctx.strokeRect(x - 9, cy + 37, 18, 9); if (button === active % 4 || (active > 3 && button === 3)) glow(x, cy + 41.5, 1.8, 0.5, palette.pale); }
}

function drawRE201(kit: Kit, feedback: number, age: number, modeValue: number): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb } = kit;
  orb(cx, cy - 6, 68, palette.warm, 0.04 + feedback * 0.04 + energy * 0.02);
  const left: readonly [number, number] = [cx - 66, cy - 18]; const right: readonly [number, number] = [cx + 66, cy - 18]; const bottom: readonly [number, number] = [cx, cy + 40];
  stroke(palette.warm, 0.34, 1.4); ctx.beginPath(); ctx.moveTo(...left); ctx.lineTo(...right); ctx.lineTo(...bottom); ctx.closePath(); ctx.stroke();
  const spin = time * (0.8 + feedback * 0.55);
  for (const [x, y] of [left, right]) { stroke(palette.primary, 0.32, 1.15); ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.stroke(); for (let spoke = 0; spoke < 6; spoke += 1) { const a = spin + spoke * TAU / 6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17); ctx.stroke(); } }
  const heads = 3 + Math.round(modeValue * 4); stroke(palette.secondary, 0.24 + age * 0.1, 1.1);
  for (let i = 0; i < heads; i += 1) { const p = i / Math.max(1, heads - 1); const x = cx - 54 + p * 108; const y = cy + 13 + Math.sin(p * Math.PI) * 17; ctx.strokeRect(x - 5, y - 4, 10, 8); if ((Math.floor(time * 2 + i) % heads) === i) glow(x, y, 1.4, 0.48, palette.secondary); }
}

function drawEMT140(kit: Kit, diffusion: number): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb } = kit;
  orb(cx, cy - 6, 70, palette.primary, 0.045 + diffusion * 0.035 + energy * 0.02); stroke(palette.primary, 0.36, 1.35); ctx.strokeRect(cx - 95, cy - 54, 190, 98);
  for (const [x, y] of [[cx - 95, cy - 54], [cx + 95, cy - 54], [cx - 95, cy + 44], [cx + 95, cy + 44]] as const) glow(x, y, 1.5, 0.42, palette.warm);
  for (let row = 0; row < 13; row += 1) { const baseY = cy - 49 + row * 8; ctx.beginPath(); for (let step = 0; step <= 64; step += 1) { const p = step / 64; const x = cx - 95 + p * 190; const y = baseY + Math.sin(p * Math.PI * 6 + time * 0.22 + row * 0.65) * (1.2 + diffusion * 4.8); step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } stroke(row % 2 ? palette.secondary : palette.primary, 0.075 + row * 0.007, 0.75); ctx.stroke(); }
}

function drawLexicon224(kit: Kit, motion: number, diffusion: number): void {
  const { ctx, cx, cy, time, palette, stroke, glow, orb, rgba } = kit;
  orb(cx, cy - 8, 68, palette.secondary, 0.04 + motion * 0.03); const cols = 12; const rows = 7; const cellW = 14; const cellH = 11; const startX = cx - 84; const startY = cy - 46;
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) { const phase = Math.sin(time * 0.7 + row * 1.3 + col * 0.73); ctx.fillStyle = rgba((row + col) % 3 ? palette.primary : palette.secondary, 0.055 + Math.max(0, phase) * (0.08 + diffusion * 0.08), true); ctx.fillRect(startX + col * cellW + 1, startY + row * cellH + 1, cellW - 2, cellH - 2); }
  stroke(palette.pale, 0.18, 1); ctx.strokeRect(startX, startY, cols * cellW, rows * cellH); const scan = Math.floor((time * (1.2 + motion)) % cols); for (let row = 0; row < rows; row += 1) glow(startX + scan * cellW + cellW / 2, startY + row * cellH + cellH / 2, 0.9, 0.26, palette.pale);
}

function drawSP1200(kit: Kit, density: number, filterEnv: number): void {
  const { ctx, cx, cy, time, transient, palette, stroke, glow, rgba } = kit;
  for (let i = 0; i < 8; i += 1) { const x = cx - 80 + i * 23; const level = 12 + ((i * 17) % 29) + Math.sin(time * 0.9 + i) * (4 + density * 8); stroke(i % 2 ? palette.secondary : palette.primary, 0.24, 1); ctx.strokeRect(x, cy - 42, 20, 70); ctx.fillStyle = rgba(i % 2 ? palette.secondary : palette.primary, 0.08 + density * 0.06, true); ctx.fillRect(x + 3, cy + 24 - level, 14, level); if ((Math.floor(time * 3.2) + i) % 8 === 0) glow(x + 10, cy + 34, 1.7 + transient, 0.55, palette.warm); }
  stroke(palette.warm, 0.16 + filterEnv * 0.1, 1); ctx.beginPath(); for (let step = 0; step <= 64; step += 1) { const p = step / 64; const x = cx - 91 + p * 182; const y = cy + 48 + Math.round(Math.sin(p * Math.PI * 4 + time * 0.35) * 6) / 2; step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
}

function drawMPC60(kit: Kit, density: number, bloom: number): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, rgba } = kit; const size = 23; const gap = 5; const startX = cx - (4 * size + 3 * gap) / 2; const startY = cy - 55; const active = Math.floor(time * (2.2 + density * 1.5)) % 16;
  for (let row = 0; row < 4; row += 1) for (let col = 0; col < 4; col += 1) { const index = row * 4 + col; const x = startX + col * (size + gap); const y = startY + row * (size + gap); stroke(index === active ? palette.pale : index % 2 ? palette.secondary : palette.primary, index === active ? 0.44 : 0.16, index === active ? 1.4 : 1); ctx.beginPath(); ctx.roundRect(x, y, size, size, 3); ctx.stroke(); if (index === active) { ctx.fillStyle = rgba(palette.warm, 0.08 + bloom * 0.08 + energy * 0.04, true); ctx.fill(); glow(x + size / 2, y + size / 2, 1.5, 0.5, palette.warm); } }
}

function drawMirage(kit: Kit, drive: number, rate: number): void {
  const { ctx, cx, cy, time, palette, stroke, glow, orb } = kit; orb(cx, cy - 8, 58, palette.secondary, 0.05); stroke(palette.primary, 0.24, 1.1); ctx.strokeRect(cx - 96, cy - 50, 192, 88); ctx.beginPath();
  for (let step = 0; step <= 72; step += 1) { const p = step / 72; const x = cx - 91 + p * 182; const raw = Math.sin(p * Math.PI * (3 + rate * 5) + time * (0.3 + rate * 0.45)) * (18 + drive * 18); const y = cy - 7 + Math.round(raw / 5) * 5; step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  stroke(palette.pale, 0.28, 1.2); ctx.stroke(); for (let i = 0; i < 8; i += 1) { const x = cx - 78 + i * 22; const lit = (Math.floor(time * 4) + i) % 8 === 0; glow(x, cy + 48, lit ? 1.7 : 0.8, lit ? 0.52 : 0.12, lit ? palette.warm : palette.primary); }
}

function drawTascam424(kit: Kit, trim: number, drive: number): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb, rgba } = kit; orb(cx, cy - 3, 66, palette.warm, 0.04 + drive * 0.035 + energy * 0.02); const channelW = 39; const gap = 7; const startX = cx - (4 * channelW + 3 * gap) / 2;
  for (let channel = 0; channel < 4; channel += 1) { const x = startX + channel * (channelW + gap); stroke(channel % 2 ? palette.secondary : palette.primary, 0.2, 1.05); ctx.beginPath(); ctx.roundRect(x, cy - 55, channelW, 92, 4); ctx.stroke(); const meter = clamp01(0.18 + trim * 0.46 + Math.sin(time * (0.7 + channel * 0.08) + channel) * 0.13 + energy * 0.3); for (let segment = 0; segment < 8; segment += 1) { const lit = segment / 8 < meter; const y = cy - 47 + (7 - segment) * 6; ctx.fillStyle = rgba(segment > 5 ? palette.warm : channel % 2 ? palette.secondary : palette.primary, lit ? 0.42 : 0.055, true); ctx.fillRect(x + 6, y, channelW - 12, 3); } const faderY = cy + 28 - drive * 27; stroke(palette.pale, 0.13, 0.8, false); ctx.beginPath(); ctx.moveTo(x + channelW / 2, cy - 2); ctx.lineTo(x + channelW / 2, cy + 32); ctx.stroke(); ctx.fillStyle = rgba(palette.pale, 0.24, true); ctx.fillRect(x + channelW / 2 - 6, faderY - 2, 12, 4); if ((Math.floor(time * 2.5) + channel) % 4 === 0) glow(x + channelW / 2, cy - 60, 1.2, 0.42, palette.warm); }
}

function drawCreative(kit: Kit, moduleId: string, mode: string, params: Record<string, number>): void {
  if (moduleId === 'saturation') drawCreativeEmber(kit, mode, params);
  else if (moduleId === 'chorus') drawCreativeDrift(kit, mode, params);
  else if (moduleId === 'delay') drawCreativeHalo(kit, mode, params);
  else if (moduleId === 'reverb') drawCreativeAtmos(kit, mode, params);
  else if (moduleId === 'media') drawCreativeArtifact(kit, mode, params);
  else drawCreativeGrain(kit, mode, params);
}

function drawCreativeEmber(kit: Kit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb, rgba } = kit; const drive = clamp01(params.drive ?? 0.2); const heat = clamp01(params.heat ?? 0.2); const character = clamp01(params.character ?? 0.3); orb(cx, cy - 7, 56, palette.primary, 0.06 + drive * 0.05 + energy * 0.02);
  const core = ctx.createRadialGradient(cx - 4, cy - 14, 1, cx, cy - 7, 28 + drive * 8); core.addColorStop(0, rgba(palette.warm, 0.48 + heat * 0.18, true)); core.addColorStop(0.4, rgba(palette.primary, 0.25 + drive * 0.12)); core.addColorStop(1, rgba(palette.secondary, 0)); ctx.fillStyle = core; ctx.beginPath(); ctx.ellipse(cx, cy - 7, 38 + drive * 9, 23 + heat * 5, Math.sin(time * 0.08) * 0.05, 0, TAU); ctx.fill();
  const rows = mode === 'broken' ? 12 : 9; for (let row = 0; row < rows; row += 1) { const y = cy - 45 + row * (90 / Math.max(1, rows - 1)); const bend = Math.sin(time * (mode === 'furnace' ? 0.34 : 0.2) + row) * (2 + heat * 4); stroke(row % 2 ? palette.secondary : palette.primary, 0.13 + drive * 0.07, 1); ctx.beginPath(); if (mode === 'broken') { const gap = 10 + (row * 9) % 24; ctx.moveTo(cx - 94, y); ctx.lineTo(cx - gap, y); ctx.moveTo(cx + gap, y + (row % 2 ? 4 : -4)); ctx.lineTo(cx + 94, y); } else { ctx.moveTo(cx - 94, y); ctx.bezierCurveTo(cx - 40, y, cx - 18, y + bend, cx, y + bend); ctx.bezierCurveTo(cx + 20, y + bend, cx + 44, y, cx + 94, y); } ctx.stroke(); }
  glow(cx, cy - 7, 2.1, 0.4 + character * 0.12, palette.warm);
}

function drawCreativeDrift(kit: Kit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb } = kit; const depth = clamp01((params.depth ?? 0.3) * 110); const rate = 0.22 + clamp01((params.rate ?? 0.2) / 2.5) * 0.75; const spread = clamp01(params.spread ?? 0.5); const motion = clamp01(params.motion ?? 0.3); orb(cx - 35, cy - 7, 52, palette.primary, 0.04 + depth * 0.03 + energy * 0.02); orb(cx + 39, cy - 4, 50, palette.secondary, 0.035 + motion * 0.025);
  for (let ribbon = 0; ribbon < 5; ribbon += 1) { const phase = time * rate * (0.5 + ribbon * 0.04) + ribbon * 1.3; ctx.beginPath(); for (let step = 0; step <= 60; step += 1) { const p = step / 60; const x = cx - 99 + p * 198; let y = cy - 7 + (ribbon - 2) * 18 + Math.sin(p * Math.PI * 2.4 + phase) * (6 + depth * 9); if (mode === 'liquid') y += Math.sin(p * Math.PI * 6 - time * 0.2 + ribbon) * 6 * motion; if (mode === 'dimension') y += (p - 0.5) * (ribbon - 2) * 11 * spread; if (mode === 'vibrato') y += Math.sin(p * Math.PI * 8 + time * rate * 2) * (3 + depth * 5); step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } stroke(ribbon % 2 ? palette.secondary : palette.primary, 0.14 + ribbon * 0.022, 1.05); ctx.stroke(); }
  if (mode === 'rotary' || mode === 'orbit') { for (let ring = 0; ring < (mode === 'orbit' ? 6 : 4); ring += 1) { const angle = time * rate * (ring % 2 ? -0.16 : 0.13); stroke(ring % 2 ? palette.secondary : palette.primary, 0.18 + ring * 0.02, 1); ctx.beginPath(); ctx.ellipse(cx, cy - 7, 24 + ring * 12, 10 + ring * 6, angle, 0, TAU); ctx.stroke(); const a = time * rate * 1.8 + ring * 1.3; glow(cx + Math.cos(a) * (24 + ring * 12), cy - 7 + Math.sin(a) * (10 + ring * 6), 1.1, 0.34, ring % 2 ? palette.pale : palette.primary); } }
}

function drawCreativeHalo(kit: Kit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb } = kit; const feedback = clamp01(params.feedback ?? 0.3); const character = clamp01(params.character ?? 0.2); const width = clamp01(params.width ?? 0.5); orb(cx, cy - 8, 62, palette.primary, 0.045 + feedback * 0.04 + energy * 0.02); const depth = 7 + Math.round(feedback * 5);
  for (let i = depth - 1; i >= 0; i -= 1) { const k = i / Math.max(1, depth - 1); const scale = 0.24 + (1 - k) * 0.88; const w = 170 * scale * (0.9 + width * 0.14); const h = 92 * scale; const x = cx + Math.sin(time * 0.04 + i * 0.7) * character * 4; const y = cy - 8 + (k - 0.5) * 8; stroke(i % 2 ? palette.secondary : palette.primary, 0.08 + (1 - k) * 0.17, 1); ctx.beginPath(); if (mode === 'diffuse' || mode === 'constellation') ctx.ellipse(x, y, w / 2, h / 2, 0, 0, TAU); else ctx.roundRect(x - w / 2, y - h / 2, w, h, 5 + scale * 5); ctx.stroke(); }
  glow(cx, cy - 8, 2.4, 0.5, palette.warm); if (mode === 'pingpong') { let x = cx - 82; let y = cy - 48; for (let i = 0; i < 10; i += 1) { const nx = i % 2 ? cx - 66 + i * 4 : cx + 66 - i * 4; const ny = cy - 45 + i * 10; stroke(i % 2 ? palette.secondary : palette.primary, 0.31 - i * 0.02, 1.1); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke(); glow(nx, ny, 1.1, 0.34 - i * 0.02, i % 2 ? palette.secondary : palette.primary); x = nx; y = ny; } }
}

function drawCreativeAtmos(kit: Kit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb } = kit; const size = 0.58 + clamp01(params.size ?? 0.5) * 0.42; const motion = clamp01(params.motion ?? 0.2); const diffusion = clamp01(params.diffusion ?? 0.5); orb(cx - 36, cy - 14, 65 * size, palette.primary, 0.035 + diffusion * 0.03 + energy * 0.02); orb(cx + 42, cy - 5, 58 * size, palette.secondary, 0.03 + motion * 0.025);
  if (mode === 'room' || mode === 'hall' || mode === 'cinema') { const columns = mode === 'cinema' ? 9 : mode === 'hall' ? 7 : 5; const roomScale = (mode === 'room' ? 0.72 : mode === 'hall' ? 0.88 : 1) * size; stroke(palette.primary, 0.13, 1); ctx.strokeRect(cx - 94 * roomScale, cy - 52 * roomScale, 188 * roomScale, 92 * roomScale); for (let i = 0; i < columns; i += 1) { const x = cx + (-82 + i * (164 / Math.max(1, columns - 1))) * roomScale; stroke(i % 2 ? palette.secondary : palette.primary, 0.14 + diffusion * 0.06, 1); ctx.beginPath(); ctx.moveTo(x, cy - 48 * roomScale); ctx.lineTo(x, cy + 36 * roomScale); ctx.stroke(); } }
  else if (mode === 'plate') { stroke(palette.primary, 0.34, 1.3); ctx.strokeRect(cx - 92 * size, cy - 49 * size, 184 * size, 91 * size); for (let row = 0; row < 10; row += 1) { ctx.beginPath(); for (let step = 0; step <= 48; step += 1) { const p = step / 48; const x = cx - 92 * size + p * 184 * size; const y = cy - 4 + (row - 4.5) * 8 + Math.sin(p * Math.PI * 5 + time * 0.2 + row) * (2 + motion * 6); step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } stroke(row % 2 ? palette.secondary : palette.primary, 0.1 + row * 0.012, 0.9); ctx.stroke(); } }
  else { const count = mode === 'nebula' ? 42 : mode === 'cloud' ? 28 : 18; for (let i = 0; i < count; i += 1) { const angle = i * 2.399 + time * (0.02 + motion * 0.025); const radius = 10 + (i % 10) * 8 * size; glow(cx + Math.cos(angle) * radius, cy - 7 + Math.sin(angle * 1.13) * radius * 0.48, 0.7 + (i % 3) * 0.3, 0.09 + (i % 6) * 0.018, i % 3 ? palette.primary : palette.secondary); } }
}

function drawCreativeGrain(kit: Kit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, time, energy, palette, stroke, orb, rgba } = kit; const density = clamp01(params.density ?? 0.4); const chaos = clamp01(params.chaos ?? 0.2); const bloom = clamp01(params.bloom ?? 0.3); orb(cx, cy - 7, 60, palette.primary, 0.04 + bloom * 0.035 + energy * 0.02); stroke(palette.secondary, 0.06, 0.7, false); for (let i = -5; i <= 5; i += 1) { ctx.beginPath(); ctx.moveTo(cx - 95, cy + i * 9); ctx.lineTo(cx + 95, cy + i * 9); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + i * 18, cy - 52); ctx.lineTo(cx + i * 18, cy + 45); ctx.stroke(); }
  const count = 22 + Math.round(density * 34); for (let i = 0; i < count; i += 1) { const seed = i * 12.9898; let orbit = time * (0.07 + chaos * 0.12) + seed; let radiusX = 22 + (i % 9) * 8; let radiusY = 10 + (i % 7) * 5; if (mode === 'shatter') { radiusX *= 1.18; radiusY *= 1.18; } if (mode === 'smear') radiusX *= 1.32; if (mode === 'stutter') orbit = Math.floor(orbit * 4) / 4; const x = cx + Math.sin(seed * 1.7 + orbit) * radiusX; const y = cy - 7 + Math.cos(seed * 0.9 + orbit * 1.2) * radiusY; const size = 1 + (i % 4) * 0.65 + bloom * 1.4; ctx.save(); ctx.translate(x, y); ctx.rotate(seed + time * 0.05 * (i % 2 ? -1 : 1)); ctx.fillStyle = rgba(mode === 'prism' && i % 3 === 0 ? palette.pale : i % 2 ? palette.secondary : palette.primary, 0.13 + bloom * 0.05, true); ctx.beginPath(); ctx.moveTo(0, -size * 2); ctx.lineTo(size * 1.5, 0); ctx.lineTo(0, size * 1.8); ctx.lineTo(-size * 1.5, 0); ctx.closePath(); ctx.fill(); ctx.restore(); }
}

function drawCreativeArtifact(kit: Kit, mode: string, params: Record<string, number>): void {
  const { ctx, cx, cy, time, energy, palette, stroke, glow, orb } = kit; const wear = clamp01(params.wear ?? 0.25); const wow = clamp01(params.wow ?? 0.16); const noise = clamp01(params.noise ?? 0.1); orb(cx - 30, cy - 7, 60, palette.primary, 0.035 + wear * 0.025 + energy * 0.02); orb(cx + 38, cy, 54, palette.secondary, 0.025 + wow * 0.03);
  if (mode === 'cassette' || mode === 'reel') { const shellW = mode === 'cassette' ? 184 : 176; const shellH = mode === 'cassette' ? 92 : 88; stroke(palette.primary, 0.32, 1.2); ctx.strokeRect(cx - shellW / 2, cy - shellH / 2 - 5, shellW, shellH); const radius = mode === 'cassette' ? 20 : 29; const spin = time * (0.65 + wear * 0.7); for (const x of [cx - 47, cx + 47]) { stroke(palette.secondary, 0.27, 1.1); ctx.beginPath(); ctx.arc(x, cy - 7, radius, 0, TAU); ctx.stroke(); for (let spoke = 0; spoke < 6; spoke += 1) { const a = spin + spoke * TAU / 6; ctx.beginPath(); ctx.moveTo(x, cy - 7); ctx.lineTo(x + Math.cos(a) * (radius - 4), cy - 7 + Math.sin(a) * (radius - 4)); ctx.stroke(); } } }
  else if (mode === 'vinyl' || mode === 'wax') { const radius = mode === 'wax' ? 56 : 49; stroke(palette.primary, 0.31, 1.2); for (let ring = 0; ring < 8; ring += 1) { ctx.beginPath(); ctx.arc(cx - 12, cy - 7, radius - ring * 5, 0, TAU); ctx.stroke(); } const angle = time * (0.8 + wow * 0.4); const x = cx - 12 + Math.cos(angle * 0.07) * 38; const y = cy - 7 + Math.sin(angle * 0.07) * 38; stroke(palette.warm, 0.34, 1.2); ctx.beginPath(); ctx.moveTo(cx + 78, cy - 48); ctx.lineTo(x, y); ctx.stroke(); glow(x, y, 1.5, 0.5, palette.warm); }
  else { const bands = mode === 'radio' ? 10 : 16; for (let row = 0; row < bands; row += 1) { const y = cy - 52 + row * (96 / Math.max(1, bands - 1)); const shift = Math.sin(time * (0.4 + wow) + row * 1.7) * (2 + wear * 8); stroke(row % 2 ? palette.secondary : palette.primary, 0.08 + noise * 0.07, 0.9); ctx.beginPath(); ctx.moveTo(cx - 96 + shift, y); ctx.lineTo(cx + 96 - shift * 0.4, y); ctx.stroke(); } }
}

function drawGlassFinish(ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette, time: number): void {
  ctx.save(); const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.22, width / 2, height / 2, Math.max(width, height) * 0.67); vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(0.72, 'rgba(0,0,0,.08)'); vignette.addColorStop(1, 'rgba(0,0,0,.66)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 0.035; ctx.fillStyle = `rgb(${palette.primary[0]} ${palette.primary[1]} ${palette.primary[2]})`; ctx.fillRect(0, ((time * 7) % (height + 8)) - 4, width, 1); ctx.restore();
}
