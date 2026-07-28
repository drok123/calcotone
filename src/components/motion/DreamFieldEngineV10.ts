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

type PatchField = { xStrength: number; yStrength: number };
type ArtLayers = {
  ember?: ModuleState;
  drift?: ModuleState;
  halo?: ModuleState;
  atmos?: ModuleState;
  grain?: ModuleState;
  artifact?: ModuleState;
};
type WorldProfile = { seed: number; horizon: number; heroX: number; heroLift: number; symmetry: number };
type SceneState = { a: WorldProfile; b: WorldProfile; mix: number; crest: number };
type AudioPhysics = { level: number; low: number; mid: number; high: number; transient: number };
type Geometry = {
  horizon: number;
  heroX: number;
  heroY: number;
  ember: number;
  drift: number;
  halo: number;
  atmos: number;
  grain: number;
  artifact: number;
  audio: AudioPhysics;
};
type Spring = { value: number; velocity: number };

const RASTER_W = 224;
const RASTER_H = 128;
const ACTIVE_INTERVAL = 1 / 36;
const IDLE_INTERVAL = 1 / 28;
const SCENE_SECONDS = 24;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const followAmount = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
const hash = (x: number, y = 0) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const valueOf = (m: ModuleState | undefined, id: string, fallback = 0) =>
  m?.parameters.find((p) => p.id === id)?.value ?? fallback;
const visualAmount = (m: ModuleState | undefined) =>
  m?.enabled && m.available ? clamp01(0.18 + Math.sqrt(clamp01(valueOf(m, 'mix', 0))) * 0.82) : 0;

function noise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm(x: number, y: number) {
  return noise(x, y) * 0.58 + noise(x * 2.03 + 7.1, y * 2.03 - 3.7) * 0.28 + noise(x * 4.07 - 2.8, y * 4.07 + 5.2) * 0.10 + noise(x * 8.11 + 1.4, y * 8.11 - 8.2) * 0.04;
}

function profileFor(epoch: number): WorldProfile {
  const h = (c: number) => hash(epoch * 17.17 + c * 9.31, c * 3.7);
  return {
    seed: epoch * 13.71 + 2.9,
    horizon: 0.53 + (h(0) - 0.5) * 0.075,
    heroX: (h(1) - 0.5) * 0.12,
    heroLift: 0.145 + h(2) * 0.09,
    symmetry: 0.48 + h(3) * 0.42,
  };
}

function modeIs(mode: string | undefined, ...values: string[]) {
  return mode ? values.includes(mode) : false;
}

export class DreamFieldEngine {
  private width = 1;
  private height = 1;
  private raster: HTMLCanvasElement | null = null;
  private rasterCtx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;
  private lastRasterTime = -Infinity;
  private lastTime = 0;
  private x = 0.5;
  private y = 0.5;
  private gesture = 0;
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
    if (typeof document === 'undefined') return;
    if (!this.raster) {
      this.raster = document.createElement('canvas');
      this.raster.width = RASTER_W;
      this.raster.height = RASTER_H;
      this.rasterCtx = this.raster.getContext('2d', { alpha: true });
      this.imageData = this.rasterCtx?.createImageData(RASTER_W, RASTER_H) ?? null;
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    const dt = this.lastTime > 0 ? clamp(frame.time - this.lastTime, 0, 0.1) : 1 / 60;
    this.lastTime = frame.time;

    this.x = lerp(this.x, clamp01(frame.x), followAmount(frame.dragging ? 22 : 6, dt));
    this.y = lerp(this.y, clamp01(frame.y), followAmount(frame.dragging ? 22 : 6, dt));
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, followAmount(frame.dragging ? 15 : 4, dt));
    const audio = this.stepAudioPhysics(frame.audio, dt);

    const layers = this.layers(frame.modules);
    const patch = this.patchField(frame.assignments);
    const scene = this.sceneState(frame.time);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;

    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderRaster(frame.time, layers, patch, scene, audio);
      this.lastRasterTime = frame.time;
    }

    const g = this.geometry(layers, patch, scene, audio);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#020406';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.raster) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const breath = 1 + g.audio.level * 0.004 + g.audio.transient * 0.003;
      ctx.translate(this.width * 0.5, this.height * 0.5);
      ctx.scale(breath, breath);
      ctx.translate(-this.width * 0.5, -this.height * 0.5);
      ctx.drawImage(this.raster, 0, 0, this.width, this.height);
      ctx.restore();
    }

    this.drawArtifactLandscape(ctx, frame.time, layers.artifact, g, scene);
    this.drawAtmos(ctx, frame.time, layers.atmos, g);
    this.drawHalo(ctx, frame.time, layers.halo, g, scene);
    this.drawEmber(ctx, frame.time, layers.ember, g, scene.crest);
    this.drawDrift(ctx, frame.time, layers.drift, g);
    this.drawGrain(ctx, frame.time, layers.grain, g);
    this.drawArtifact(ctx, frame.time, layers.artifact, g);
    this.drawAudioPulse(ctx, g);
  }

  private stepAudioPhysics(audio: VisualAudioState, dt: number): AudioPhysics {
    const targets: AudioPhysics = {
      level: clamp01(audio.level),
      low: clamp01(audio.low),
      mid: clamp01(audio.mid),
      high: clamp01(audio.high),
      transient: clamp01(audio.transient),
    };

    const tune: Record<keyof AudioPhysics, [number, number]> = {
      level: [42, 10],
      low: [32, 7.4],
      mid: [46, 9],
      high: [62, 11.5],
      transient: [88, 12.5],
    };

    (Object.keys(targets) as (keyof AudioPhysics)[]).forEach((key) => {
      const spring = this.springs[key];
      const [stiffness, damping] = tune[key];
      spring.velocity += (targets[key] - spring.value) * stiffness * dt;
      spring.velocity *= Math.exp(-damping * dt);
      spring.value += spring.velocity * dt;
      spring.value = clamp(spring.value, -0.08, 1.35);
    });

    return {
      level: clamp01(this.springs.level.value),
      low: clamp01(this.springs.low.value),
      mid: clamp01(this.springs.mid.value),
      high: clamp01(this.springs.high.value),
      transient: clamp(this.springs.transient.value, 0, 1.25),
    };
  }

  private layers(modules: ModuleState[]): ArtLayers {
    const find = (id: string) => modules.find((m) => m.id === id && m.enabled && m.available);
    return {
      ember: find('saturation'),
      drift: find('chorus'),
      halo: find('delay'),
      atmos: find('reverb'),
      grain: find('bitcrusher'),
      artifact: find('media'),
    };
  }

  private patchField(assignments: XYAssignment[]): PatchField {
    let xd = 0;
    let yd = 0;
    let xc = 0;
    let yc = 0;
    for (const a of assignments) {
      if (a.axis === 'x') {
        xd += a.depth;
        xc += 1;
      } else {
        yd += a.depth;
        yc += 1;
      }
    }
    return { xStrength: xc ? clamp01(xd / xc) : 0, yStrength: yc ? clamp01(yd / yc) : 0 };
  }

  private sceneState(time: number): SceneState {
    const j = time / SCENE_SECONDS;
    const e = Math.floor(j);
    const local = fract(j);
    const mix = smoothstep(0.76, 1, local);
    return { a: profileFor(e), b: profileFor(e + 1), mix, crest: Math.pow(Math.sin(mix * Math.PI), 1.5) };
  }

  private geometry(l: ArtLayers, p: PatchField, s: SceneState, audio: AudioPhysics): Geometry {
    const xs = this.x - 0.5;
    const horizon =
      lerp(s.a.horizon, s.b.horizon, s.mix) +
      (0.5 - this.y) * (0.055 + p.yStrength * 0.025) +
      (audio.low - 0.18) * 0.008;
    const heroX =
      0.5 +
      lerp(s.a.heroX, s.b.heroX, s.mix) +
      xs * (0.12 + p.xStrength * 0.06) +
      Math.sin(this.lastTime * 0.8) * audio.mid * 0.004;
    const heroY =
      horizon -
      lerp(s.a.heroLift, s.b.heroLift, s.mix) -
      (this.y - 0.5) * 0.022 -
      this.gesture * 0.006 -
      audio.low * 0.007 -
      audio.transient * 0.004;
    return {
      horizon,
      heroX,
      heroY,
      ember: visualAmount(l.ember),
      drift: visualAmount(l.drift),
      halo: visualAmount(l.halo),
      atmos: visualAmount(l.atmos),
      grain: visualAmount(l.grain),
      artifact: visualAmount(l.artifact),
      audio,
    };
  }

  private mountainSurface(
    u: number,
    horizon: number,
    m: ModuleState | undefined,
    seed: number,
    time: number,
    symmetry: number,
    audioLow = 0
  ) {
    const amount = visualAmount(m);
    if (amount <= 0) return horizon - 0.008;
    const mode = m?.delayAlgorithm ?? 'clean';
    const feedback = valueOf(m, 'feedback', 0.24);
    const character = valueOf(m, 'character', 0.14);
    const width = valueOf(m, 'width', 0.58);
    const p = u * 2 - 1;
    const q = Math.abs(p);
    const axis = lerp(p, q, symmetry);
    const n = fbm(axis * (1.12 + character * 0.6) + seed * 0.11, seed * 0.07 + time * 0.0018);
    const broad = Math.pow(Math.abs(Math.sin(axis * (3.1 + width * 2.4) + seed * 0.31)), 3.2);
    let spire = Math.pow(Math.abs(Math.sin(axis * (11 + character * 12) + seed)), 13 - feedback * 6);
    let height = 0.022 + n * (0.038 + amount * 0.028) + broad * amount * 0.055;

    if (mode === 'tape' || mode === 're201' || mode === 'EP-3 Echoplex') {
      height += Math.pow(n, 1.6) * amount * 0.045;
      spire *= 0.22;
    } else if (mode === 'bbd' || mode === 'Deluxe Memory Man') {
      height += spire * amount * 0.055;
      height = Math.round(height * 34) / 34;
    } else if (mode === 'pingpong') {
      height = height * (p < 0 ? 0.65 + feedback * 0.5 : 1.1 - feedback * 0.18) + spire * amount * 0.055;
    } else if (mode === 'diffuse') {
      height = 0.020 + Math.pow(n, 1.25) * (0.07 + amount * 0.055);
      spire *= 0.12;
    } else if (mode === 'scatter' || mode === 'AMS DMX 15-80 S') {
      spire = Math.pow(Math.abs(Math.sin(axis * (17 + character * 15) + seed * 1.3)), 18 - feedback * 8);
      height += spire * amount * (0.09 + character * 0.06);
    } else if (mode === 'constellation' || mode === 'Binson Echorec') {
      spire = Math.pow(Math.abs(Math.sin(axis * 13.7 + seed)), 10);
      height += spire * amount * 0.075;
    } else {
      height += spire * amount * 0.042;
    }

    height *= 1 + audioLow * (0.025 + feedback * 0.035);
    return horizon - height * (0.72 + amount * 0.48);
  }

  private cloudField(
    u: number,
    v: number,
    horizon: number,
    m: ModuleState | undefined,
    seed: number,
    time: number,
    audio: AudioPhysics
  ) {
    const amount = visualAmount(m);
    if (amount <= 0 || v >= horizon) return { density: 0, cool: 0, warm: 0 };
    const mode = m?.algorithm ?? 'hall';
    const size = valueOf(m, 'size', 0.52);
    const diff = valueOf(m, 'diffusion', 0.74);
    const motion = valueOf(m, 'motion', 0.18);
    const color = valueOf(m, 'color', 0.42);
    const p = u * 2 - 1;
    const drift = time * (0.002 + motion * 0.005) + audio.mid * 0.03;
    const base = fbm(p * (0.75 + (1 - size) * 0.55) + seed * 0.09 + drift, v * (1.35 + diff * 0.6) - drift * 0.7);
    const detail = noise(p * 2.6 + seed * 0.17 - drift * 1.4, v * 3.1 + seed * 0.04);
    const alt = clamp01((horizon - v) / Math.max(0.18, horizon));
    let density = smoothstep(0.46 - diff * 0.10, 0.76, base + detail * 0.12) * amount;
    let cool = 0.55 + color * 0.45;
    let warm = 0.30 + (1 - color) * 0.35;

    if (mode === 'room') density *= smoothstep(0.42, 0.03, horizon - v) * 0.82;
    else if (mode === 'plate' || mode === 'emt140') density = Math.pow(clamp01(Math.sin(v * 39 + base * 4 + time * 0.035 + audio.high * 2) * 0.5 + 0.5), 5) * amount * (0.25 + diff * 0.5);
    else if (mode === 'cinema') {
      density = clamp01(density * 1.1 + Math.pow(clamp01(Math.cos(p * 8.5 + seed) * 0.5 + 0.5), 7) * alt * amount * 0.38);
      warm += 0.22;
    } else if (mode === 'cloud' || mode === 'lexicon224') density = smoothstep(0.40, 0.68, base) * amount * (0.72 + diff * 0.38);
    else if (mode === 'freeze') {
      density = Math.pow(smoothstep(0.50, 0.74, base + detail * 0.18), 1.8) * amount * 0.72;
      cool = 1;
      warm = 0.08;
    } else if (mode === 'celestial') {
      density *= 0.62;
      cool = 0.72;
      warm = 0.72;
    } else if (mode === 'aurora') {
      density = Math.pow(clamp01(Math.sin(p * 6.4 + v * 14 + time * (0.08 + motion * 0.12) + audio.mid * 3) * 0.5 + 0.5), 10) * amount * (0.28 + diff * 0.34);
      cool = 1;
      warm = 0.28;
    } else if (mode === 'nebula') {
      density = smoothstep(0.34, 0.68, base + detail * 0.20) * amount * 0.88;
      cool = 0.84;
      warm = 0.74;
    } else if (mode === 'abyss') {
      density = smoothstep(0.38, 0.65, base) * amount * 0.54;
      cool = 0.28;
      warm = 0.06;
    }

    density *= 0.92 + audio.mid * 0.18 + audio.transient * 0.08;
    return { density: clamp01(density), cool: clamp01(cool), warm: clamp01(warm) };
  }

  private waterWave(
    u: number,
    v: number,
    m: ModuleState | undefined,
    heroX: number,
    horizon: number,
    seed: number,
    time: number,
    audio: AudioPhysics
  ) {
    const amount = visualAmount(m);
    if (amount <= 0 || v <= horizon) return 0;
    const mode = m?.driftMode ?? 'chorus';
    const rate = valueOf(m, 'rate', 0.094);
    const depth = valueOf(m, 'depth', 0.275);
    const spread = valueOf(m, 'spread', 0.62);
    const motion = valueOf(m, 'motion', 0.32);
    const x = u - 0.5;
    const y = v - horizon;
    const speed = 0.12 + rate * 0.62 + motion * 0.16 + audio.mid * 0.12;
    let wave = 0;

    if (mode === 'ensemble') wave = (Math.sin(x * 42 + time * speed) + Math.sin(x * 61 - time * speed * 0.72 + seed) + Math.sin(y * 70 + x * 19 + time * 0.11)) / 3;
    else if (mode === 'dimension' || mode === 'dimensiond') wave = Math.sin((Math.abs(x) * (38 + spread * 22) + y * 16) - time * speed) * (0.65 + spread * 0.35);
    else if (mode === 'vibrato') wave = Math.sin(x * (70 + depth * 45) + time * speed * 1.8) * 0.75;
    else if (mode === 'rotary') wave = Math.sin(Math.hypot(x * 1.25, (v - (horizon + 0.25)) * 1.9) * (42 + spread * 8) - time * speed * 1.3);
    else if (mode === 'doppler') {
      const source = heroX + Math.sin(time * speed * 0.55) * (0.08 + spread * 0.08);
      wave = Math.sin(Math.hypot((u - source) * 1.25, y * 1.8) * 54 - time * speed * 1.8);
    } else if (mode === 'liquid') wave = (fbm(x * (3.2 + depth * 2.5) + seed * 0.1 + time * speed * 0.08, y * 6.4 - time * speed * 0.12) - 0.5) * 2;
    else if (mode === 'orbit') wave = Math.sin(Math.hypot((u - heroX) * (1.4 + spread * 0.3), (v - (horizon + 0.30)) * 2.2) * 46 - time * speed) * 0.7 + Math.cos((u - heroX) * 34 + time * speed * 0.6) * 0.3;
    else if (mode === 'ce1') wave = Math.sin(x * 44 + time * speed * 0.72) * 0.72 + Math.sin(x * 24 - time * speed * 0.44 + y * 32) * 0.28;
    else wave = Math.sin(x * (46 + spread * 12) + time * speed) * 0.62 + Math.sin(x * 27 - time * speed * 0.68 + y * 28) * 0.38;

    const impulse = 1 + audio.low * 0.22 + audio.transient * 0.14;
    return wave * amount * (0.45 + depth * 0.55) * impulse;
  }

  private renderRaster(time: number, l: ArtLayers, p: PatchField, s: SceneState, audio: AudioPhysics) {
    if (!this.rasterCtx || !this.imageData) return;
    const data = this.imageData.data;
    const g = this.geometry(l, p, s, audio);
    const { horizon, heroX } = g;
    const seed = lerp(s.a.seed, s.b.seed, s.mix);
    const warmBias = clamp01(0.52 + (this.x - 0.5) * 0.24 + g.ember * 0.10 + audio.low * 0.06);
    const ma = new Float32Array(RASTER_W);
    const mb = new Float32Array(RASTER_W);

    for (let px = 0; px < RASTER_W; px += 1) {
      const u = px / (RASTER_W - 1);
      ma[px] = this.mountainSurface(u, horizon, l.halo, s.a.seed, time, s.a.symmetry, audio.low);
      mb[px] = this.mountainSurface(u, horizon, l.halo, s.b.seed, time, s.b.symmetry, audio.low);
    }

    for (let py = 0; py < RASTER_H; py += 1) {
      const v = py / (RASTER_H - 1);
      for (let px = 0; px < RASTER_W; px += 1) {
        const u = px / (RASTER_W - 1);
        const x = u * 2 - 1;
        const field = lerp(
          fbm(x * 0.86 + s.a.seed * 0.08 + time * 0.0035, v * 1.22 - time * 0.0025),
          fbm(x * 0.86 + s.b.seed * 0.08 + time * 0.0035, v * 1.22 - time * 0.0025),
          s.mix
        );
        const detail = noise(x * 2.65 + seed * 0.13 - time * (0.006 + audio.high * 0.003), v * 2.4 + seed * 0.04);
        const surface = lerp(ma[px], mb[px], s.mix);
        const mountain = smoothstep(surface - 0.006, surface + 0.004, v) * (1 - smoothstep(horizon - 0.002, horizon + 0.010, v));
        let r = 3;
        let gg = 6;
        let b = 12;

        if (v < horizon) {
          const alt = clamp01((horizon - v) / Math.max(0.20, horizon));
          const hg = Math.exp(-Math.abs(v - horizon) * 24);
          r += 5 + alt * 9 + field * 10 + hg * (20 + warmBias * 20) + audio.low * hg * 8;
          gg += 9 + alt * 16 + detail * 12 + hg * 25 + audio.mid * 2;
          b += 18 + alt * 30 + field * 17 + detail * 12 + hg * 31 + audio.high * 4;
          const cloud = this.cloudField(u, v, horizon, l.atmos, seed, time, audio);
          r += cloud.density * (10 + cloud.warm * 38);
          gg += cloud.density * (18 + cloud.cool * 34);
          b += cloud.density * (28 + cloud.cool * 40 + cloud.warm * 10);
          if (l.atmos?.algorithm === 'abyss') {
            const a = cloud.density * g.atmos * 0.44;
            r *= 1 - a;
            gg *= 1 - a * 0.82;
            b *= 1 - a * 0.56;
          }
        } else {
          const depth = clamp01((v - horizon) / Math.max(0.001, 1 - horizon));
          const wave = this.waterWave(u, v, l.drift, heroX, horizon, seed, time, audio);
          const water = g.drift;
          const refl = Math.exp(-Math.abs(u - heroX + wave * 0.012) * (6.8 - water * 2.8 - valueOf(l.drift, 'spread', 0.62) * 0.8)) * (1 - depth * 0.58);
          const wn = noise(x * (3.2 + water * 1.3) + time * (0.010 + audio.mid * 0.012), v * 8.5 - time * (0.022 + audio.low * 0.018));
          r += 3 + depth * 5 + refl * water * (25 + warmBias * 36);
          gg += 8 + depth * 9 + refl * water * 38;
          b += 15 + depth * 17 + refl * water * 55;
          const rip = Math.pow(clamp01(wave * 0.5 + 0.5), 8) * water * smoothstep(horizon + 0.02, 0.96, v);
          r += rip * (8 + warmBias * 13);
          gg += rip * 17;
          b += rip * 27;
          const gr = (wn - 0.5) * water * (5.5 + audio.high * 4);
          r += gr * 0.55;
          gg += gr * 0.72;
          b += gr;
          if (water <= 0.01) {
            r *= 0.72;
            gg *= 0.76;
            b *= 0.82;
          }
        }

        if (mountain > 0) {
          const rim = 1 - smoothstep(0.002, 0.015, Math.abs(v - surface));
          r = lerp(r, 3 + rim * (10 + g.halo * 17 + audio.transient * 9), mountain * 0.95);
          gg = lerp(gg, 7 + rim * (15 + g.halo * 20 + audio.high * 4), mountain * 0.97);
          b = lerp(b, 10 + rim * (20 + g.halo * 24 + audio.mid * 5), mountain * 0.96);
        }

        if (g.drift > 0.01 && v > horizon) {
          const rv = horizon - (v - horizon) + this.waterWave(u, v, l.drift, heroX, horizon, seed, time, audio) * 0.012;
          const rm = smoothstep(surface - 0.008, surface + 0.006, rv) * (1 - smoothstep(horizon, horizon + 0.01, rv));
          const a = rm * g.drift * (1 - clamp01((v - horizon) * 1.5)) * (0.35 + detail * 0.30);
          r = lerp(r, 8 + warmBias * 11, a);
          gg = lerp(gg, 17, a);
          b = lerp(b, 27 + g.drift * 11, a);
        }

        if (g.artifact > 0.01) {
          const mode = l.artifact?.mediaMode ?? 'cassette';
          const wear = valueOf(l.artifact, 'wear', 0.162) * g.artifact;
          const wow = valueOf(l.artifact, 'wow', 0.16) * g.artifact;
          const nv = valueOf(l.artifact, 'noise', 0.1) * g.artifact;
          const tone = valueOf(l.artifact, 'tone', 0.62);
          const dust = (hash(px + Math.floor(time * 1.5), py + seed) - 0.5) * nv * (7 + audio.high * 6);
          if (mode === 'cassette' || mode === 'tascam424') {
            r += wear * (4 + tone * 6) + dust;
            gg += wear * 1.5 + dust * 0.65;
            b -= wear * 2.4 - dust * 0.45;
          } else if (mode === 'reel' || mode === 'Ampex ATR-102') {
            const f = Math.sin(v * 17 + time * 0.7) * wow * 3;
            r += f + dust * 0.5;
            gg += f * 0.72 + dust * 0.45;
            b += f * 0.48 + dust * 0.35;
          } else if (mode === 'vinyl') {
            r += dust * 0.72;
            gg += dust * 0.66;
            b += dust * 0.58;
          } else if (mode === 'vhs') {
            const seam = Math.sin(py * 0.54 + time * 4.2 + x * 0.5) * wear;
            r += seam * 5 + dust * 0.42;
            gg += seam * 0.7;
            b -= seam * 3.4;
          } else if (mode === 'radio') {
            const c = Math.sin(v * 93 + time * 7.1) * nv * 4.5;
            r += c;
            gg += c;
            b += c * 0.82;
          } else if (mode === 'wax') {
            const a = wear * 0.12;
            const mono = (r + gg + b) / 3;
            r = lerp(r, mono + 5, a);
            gg = lerp(gg, mono + 2, a);
            b = lerp(b, mono, a);
          } else if (mode === 'broken') {
            const t = Math.sin(py * 0.78 + time * 8.4 + seed) * wear;
            r += t * 8 + dust;
            gg -= t * 2;
            b -= t * 5;
          } else if (modeIs(mode, 'Neve 1073', 'SSL 4000E', 'API 1608')) {
            const consoleWarmth = mode === 'Neve 1073' ? 1 : mode === 'API 1608' ? 0.6 : 0.25;
            r += wear * (5 + consoleWarmth * 4);
            gg += wear * (3 + tone * 2);
            b += wear * (1 + (1 - consoleWarmth) * 2);
          } else {
            const a = wear * 0.11;
            r = lerp(r, 33, a) + dust * 0.5;
            gg = lerp(gg, 30, a) + dust * 0.45;
            b = lerp(b, 24, a) + dust * 0.35;
          }
        }

        const hl = Math.exp(-Math.abs(v - horizon) * 40);
        r += hl * (5 + warmBias * 14 + audio.low * 6);
        gg += hl * (10 + audio.mid * 3);
        b += hl * (12 + audio.high * 4);
        const i = (py * RASTER_W + px) * 4;
        data[i] = clamp(r, 0, 255);
        data[i + 1] = clamp(gg, 0, 255);
        data[i + 2] = clamp(b, 0, 255);
        data[i + 3] = 255;
      }
    }

    this.rasterCtx.putImageData(this.imageData, 0, 0);
  }

  private drawEmber(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry, crest: number) {
    const w = this.width;
    const h = this.height;
    const min = Math.min(w, h);
    const cx = g.heroX * w;
    const cy = g.heroY * h;
    const amount = g.ember;
    const mode = m?.emberMode ?? 'velvet';
    const drive = valueOf(m, 'drive', 0.14);
    const heat = valueOf(m, 'heat', 0.18);
    const character = valueOf(m, 'character', 0.22);
    const pulse = 1 + g.audio.low * 0.16 + g.audio.transient * 0.12;
    const core = min * (0.025 + amount * 0.023 + crest * 0.006) * pulse;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (amount > 0) {
      const glow = ctx.createRadialGradient(cx, cy, core * 0.55, cx, cy, core * (4.1 + heat * 1.4));
      const hot = modeIs(mode, 'furnace', 'mullard', 'rcablack');
      const airy = modeIs(mode, 'exciter', 'telefunken', 'bugleboy');
      glow.addColorStop(0, `rgba(255,225,165,${0.09 + amount * 0.12 + g.audio.transient * 0.05})`);
      glow.addColorStop(0.28, hot ? `rgba(255,108,63,${0.08 + amount * 0.09})` : `rgba(249,148,79,${0.07 + amount * 0.075})`);
      glow.addColorStop(0.58, airy ? `rgba(94,213,255,${0.045 + character * 0.045})` : `rgba(221,78,176,${0.035 + character * 0.04})`);
      glow.addColorStop(0.83, `rgba(78,213,217,${0.018 + amount * 0.022})`);
      glow.addColorStop(1, 'rgba(78,213,217,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, core * (4.1 + heat * 1.4), 0, Math.PI * 2);
      ctx.fill();

      const count = mode === 'console' ? 7 : mode === 'furnace' ? 6 : modeIs(mode, 'goldlion', 'mullard', 'telefunken', 'bugleboy', 'rcablack') ? 5 : modeIs(mode, 'exciter', 'broken') ? 4 : 3;
      for (let i = 0; i < count; i += 1) {
        const p = i / Math.max(1, count - 1);
        const radius = core * (1.2 + p * (2.5 + drive * 1.1 + g.audio.low * 0.28));
        const wobble = Math.sin(time * (0.12 + g.audio.mid * 0.24) + i * 1.8) * core * (0.06 + heat * 0.12 + g.audio.transient * 0.05);
        const alpha = (0.055 + amount * 0.08 + g.audio.level * 0.03) * (1 - p * 0.42);
        ctx.strokeStyle = i % 2 ? `rgba(222,84,181,${alpha * 0.72})` : `rgba(250,169,95,${alpha})`;
        ctx.lineWidth = Math.max(1, min * (0.0014 + (1 - p) * 0.0006));
        ctx.beginPath();
        if (mode === 'transformer') ctx.ellipse(cx, cy, radius * 1.24, radius * 0.72, (i % 2 ? -1 : 1) * 0.18, Math.PI * 0.06, Math.PI * 1.94);
        else if (mode === 'broken') {
          const start = time * 0.025 + i * 1.3 + g.audio.transient * 0.8;
          ctx.arc(cx, cy, radius + wobble, start, start + Math.PI * (0.72 + p * 0.32));
        } else ctx.arc(cx, cy, radius + wobble, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (mode === 'exciter' || mode === 'telefunken' || mode === 'bugleboy') {
        ctx.strokeStyle = `rgba(244,226,186,${0.035 + amount * 0.045 + g.audio.high * 0.035})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 12; i += 1) {
          const a = i / 12 * Math.PI * 2 + time * (0.006 + g.audio.high * 0.02);
          const inner = core * 1.25;
          const outer = core * (2.1 + character * 1.7 + (i % 3) * 0.18 + g.audio.transient * 0.6);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(1,3,7,.985)';
    ctx.beginPath();
    ctx.arc(cx, cy, core * 0.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = amount > 0 ? `rgba(246,205,146,${0.10 + amount * 0.09 + g.audio.transient * 0.06})` : 'rgba(116,151,150,.07)';
    ctx.lineWidth = Math.max(1, min * 0.0015);
    ctx.stroke();
    ctx.restore();
  }

  private drawHalo(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry, s: SceneState) {
    if (!m || g.halo <= 0) return;
    const w = this.width;
    const h = this.height;
    const seed = lerp(s.a.seed, s.b.seed, s.mix);
    const sym = lerp(s.a.symmetry, s.b.symmetry, s.mix);
    const mode = m.delayAlgorithm ?? 'clean';
    const feedback = valueOf(m, 'feedback', 0.24);
    const character = valueOf(m, 'character', 0.14);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const ridgeCount = modeIs(mode, 'bbd', 'Deluxe Memory Man') ? 8 : modeIs(mode, 'scatter', 'AMS DMX 15-80 S') ? 13 : 7;
    for (let i = 0; i < ridgeCount; i += 1) {
      const u = 0.06 + i / Math.max(1, ridgeCount - 1) * 0.88;
      const x = u * w;
      const y = this.mountainSurface(u, g.horizon, m, seed, time, sym, g.audio.low) * h;
      const lift = (2 + (i % 3) * 2) * (1 + g.audio.transient * 0.6);
      ctx.strokeStyle = i % 2 ? `rgba(82,216,220,${0.035 + g.halo * 0.05 + g.audio.high * 0.025})` : `rgba(244,181,108,${0.03 + g.halo * 0.045})`;
      ctx.lineWidth = modeIs(mode, 'bbd', 'Deluxe Memory Man') ? 1.4 : 0.85;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.018, y + 1);
      if (mode === 'pingpong') {
        ctx.lineTo(x, y - lift * (i % 2 ? 1.7 : 0.55));
        ctx.lineTo(x + w * 0.018, y + 1);
      } else if (modeIs(mode, 'scatter', 'AMS DMX 15-80 S')) {
        ctx.lineTo(x + Math.sin(i * 2.1) * w * 0.006, y - lift * (1.2 + hash(i, seed) * 1.8));
        ctx.lineTo(x + w * 0.012, y + 1);
      } else if (modeIs(mode, 'tape', 're201', 'EP-3 Echoplex')) {
        ctx.quadraticCurveTo(x, y - lift * 0.7, x + w * 0.018, y + 1);
      } else {
        ctx.lineTo(x, y - lift);
        ctx.lineTo(x + w * 0.018, y + 1);
      }
      ctx.stroke();
    }

    if (mode === 'constellation' || mode === 'Binson Echorec') {
      for (let i = 0; i < 18; i += 1) {
        const u = 0.04 + hash(i * 7.2, seed) * 0.92;
        const x = u * w;
        const ridge = this.mountainSurface(u, g.horizon, m, seed, time, sym, g.audio.low) * h;
        const y = ridge - 5 - hash(i * 5.8, seed) * h * 0.14;
        const twinkle = 0.6 + Math.sin(time * (0.8 + g.audio.high * 1.4) + i) * 0.4;
        ctx.fillStyle = i % 2 ? `rgba(82,216,220,${(0.08 + g.halo * 0.10 + g.audio.high * 0.08) * twinkle})` : `rgba(244,181,108,${(0.08 + g.halo * 0.10) * twinkle})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.65 + (i % 3) * 0.28 + g.audio.transient * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (modeIs(mode, 're201', 'EP-3 Echoplex', 'Binson Echorec')) {
      const rings = mode === 'Binson Echorec' ? 4 : 3;
      const cx = g.heroX * w;
      const cy = g.horizon * h - h * 0.035;
      for (let i = 0; i < rings; i += 1) {
        ctx.strokeStyle = `rgba(244,170,96,${0.025 + g.halo * 0.035})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * (0.08 + i * 0.035 + feedback * 0.02), h * (0.018 + i * 0.008), character * 0.12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawAtmos(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry) {
    if (!m || g.atmos <= 0) return;
    const mode = m.algorithm ?? 'hall';
    const w = this.width;
    const h = this.height;
    const hz = g.horizon * h;
    const motion = valueOf(m, 'motion', 0.18);
    const diffusion = valueOf(m, 'diffusion', 0.74);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    if (mode === 'aurora') {
      const ribbons = 5;
      for (let i = 0; i < ribbons; i += 1) {
        const grad = ctx.createLinearGradient(w * 0.12, 0, w * 0.88, 0);
        grad.addColorStop(0, 'rgba(77,214,218,0)');
        grad.addColorStop(0.38, `rgba(77,214,218,${0.028 + g.atmos * 0.035 + g.audio.mid * 0.035})`);
        grad.addColorStop(0.62, `rgba(218,83,184,${0.022 + g.atmos * 0.03 + g.audio.high * 0.02})`);
        grad.addColorStop(1, 'rgba(218,83,184,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1 + diffusion * 0.6;
        ctx.beginPath();
        for (let step = 0; step <= 38; step += 1) {
          const p = step / 38;
          const x = w * (0.06 + p * 0.88);
          const y = hz * (0.16 + i * 0.085) + Math.sin(p * Math.PI * 2 + time * (0.08 + motion * 0.08) + i + g.audio.mid * 3) * h * (0.022 + g.audio.low * 0.012);
          step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (mode === 'celestial' || mode === 'nebula') {
      const cx = g.heroX * w;
      const cy = g.heroY * h;
      const r = Math.min(w, h) * (mode === 'nebula' ? 0.25 : 0.18) * (1 + g.audio.low * 0.12);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, `rgba(228,239,233,${0.025 + g.atmos * 0.035 + g.audio.transient * 0.035})`);
      glow.addColorStop(0.45, mode === 'nebula' ? `rgba(218,83,184,${0.02 + g.atmos * 0.028})` : `rgba(88,151,255,${0.012 + g.atmos * 0.018})`);
      glow.addColorStop(1, 'rgba(88,151,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (mode === 'plate' || mode === 'emt140') {
      const lines = mode === 'emt140' ? 8 : 5;
      for (let i = 0; i < lines; i += 1) {
        const y = hz * (0.24 + i * 0.075) + Math.sin(time * 0.11 + i) * h * 0.006 * (1 + g.audio.mid);
        ctx.strokeStyle = `rgba(208,224,218,${0.018 + g.atmos * 0.026 + g.audio.high * 0.018})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(w * 0.14, y);
        ctx.quadraticCurveTo(w * 0.5, y - h * 0.018 * diffusion, w * 0.86, y);
        ctx.stroke();
      }
    } else if (mode === 'lexicon224') {
      for (let i = 0; i < 7; i += 1) {
        const y = hz * (0.24 + i * 0.07);
        ctx.strokeStyle = i % 2 ? `rgba(79,216,219,${0.02 + g.atmos * 0.028})` : `rgba(218,83,184,${0.016 + g.atmos * 0.022})`;
        ctx.beginPath();
        for (let step = 0; step <= 28; step += 1) {
          const p = step / 28;
          const x = w * (0.10 + p * 0.80);
          const yy = y + Math.sin(p * Math.PI * (2 + i % 3) + time * (0.10 + motion * 0.08) + i) * h * (0.004 + g.audio.mid * 0.008);
          step === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    } else if (mode === 'freeze') {
      const cx = g.heroX * w;
      ctx.strokeStyle = `rgba(160,225,255,${0.025 + g.atmos * 0.04 + g.audio.high * 0.025})`;
      for (let i = 0; i < 9; i += 1) {
        const a = hash(i * 3.3) * Math.PI;
        const r = Math.min(w, h) * (0.04 + i * 0.016);
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r, hz * 0.54 - Math.sin(a) * r * 0.3);
        ctx.lineTo(cx + Math.cos(a) * r, hz * 0.54 + Math.sin(a) * r * 0.3);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawDrift(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry) {
    if (!m || g.drift <= 0) return;
    const w = this.width;
    const h = this.height;
    const hz = g.horizon * h;
    const cx = g.heroX * w;
    const mode = m.driftMode ?? 'chorus';
    const spread = valueOf(m, 'spread', 0.62);
    const motion = valueOf(m, 'motion', 0.32);
    const depth = valueOf(m, 'depth', 0.275);
    const count = mode === 'ensemble' ? 9 : mode === 'liquid' ? 7 : modeIs(mode, 'dimension', 'dimensiond') ? 6 : 5;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = (i + 1) / (count + 1);
      const y = lerp(hz + h * 0.055, h * 0.92, p);
      const half = w * (0.08 + p * (0.24 + spread * 0.16));
      const wobble = Math.sin(time * (0.035 + motion * 0.05 + g.audio.mid * 0.04) + i * 1.2) * h * (0.004 + g.audio.low * 0.006);
      ctx.strokeStyle = i % 2 ? `rgba(77,214,218,${0.025 + g.drift * 0.03 + g.audio.high * 0.018})` : `rgba(218,83,184,${0.018 + g.drift * 0.024})`;
      ctx.lineWidth = modeIs(mode, 'dimension', 'dimensiond') ? 1.25 : 0.9;
      ctx.beginPath();
      if (mode === 'rotary' || mode === 'orbit') ctx.ellipse(cx, y, half, h * (0.012 + p * 0.025 + g.audio.low * 0.008), (this.x - 0.5) * 0.05, Math.PI, Math.PI * 2);
      else if (mode === 'doppler') {
        const source = cx + Math.sin(time * (0.22 + motion * 0.3)) * w * 0.06 * spread;
        ctx.moveTo(source - half, y + wobble);
        ctx.quadraticCurveTo(source, y - h * (0.008 + depth * 0.012 + g.audio.transient * 0.01), source + half, y - wobble);
      } else {
        ctx.moveTo(cx - half, y + wobble);
        ctx.quadraticCurveTo(cx, y - h * (0.006 + g.drift * 0.006 + g.audio.low * 0.008), cx + half, y - wobble);
      }
      ctx.stroke();
    }

    if (mode === 'ce1') {
      ctx.strokeStyle = `rgba(244,176,103,${0.025 + g.drift * 0.035})`;
      ctx.lineWidth = 1;
      const y = hz + h * 0.15;
      ctx.beginPath();
      for (let i = 0; i <= 32; i += 1) {
        const p = i / 32;
        const x = w * (0.08 + p * 0.84);
        const yy = y + Math.sin(p * Math.PI * 5 + time * 0.16) * h * (0.006 + depth * 0.015 + g.audio.mid * 0.008);
        i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawGrain(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry) {
    if (!m || g.grain <= 0) return;
    const w = this.width;
    const h = this.height;
    const mode = m.grainMode ?? 'smear';
    const density = valueOf(m, 'density', 0.42);
    const chaos = valueOf(m, 'chaos', 0.16);
    const bloom = valueOf(m, 'bloom', 0.36);
    const pitch = valueOf(m, 'pitch', 0.38);
    const mosaic = mode === 'mosaic';
    const count = 12 + Math.round(density * 40 + g.grain * 10 + g.audio.high * 12);
    const speed = 0.035 + density * 0.045 + pitch * 0.025 + g.audio.high * 0.035;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const seed = hash(i * 11.31 + 4.7);
      const lateral = hash(i * 17.2 + 2.3);
      let fall = (time * speed * (0.72 + seed * 0.56) + seed) % 1;
      if (mode === 'slice' || mosaic) fall = Math.floor(fall * (mosaic ? 9 : 12)) / (mosaic ? 9 : 12);
      const x = lateral * w + Math.sin(time * 0.04 + i) * chaos * w * (0.012 + g.audio.mid * 0.008);
      const y = -h * 0.08 + fall * h * 1.12;
      const alpha = (0.025 + g.grain * 0.035 + g.audio.high * 0.025) * (0.55 + seed * 0.45);

      if (mode === 'scatter' || mode === 'freeze') {
        const size = 1.1 + seed * (2.2 + chaos * 2.2 + g.audio.transient * 3);
        ctx.fillStyle = mode === 'freeze' ? `rgba(229,132,189,${alpha * 0.76})` : `rgba(116,223,221,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size * 0.8, y + size * 0.4);
        ctx.lineTo(x - size * 0.6, y + size);
        ctx.closePath();
        ctx.fill();
      } else if (mosaic) {
        const block = 1.7;
        const qx = Math.round(x / block) * block;
        const qy = Math.round(y / block) * block;
        ctx.fillStyle = `rgba(242,176,102,${alpha * 0.74})`;
        ctx.fillRect(qx, qy, block, block * (1 + seed * 1.6));
      } else {
        const len = mode === 'smear' ? 11 + bloom * 15 + g.audio.low * 10 : mode === 'prism' ? 5 + bloom * 7 : 4 + density * 7;
        ctx.strokeStyle = mode === 'prism'
          ? i % 3 === 0 ? `rgba(244,173,99,${alpha})` : i % 2 ? `rgba(220,88,187,${alpha})` : `rgba(86,216,220,${alpha})`
          : `rgba(196,229,222,${alpha})`;
        ctx.lineWidth = mode === 'smear' ? 1.1 : 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + chaos * 2.8 + g.audio.transient * 2, y + len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawArtifactLandscape(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry, s: SceneState) {
    if (!m || g.artifact <= 0) return;
    const mode = m.mediaMode ?? 'cassette';
    if (mode === 'vhs') this.drawCyberCity(ctx, time, m, g, s);
    else if (modeIs(mode, 'tascam424', 'Neve 1073', 'SSL 4000E', 'API 1608')) this.drawSamplerGrid(ctx, time, mode, g);
    else if (mode === 'archive') this.drawArchiveMonoliths(ctx, g, s);
    else if (mode === 'broken') this.drawBrokenStructures(ctx, time, g, s);
  }

  private drawCyberCity(ctx: CanvasRenderingContext2D, time: number, m: ModuleState, g: Geometry, s: SceneState) {
    const w = this.width;
    const h = this.height;
    const hz = g.horizon * h;
    const seed = lerp(s.a.seed, s.b.seed, s.mix);
    const wear = valueOf(m, 'wear', 0.162);
    const wow = valueOf(m, 'wow', 0.16);
    const noiseAmount = valueOf(m, 'noise', 0.1);
    const parallax = (this.x - 0.5) * w * 0.025;
    const bassLift = g.audio.low * h * 0.018;
    const buildingCount = 17;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < buildingCount; i += 1) {
      const t = i / (buildingCount - 1);
      const n = hash(i * 9.17, seed);
      const n2 = hash(i * 4.31 + 2.7, seed);
      const width = w * (0.028 + n2 * 0.035);
      const x = t * w - width * 0.5 + (n - 0.5) * w * 0.026 - parallax * (0.35 + n * 0.5);
      const base = hz + h * (0.018 + n2 * 0.028);
      const height = h * (0.09 + n * 0.22 + (i % 5 === 0 ? 0.10 : 0)) * (1 + g.artifact * 0.16) + bassLift * (0.25 + n * 0.75);
      const top = base - height;
      const lean = (this.x - 0.5) * width * 0.12 + Math.sin(time * 0.35 + i) * wow * 1.8;

      ctx.fillStyle = `rgba(${5 + Math.round(n * 5)},${8 + Math.round(n2 * 5)},${15 + Math.round(n * 8)},${0.82 + g.artifact * 0.12})`;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x + lean, top + (i % 4 === 0 ? height * 0.04 : 0));
      ctx.lineTo(x + width + lean, top);
      ctx.lineTo(x + width, base);
      ctx.closePath();
      ctx.fill();

      const edgeAlpha = 0.035 + g.artifact * 0.06 + g.audio.high * 0.035;
      ctx.strokeStyle = i % 3 === 0 ? `rgba(224,76,190,${edgeAlpha})` : `rgba(66,214,222,${edgeAlpha})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      const cols = Math.max(1, Math.floor(width / 7));
      const rows = Math.max(2, Math.floor(height / 9));
      const windowW = Math.max(1.1, width / (cols * 2.8));
      const windowH = 1.1;
      for (let row = 1; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const id = i * 101 + row * 13 + col * 7;
          const alive = hash(id, seed) > 0.42 - noiseAmount * 0.18;
          if (!alive) continue;
          const flicker = hash(id + Math.floor(time * (3 + g.audio.high * 8)), seed);
          const hit = g.audio.transient > 0.06 && flicker > 0.72;
          const a = (0.035 + g.artifact * 0.055 + g.audio.high * 0.055 + (hit ? g.audio.transient * 0.16 : 0)) * (0.65 + flicker * 0.35);
          ctx.fillStyle = (row + col + i) % 4 === 0 ? `rgba(237,75,195,${a})` : `rgba(87,224,226,${a})`;
          const wx = x + width * 0.18 + col * (width * 0.64 / Math.max(1, cols - 1));
          const wy = base - row * (height * 0.76 / rows);
          ctx.fillRect(wx + lean * (1 - row / rows), wy, windowW, windowH);
        }
      }

      if (i % 5 === 2) {
        const signY = top + height * (0.23 + n2 * 0.18);
        const signW = width * (0.7 + n * 0.25);
        const signA = 0.045 + g.artifact * 0.07 + g.audio.mid * 0.05 + g.audio.transient * 0.08;
        ctx.fillStyle = i % 2 ? `rgba(224,73,192,${signA})` : `rgba(73,222,225,${signA})`;
        ctx.fillRect(x - signW * 0.08, signY, signW, 2 + g.audio.transient * 1.5);
      }
    }

    ctx.globalCompositeOperation = 'screen';
    const vanX = g.heroX * w + (this.x - 0.5) * w * 0.08;
    const vanY = hz + h * 0.008;
    for (let i = -7; i <= 7; i += 1) {
      const bottomX = w * 0.5 + i * w * 0.085;
      ctx.strokeStyle = i % 2 ? `rgba(74,218,223,${0.018 + g.artifact * 0.028})` : `rgba(224,74,191,${0.014 + g.artifact * 0.023})`;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(vanX, vanY);
      ctx.lineTo(bottomX, h);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i += 1) {
      const p = i / 7;
      const y = lerp(vanY, h, Math.pow(p, 1.65));
      const inset = (1 - p) * w * 0.42;
      const wobble = Math.sin(time * (0.8 + wow * 1.5) + i) * wear * 1.2;
      ctx.strokeStyle = `rgba(92,220,222,${0.016 + g.artifact * 0.024 + g.audio.low * 0.015})`;
      ctx.beginPath();
      ctx.moveTo(inset, y + wobble);
      ctx.lineTo(w - inset, y - wobble);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawSamplerGrid(ctx: CanvasRenderingContext2D, time: number, mode: string, g: Geometry) {
    const w = this.width;
    const h = this.height;
    const hz = g.horizon * h;
    const warm = mode === 'tascam424' || mode === 'Neve 1073';
    const punchy = mode === 'SSL 4000E' || mode === 'API 1608';
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const count = punchy ? 9 : 7;
    for (let i = 0; i < count; i += 1) {
      const x = w * (0.08 + i / Math.max(1, count - 1) * 0.84);
      const height = h * (0.025 + (i % 3) * 0.012 + g.audio.low * 0.012);
      ctx.strokeStyle = warm ? `rgba(245,172,94,${0.018 + g.artifact * 0.032})` : `rgba(87,214,221,${0.018 + g.artifact * 0.032})`;
      ctx.beginPath();
      ctx.moveTo(x, hz - height);
      ctx.lineTo(x, hz + h * 0.035);
      ctx.stroke();
      const meter = (Math.sin(time * (0.6 + i * 0.03) + i) * 0.5 + 0.5) * (0.3 + g.audio.level * 0.7);
      ctx.fillStyle = warm ? `rgba(246,184,102,${0.02 + meter * 0.055})` : `rgba(92,222,220,${0.02 + meter * 0.055})`;
      ctx.fillRect(x - 1.4, hz + h * 0.045, 2.8, -h * 0.04 * meter);
    }
    ctx.restore();
  }

  private drawArchiveMonoliths(ctx: CanvasRenderingContext2D, g: Geometry, s: SceneState) {
    const w = this.width;
    const h = this.height;
    const hz = g.horizon * h;
    const seed = lerp(s.a.seed, s.b.seed, s.mix);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 8; i += 1) {
      const n = hash(i * 5.8, seed);
      const x = w * (0.08 + i / 7 * 0.84);
      const height = h * (0.035 + n * 0.07);
      ctx.strokeStyle = `rgba(226,199,153,${0.02 + g.artifact * 0.035})`;
      ctx.strokeRect(x - 4, hz - height, 8, height);
      ctx.fillStyle = `rgba(226,199,153,${0.008 + g.artifact * 0.015})`;
      ctx.fillRect(x - 3, hz - height + 2, 6, Math.max(1, height - 4));
    }
    ctx.restore();
  }

  private drawBrokenStructures(ctx: CanvasRenderingContext2D, time: number, g: Geometry, s: SceneState) {
    const w = this.width;
    const h = this.height;
    const hz = g.horizon * h;
    const seed = lerp(s.a.seed, s.b.seed, s.mix);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 11; i += 1) {
      const n = hash(i * 8.1, seed);
      const x = w * (0.04 + i / 10 * 0.92);
      const sway = Math.sin(time * 0.45 + i) * (1 + g.audio.transient * 3);
      ctx.strokeStyle = i % 2 ? `rgba(222,84,181,${0.022 + g.artifact * 0.035})` : `rgba(82,216,220,${0.02 + g.artifact * 0.032})`;
      ctx.beginPath();
      ctx.moveTo(x, hz + h * 0.025);
      ctx.lineTo(x + sway, hz - h * (0.025 + n * 0.095));
      ctx.lineTo(x + w * 0.018 + sway * 0.4, hz - h * (0.01 + n * 0.05));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawArtifact(ctx: CanvasRenderingContext2D, time: number, m: ModuleState | undefined, g: Geometry) {
    if (!m || g.artifact <= 0) return;
    const w = this.width;
    const h = this.height;
    const mode = m.mediaMode ?? 'cassette';
    const wear = valueOf(m, 'wear', 0.162) * g.artifact;
    const wow = valueOf(m, 'wow', 0.16) * g.artifact;
    const nv = valueOf(m, 'noise', 0.1) * g.artifact;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (mode === 'vhs' || mode === 'broken') {
      const lines = mode === 'broken' ? 5 : 3;
      for (let i = 0; i < lines; i += 1) {
        const y = (hash(Math.floor(time * (0.45 + i * 0.12)) + i * 9.2) * 0.78 + 0.1) * h;
        const shift = Math.sin(time * (1.3 + g.audio.high * 0.9) + i) * (1 + wear * (mode === 'broken' ? 8 : 3) + g.audio.transient * 5);
        ctx.strokeStyle = i % 2 ? `rgba(83,216,220,${0.018 + wear * 0.045 + g.audio.high * 0.025})` : `rgba(225,92,188,${0.016 + wear * 0.040})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + shift);
        ctx.stroke();
      }
    } else if (mode === 'vinyl') {
      for (let i = 0; i < 7; i += 1) {
        const x = hash(i * 7.7 + Math.floor(time * 0.15)) * w;
        const y = hash(i * 5.1 + 3.2) * h;
        ctx.fillStyle = `rgba(236,220,181,${0.018 + nv * 0.055 + g.audio.high * 0.018})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.6 + (i % 2) * 0.4 + g.audio.transient * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mode === 'radio') {
      const y = ((time * (0.12 + g.audio.mid * 0.08)) % 1) * h;
      const grad = ctx.createLinearGradient(0, y - 12, 0, y + 12);
      grad.addColorStop(0, 'rgba(85,216,220,0)');
      grad.addColorStop(0.5, `rgba(218,232,220,${0.012 + nv * 0.035 + g.audio.level * 0.02})`);
      grad.addColorStop(1, 'rgba(85,216,220,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 12, w, 24);
    } else if (modeIs(mode, 'reel', 'cassette', 'Ampex ATR-102')) {
      const x = w * (0.5 + Math.sin(time * 0.045) * wow * 0.03);
      const sheen = ctx.createLinearGradient(x - w * 0.22, 0, x + w * 0.22, 0);
      sheen.addColorStop(0, 'rgba(245,171,100,0)');
      sheen.addColorStop(0.5, `rgba(245,171,100,${0.010 + wear * 0.024 + g.audio.low * 0.015})`);
      sheen.addColorStop(1, 'rgba(245,171,100,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'archive') {
      ctx.fillStyle = `rgba(235,205,153,${0.008 + wear * 0.020})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  private drawAudioPulse(ctx: CanvasRenderingContext2D, g: Geometry) {
    if (g.audio.transient < 0.025 && g.audio.level < 0.04) return;
    const w = this.width;
    const h = this.height;
    const cx = g.heroX * w;
    const cy = g.horizon * h;
    const r = Math.min(w, h) * (0.055 + g.audio.low * 0.07 + g.audio.transient * 0.05);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(214,236,224,${0.008 + g.audio.transient * 0.045})`;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.65, r * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
