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
type Palette = { a: RGB; b: RGB; warm: RGB; pale: RGB; dark: RGB };
type Scene = { ctx: CanvasRenderingContext2D; module: ModuleState; params: Params; time: number; motion: Physics; p: Palette };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const c01 = (v: number) => clamp(v, 0, 1);
const fract = (v: number) => v - Math.floor(v);
const hash = (v: number) => fract(Math.sin(v * 127.1) * 43758.5453123);
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${c01(a)})`;
const val = (p: Params, id: string, fallback = 0) => p[id] ?? fallback;
const isMode = (mode: string, ...values: string[]) => values.includes(mode);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function palette(id: string): Palette {
  if (id === 'saturation') return { a: [242, 119, 55], b: [190, 49, 116], warm: [255, 197, 105], pale: [255, 235, 204], dark: [18, 5, 8] };
  if (id === 'chorus') return { a: [70, 205, 228], b: [101, 107, 242], warm: [234, 211, 129], pale: [222, 248, 250], dark: [3, 8, 25] };
  if (id === 'delay') return { a: [151, 113, 246], b: [222, 75, 170], warm: [249, 179, 96], pale: [239, 232, 255], dark: [9, 5, 28] };
  if (id === 'reverb') return { a: [74, 145, 239], b: [157, 103, 235], warm: [229, 192, 131], pale: [227, 240, 250], dark: [4, 10, 28] };
  if (id === 'media') return { a: [222, 150, 78], b: [179, 78, 105], warm: [251, 190, 99], pale: [243, 229, 201], dark: [17, 9, 6] };
  return { a: [220, 88, 194], b: [82, 194, 148], warm: [241, 174, 90], pale: [238, 235, 246], dark: [14, 4, 18] };
}

function modeFor(m: ModuleState): string {
  if (m.id === 'saturation') return m.emberMode ?? 'velvet';
  if (m.id === 'chorus') return m.driftMode ?? 'chorus';
  if (m.id === 'delay') return m.delayAlgorithm ?? 'tape';
  if (m.id === 'reverb') return m.algorithm ?? 'hall';
  if (m.id === 'media') return m.mediaMode ?? 'cassette';
  return m.grainMode ?? 'reconstruct';
}

function captionFor(m: ModuleState): string {
  if (m.id === 'saturation') {
    const names: Record<string, string> = {
      goldlion: 'B759 · GOLD LION FIELD', mullard: 'ECC83 · MULLARD HEAT', telefunken: 'ECC83 · TELEFUNKEN GRID',
      bugleboy: '12AX7 · BUGLE BOY AIR', rcablack: '12AX7 · RCA BLACK PLATE',
    };
    return names[m.emberMode ?? ''] ?? 'THERMAL REACTOR';
  }
  if (m.id === 'chorus') return m.driftMode === 'ce1' ? 'CE-1 · BBD CHORUS' : m.driftMode === 'dimensiond' ? 'DIMENSION D · PHASE MATRIX' : 'PHASE CURRENT';
  if (m.id === 'delay') return m.delayAlgorithm === 're201' ? 'RE-201 · TAPE ECHO' : formatAlgorithmName(m.delayAlgorithm ?? 'tape');
  if (m.id === 'reverb') return m.algorithm === 'emt140' ? 'EMT 140 · PLATE FIELD' : m.algorithm === 'lexicon224' ? '224 · DIGITAL SPACE' : (m.algorithm ?? 'hall').toUpperCase();
  if (m.id === 'bitcrusher') return m.grainMode === 'sp1200' ? 'SP-1200 · 26.04 KHZ' : m.grainMode === 'mpc60' ? 'MPC60 · 40 KHZ' : m.grainMode === 'mirage' ? 'MIRAGE · 8 BIT' : (m.grainMode ?? 'reconstruct').toUpperCase();
  if (m.id === 'media') return m.mediaMode === 'tascam424' ? 'PORTASTUDIO 424 · 4 TRACK' : (m.mediaMode ?? 'cassette').toUpperCase();
  return 'SIGNAL WORLD';
}

function spring(s: Spring, target: number, stiffness: number, damping: number, dt: number): number {
  s.velocity += (target - s.value) * stiffness * dt;
  s.velocity *= Math.exp(-damping * dt);
  s.value += s.velocity * dt;
  return c01(s.value);
}
function physics(s: Record<keyof Physics, Spring>, a: VisualAudioState, dt: number): Physics {
  return {
    level: spring(s.level, c01(a.level), 42, 10, dt), low: spring(s.low, c01(a.low), 28, 7, dt),
    mid: spring(s.mid, c01(a.mid), 44, 9, dt), high: spring(s.high, c01(a.high), 60, 11, dt),
    transient: spring(s.transient, c01(a.transient), 88, 12, dt),
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

function drawViewport(ctx: CanvasRenderingContext2D, cw: number, ch: number, scene: Scene) {
  ctx.fillStyle = '#010203'; ctx.fillRect(0, 0, cw, ch);
  if (!scene.module.enabled) return;
  const scale = Math.max(0.01, Math.min((cw - 8) / W, (ch - 8) / H));
  ctx.save(); ctx.translate((cw - W * scale) / 2, (ch - H * scale) / 2); ctx.scale(scale, scale);
  drawScene(scene);
  drawEdgeGlass(scene);
  ctx.restore();
}

function stroke(ctx: CanvasRenderingContext2D, c: RGB, alpha: number, width = 1) { ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = width; }
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, c: RGB, radius: number, alpha: number) {
  ctx.save(); ctx.fillStyle = rgba(c, alpha); ctx.shadowColor = rgba(c, Math.min(0.5, alpha)); ctx.shadowBlur = 3 + radius * 2.5;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill(); ctx.restore();
}
function backgroundGradient(ctx: CanvasRenderingContext2D, top: RGB, bottom: RGB) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgba(top, 1)); g.addColorStop(1, rgba(bottom, 1)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawEdgeGlass({ ctx }: Scene) {
  const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(0,0,0,.32)'); g.addColorStop(.07, 'transparent'); g.addColorStop(.93, 'transparent'); g.addColorStop(1, 'rgba(0,0,0,.32)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const top = ctx.createLinearGradient(0, 0, 0, H); top.addColorStop(0, 'rgba(255,255,255,.025)'); top.addColorStop(.16, 'transparent'); top.addColorStop(1, 'rgba(0,0,0,.16)'); ctx.fillStyle = top; ctx.fillRect(0, 0, W, H);
}
function drawScene(s: Scene) {
  if (s.module.id === 'saturation') drawEmber(s);
  else if (s.module.id === 'chorus') drawDrift(s);
  else if (s.module.id === 'delay') drawHalo(s);
  else if (s.module.id === 'reverb') drawAtmos(s);
  else if (s.module.id === 'bitcrusher') drawGrain(s);
  else drawArtifact(s);
}

function drawEmber({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), drive = c01(val(params, 'drive', .2)), heat = c01(val(params, 'heat', .2)), character = c01(val(params, 'character', .3));
  backgroundGradient(ctx, [24, 7, 11], [5, 2, 4]);
  const furnace = ctx.createLinearGradient(0, 0, 0, H); furnace.addColorStop(0, 'transparent'); furnace.addColorStop(.56, rgba(p.a, .015 + heat * .025)); furnace.addColorStop(1, rgba(p.b, .035 + drive * .025)); ctx.fillStyle = furnace; ctx.fillRect(0, 0, W, H);

  for (let row = 0; row < 9; row++) {
    const y = 24 + row * 12;
    const bend = Math.sin(time * (.11 + heat * .08) + row * .72) * (2 + heat * 5 + motion.low * 3);
    stroke(ctx, row % 2 ? p.b : p.a, .055 + drive * .055, .7 + row * .025);
    ctx.beginPath(); ctx.moveTo(10, y);
    ctx.bezierCurveTo(60, y - bend, 88, y + bend, 120, y + bend * .35);
    ctx.bezierCurveTo(154, y - bend * .7, 188, y + bend * .25, 230, y); ctx.stroke();
  }

  const hardware = isMode(m, 'goldlion', 'mullard', 'telefunken', 'bugleboy', 'rcablack');
  if (hardware || isMode(m, 'tube', 'console', 'transformer')) {
    const spacing = m === 'rcablack' ? 43 : 46;
    for (let i = -1; i <= 1; i++) {
      const x = 120 + i * spacing, y = 70 - motion.low * 2;
      const plate = m === 'mullard' ? [230, 99, 65] as RGB : m === 'telefunken' ? [176, 217, 229] as RGB : m === 'rcablack' ? [123, 82, 78] as RGB : p.a;
      const body = ctx.createLinearGradient(x - 15, 32, x + 15, 100); body.addColorStop(0, rgba(plate, .035)); body.addColorStop(.55, rgba(plate, .09 + drive * .04)); body.addColorStop(1, 'transparent'); ctx.fillStyle = body;
      ctx.beginPath(); ctx.roundRect(x - 15, 31, 30, 72, 12); ctx.fill(); stroke(ctx, plate, .22 + drive * .10, 1.05); ctx.stroke();
      for (let g = -2; g <= 2; g++) { const gy = y + g * 10; stroke(ctx, p.warm, .08 + heat * .08, .75); ctx.beginPath(); ctx.moveTo(x - 9, gy); ctx.lineTo(x + 9, gy + Math.sin(time * .18 + g + i) * 1.4); ctx.stroke(); }
      const rise = fract(time * (.28 + heat * .25) + i * .19); glow(ctx, x, 92 - rise * 47, p.warm, 1.2 + drive * .8, .32 + motion.transient * .15);
    }
  }

  if (m === 'goldlion') for (let i = 0; i < 5; i++) { stroke(ctx, p.warm, .06 + i * .012, .8); ctx.beginPath(); ctx.ellipse(120, 69, 26 + i * 15, 10 + i * 6, Math.sin(time * .035) * .08, 0, TAU); ctx.stroke(); }
  else if (m === 'telefunken') { ctx.save(); ctx.translate(120, 69); ctx.rotate(Math.PI / 4 + Math.sin(time * .04) * .02); for (let i = 0; i < 5; i++) { stroke(ctx, p.pale, .05 + i * .02, .75); ctx.strokeRect(-13 - i * 8, -13 - i * 8, 26 + i * 16, 26 + i * 16); } ctx.restore(); }
  else if (m === 'bugleboy') for (let i = 0; i < 18; i++) { const a = i * 2.399 + time * .055, r = 20 + (i % 6) * 11; glow(ctx, 120 + Math.cos(a) * r, 68 + Math.sin(a * 1.12) * r * .42, i % 2 ? p.a : p.warm, .7 + (i % 3) * .25, .08 + motion.high * .08); }
  else if (m === 'furnace') { const g = ctx.createRadialGradient(120, 80, 1, 120, 80, 68); g.addColorStop(0, rgba(p.warm, .23 + motion.low * .1)); g.addColorStop(.45, rgba(p.a, .09)); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(30, 15, 180, 125); }
  else if (m === 'exciter') for (let i = 0; i < 15; i++) { const a = -Math.PI * .92 + i * Math.PI * 1.84 / 14; stroke(ctx, p.pale, .035 + motion.high * .04, .7); ctx.beginPath(); ctx.moveTo(120, 75); ctx.lineTo(120 + Math.cos(a) * (45 + character * 30), 75 + Math.sin(a) * (28 + character * 18)); ctx.stroke(); }
  else if (m === 'broken') for (let i = 0; i < 8; i++) { const x = 20 + hash(i * 5.7) * 200, y = 20 + hash(i * 8.2) * 105; stroke(ctx, i % 2 ? p.b : p.a, .10 + motion.transient * .06, 1); ctx.beginPath(); ctx.moveTo(x - 9, y - 7); ctx.lineTo(x + 4, y); ctx.lineTo(x - 2, y + 12); ctx.stroke(); }

  glow(ctx, 120, 72 - motion.low * 2, p.warm, 1.5 + motion.transient * 1.7, .28 + character * .08);
}

function drawDrift({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), depth = c01(val(params, 'depth', .3) * 110), rate = .15 + c01(val(params, 'rate', .2) / 2.5) * .9, spread = c01(val(params, 'spread', .5)), movement = c01(val(params, 'motion', .3));
  backgroundGradient(ctx, [4, 12, 31], [3, 5, 16]);
  const split = ctx.createLinearGradient(0, 0, W, 0); split.addColorStop(0, rgba(p.a, .085)); split.addColorStop(.42, 'transparent'); split.addColorStop(.58, 'transparent'); split.addColorStop(1, rgba(p.b, .085)); ctx.fillStyle = split; ctx.fillRect(0, 0, W, H);

  if (isMode(m, 'rotary', 'orbit')) {
    for (let ring = 0; ring < (m === 'orbit' ? 7 : 5); ring++) {
      const angle = time * rate * (ring % 2 ? -.14 : .11) + ring * .23;
      stroke(ctx, ring % 2 ? p.b : p.a, .08 + ring * .018 + motion.high * .02, .8);
      ctx.beginPath(); ctx.ellipse(120, 73, 28 + ring * 14, 10 + ring * 7, angle, 0, TAU); ctx.stroke();
      const a = time * rate * 1.7 + ring * 1.4; glow(ctx, 120 + Math.cos(a) * (28 + ring * 14), 73 + Math.sin(a) * (10 + ring * 7), ring % 2 ? p.b : p.a, .8 + ring * .08, .16 + motion.transient * .08);
    }
    return;
  }

  if (m === 'doppler') {
    const sourceX = 36 + (Math.sin(time * rate * .55) * .5 + .5) * 168;
    glow(ctx, sourceX, 74, p.warm, 1.4 + motion.transient, .34);
    for (let i = 0; i < 9; i++) { const r = 12 + i * 15 + fract(time * rate * .22) * 15; stroke(ctx, i % 2 ? p.b : p.a, .14 - i * .011, .9); ctx.beginPath(); ctx.arc(sourceX, 74, r, -1.08, 1.08); ctx.stroke(); }
    return;
  }

  for (let ribbon = 0; ribbon < 6; ribbon++) {
    const phase = time * rate * (.48 + ribbon * .045) + ribbon * 1.22 + motion.mid * .6;
    ctx.beginPath();
    for (let step = 0; step <= 80; step++) {
      const q = step / 80, x = 6 + q * 228;
      let y = 31 + ribbon * 18 + Math.sin(q * Math.PI * 2.35 + phase) * (4 + depth * 10);
      if (m === 'liquid') y += Math.sin(q * Math.PI * 6 - time * .24 + ribbon) * 6 * movement;
      if (isMode(m, 'dimension', 'dimensiond')) y += (q - .5) * (ribbon - 2.5) * 12 * spread;
      if (m === 'vibrato') y += Math.sin(q * Math.PI * 8 + time * rate * 2) * (3 + depth * 5);
      if (m === 'ensemble') y += Math.sin(q * Math.PI * 4.3 - phase * .7) * 3.5;
      step ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    stroke(ctx, ribbon % 2 ? p.b : p.a, .11 + ribbon * .018 + motion.high * .03, 1 + (ribbon === 2 || ribbon === 3 ? .15 : 0)); ctx.stroke();
  }
  if (m === 'ce1') { stroke(ctx, p.warm, .18, 1); ctx.strokeRect(30, 117, 180, 12); const x = 37 + (Math.sin(time * 1.05) * .5 + .5) * 166; glow(ctx, x, 123, p.warm, 1.4, .35 + motion.transient * .1); }
}

function drawHalo({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), feedback = c01(val(params, 'feedback', .3)), character = c01(val(params, 'character', .2)), width = c01(val(params, 'width', .5));
  backgroundGradient(ctx, [12, 7, 33], [3, 3, 13]);
  const vanX = 164 + Math.sin(time * .035) * 4 + motion.mid * 2, vanY = 54 - motion.low * 2;
  const depth = 8 + Math.round(feedback * 7);

  for (let i = depth - 1; i >= 0; i--) {
    const q = i / Math.max(1, depth - 1), z = 1 - q;
    const cx = lerp(42, vanX, q), cy = lerp(104, vanY, q);
    const frameW = lerp(194 * (0.86 + width * .16), 24, q), frameH = lerp(96, 16, q);
    const wobble = isMode(m, 'tape', 're201', 'EP-3 Echoplex') ? Math.sin(time * .18 + i) * character * 2.5 : 0;
    stroke(ctx, i % 2 ? p.b : p.a, .045 + z * .18 + motion.transient * z * .04, .75 + z * .35);
    ctx.beginPath();
    if (isMode(m, 'diffuse', 'constellation', 'Binson Echorec')) ctx.ellipse(cx + wobble, cy, frameW / 2, frameH / 2, character * .04, 0, TAU);
    else if (isMode(m, 'bbd', 'Deluxe Memory Man')) { const x = Math.round((cx - frameW / 2) / 3) * 3, y = Math.round((cy - frameH / 2) / 3) * 3; ctx.rect(x, y, Math.round(frameW / 3) * 3, Math.round(frameH / 3) * 3); }
    else ctx.roundRect(cx - frameW / 2 + wobble, cy - frameH / 2, frameW, frameH, 3 + z * 6);
    ctx.stroke();
  }

  if (m === 'pingpong') {
    let x = 30, y = 30;
    for (let i = 0; i < 12; i++) { const nx = i % 2 ? 64 + i * 5 : 190 - i * 5, ny = 28 + i * 8.3; stroke(ctx, i % 2 ? p.b : p.a, .29 - i * .017, 1); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke(); glow(ctx, nx, ny, i % 2 ? p.b : p.a, .8, .18 + motion.transient * .08); x = nx; y = ny; }
  } else if (isMode(m, 'scatter', 'AMS DMX 15-80 S')) {
    for (let i = 0; i < 18; i++) { const x = 16 + hash(i * 7.7 + Math.floor(time * .6)) * 208, y = 18 + hash(i * 4.3) * 112; stroke(ctx, i % 2 ? p.b : p.a, .055 + motion.high * .04, .7); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (hash(i * 2.1) - .5) * 18, y + (hash(i * 3.2) - .5) * 14); ctx.stroke(); }
  } else if (isMode(m, 'constellation', 'Binson Echorec')) {
    for (let i = 0; i < 15; i++) { const x = 22 + hash(i * 6.1) * 196, y = 16 + hash(i * 3.8) * 112; glow(ctx, x, y, i % 3 ? p.a : p.b, .55 + (i % 3) * .2, .08 + motion.high * .07); if (i > 0) { const px = 22 + hash((i - 1) * 6.1) * 196, py = 16 + hash((i - 1) * 3.8) * 112; stroke(ctx, p.pale, .035, .55); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); } }
  }
  glow(ctx, vanX, vanY, p.warm, 1.25 + motion.transient * 1.4, .3);
}

function drawAtmos({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), size = .62 + c01(val(params, 'size', .5)) * .38, diffusion = c01(val(params, 'diffusion', .5)), movement = c01(val(params, 'motion', .2));
  backgroundGradient(ctx, [5, 13, 32], [3, 6, 18]);
  ctx.save(); ctx.globalCompositeOperation = 'screen';

  const sky = ctx.createLinearGradient(0, 0, W, H); sky.addColorStop(0, rgba(p.a, .04)); sky.addColorStop(.48, 'transparent'); sky.addColorStop(1, rgba(p.b, .035)); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  if (isMode(m, 'room', 'hall', 'cinema')) {
    const columns = m === 'cinema' ? 9 : m === 'hall' ? 7 : 5, vanX = 120 + Math.sin(time * .03) * 4, vanY = 42 - motion.mid * 2;
    for (let i = 0; i < columns; i++) { const q = i / Math.max(1, columns - 1), x = lerp(20, 220, q); stroke(ctx, i % 2 ? p.b : p.a, .045 + diffusion * .035, .7); ctx.beginPath(); ctx.moveTo(vanX + (x - 120) * .24, vanY); ctx.lineTo(x, 132); ctx.stroke(); }
    for (let row = 0; row < 5; row++) { const y = 54 + row * 17; stroke(ctx, p.pale, .025 + row * .008, .55); ctx.beginPath(); ctx.moveTo(28 + row * 5, y); ctx.lineTo(212 - row * 5, y + Math.sin(time * .04 + row) * 1.4); ctx.stroke(); }
  }

  if (isMode(m, 'plate', 'emt140')) {
    const x0 = 20, y0 = 22, ww = 200, hh = 103; stroke(ctx, p.pale, .15, 1.05); ctx.strokeRect(x0, y0, ww, hh);
    for (let row = 0; row < 12; row++) { const baseY = y0 + 7 + row * 8; ctx.beginPath(); for (let s = 0; s <= 60; s++) { const q = s / 60, x = x0 + 3 + q * (ww - 6), y = baseY + Math.sin(q * Math.PI * 6 + time * .2 + row * .61) * (1.1 + diffusion * 5 + motion.mid * 1.5); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } stroke(ctx, row % 2 ? p.b : p.a, .055 + row * .006, .7); ctx.stroke(); }
  } else if (m === 'aurora') {
    for (let band = 0; band < 5; band++) { const gradient = ctx.createLinearGradient(0, 0, W, 0); gradient.addColorStop(0, 'transparent'); gradient.addColorStop(.35, rgba(band % 2 ? p.b : p.a, .07 + diffusion * .05)); gradient.addColorStop(.72, rgba(band % 2 ? p.a : p.b, .04)); gradient.addColorStop(1, 'transparent'); ctx.strokeStyle = gradient; ctx.lineWidth = 1.3 + band * .25; ctx.beginPath(); for (let s = 0; s <= 44; s++) { const q = s / 44, x = -8 + q * 256, y = 24 + band * 20 + Math.sin(q * TAU + time * (.07 + movement * .08) + band) * (6 + motion.mid * 5); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  } else if (m === 'freeze') {
    for (let i = 0; i < 24; i++) { const x = 16 + hash(i * 3.7) * 208, y = 16 + hash(i * 7.9) * 118, r = 2 + hash(i * 2.3) * 5; stroke(ctx, p.pale, .045 + motion.high * .03, .6); ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x, y - r * .65); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * .65); ctx.closePath(); ctx.stroke(); }
  } else if (m === 'lexicon224') {
    for (let row = 0; row < 7; row++) for (let col = 0; col < 13; col++) { const phase = Math.sin(time * .75 + row * 1.1 + col * .61), alpha = .025 + Math.max(0, phase) * (.04 + diffusion * .055); ctx.fillStyle = rgba((row + col) % 3 ? p.a : p.b, alpha); ctx.fillRect(14 + col * 16.2, 18 + row * 15, 12, 9); }
  } else {
    const sheets = m === 'nebula' ? 9 : m === 'cloud' ? 7 : 5;
    for (let band = 0; band < sheets; band++) { const seed = hash(band * 9.17), base = 10 + band * (130 / Math.max(1, sheets - 1)), amp = (4 + diffusion * 10) * (.55 + seed * .6), speed = .02 + movement * .055 + seed * .015; ctx.beginPath(); for (let s = 0; s <= 48; s++) { const q = s / 48, x = -12 + q * 264, y = base + Math.sin(q * Math.PI * (1.1 + seed) + time * speed + band) * amp - motion.mid * (band % 2 ? 3 : 1.5); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } stroke(ctx, band % 3 === 0 ? p.b : p.a, .035 + diffusion * .035 + motion.high * .018, .8 + size * .45); ctx.stroke(); }
    const motes = m === 'nebula' ? 38 : m === 'celestial' ? 30 : 18;
    for (let i = 0; i < motes; i++) { const seed = hash(i * 17.3), x = 8 + hash(i * 4.1 + time * .002) * 224, y = 10 + hash(i * 6.7 + time * .0015) * 122; glow(ctx, x + Math.sin(time * (.012 + seed * .02) + i) * 4, y - motion.mid * 3, i % 4 ? p.a : p.b, .45 + (i % 4) * .25, .045 + motion.high * .035); }
  }
  ctx.restore();

  if (m === 'abyss') { const g = ctx.createLinearGradient(0, 25, 0, H); g.addColorStop(0, 'transparent'); g.addColorStop(1, 'rgba(0,0,0,.48)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
}

function drawGrain({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), density = c01(val(params, 'density', .4)), chaos = c01(val(params, 'chaos', .2)), bloom = c01(val(params, 'bloom', .3));
  backgroundGradient(ctx, [16, 5, 22], [4, 3, 10]);

  if (m === 'sp1200') {
    const baseline = 116; for (let i = 0; i < 8; i++) { const x = 22 + i * 25, level = 20 + ((i * 17) % 35) + Math.sin(time * .9 + i) * (3 + density * 8); stroke(ctx, i % 2 ? p.b : p.a, .18, .9); ctx.strokeRect(x, 28, 19, 78); ctx.fillStyle = rgba(i % 2 ? p.b : p.a, .05 + density * .08); ctx.fillRect(x + 3, baseline - level, 13, level - 10); if ((Math.floor(time * 3.1) + i) % 8 === 0) glow(ctx, x + 9.5, 121, p.warm, 1.5 + motion.transient, .4); }
    stroke(ctx, p.warm, .16, 1); ctx.beginPath(); for (let s = 0; s <= 60; s++) { const q = s / 60, x = 18 + q * 204, y = 130 + Math.round(Math.sin(q * Math.PI * 4 + time * .35) * 5) / 2; s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); return;
  }
  if (m === 'mpc60') {
    const size = 24, gap = 6, sx = 57, sy = 17, active = Math.floor(time * (2.2 + density * 1.5) + motion.transient * 4) % 16;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) { const i = row * 4 + col, x = sx + col * (size + gap), y = sy + row * (size + gap); stroke(ctx, i === active ? p.pale : i % 2 ? p.b : p.a, i === active ? .42 : .13, i === active ? 1.3 : .85); ctx.beginPath(); ctx.roundRect(x, y, size, size, 3); ctx.stroke(); if (i === active) { ctx.fillStyle = rgba(p.warm, .06 + bloom * .08); ctx.fill(); glow(ctx, x + size / 2, y + size / 2, p.warm, 1.2, .32); } } return;
  }
  if (m === 'mirage') {
    stroke(ctx, p.a, .18, 1); ctx.strokeRect(17, 20, 206, 98); ctx.beginPath(); for (let s = 0; s <= 76; s++) { const q = s / 76, x = 22 + q * 196, raw = Math.sin(q * Math.PI * (3 + val(params, 'pitch', .38) * 5) + time * .42) * (18 + density * 17), y = 69 + Math.round(raw / 5) * 5; s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } stroke(ctx, p.pale, .28, 1.15); ctx.stroke(); for (let i = 0; i < 8; i++) glow(ctx, 34 + i * 24, 126, (Math.floor(time * 4) + i) % 8 === 0 ? p.warm : p.a, 1, (Math.floor(time * 4) + i) % 8 === 0 ? .36 : .08); return;
  }

  const count = 16 + Math.round(density * 34), steppedTime = m === 'stutter' ? Math.floor(time * (4 + chaos * 8)) / (4 + chaos * 8) : time;
  for (let i = 0; i < count; i++) {
    const seed = i * 12.9898, quant = m === 'reconstruct' ? 4 : 1;
    let x = 13 + hash(seed * 1.7 + steppedTime * .09) * 214, y = 15 + hash(seed * .9 + steppedTime * .11) * 116;
    if (quant > 1) { x = Math.round(x / quant) * quant; y = Math.round(y / quant) * quant; }
    if (m === 'smear') x += Math.sin(time * .25 + i) * (8 + chaos * 13);
    const z = 1.2 + (i % 4) * 1 + bloom * 2 + motion.transient * 1.2;
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = rgba(m === 'prism' && i % 3 === 0 ? p.pale : i % 2 ? p.b : p.a, .10 + bloom * .065 + motion.high * .04);
    if (isMode(m, 'shatter', 'prism', 'ruin')) { ctx.rotate(seed + time * .04 * (i % 2 ? -1 : 1)); ctx.beginPath(); ctx.moveTo(0, -z * 2.1); ctx.lineTo(z * 1.5, 0); ctx.lineTo(0, z * 1.7); ctx.lineTo(-z * 1.4, 0); ctx.closePath(); ctx.fill(); }
    else ctx.fillRect(-z, -z, z * 2, z * (1 + hash(i) * 2)); ctx.restore();
  }
}

function drawArtifact({ ctx, module, params, time, motion, p }: Scene) {
  const m = modeFor(module), wear = c01(val(params, 'wear', .25)), wow = c01(val(params, 'wow', .16)), noise = c01(val(params, 'noise', .1));
  backgroundGradient(ctx, [18, 10, 7], [5, 4, 6]);

  if (isMode(m, 'Neve 1073', 'SSL 4000E', 'API 1608')) { drawSummingDesk(ctx, m, time, motion, p, wear); return; }

  const transport = Math.sin(time * (.22 + wow * .45)) * (1 + wow * 4);
  if (isMode(m, 'cassette', 'reel', 'tascam424', 'Ampex ATR-102')) {
    const reel = isMode(m, 'reel', 'Ampex ATR-102'), shellW = reel ? 190 : 196, shellH = reel ? 94 : 100, left = reel ? 72 : 74, right = reel ? 168 : 166, radius = reel ? 31 : 21, spin = time * (.7 + wear * .65);
    const chassis = ctx.createLinearGradient(18, 26, 220, 124); chassis.addColorStop(0, rgba(p.a, .035)); chassis.addColorStop(.55, 'rgba(0,0,0,.08)'); chassis.addColorStop(1, rgba(p.b, .025)); ctx.fillStyle = chassis; ctx.fillRect(120 - shellW / 2 + transport * .2, 72 - shellH / 2, shellW, shellH);
    stroke(ctx, p.a, .27, 1.05); ctx.strokeRect(120 - shellW / 2 + transport * .2, 72 - shellH / 2, shellW, shellH);
    for (const x0 of [left, right]) { const x = x0 + transport * .12; stroke(ctx, p.b, .23, 1); ctx.beginPath(); ctx.arc(x, 67, radius, 0, TAU); ctx.stroke(); for (let spoke = 0; spoke < 6; spoke++) { const a = spin + spoke * TAU / 6; ctx.beginPath(); ctx.moveTo(x, 67); ctx.lineTo(x + Math.cos(a) * (radius - 4), 67 + Math.sin(a) * (radius - 4)); ctx.stroke(); } }
    if (m === 'tascam424') for (let c = 0; c < 4; c++) { const x = 48 + c * 48, meter = c01(.18 + motion.level * .7 + Math.sin(time * (.7 + c * .07) + c) * .13); ctx.fillStyle = rgba(c % 2 ? p.b : p.a, .04 + meter * .16); ctx.fillRect(x, 104 - meter * 30, 18, meter * 30); }
    return;
  }

  if (isMode(m, 'vinyl', 'wax')) {
    const radius = m === 'wax' ? 58 : 50, cx = 101 + transport * .15, cy = 72; stroke(ctx, p.a, .27, 1.05); for (let r = 0; r < 9; r++) { ctx.beginPath(); ctx.arc(cx, cy, radius - r * 5, 0, TAU); ctx.stroke(); }
    const angle = time * (.08 + wow * .04), x = cx + Math.cos(angle) * 37, y = cy + Math.sin(angle) * 37; stroke(ctx, p.warm, .34, 1.1); ctx.beginPath(); ctx.moveTo(204, 25); ctx.lineTo(x, y); ctx.stroke(); glow(ctx, x, y, p.warm, 1.25, .4); return;
  }

  if (m === 'vhs') {
    for (let i = 0; i < 11; i++) { const bw = 10 + hash(i * 3.7) * 13, x = 8 + i * 22 + (hash(i * 7.1) - .5) * 8 + transport * .35, h = 22 + hash(i * 4.2) * 66; ctx.fillStyle = rgba([5, 9, 17], .92); ctx.fillRect(x, 126 - h, bw, h); stroke(ctx, i % 2 ? p.b : p.a, .05 + motion.high * .04, .75); ctx.strokeRect(x, 126 - h, bw, h); for (let y = 126 - h + 8; y < 121; y += 10) if (hash(i * 17 + y + Math.floor(time * 3)) > .54) { ctx.fillStyle = rgba((i + y) % 3 ? p.a : p.b, .06 + motion.high * .05); ctx.fillRect(x + 3, y, Math.max(2, bw - 6), 1.2); } }
    for (let row = 0; row < 15; row++) { const y = 15 + row * 8, shift = Math.sin(time * (.45 + wow) + row * 1.5) * (2 + wear * 8) + (row % 4 === 0 ? motion.transient * 6 : 0); stroke(ctx, row % 3 ? p.a : p.b, .035 + noise * .05, row % 4 === 0 ? 1 : .55); ctx.beginPath(); ctx.moveTo(8 + shift, y); ctx.lineTo(232 - shift * .45, y); ctx.stroke(); } return;
  }

  if (m === 'archive') { for (let i = 0; i < 9; i++) { const x = 18 + i * 24, h = 26 + hash(i * 4.1) * 72; stroke(ctx, i % 3 ? p.a : p.warm, .08 + motion.high * .02, .8); ctx.strokeRect(x, 124 - h, 10, h); ctx.fillStyle = rgba(p.pale, .025); ctx.fillRect(x + 3, 128 - h, 4, h - 8); } return; }
  if (m === 'broken') { for (let i = 0; i < 20; i++) { const y = 15 + i * 6, shift = (hash(i + Math.floor(time * 5)) - .5) * (3 + wear * 15); stroke(ctx, i % 2 ? p.b : p.a, .06 + noise * .07, .75); ctx.beginPath(); ctx.moveTo(8 + shift, y); ctx.lineTo(72 + shift * .2, y); ctx.moveTo(91 - shift, y + (i % 3 - 1) * 2); ctx.lineTo(232, y); ctx.stroke(); } return; }

  const bands = m === 'radio' ? 11 : 16;
  for (let row = 0; row < bands; row++) { const y = 18 + row * (108 / Math.max(1, bands - 1)), shift = Math.sin(time * (.4 + wow) + row * 1.7) * (2 + wear * 9); stroke(ctx, row % 2 ? p.b : p.a, .07 + noise * .08, .85); ctx.beginPath(); ctx.moveTo(10 + shift, y); ctx.lineTo(230 - shift * .4, y); ctx.stroke(); }
}

function drawSummingDesk(ctx: CanvasRenderingContext2D, mode: string, time: number, motion: Physics, p: Palette, cohesion: number) {
  const channels = mode === 'API 1608' ? 10 : 8, busY = 108, centerX = 120;
  for (let i = 0; i < channels; i++) {
    const q = i / Math.max(1, channels - 1), x = 22 + q * 196, signal = c01(.12 + motion.level * .72 + Math.sin(time * (.52 + i * .025) + i * 1.13) * .10);
    const c = i % 2 ? p.b : p.a;
    stroke(ctx, c, .075 + signal * .10, .75); ctx.beginPath(); ctx.moveTo(x, 24); ctx.bezierCurveTo(x, 62, lerp(x, centerX, .52), 83, centerX + (q - .5) * 22, busY); ctx.stroke();
    glow(ctx, x, 24 + (1 - signal) * 18, c, .55 + signal * .65, .12 + signal * .12);
  }
  stroke(ctx, p.warm, .18 + cohesion * .06, 1.15); ctx.beginPath(); ctx.moveTo(43, busY); ctx.lineTo(197, busY); ctx.stroke();
  const busPulse = 1 + motion.low * .12 + motion.transient * .10;
  if (mode === 'Neve 1073') {
    for (let ring = 0; ring < 5; ring++) { stroke(ctx, ring % 2 ? p.warm : p.a, .08 + ring * .016, .8); ctx.beginPath(); ctx.ellipse(centerX, 82, (18 + ring * 9) * busPulse, (7 + ring * 3.5) * busPulse, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = rgba(p.warm, .05 + motion.level * .04); ctx.fillRect(92, 115, 56, 8);
  } else if (mode === 'SSL 4000E') {
    for (let i = 0; i < 7; i++) { const x = 68 + i * 17, meter = c01(.16 + motion.level * .66 + Math.sin(time * .7 + i) * .08); stroke(ctx, p.a, .08, .65); ctx.strokeRect(x, 66, 9, 31); ctx.fillStyle = rgba(i > 4 ? p.warm : p.a, .05 + meter * .13); ctx.fillRect(x + 2, 94 - meter * 23, 5, meter * 23); }
  } else {
    for (let i = 0; i < 6; i++) { const x = 75 + i * 18, size = 9 + (i % 2) * 3; stroke(ctx, i % 2 ? p.b : p.a, .12, .8); ctx.strokeRect(x - size / 2, 74 - size / 2, size, size); glow(ctx, x, 74, i % 2 ? p.b : p.a, .5 + motion.transient * .5, .10 + motion.high * .06); }
  }
  glow(ctx, centerX, busY, p.warm, 1.2 + motion.transient * 1.2, .25 + motion.level * .08);
}
