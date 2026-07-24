import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import { getLatestVisualAudioState, type VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';

const W = 240;
const H = 150;
const TAU = Math.PI * 2;

type RGB = readonly [number, number, number];
type Params = Record<string, number>;
type Physics = { level: number; low: number; mid: number; high: number; transient: number };
type Spring = { value: number; velocity: number };
type Palette = { primary: RGB; secondary: RGB; warm: RGB; pale: RGB; deep: RGB };
type Scene = { ctx: CanvasRenderingContext2D; module: ModuleState; params: Params; time: number; motion: Physics; p: Palette };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const c01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const hash = (v: number) => fract(Math.sin(v * 127.1) * 43758.5453123);
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${c01(a)})`;
const val = (p: Params, id: string, fallback = 0) => p[id] ?? fallback;
const isMode = (m: string, ...modes: string[]) => modes.includes(m);

function palette(id: string): Palette {
  if (id === 'saturation') return { primary: [255, 108, 48], secondary: [226, 65, 141], warm: [255, 214, 132], pale: [255, 239, 215], deep: [16, 3, 8] };
  if (id === 'chorus') return { primary: [61, 216, 255], secondary: [95, 112, 255], warm: [250, 221, 142], pale: [231, 250, 255], deep: [2, 7, 23] };
  if (id === 'delay') return { primary: [91, 123, 255], secondary: [194, 89, 255], warm: [250, 205, 134], pale: [239, 238, 255], deep: [4, 4, 26] };
  if (id === 'reverb') return { primary: [82, 162, 255], secondary: [171, 101, 255], warm: [238, 216, 162], pale: [234, 245, 255], deep: [3, 8, 27] };
  if (id === 'bitcrusher') return { primary: [79, 178, 255], secondary: [171, 91, 255], warm: [238, 212, 159], pale: [236, 244, 255], deep: [5, 6, 24] };
  return { primary: [255, 184, 79], secondary: [231, 126, 67], warm: [255, 226, 157], pale: [255, 240, 212], deep: [14, 8, 4] };
}

function modeFor(module: ModuleState): string {
  if (module.id === 'saturation') return module.emberMode ?? 'velvet';
  if (module.id === 'chorus') return module.driftMode ?? 'chorus';
  if (module.id === 'delay') return module.delayAlgorithm ?? 'tape';
  if (module.id === 'reverb') return module.algorithm ?? 'hall';
  if (module.id === 'media') return module.mediaMode ?? 'cassette';
  return module.grainMode ?? 'reconstruct';
}

function captionFor(module: ModuleState): string {
  if (module.id === 'saturation') return 'EMBER · THERMAL CHAMBER';
  if (module.id === 'chorus') return 'DRIFT · PHASE CURRENT';
  if (module.id === 'delay') return module.delayAlgorithm === 're201' ? 'HALO · TAPE CORRIDOR' : `HALO · ${formatAlgorithmName(module.delayAlgorithm ?? 'tape').toUpperCase()}`;
  if (module.id === 'reverb') return module.algorithm === 'emt140' ? 'ATMOS · PLATE SKY' : module.algorithm === 'lexicon224' ? 'ATMOS · DIGITAL HEAVEN' : `ATMOS · ${(module.algorithm ?? 'hall').toUpperCase()}`;
  if (module.id === 'bitcrusher') return module.grainMode === 'sp1200' ? 'GRAIN · SP-1200 CRYSTAL' : module.grainMode === 'mpc60' ? 'GRAIN · MPC60 MATRIX' : module.grainMode === 'mirage' ? 'GRAIN · MIRAGE MEMORY' : 'GRAIN · QUANTIZED FIELD';
  if (module.id === 'media') return isMode(module.mediaMode ?? '', 'Neve 1073', 'SSL 4000E', 'API 1608') ? 'ARTIFACT · SUMMING BUS' : `ARTIFACT · ${(module.mediaMode ?? 'cassette').toUpperCase()}`;
  return 'SIGNAL OBSERVATORY';
}

function spring(s: Spring, target: number, stiffness: number, damping: number, dt: number): number {
  s.velocity += (target - s.value) * stiffness * dt;
  s.velocity *= Math.exp(-damping * dt);
  s.value += s.velocity * dt;
  return c01(s.value);
}

function physics(s: Record<keyof Physics, Spring>, a: VisualAudioState, dt: number): Physics {
  return {
    level: spring(s.level, c01(a.level), 38, 9, dt),
    low: spring(s.low, c01(a.low), 24, 6.5, dt),
    mid: spring(s.mid, c01(a.mid), 38, 8.5, dt),
    high: spring(s.high, c01(a.high), 52, 10.5, dt),
    transient: spring(s.transient, c01(a.transient), 78, 11.5, dt),
  };
}

export function ModuleViewport({ module }: { module: ModuleState; visualState: VisualAudioState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moduleRef = useRef(module);
  const last = useRef(0);
  const springs = useRef<Record<keyof Physics, Spring>>({
    level: { value: 0, velocity: 0 }, low: { value: 0, velocity: 0 }, mid: { value: 0, velocity: 0 },
    high: { value: 0, velocity: 0 }, transient: { value: 0, velocity: 0 },
  });
  moduleRef.current = module;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let cw = 1, ch = 1, dpr = Math.min(1.75, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cw = Math.max(1, rect.width); ch = Math.max(1, rect.height); dpr = Math.min(1.75, window.devicePixelRatio || 1);
      const width = Math.round(cw * dpr), height = Math.round(ch * dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const render: ViewportRenderCallback = (stamp) => {
      const time = stamp / 1000;
      const dt = last.current ? clamp(time - last.current, 0.001, 0.08) : 1 / 60;
      last.current = time;
      const current = moduleRef.current;
      const params: Params = {};
      for (const parameter of current.parameters) params[parameter.id] = parameter.value;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawViewport(ctx, cw, ch, { ctx, module: current, params, time, motion: physics(springs.current, getLatestVisualAudioState(), dt), p: palette(current.id) });
    };
    const unsubscribe = subscribeViewportAnimation(render);
    return () => { unsubscribe(); ro.disconnect(); };
  }, [module.id]);

  return <div className={`dsp-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}><div className="viewport-glass" aria-hidden="true"/><canvas ref={canvasRef} aria-hidden="true"/><span className="viewport-caption">{captionFor(module)}</span></div>;
}

function drawViewport(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: Scene) {
  ctx.fillStyle = '#010205'; ctx.fillRect(0, 0, cw, ch);
  if (!s.module.enabled) return;
  const scale = Math.max(0.01, Math.min((cw - 8) / W, (ch - 8) / H));
  ctx.save(); ctx.translate((cw - W * scale) / 2, (ch - H * scale) / 2); ctx.scale(scale, scale);
  drawObservatory(s);
  if (s.module.id === 'saturation') drawEmber(s);
  else if (s.module.id === 'chorus') drawDrift(s);
  else if (s.module.id === 'delay') drawHalo(s);
  else if (s.module.id === 'reverb') drawAtmos(s);
  else if (s.module.id === 'bitcrusher') drawGrain(s);
  else drawArtifact(s);
  drawForeground(s);
  ctx.restore();
}

function stroke(ctx: CanvasRenderingContext2D, c: RGB, alpha: number, width = 1) { ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = width; }
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, c: RGB, radius: number, alpha: number, blur = 10) {
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba(c, alpha); ctx.shadowColor = rgba(c, Math.min(.6, alpha)); ctx.shadowBlur = blur;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill(); ctx.restore();
}
function lineGlow(ctx: CanvasRenderingContext2D, c: RGB, alpha: number, width: number, blur = 8) {
  ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = width; ctx.shadowColor = rgba(c, Math.min(.5, alpha)); ctx.shadowBlur = blur;
}
function beam(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, width: number, c: RGB, alpha: number) {
  const g = ctx.createLinearGradient(x - width, 0, x + width, 0);
  g.addColorStop(0, rgba(c, 0)); g.addColorStop(.5, rgba(c, alpha)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.fillRect(x - width, y0, width * 2, y1 - y0);
}

function drawObservatory({ ctx, time, motion, p }: Scene) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, rgba(p.deep, 1)); sky.addColorStop(.52, 'rgb(3,6,16)'); sky.addColorStop(1, 'rgb(1,2,7)');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const haze = ctx.createRadialGradient(120, 76, 2, 120, 76, 112);
  haze.addColorStop(0, rgba(p.primary, .045 + motion.level * .025)); haze.addColorStop(.42, rgba(p.secondary, .018)); haze.addColorStop(1, 'transparent');
  ctx.fillStyle = haze; ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 22; i++) {
    const drift = time * (.006 + (i % 4) * .0015);
    const x = 8 + fract(hash(i * 9.17) + drift) * 224;
    const y = 8 + hash(i * 4.11 + 9) * 112 - motion.mid * (i % 3) * .6;
    const alpha = .035 + hash(i * 2.7) * .06 + motion.high * .025;
    glow(ctx, x, y, i % 5 === 0 ? p.warm : p.pale, .25 + (i % 3) * .16, alpha, 4);
  }

  const floorY = 121;
  for (let i = -5; i <= 5; i++) {
    const x = 120 + i * 34;
    stroke(ctx, i % 2 ? p.secondary : p.primary, .018, .55);
    ctx.beginPath(); ctx.moveTo(120, 83); ctx.lineTo(x, 150); ctx.stroke();
  }
  for (let row = 0; row < 6; row++) {
    const q = row / 5, y = lerp(86, 148, q * q);
    stroke(ctx, p.pale, .012 + q * .010, .5); ctx.beginPath(); ctx.moveTo(12 + q * 27, y); ctx.lineTo(228 - q * 27, y); ctx.stroke();
  }
  stroke(ctx, p.primary, .045, .7); ctx.beginPath(); ctx.moveTo(15, floorY); ctx.lineTo(225, floorY); ctx.stroke();
  ctx.restore();
}

function drawForeground({ ctx, p }: Scene) {
  const edge = ctx.createLinearGradient(0, 0, W, 0); edge.addColorStop(0, 'rgba(0,0,0,.34)'); edge.addColorStop(.07, 'transparent'); edge.addColorStop(.93, 'transparent'); edge.addColorStop(1, 'rgba(0,0,0,.34)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, W, H);
  stroke(ctx, p.pale, .022, .65); ctx.beginPath(); ctx.moveTo(8, 131); ctx.lineTo(232, 131); ctx.stroke();
}

function drawEmber({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), drive = c01(val(params, 'drive', .2)), heat = c01(val(params, 'heat', .2));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const daisY = 112, pulse = 1 + motion.low * .08 + motion.transient * .04;
  for (let ring = 0; ring < 5; ring++) {
    stroke(ctx, ring % 2 ? p.secondary : p.primary, .07 + ring * .015 + drive * .03, .75 + ring * .08);
    ctx.beginPath(); ctx.ellipse(120, daisY, (32 + ring * 15) * pulse, 5 + ring * 2.8, 0, 0, TAU); ctx.stroke();
  }
  const columns = isMode(m, 'furnace', 'broken') ? 7 : 5;
  for (let i = 0; i < columns; i++) {
    const q = i / Math.max(1, columns - 1), x = lerp(76, 164, q), phase = Math.sin(time * (.18 + heat * .12) + i * 1.7);
    const h = 35 + (1 - Math.abs(q - .5) * 1.35) * 38 + phase * (3 + heat * 5) + motion.low * 7;
    beam(ctx, x, daisY - h, daisY, 5 + drive * 3, i % 2 ? p.secondary : p.primary, .09 + drive * .08 + motion.level * .04);
    lineGlow(ctx, i % 2 ? p.secondary : p.primary, .30 + drive * .18, .8 + drive * .5, 10);
    ctx.beginPath(); ctx.moveTo(x, daisY); ctx.lineTo(x, daisY - h); ctx.stroke();
    glow(ctx, x, daisY - h, p.warm, 1 + motion.transient * 1.2, .25 + heat * .12, 12);
  }
  for (let i = 0; i < 26; i++) {
    const seed = hash(i * 7.31), rise = fract(time * (.12 + heat * .10) + seed), x = 120 + (hash(i * 4.2) - .5) * (78 + drive * 28), y = daisY - rise * (65 + heat * 28);
    glow(ctx, x, y, i % 3 ? p.primary : p.warm, .35 + (i % 4) * .12, .035 + motion.high * .045, 4);
  }
  ctx.restore();
}

function drawDrift({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), depth = c01(val(params, 'depth', .25) * 120), rate = .12 + c01(val(params, 'rate', .2) / 2.5) * .7, spread = c01(val(params, 'spread', .5));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let ribbon = 0; ribbon < 13; ribbon++) {
    const phase = time * rate * (.45 + ribbon * .025) + ribbon * .48 + motion.mid * .45;
    const base = 76 + (ribbon - 6) * 3.7, amp = 8 + depth * 12 + Math.abs(ribbon - 6) * .7;
    ctx.beginPath();
    for (let step = 0; step <= 90; step++) {
      const q = step / 90, x = -8 + q * 256;
      let y = base + Math.sin(q * TAU * (1.05 + spread * .32) + phase) * amp;
      y += Math.sin(q * TAU * 2.2 - phase * .55 + ribbon) * (1.5 + spread * 3);
      if (m === 'liquid') y += Math.sin(q * TAU * 4.5 - time * .18) * 3.8;
      if (m === 'vibrato') y += Math.sin(q * TAU * 5.5 + time * rate * 2) * 2.8;
      step ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const color = ribbon % 5 === 0 ? p.warm : ribbon % 2 ? p.secondary : p.primary;
    lineGlow(ctx, color, .055 + (6 - Math.abs(ribbon - 6)) * .012 + motion.high * .025, .7 + (ribbon === 6 ? .7 : 0), ribbon === 6 ? 11 : 5);
    ctx.stroke();
  }
  const center = 120 + Math.sin(time * rate * .7) * 8;
  beam(ctx, center, 43, 112, 16, p.pale, .018 + motion.level * .025);
  glow(ctx, center, 78, p.pale, .75 + motion.transient, .18 + motion.high * .08, 14);
  ctx.restore();
}

function drawHalo({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), feedback = c01(val(params, 'feedback', .3)), width = c01(val(params, 'width', .5)), character = c01(val(params, 'character', .2));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const cx = 137 + Math.sin(time * .035) * 2.5, cy = 67 - motion.low * 1.8;
  const rings = 8 + Math.round(feedback * 5);
  for (let i = rings - 1; i >= 0; i--) {
    const q = i / Math.max(1, rings - 1), rx = lerp(19, 83 * (.88 + width * .18), q), ry = lerp(11, 54, q);
    const wobble = isMode(m, 'tape', 're201', 'EP-3 Echoplex') ? Math.sin(time * .12 + i) * character * 2 : 0;
    lineGlow(ctx, i % 2 ? p.secondary : p.primary, .055 + (1 - q) * .12 + motion.transient * .035, .75 + (1 - q) * .4, 7);
    ctx.beginPath(); ctx.ellipse(cx + wobble, cy, rx, ry, character * .025, 0, TAU); ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const q = i / 6, x = lerp(32, 105, q), mirror = 240 - x;
    stroke(ctx, i % 2 ? p.secondary : p.primary, .035 + q * .02, .7); ctx.beginPath(); ctx.moveTo(x, 116); ctx.lineTo(lerp(x, cx, .78), cy + 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mirror, 116); ctx.lineTo(lerp(mirror, cx, .78), cy + 18); ctx.stroke();
  }
  glow(ctx, cx, cy, p.pale, 3.2 + motion.transient * 2.5, .28 + motion.level * .07, 18);
  const pillar = ctx.createLinearGradient(cx, cy, cx, 124); pillar.addColorStop(0, rgba(p.pale, .12)); pillar.addColorStop(1, 'transparent'); ctx.fillStyle = pillar; ctx.fillRect(cx - 1.2, cy, 2.4, 57);
  ctx.restore();
}

function drawAtmos({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), diffusion = c01(val(params, 'diffusion', .5)), movement = c01(val(params, 'motion', .2));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const horizon = 106;
  for (let band = 0; band < 7; band++) {
    const x = -25 + band * 47 + Math.sin(time * (.018 + movement * .025) + band) * 12;
    const g = ctx.createLinearGradient(x, 0, x + 75, H); g.addColorStop(0, 'transparent'); g.addColorStop(.48, rgba(band % 2 ? p.secondary : p.primary, .025 + diffusion * .03 + motion.mid * .015)); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(x, 0, 95, 132);
  }
  for (let i = 0; i < 5; i++) {
    const y = 38 + i * 14 + Math.sin(time * .018 + i) * 2;
    ctx.beginPath();
    for (let step = 0; step <= 48; step++) {
      const q = step / 48, x = -6 + q * 252, yy = y + Math.sin(q * Math.PI * (1.3 + i * .12) + time * (.026 + movement * .03) + i) * (5 + diffusion * 8);
      step ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    lineGlow(ctx, i % 2 ? p.secondary : p.primary, .035 + diffusion * .028 + motion.high * .018, .75 + i * .08, 8); ctx.stroke();
  }
  if (isMode(m, 'aurora', 'nebula', 'celestial', 'cloud')) {
    for (let i = 0; i < 18; i++) {
      const x = 10 + hash(i * 5.7 + time * .001) * 220, y = 12 + hash(i * 8.1 + time * .0015) * 100;
      glow(ctx, x, y, i % 4 ? p.primary : p.secondary, .3 + (i % 4) * .17, .035 + motion.high * .03, 6);
    }
  }
  if (isMode(m, 'plate', 'emt140')) {
    stroke(ctx, p.pale, .10, .85); ctx.strokeRect(27, 29, 186, 82);
    for (let r = 0; r < 9; r++) { const y = 37 + r * 8; ctx.beginPath(); for (let step = 0; step <= 55; step++) { const q = step / 55, x = 31 + q * 178, yy = y + Math.sin(q * TAU * 2.3 + time * .18 + r) * (1.2 + diffusion * 3.5); step ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } stroke(ctx, r % 2 ? p.secondary : p.primary, .045 + r * .004, .6); ctx.stroke(); }
  }
  const well = ctx.createRadialGradient(120, horizon, 0, 120, horizon, 62); well.addColorStop(0, rgba(p.pale, .11 + motion.level * .04)); well.addColorStop(.32, rgba(p.primary, .035)); well.addColorStop(1, 'transparent'); ctx.fillStyle = well; ctx.fillRect(48, 62, 144, 88);
  beam(ctx, 120, 70, 124, 18, p.pale, .018 + motion.level * .03);
  glow(ctx, 120, horizon, p.pale, 1.7 + motion.transient * 1.4, .22, 16);
  ctx.restore();
}

function drawGrain({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), density = c01(val(params, 'density', .4)), chaos = c01(val(params, 'chaos', .2));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const cellCount = isMode(m, 'mpc60') ? 16 : isMode(m, 'sp1200') ? 12 : 22 + Math.round(density * 14);
  for (let i = 0; i < cellCount; i++) {
    const seed = hash(i * 8.71), z = fract(seed + time * (.006 + chaos * .012)), depth = .25 + z * .9;
    const x = 120 + (hash(i * 3.17) - .5) * 190 * depth, y = 75 + (hash(i * 5.91) - .5) * 98 * depth - motion.mid * (1 - z) * 2;
    const size = (3 + hash(i * 2.77) * 8) * depth;
    const c = i % 3 ? p.primary : p.secondary;
    stroke(ctx, c, .045 + (1 - z) * .08 + motion.high * .025, .65 + depth * .35);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    if (i % 4 === 0) { ctx.fillStyle = rgba(c, .018 + motion.level * .02); ctx.fillRect(x - size / 2 + 1, y - size / 2 + 1, Math.max(0, size - 2), Math.max(0, size - 2)); }
  }
  for (let i = 0; i < 7; i++) {
    const q = i / 6, y = lerp(93, 134, q * q); stroke(ctx, i % 2 ? p.secondary : p.primary, .025 + q * .02, .55); ctx.beginPath(); ctx.moveTo(28 + q * 25, y); ctx.lineTo(212 - q * 25, y); ctx.stroke();
  }
  const burst = 10 + Math.round(motion.transient * 10);
  for (let i = 0; i < burst; i++) {
    const a = i / burst * TAU + time * .025, r = 12 + (i % 5) * 7; glow(ctx, 120 + Math.cos(a) * r, 84 + Math.sin(a * 1.17) * r * .48, i % 2 ? p.primary : p.secondary, .35 + (i % 3) * .14, .045 + motion.high * .04, 5);
  }
  glow(ctx, 120, 84, p.pale, 1.4 + motion.transient * 1.3, .2 + motion.level * .05, 14);
  ctx.restore();
}

function drawArtifact({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), wear = c01(val(params, 'wear', .2)), wow = c01(val(params, 'wow', .16)), noise = c01(val(params, 'noise', .1));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const busX = 120, busY = 80;

  if (isMode(m, 'Neve 1073', 'SSL 4000E', 'API 1608')) {
    const channels = m === 'API 1608' ? 12 : 10;
    for (let i = 0; i < channels; i++) {
      const q = i / Math.max(1, channels - 1), fromLeft = i < channels / 2;
      const sx = fromLeft ? 7 : 233, sy = 26 + (i % (channels / 2)) * 19;
      const signal = .2 + motion.level * .65 + Math.sin(time * (.38 + i * .018) + i) * .08;
      const c = i % 3 === 0 ? p.warm : i % 2 ? p.secondary : p.primary;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      const bend = (q - .5) * 16 + Math.sin(time * .045 + i) * 1.5;
      ctx.bezierCurveTo(60 + (fromLeft ? 0 : 80), sy + bend, 90 + (fromLeft ? 0 : 60), busY - 20 + bend * .35, busX, busY);
      lineGlow(ctx, c, .06 + signal * .07, .75 + signal * .25, 6); ctx.stroke();
      glow(ctx, lerp(sx, busX, .34), lerp(sy, busY, .34), c, .35 + signal * .35, .07 + signal * .05, 5);
    }
    lineGlow(ctx, p.warm, .26 + wear * .08, 1.2, 13); ctx.beginPath(); ctx.moveTo(busX, 28); ctx.lineTo(busX, 124); ctx.stroke();
    glow(ctx, busX, busY, p.warm, 1.8 + motion.transient * 1.4, .32 + motion.level * .08, 18);
    const spread = 16 + motion.low * 8;
    for (let i = 0; i < 5; i++) { stroke(ctx, i % 2 ? p.primary : p.warm, .055 + i * .012, .7); ctx.beginPath(); ctx.ellipse(busX, busY, spread + i * 11, 5 + i * 3.5, 0, 0, TAU); ctx.stroke(); }
  } else if (isMode(m, 'cassette', 'reel', 'tascam424', 'Ampex ATR-102')) {
    const left = 76, right = 164, r = isMode(m, 'reel', 'Ampex ATR-102') ? 27 : 20, spin = time * (.35 + wear * .4);
    stroke(ctx, p.primary, .18, .9); ctx.strokeRect(48, 30, 144, 88);
    for (const x of [left, right]) { stroke(ctx, p.warm, .18 + wear * .06, .85); ctx.beginPath(); ctx.arc(x, 71, r, 0, TAU); ctx.stroke(); for (let s = 0; s < 6; s++) { const a = spin + s * TAU / 6; ctx.beginPath(); ctx.moveTo(x, 71); ctx.lineTo(x + Math.cos(a) * (r - 4), 71 + Math.sin(a) * (r - 4)); ctx.stroke(); } }
    lineGlow(ctx, p.secondary, .10 + wow * .06, .75, 7); ctx.beginPath(); ctx.moveTo(left + r, 71); ctx.bezierCurveTo(105, 64 + Math.sin(time * .4) * wow * 5, 135, 78 - Math.sin(time * .36) * wow * 5, right - r, 71); ctx.stroke();
  } else if (isMode(m, 'vinyl', 'wax')) {
    const cx = 105, cy = 76, r = m === 'wax' ? 51 : 44; for (let i = 0; i < 8; i++) { stroke(ctx, i % 2 ? p.primary : p.secondary, .05 + i * .012, .7); ctx.beginPath(); ctx.arc(cx, cy, r - i * 5, 0, TAU); ctx.stroke(); }
    const a = time * (.035 + wow * .035), x = cx + Math.cos(a) * 34, y = cy + Math.sin(a) * 34; lineGlow(ctx, p.warm, .24, 1, 9); ctx.beginPath(); ctx.moveTo(202, 31); ctx.lineTo(x, y); ctx.stroke(); glow(ctx, x, y, p.warm, 1.2, .35, 12);
  } else if (m === 'vhs') {
    for (let i = 0; i < 12; i++) { const bw = 9 + hash(i * 3.2) * 12, x = 8 + i * 20 + (hash(i * 7.1) - .5) * 7, h = 18 + hash(i * 4.4) * 57; ctx.fillStyle = 'rgba(4,8,18,.88)'; ctx.fillRect(x, 121 - h, bw, h); stroke(ctx, i % 2 ? p.secondary : p.primary, .045 + motion.high * .03, .65); ctx.strokeRect(x, 121 - h, bw, h); }
    for (let row = 0; row < 12; row++) { const y = 21 + row * 8, shift = Math.sin(time * (.22 + wow * .45) + row) * (1 + wear * 5); stroke(ctx, row % 3 ? p.primary : p.secondary, .03 + noise * .04, .55); ctx.beginPath(); ctx.moveTo(8 + shift, y); ctx.lineTo(232 - shift * .3, y); ctx.stroke(); }
  } else {
    for (let i = 0; i < 15; i++) { const y = 19 + i * 7.2, shift = Math.sin(time * (.16 + wow * .35) + i * 1.2) * (1 + wear * 5); stroke(ctx, i % 2 ? p.secondary : p.primary, .045 + noise * .05, .65); ctx.beginPath(); ctx.moveTo(15 + shift, y); ctx.lineTo(225 - shift * .4, y); ctx.stroke(); }
  }
  ctx.restore();
}
