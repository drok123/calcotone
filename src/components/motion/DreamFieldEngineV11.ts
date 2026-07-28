import type { ModuleState, XYAssignment } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
  audio: VisualAudioState;
};

type LayerSet = {
  ember?: ModuleState;
  drift?: ModuleState;
  halo?: ModuleState;
  atmos?: ModuleState;
  grain?: ModuleState;
  artifact?: ModuleState;
};

type Spring = { value: number; velocity: number };
type AudioPhysics = { level: number; low: number; mid: number; high: number; transient: number };
type Color = [number, number, number];
type Palette = {
  bgTop: Color; bgBottom: Color; haze: Color; terrain: Color; water: Color;
  accentA: Color; accentB: Color; core: Color; coreGlow: Color; detail: Color;
};

type Scene = { horizon: number; heroX: number; heroLift: number; symmetry: number; seed: number };

type Composition = {
  horizon: number;
  heroX: number;
  heroY: number;
  ember: number;
  drift: number;
  halo: number;
  atmos: number;
  grain: number;
  artifact: number;
  palette: Palette;
  audio: AudioPhysics;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const fract = (v: number) => v - Math.floor(v);
const hash = (x: number, y = 0) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const css = (c: Color, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
const scaleColor = (c: Color, s: number): Color => [c[0] * s, c[1] * s, c[2] * s];
const modeIs = (mode: string | undefined, ...values: string[]) => !!mode && values.includes(mode);
const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) => module?.parameters.find((p) => p.id === id)?.value ?? fallback;
const amountOf = (module: ModuleState | undefined) => module?.enabled && module.available ? clamp01(0.16 + Math.sqrt(clamp01(valueOf(module, 'mix', 0))) * 0.84) : 0;

function sceneAt(index: number): Scene {
  const s = index * 9.173 + 1.7;
  return {
    horizon: 0.50 + (hash(s, 0.1) - 0.5) * 0.05,
    heroX: (hash(s, 0.2) - 0.5) * 0.16,
    heroLift: 0.13 + hash(s, 0.3) * 0.10,
    symmetry: 0.45 + hash(s, 0.4) * 0.45,
    seed: s,
  };
}

function paletteFor(layers: LayerSet, audio: AudioPhysics): Palette {
  const mediaMode = layers.artifact?.mediaMode ?? 'cassette';
  let palette: Palette = {
    bgTop: [4, 10, 20], bgBottom: [13, 24, 40], haze: [60, 130, 152], terrain: [8, 12, 18], water: [6, 14, 24],
    accentA: [90, 222, 225], accentB: [233, 82, 192], core: [255, 190, 120], coreGlow: [247, 103, 154], detail: [230, 240, 240],
  };
  if (mediaMode === 'vhs') {
    palette = { ...palette, bgTop: [4, 8, 18], bgBottom: [10, 18, 36], water: [5, 12, 28] };
  } else if (modeIs(mediaMode, 'sp1200', 'mpc60', 'mirage', 's950', 'emulator2', 'fairlightiix', 'cassette', 'reel', 'Ampex ATR-102')) {
    palette = {
      bgTop: [8, 10, 14], bgBottom: [25, 23, 26], haze: [124, 109, 88], terrain: [12, 10, 10], water: [12, 11, 13],
      accentA: [240, 181, 104], accentB: [194, 124, 76], core: [255, 209, 148], coreGlow: [252, 145, 88], detail: [243, 231, 214],
    };
  } else if (modeIs(mediaMode, 'archive', 'wax', 'vinyl')) {
    palette = {
      bgTop: [11, 10, 12], bgBottom: [35, 28, 20], haze: [148, 122, 90], terrain: [15, 12, 10], water: [18, 16, 14],
      accentA: [224, 192, 145], accentB: [171, 127, 86], core: [255, 221, 170], coreGlow: [239, 155, 98], detail: [239, 226, 198],
    };
  } else if (mediaMode === 'broken') {
    palette = {
      bgTop: [3, 7, 14], bgBottom: [14, 18, 28], haze: [74, 101, 130], terrain: [6, 8, 12], water: [5, 10, 18],
      accentA: [92, 223, 225], accentB: [229, 100, 187], core: [245, 194, 122], coreGlow: [232, 83, 170], detail: [228, 236, 238],
    };
  }
  const boost = 1 + audio.high * 0.05 + audio.transient * 0.06;
  return { ...palette, accentA: scaleColor(palette.accentA, boost), accentB: scaleColor(palette.accentB, 1 + audio.transient * 0.05) };
}

export class DreamFieldEngine {
  private width = 1;
  private height = 1;
  private x = 0.5;
  private y = 0.5;
  private drag = 0;
  private lastTime = 0;
  private springs: Record<keyof AudioPhysics, Spring> = {
    level: { value: 0, velocity: 0 },
    low: { value: 0, velocity: 0 },
    mid: { value: 0, velocity: 0 },
    high: { value: 0, velocity: 0 },
    transient: { value: 0, velocity: 0 },
  };

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    const dt = this.lastTime > 0 ? clamp(frame.time - this.lastTime, 0, 0.1) : 1 / 60;
    this.lastTime = frame.time;
    this.x = lerp(this.x, clamp01(frame.x), follow(frame.dragging ? 18 : 6, dt));
    this.y = lerp(this.y, clamp01(frame.y), follow(frame.dragging ? 18 : 6, dt));
    this.drag = lerp(this.drag, frame.dragging ? 1 : 0, follow(frame.dragging ? 12 : 4, dt));

    const layers = this.layers(frame.modules);
    const audio = this.audio(frame.audio, dt);
    const composition = this.compose(layers, frame.assignments, frame.time, audio);

    ctx.clearRect(0, 0, this.width, this.height);
    this.drawSky(ctx, composition);
    this.drawAtmosphere(ctx, frame.time, layers.atmos, composition);
    this.drawTerrainAndWater(ctx, layers, composition);
    this.drawMediaWorld(ctx, frame.time, layers.artifact, composition);
    this.drawHero(ctx, frame.time, layers.ember, composition);
    this.drawWaterGuides(ctx, frame.time, layers.drift, composition);
    this.drawParticles(ctx, frame.time, layers.grain, composition);
    this.drawPulse(ctx, composition);
  }

  private layers(modules: ModuleState[]): LayerSet {
    const get = (id: string) => modules.find((m) => m.id === id && m.enabled && m.available);
    return { ember: get('saturation'), drift: get('chorus'), halo: get('delay'), atmos: get('reverb'), grain: get('bitcrusher'), artifact: get('media') };
  }

  private audio(input: VisualAudioState, dt: number): AudioPhysics {
    const target: AudioPhysics = { level: clamp01(input.level), low: clamp01(input.low), mid: clamp01(input.mid), high: clamp01(input.high), transient: clamp01(input.transient) };
    const tuning: Record<keyof AudioPhysics, [number, number]> = { level: [40, 10], low: [30, 7], mid: [45, 9], high: [56, 10], transient: [82, 12] };
    (Object.keys(target) as (keyof AudioPhysics)[]).forEach((key) => {
      const spring = this.springs[key];
      const [stiffness, damping] = tuning[key];
      spring.velocity += (target[key] - spring.value) * stiffness * dt;
      spring.velocity *= Math.exp(-damping * dt);
      spring.value += spring.velocity * dt;
    });
    return { level: clamp01(this.springs.level.value), low: clamp01(this.springs.low.value), mid: clamp01(this.springs.mid.value), high: clamp01(this.springs.high.value), transient: clamp01(this.springs.transient.value) };
  }

  private compose(layers: LayerSet, assignments: XYAssignment[], time: number, audio: AudioPhysics): Composition {
    let xDepth = 0, yDepth = 0, xCount = 0, yCount = 0;
    assignments.forEach((a) => { if (a.axis === 'x') { xDepth += a.depth; xCount += 1; } else { yDepth += a.depth; yCount += 1; } });
    const sx = xCount ? xDepth / xCount : 0;
    const sy = yCount ? yDepth / yCount : 0;
    const epoch = Math.floor(time / 28);
    const mix = ease(fract(time / 28));
    const a = sceneAt(epoch), b = sceneAt(epoch + 1);
    const horizonBase = lerp(a.horizon, b.horizon, mix);
    const horizon = horizonBase + (0.5 - this.y) * (0.05 + sy * 0.02) + (audio.low - 0.2) * 0.01;
    const heroX = 0.5 + lerp(a.heroX, b.heroX, mix) + (this.x - 0.5) * (0.12 + sx * 0.05);
    const heroY = horizon - lerp(a.heroLift, b.heroLift, mix) - (this.y - 0.5) * 0.025 - audio.low * 0.01 - this.drag * 0.006;
    return {
      horizon, heroX, heroY, palette: paletteFor(layers, audio), audio,
      ember: amountOf(layers.ember), drift: amountOf(layers.drift), halo: amountOf(layers.halo), atmos: amountOf(layers.atmos), grain: amountOf(layers.grain), artifact: amountOf(layers.artifact),
    };
  }

  private terrainY(u: number, module: ModuleState | undefined, c: Composition): number {
    const mode = module?.delayAlgorithm ?? 'clean';
    const amount = c.halo;
    const feedback = valueOf(module, 'feedback', 0.2);
    const character = valueOf(module, 'character', 0.15);
    const x = u * 2 - 1;
    const ridge = Math.pow(Math.abs(Math.sin(x * (3 + character * 6) + 2)), 3.2);
    const peaks = Math.pow(Math.abs(Math.sin(x * (8 + feedback * 9) + 1.5)), 8 - feedback * 3);
    let h = 0.045 + ridge * (0.02 + amount * 0.055);
    if (modeIs(mode, 're201', 'EP-3 Echoplex', 'tape')) h += ridge * amount * 0.05;
    else if (modeIs(mode, 'bbd', 'Deluxe Memory Man')) h += peaks * amount * 0.05;
    else if (modeIs(mode, 'constellation', 'Binson Echorec')) h += ridge * amount * 0.04 + peaks * amount * 0.03;
    else if (modeIs(mode, 'scatter', 'AMS DMX 15-80 S')) h += peaks * amount * 0.06;
    else if (mode === 'diffuse') h = 0.06 + Math.abs(Math.sin(x * 2.2)) * (0.02 + amount * 0.03);
    return c.horizon - h * (1 + c.audio.low * 0.08);
  }

  private drawSky(ctx: CanvasRenderingContext2D, c: Composition) {
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, css(c.palette.bgTop));
    g.addColorStop(0.6, css(c.palette.bgBottom));
    g.addColorStop(1, css([2, 4, 8]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawAtmosphere(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, c: Composition) {
    if (!module || c.atmos <= 0) return;
    const mode = module.algorithm ?? 'hall';
    const horizonY = c.horizon * this.height;
    const glow = ctx.createRadialGradient(c.heroX * this.width, c.heroY * this.height, 0, c.heroX * this.width, c.heroY * this.height, this.width * 0.45);
    glow.addColorStop(0, css(c.palette.haze, 0.08 + c.atmos * 0.08));
    glow.addColorStop(1, css(c.palette.haze, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, horizonY);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (mode === 'aurora') {
      for (let i = 0; i < 3; i += 1) {
        ctx.strokeStyle = css(i % 2 ? c.palette.accentA : c.palette.accentB, 0.03 + c.atmos * 0.035);
        ctx.beginPath();
        for (let s = 0; s <= 28; s += 1) {
          const p = s / 28;
          const x = this.width * (0.08 + p * 0.84);
          const y = horizonY * (0.20 + i * 0.13) + Math.sin(p * Math.PI * 2 + time * 0.1 + i) * this.height * (0.016 + c.audio.mid * 0.012);
          s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (modeIs(mode, 'plate', 'emt140')) {
      for (let i = 0; i < 4; i += 1) {
        const y = horizonY * (0.30 + i * 0.10);
        ctx.strokeStyle = css(i % 2 ? c.palette.detail : c.palette.accentA, 0.02 + c.atmos * 0.025);
        ctx.beginPath();
        ctx.moveTo(this.width * 0.18, y);
        ctx.quadraticCurveTo(this.width * 0.5, y - this.height * 0.01, this.width * 0.82, y);
        ctx.stroke();
      }
    } else if (modeIs(mode, 'celestial', 'nebula')) {
      const count = mode === 'celestial' ? 14 : 9;
      for (let i = 0; i < count; i += 1) {
        const x = this.width * (0.08 + hash(i * 6.3, 1.1) * 0.84);
        const y = horizonY * (0.14 + hash(i * 5.1, 1.7) * 0.54);
        ctx.fillStyle = css(i % 2 ? c.palette.accentA : c.palette.detail, 0.02 + c.atmos * 0.02 + (0.5 + Math.sin(time + i) * 0.5) * 0.02);
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + (i % 3) * 0.3 + c.audio.transient * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawTerrainAndWater(ctx: CanvasRenderingContext2D, layers: LayerSet, c: Composition) {
    const horizonY = c.horizon * this.height;
    ctx.fillStyle = css(c.palette.water);
    ctx.fillRect(0, horizonY, this.width, this.height - horizonY);

    const reflection = ctx.createLinearGradient(0, horizonY, 0, this.height);
    reflection.addColorStop(0, css(c.palette.coreGlow, 0.08 + c.ember * 0.05));
    reflection.addColorStop(1, css(c.palette.coreGlow, 0));
    ctx.fillStyle = reflection;
    ctx.fillRect(c.heroX * this.width - this.width * 0.16, horizonY, this.width * 0.32, this.height - horizonY);

    ctx.fillStyle = css(c.palette.terrain);
    ctx.beginPath();
    ctx.moveTo(0, this.height);
    for (let i = 0; i <= 32; i += 1) {
      const u = i / 32;
      ctx.lineTo(u * this.width, this.terrainY(u, layers.halo, c) * this.height);
    }
    ctx.lineTo(this.width, this.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = css(c.palette.accentA, 0.03 + c.halo * 0.04 + c.audio.high * 0.02);
    ctx.beginPath();
    for (let i = 0; i <= 32; i += 1) {
      const u = i / 32;
      const x = u * this.width;
      const y = this.terrainY(u, layers.halo, c) * this.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawHero(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, c: Composition) {
    if (!module || c.ember <= 0) return;
    const cx = c.heroX * this.width;
    const cy = c.heroY * this.height;
    const min = Math.min(this.width, this.height);
    const drive = valueOf(module, 'drive', 0.15);
    const heat = valueOf(module, 'heat', 0.18);
    const mode = module.emberMode ?? 'velvet';
    const radius = min * (0.03 + c.ember * 0.02 + drive * 0.01) * (1 + c.audio.low * 0.16 + c.audio.transient * 0.08);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * (4 + heat * 1.6));
    glow.addColorStop(0, css(c.palette.core, 0.18 + c.ember * 0.12));
    glow.addColorStop(0.4, css(c.palette.coreGlow, 0.10 + c.ember * 0.06));
    glow.addColorStop(1, css(c.palette.accentB, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (4 + heat * 1.6), 0, Math.PI * 2);
    ctx.fill();
    const rings = modeIs(mode, 'furnace', 'broken') ? 4 : modeIs(mode, 'transformer', 'console') ? 2 : 3;
    for (let i = 0; i < rings; i += 1) {
      const p = i / Math.max(1, rings - 1);
      ctx.strokeStyle = css(i % 2 ? c.palette.accentB : c.palette.core, 0.04 + c.ember * 0.04 - p * 0.015 + c.audio.transient * 0.02);
      ctx.beginPath();
      if (mode === 'transformer') ctx.ellipse(cx, cy, radius * (1.4 + p * 1.6), radius * (0.9 + p * 0.8), (this.x - 0.5) * 0.16, 0, Math.PI * 2);
      else if (mode === 'broken') ctx.arc(cx, cy, radius * (1.3 + p * 1.5), time * 0.06 + i, time * 0.06 + i + Math.PI * 1.2);
      else ctx.arc(cx, cy, radius * (1.3 + p * 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = css([2, 4, 8], 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.82, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMediaWorld(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, c: Composition) {
    if (!module || c.artifact <= 0) return;
    const mode = module.mediaMode ?? 'cassette';
    if (mode === 'vhs') return this.drawCyberCity(ctx, time, module, c);
    if (modeIs(mode, 'sp1200', 'mpc60', 'mirage', 's950', 'emulator2', 'fairlightiix')) return this.drawSamplerWorld(ctx, time, mode, c);
    if (mode === 'archive') return this.drawArchiveWorld(ctx, c);
    if (mode === 'broken') return this.drawBrokenWorld(ctx, time, c);
  }

  private drawCyberCity(ctx: CanvasRenderingContext2D, time: number, module: ModuleState, c: Composition) {
    const horizonY = c.horizon * this.height;
    const wow = valueOf(module, 'wow', 0.15);
    const noise = valueOf(module, 'noise', 0.12);
    const count = 11;
    const parallax = (this.x - 0.5) * this.width * 0.03;
    for (let i = 0; i < count; i += 1) {
      const p = i / (count - 1);
      const n = hash(i * 7.1, 0.2);
      const w = this.width * (0.038 + hash(i * 4.2, 0.7) * 0.045);
      const x = p * this.width - w * 0.5 + (n - 0.5) * this.width * 0.02 - parallax * (0.4 + n * 0.4);
      const base = horizonY + this.height * (0.012 + hash(i, 1.4) * 0.03);
      const h = this.height * (0.12 + n * 0.18 + (i % 4 === 0 ? 0.06 : 0)) * (1 + c.audio.low * 0.1);
      const lean = (this.x - 0.5) * w * 0.1 + Math.sin(time * 0.25 + i) * wow;
      ctx.fillStyle = css([6 + n * 4, 9 + n * 5, 16 + n * 8], 0.88);
      ctx.beginPath();
      ctx.moveTo(x, base); ctx.lineTo(x + lean, base - h); ctx.lineTo(x + w + lean, base - h); ctx.lineTo(x + w, base); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = css(i % 2 ? c.palette.accentA : c.palette.accentB, 0.05 + c.artifact * 0.05 + c.audio.high * 0.03);
      ctx.stroke();
      const cols = Math.max(1, Math.floor(w / 8));
      const rows = Math.max(2, Math.floor(h / 10));
      for (let row = 1; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
        if (hash(i * 101 + row * 13 + col * 7, 0.3) <= 0.5 - noise * 0.12) continue;
        const alpha = 0.03 + c.audio.high * 0.05 + c.audio.transient * (hash(i + row, col) > 0.75 ? 0.08 : 0);
        ctx.fillStyle = css((row + col + i) % 4 === 0 ? c.palette.accentB : c.palette.accentA, alpha);
        ctx.fillRect(x + w * 0.18 + col * (w * 0.58 / Math.max(1, cols - 1)) + lean * (1 - row / rows), base - row * (h * 0.72 / rows), 1.4, 1.2);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const vanX = c.heroX * this.width + (this.x - 0.5) * this.width * 0.08;
    for (let i = -5; i <= 5; i += 1) {
      ctx.strokeStyle = css(i % 2 ? c.palette.accentA : c.palette.accentB, 0.02 + c.audio.low * 0.015);
      ctx.beginPath(); ctx.moveTo(vanX, horizonY + this.height * 0.01); ctx.lineTo(this.width * 0.5 + i * this.width * 0.10, this.height); ctx.stroke();
    }
    ctx.restore();
  }

  private drawSamplerWorld(ctx: CanvasRenderingContext2D, time: number, mode: string, c: Composition) {
    const horizonY = c.horizon * this.height;
    const color = modeIs(mode, 'mirage', 'emulator2') ? c.palette.accentB : mode === 'sp1200' ? c.palette.core : c.palette.accentA;
    const count = mode === 'fairlightiix' ? 8 : mode === 'sp1200' ? 6 : 7;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const x = this.width * (0.12 + i / Math.max(1, count - 1) * 0.76);
      const meter = (Math.sin(time * (0.6 + i * 0.03) + i) * 0.5 + 0.5) * (0.3 + c.audio.level * 0.7);
      ctx.strokeStyle = css(color, 0.025 + c.artifact * 0.03); ctx.beginPath(); ctx.moveTo(x, horizonY - this.height * 0.04); ctx.lineTo(x, horizonY + this.height * 0.04); ctx.stroke();
      ctx.fillStyle = css(color, 0.03 + meter * 0.06); ctx.fillRect(x - 1.5, horizonY + this.height * 0.03, 3, -this.height * 0.045 * meter);
    }
    ctx.restore();
  }

  private drawArchiveWorld(ctx: CanvasRenderingContext2D, c: Composition) {
    const horizonY = c.horizon * this.height;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 6; i += 1) {
      const x = this.width * (0.14 + i / 5 * 0.72); const h = this.height * (0.04 + hash(i * 5.8, 1.1) * 0.06);
      ctx.strokeStyle = css(c.palette.detail, 0.024 + c.artifact * 0.03); ctx.strokeRect(x - 4, horizonY - h, 8, h);
    }
    ctx.restore();
  }

  private drawBrokenWorld(ctx: CanvasRenderingContext2D, time: number, c: Composition) {
    const horizonY = c.horizon * this.height;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 8; i += 1) {
      const x = this.width * (0.10 + i / 7 * 0.80); const sway = Math.sin(time * 0.4 + i) * (1 + c.audio.transient * 3);
      ctx.strokeStyle = css(i % 2 ? c.palette.accentB : c.palette.accentA, 0.02 + c.artifact * 0.03);
      ctx.beginPath(); ctx.moveTo(x, horizonY + this.height * 0.02); ctx.lineTo(x + sway, horizonY - this.height * (0.03 + hash(i * 8.2, 0.9) * 0.08)); ctx.stroke();
    }
    ctx.restore();
  }

  private drawWaterGuides(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, c: Composition) {
    if (!module || c.drift <= 0) return;
    const mode = module.driftMode ?? 'chorus';
    const count = mode === 'ensemble' ? 6 : modeIs(mode, 'dimension', 'dimensiond') ? 5 : 4;
    const horizonY = c.horizon * this.height;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = (i + 1) / (count + 1);
      const y = lerp(horizonY + this.height * 0.06, this.height * 0.88, p);
      const half = this.width * (0.10 + p * 0.24);
      const wobble = Math.sin(time * 0.05 + i) * this.height * (0.003 + c.audio.low * 0.006);
      ctx.strokeStyle = css(i % 2 ? c.palette.accentA : c.palette.detail, 0.018 + c.drift * 0.025 + c.audio.high * 0.015);
      ctx.beginPath();
      if (modeIs(mode, 'rotary', 'orbit')) ctx.ellipse(c.heroX * this.width, y, half, this.height * (0.014 + p * 0.018), (this.x - 0.5) * 0.04, Math.PI, Math.PI * 2);
      else { ctx.moveTo(c.heroX * this.width - half, y + wobble); ctx.quadraticCurveTo(c.heroX * this.width, y - this.height * 0.01, c.heroX * this.width + half, y - wobble); }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, c: Composition) {
    if (!module || c.grain <= 0) return;
    const mode = module.grainMode ?? 'mosaic';
    const density = valueOf(module, 'density', 0.42);
    const chaos = valueOf(module, 'chaos', 0.16);
    const count = 8 + Math.round(density * 18 + c.audio.high * 8);
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const seed = hash(i * 9.3, 1.4);
      const travel = (time * (0.03 + density * 0.03 + c.audio.high * 0.03) * (0.7 + seed * 0.5) + seed) % 1;
      const x = (0.10 + hash(i * 4.7, 3.1) * 0.80) * this.width + Math.sin(time * 0.03 + i) * chaos * this.width * 0.02;
      const y = (0.14 + travel * 0.74) * this.height;
      const alpha = 0.02 + c.grain * 0.025 + c.audio.high * 0.02;
      ctx.strokeStyle = css(mode === 'prism' ? (i % 2 ? c.palette.accentA : c.palette.accentB) : mode === 'freeze' ? c.palette.accentA : c.palette.detail, alpha);
      ctx.beginPath();
      if (mode === 'slice') {
        const cellY = Math.round(y / 6) * 6;
        ctx.moveTo(x - 3, cellY); ctx.lineTo(x + 3 + c.audio.transient * 2, cellY);
      } else {
        ctx.moveTo(x, y); ctx.lineTo(x + chaos * 2 + c.audio.transient * 1.8, y + (mode === 'smear' ? 10 : 5) + c.audio.low * 5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPulse(ctx: CanvasRenderingContext2D, c: Composition) {
    if (c.audio.transient < 0.02 && c.audio.level < 0.04) return;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = css(c.palette.detail, 0.012 + c.audio.transient * 0.04);
    ctx.beginPath();
    ctx.ellipse(c.heroX * this.width, c.horizon * this.height, Math.min(this.width, this.height) * (0.09 + c.audio.low * 0.08), Math.min(this.width, this.height) * (0.02 + c.audio.transient * 0.02), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
