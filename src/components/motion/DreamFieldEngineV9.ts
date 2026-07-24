import type { ModuleState, XYAssignment } from '../../ui/types';

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
};

type PatchField = {
  total: number;
  xStrength: number;
  yStrength: number;
};

type ArtLayers = {
  ember?: ModuleState;
  drift?: ModuleState;
  halo?: ModuleState;
  atmos?: ModuleState;
  grain?: ModuleState;
  artifact?: ModuleState;
};

type WorldProfile = {
  seed: number;
  horizon: number;
  heroX: number;
  heroLift: number;
  symmetry: number;
};

type SceneState = {
  a: WorldProfile;
  b: WorldProfile;
  worldMix: number;
  crest: number;
};

const RASTER_W = 112;
const RASTER_H = 64;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;
const SCENE_SECONDS = 24;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (value: number) => value - Math.floor(value);
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const followAmount = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
const hash = (x: number, y = 0) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
  module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;
const visualAmount = (module: ModuleState | undefined) =>
  module?.enabled && module.available ? clamp01(0.18 + Math.sqrt(clamp01(valueOf(module, 'mix', 0))) * 0.82) : 0;

function noise(x: number, y: number): number {
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

function fbm(x: number, y: number): number {
  return noise(x, y) * 0.64 + noise(x * 2.03 + 7.1, y * 2.03 - 3.7) * 0.27 + noise(x * 4.07 - 2.8, y * 4.07 + 5.2) * 0.09;
}

function profileFor(epoch: number): WorldProfile {
  const h = (channel: number) => hash(epoch * 17.17 + channel * 9.31, channel * 3.7);
  return {
    seed: epoch * 13.71 + 2.9,
    horizon: 0.53 + (h(0) - 0.5) * 0.075,
    heroX: (h(1) - 0.5) * 0.12,
    heroLift: 0.145 + h(2) * 0.09,
    symmetry: 0.48 + h(3) * 0.42,
  };
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
    const dt = this.lastTime > 0 ? frame.time - this.lastTime : 1 / 60;
    this.lastTime = frame.time;
    this.x = lerp(this.x, clamp01(frame.x), followAmount(frame.dragging ? 20 : 5, dt));
    this.y = lerp(this.y, clamp01(frame.y), followAmount(frame.dragging ? 20 : 5, dt));
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, followAmount(frame.dragging ? 14 : 3.6, dt));

    const layers = this.artLayers(frame.modules);
    const patch = this.patchField(frame.assignments);
    const scene = this.sceneState(frame.time);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;

    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderRaster(frame.time, layers, patch, scene);
      this.lastRasterTime = frame.time;
    }

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#020406';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.raster) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.raster, 0, 0, this.width, this.height);
      ctx.restore();
    }

    const geometry = this.worldGeometry(layers, patch, scene);
    this.drawAtmosAccents(ctx, frame.time, layers.atmos, geometry);
    this.drawHaloAccents(ctx, frame.time, layers.halo, geometry);
    this.drawEmberSun(ctx, frame.time, layers.ember, geometry, scene.crest);
    this.drawDriftAccents(ctx, frame.time, layers.drift, geometry);
    this.drawGrainWeather(ctx, frame.time, layers.grain, geometry);
    this.drawArtifactFx(ctx, frame.time, layers.artifact, geometry);
  }

  private artLayers(modules: ModuleState[]): ArtLayers {
    const active = (id: string) => modules.find((module) => module.id === id && module.enabled && module.available);
    return {
      ember: active('saturation'),
      drift: active('chorus'),
      halo: active('delay'),
      atmos: active('reverb'),
      grain: active('bitcrusher'),
      artifact: active('media'),
    };
  }

  private patchField(assignments: XYAssignment[]): PatchField {
    let xDepth = 0;
    let yDepth = 0;
    let xCount = 0;
    let yCount = 0;
    for (const assignment of assignments) {
      if (assignment.axis === 'x') {
        xDepth += assignment.depth;
        xCount += 1;
      } else {
        yDepth += assignment.depth;
        yCount += 1;
      }
    }
    return {
      total: assignments.length,
      xStrength: xCount ? clamp01(xDepth / xCount) : 0,
      yStrength: yCount ? clamp01(yDepth / yCount) : 0,
    };
  }

  private sceneState(time: number): SceneState {
    const journey = time / SCENE_SECONDS;
    const epoch = Math.floor(journey);
    const local = fract(journey);
    const transition = smoothstep(0.76, 1, local);
    return {
      a: profileFor(epoch),
      b: profileFor(epoch + 1),
      worldMix: transition,
      crest: Math.pow(Math.sin(transition * Math.PI), 1.5),
    };
  }

  private worldGeometry(layers: ArtLayers, patch: PatchField, scene: SceneState) {
    const xSteer = this.x - 0.5;
    const horizon = lerp(scene.a.horizon, scene.b.horizon, scene.worldMix) + (0.5 - this.y) * (0.055 + patch.yStrength * 0.025);
    const heroX = 0.5 + lerp(scene.a.heroX, scene.b.heroX, scene.worldMix) + xSteer * (0.12 + patch.xStrength * 0.06);
    const heroLift = lerp(scene.a.heroLift, scene.b.heroLift, scene.worldMix);
    const heroY = horizon - heroLift - (this.y - 0.5) * 0.022;
    const ember = visualAmount(layers.ember);
    const halo = visualAmount(layers.halo);
    const atmos = visualAmount(layers.atmos);
    const drift = visualAmount(layers.drift);
    const grain = visualAmount(layers.grain);
    const artifact = visualAmount(layers.artifact);
    return { horizon, heroX, heroY, ember, halo, atmos, drift, grain, artifact };
  }

  private mountainSurface(
    u: number,
    horizon: number,
    module: ModuleState | undefined,
    seed: number,
    time: number,
    symmetry: number
  ): number {
    const amount = visualAmount(module);
    if (amount <= 0) return horizon - 0.008;

    const mode = module?.delayAlgorithm ?? 'clean';
    const feedback = valueOf(module, 'feedback', 0.24);
    const character = valueOf(module, 'character', 0.14);
    const width = valueOf(module, 'width', 0.58);
    const p = u * 2 - 1;
    const q = Math.abs(p);
    const axis = lerp(p, q, symmetry);
    const n = fbm(axis * (1.12 + character * 0.6) + seed * 0.11, seed * 0.07 + time * 0.0018);
    const broad = Math.pow(Math.abs(Math.sin(axis * (3.1 + width * 2.4) + seed * 0.31)), 3.2);
    let spire = Math.pow(Math.abs(Math.sin(axis * (11 + character * 12) + seed)), 13 - feedback * 6);
    let height = 0.022 + n * (0.038 + amount * 0.028) + broad * amount * 0.055;

    if (mode === 'tape') {
      height += Math.pow(n, 1.6) * amount * 0.045;
      spire *= 0.22;
    } else if (mode === 'bbd') {
      height += spire * amount * 0.055;
      height = Math.round(height * 34) / 34;
    } else if (mode === 'pingpong') {
      const side = p < 0 ? 0.65 + feedback * 0.5 : 1.1 - feedback * 0.18;
      height = height * side + spire * amount * 0.055;
    } else if (mode === 'diffuse') {
      height = 0.020 + Math.pow(n, 1.25) * (0.07 + amount * 0.055);
      spire *= 0.12;
    } else if (mode === 'scatter') {
      spire = Math.pow(Math.abs(Math.sin(axis * (17 + character * 15) + seed * 1.3)), 18 - feedback * 8);
      height += spire * amount * (0.09 + character * 0.06);
    } else if (mode === 'constellation') {
      spire = Math.pow(Math.abs(Math.sin(axis * 13.7 + seed)), 10);
      height += spire * amount * 0.075;
    } else {
      height += spire * amount * 0.042;
    }

    return horizon - height * (0.72 + amount * 0.48);
  }

  private cloudField(
    u: number,
    v: number,
    horizon: number,
    module: ModuleState | undefined,
    seed: number,
    time: number
  ): { density: number; cool: number; warm: number } {
    const amount = visualAmount(module);
    if (amount <= 0 || v >= horizon) return { density: 0, cool: 0, warm: 0 };

    const mode = module?.algorithm ?? 'hall';
    const size = valueOf(module, 'size', 0.52);
    const diffusion = valueOf(module, 'diffusion', 0.74);
    const motion = valueOf(module, 'motion', 0.18);
    const color = valueOf(module, 'color', 0.42);
    const p = u * 2 - 1;
    const drift = time * (0.002 + motion * 0.005);
    const base = fbm(p * (0.75 + (1 - size) * 0.55) + seed * 0.09 + drift, v * (1.35 + diffusion * 0.6) - drift * 0.7);
    const detail = noise(p * 2.6 + seed * 0.17 - drift * 1.4, v * 3.1 + seed * 0.04);
    const altitude = clamp01((horizon - v) / Math.max(0.18, horizon));
    let density = smoothstep(0.46 - diffusion * 0.10, 0.76, base + detail * 0.12) * amount;
    let cool = 0.55 + color * 0.45;
    let warm = 0.30 + (1 - color) * 0.35;

    if (mode === 'room') {
      density *= smoothstep(0.42, 0.03, horizon - v) * 0.82;
    } else if (mode === 'plate') {
      const bands = Math.pow(clamp01(Math.sin(v * 39 + base * 4 + time * 0.035) * 0.5 + 0.5), 5);
      density = bands * amount * (0.25 + diffusion * 0.5);
    } else if (mode === 'cinema') {
      const shaft = Math.pow(clamp01(Math.cos(p * 8.5 + seed) * 0.5 + 0.5), 7);
      density = clamp01(density * 1.1 + shaft * altitude * amount * 0.38);
      warm += 0.22;
    } else if (mode === 'cloud') {
      density = smoothstep(0.40, 0.68, base) * amount * (0.72 + diffusion * 0.38);
    } else if (mode === 'freeze') {
      density = Math.pow(smoothstep(0.50, 0.74, base + detail * 0.18), 1.8) * amount * 0.72;
      cool = 1;
      warm = 0.08;
    } else if (mode === 'celestial') {
      density *= 0.62;
      cool = 0.72;
      warm = 0.72;
    } else if (mode === 'aurora') {
      const ribbon = Math.pow(clamp01(Math.sin(p * 6.4 + v * 14 + time * (0.08 + motion * 0.12)) * 0.5 + 0.5), 10);
      density = ribbon * amount * (0.28 + diffusion * 0.34);
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

    return { density: clamp01(density), cool: clamp01(cool), warm: clamp01(warm) };
  }

  private waterWave(
    u: number,
    v: number,
    module: ModuleState | undefined,
    heroX: number,
    horizon: number,
    seed: number,
    time: number
  ): number {
    const amount = visualAmount(module);
    if (amount <= 0 || v <= horizon) return 0;

    const mode = module?.driftMode ?? 'chorus';
    const rate = valueOf(module, 'rate', 0.094);
    const depth = valueOf(module, 'depth', 0.275);
    const spread = valueOf(module, 'spread', 0.62);
    const motion = valueOf(module, 'motion', 0.32);
    const x = u - 0.5;
    const y = v - horizon;
    const speed = 0.12 + rate * 0.62 + motion * 0.16;
    let wave = 0;

    if (mode === 'ensemble') {
      wave = Math.sin(x * 42 + time * speed) + Math.sin(x * 61 - time * speed * 0.72 + seed) + Math.sin(y * 70 + x * 19 + time * 0.11);
      wave /= 3;
    } else if (mode === 'dimension') {
      wave = Math.sin((Math.abs(x) * (38 + spread * 22) + y * 16) - time * speed) * (0.65 + spread * 0.35);
    } else if (mode === 'vibrato') {
      wave = Math.sin(x * (70 + depth * 45) + time * speed * 1.8) * 0.75;
    } else if (mode === 'rotary') {
      const d = Math.hypot(x * 1.25, (v - (horizon + 0.25)) * 1.9);
      wave = Math.sin(d * (42 + spread * 8) - time * speed * 1.3);
    } else if (mode === 'doppler') {
      const source = heroX + Math.sin(time * speed * 0.55) * (0.08 + spread * 0.08);
      const d = Math.hypot((u - source) * 1.25, y * 1.8);
      wave = Math.sin(d * 54 - time * speed * 1.8);
    } else if (mode === 'liquid') {
      const n = fbm(x * (3.2 + depth * 2.5) + seed * 0.1 + time * speed * 0.08, y * 6.4 - time * speed * 0.12);
      wave = (n - 0.5) * 2;
    } else if (mode === 'orbit') {
      const d = Math.hypot((u - heroX) * (1.4 + spread * 0.3), (v - (horizon + 0.30)) * 2.2);
      wave = Math.sin(d * 46 - time * speed) * 0.7 + Math.cos((u - heroX) * 34 + time * speed * 0.6) * 0.3;
    } else {
      wave = Math.sin(x * (46 + spread * 12) + time * speed) * 0.62 + Math.sin(x * 27 - time * speed * 0.68 + y * 28) * 0.38;
    }

    return wave * amount * (0.45 + depth * 0.55);
  }

  private renderRaster(time: number, layers: ArtLayers, patch: PatchField, scene: SceneState) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const geometry = this.worldGeometry(layers, patch, scene);
    const { horizon, heroX, heroY } = geometry;
    const seedA = scene.a.seed;
    const seedB = scene.b.seed;
    const seed = lerp(seedA, seedB, scene.worldMix);
    const symmetry = lerp(scene.a.symmetry, scene.b.symmetry, scene.worldMix);
    const warmBias = clamp01(0.52 + (this.x - 0.5) * 0.24 + geometry.ember * 0.10);

    const mountainA = new Float32Array(RASTER_W);
    const mountainB = new Float32Array(RASTER_W);
    for (let px = 0; px < RASTER_W; px += 1) {
      const u = px / (RASTER_W - 1);
      mountainA[px] = this.mountainSurface(u, horizon, layers.halo, seedA, time, scene.a.symmetry);
      mountainB[px] = this.mountainSurface(u, horizon, layers.halo, seedB, time, scene.b.symmetry);
    }

    for (let py = 0; py < RASTER_H; py += 1) {
      const v = py / (RASTER_H - 1);
      for (let px = 0; px < RASTER_W; px += 1) {
        const u = px / (RASTER_W - 1);
        const p = u * 2 - 1;
        const field = lerp(
          fbm(p * 0.86 + seedA * 0.08 + time * 0.0035, v * 1.22 - time * 0.0025),
          fbm(p * 0.86 + seedB * 0.08 + time * 0.0035, v * 1.22 - time * 0.0025),
          scene.worldMix
        );
        const detail = noise(p * 2.65 + seed * 0.13 - time * 0.006, v * 2.4 + seed * 0.04);
        const surface = lerp(mountainA[px], mountainB[px], scene.worldMix);
        const mountainMask = smoothstep(surface - 0.008, surface + 0.006, v) * (1 - smoothstep(horizon - 0.002, horizon + 0.010, v));

        let r = 3;
        let g = 6;
        let b = 12;

        if (v < horizon) {
          const altitude = clamp01((horizon - v) / Math.max(0.20, horizon));
          const horizonGlow = Math.exp(-Math.abs(v - horizon) * 24);
          r += 5 + altitude * 9 + field * 10 + horizonGlow * (20 + warmBias * 20);
          g += 9 + altitude * 16 + detail * 12 + horizonGlow * 25;
          b += 18 + altitude * 30 + field * 17 + detail * 12 + horizonGlow * 31;

          const cloud = this.cloudField(u, v, horizon, layers.atmos, seed, time);
          if (cloud.density > 0) {
            r += cloud.density * (10 + cloud.warm * 38);
            g += cloud.density * (18 + cloud.cool * 34);
            b += cloud.density * (28 + cloud.cool * 40 + cloud.warm * 10);
          }

          if (layers.atmos?.algorithm === 'abyss' && geometry.atmos > 0) {
            const abyss = cloud.density * geometry.atmos * 0.44;
            r *= 1 - abyss;
            g *= 1 - abyss * 0.82;
            b *= 1 - abyss * 0.56;
          }
        } else {
          const depth = clamp01((v - horizon) / Math.max(0.001, 1 - horizon));
          const wave = this.waterWave(u, v, layers.drift, heroX, horizon, seed, time);
          const waterAmount = geometry.drift;
          const reflectionWidth = 6.8 - waterAmount * 2.8 - valueOf(layers.drift, 'spread', 0.62) * 0.8;
          const reflection = Math.exp(-Math.abs(u - heroX + wave * 0.012) * reflectionWidth) * (1 - depth * 0.58);
          const waterNoise = noise(p * (3.2 + waterAmount * 1.3) + time * 0.010, v * 8.5 - time * 0.022);

          r += 3 + depth * 5 + reflection * waterAmount * (25 + warmBias * 36);
          g += 8 + depth * 9 + reflection * waterAmount * 38;
          b += 15 + depth * 17 + reflection * waterAmount * 55;

          const ripple = Math.pow(clamp01(wave * 0.5 + 0.5), 8) * waterAmount * smoothstep(horizon + 0.02, 0.96, v);
          r += ripple * (8 + warmBias * 13);
          g += ripple * 17;
          b += ripple * 27;

          const grain = (waterNoise - 0.5) * waterAmount * 5.5;
          r += grain * 0.55;
          g += grain * 0.72;
          b += grain;

          if (waterAmount <= 0.01) {
            r *= 0.72;
            g *= 0.76;
            b *= 0.82;
          }
        }

        if (mountainMask > 0) {
          const haloAmount = geometry.halo;
          const rim = 1 - smoothstep(0.002, 0.018, Math.abs(v - surface));
          r = lerp(r, 3 + rim * (10 + haloAmount * 17), mountainMask * 0.95);
          g = lerp(g, 7 + rim * (15 + haloAmount * 20), mountainMask * 0.97);
          b = lerp(b, 10 + rim * (20 + haloAmount * 24), mountainMask * 0.96);
        }

        if (geometry.drift > 0.01 && v > horizon) {
          const reflectedV = horizon - (v - horizon) + this.waterWave(u, v, layers.drift, heroX, horizon, seed, time) * 0.012;
          const reflectedMountain = smoothstep(surface - 0.008, surface + 0.006, reflectedV) * (1 - smoothstep(horizon, horizon + 0.01, reflectedV));
          const reflectionFade = geometry.drift * (1 - clamp01((v - horizon) * 1.5));
          const amount = reflectedMountain * reflectionFade * (0.35 + detail * 0.30);
          r = lerp(r, 8 + warmBias * 11, amount);
          g = lerp(g, 17, amount);
          b = lerp(b, 27 + geometry.drift * 11, amount);
        }

        if (geometry.artifact > 0.01) {
          const mode = layers.artifact?.mediaMode ?? 'cassette';
          const wear = valueOf(layers.artifact, 'wear', 0.162) * geometry.artifact;
          const wow = valueOf(layers.artifact, 'wow', 0.16) * geometry.artifact;
          const noiseAmount = valueOf(layers.artifact, 'noise', 0.1) * geometry.artifact;
          const tone = valueOf(layers.artifact, 'tone', 0.62);
          const dust = (hash(px + Math.floor(time * 1.5), py + seed) - 0.5) * noiseAmount * 7;

          if (mode === 'cassette') {
            r += wear * (4 + tone * 6) + dust;
            g += wear * 1.5 + dust * 0.65;
            b -= wear * 2.4 - dust * 0.45;
          } else if (mode === 'reel') {
            const flutter = Math.sin(v * 17 + time * 0.7) * wow * 3.0;
            r += flutter + dust * 0.5;
            g += flutter * 0.72 + dust * 0.45;
            b += flutter * 0.48 + dust * 0.35;
          } else if (mode === 'vinyl') {
            r += dust * 0.72;
            g += dust * 0.66;
            b += dust * 0.58;
          } else if (mode === 'vhs') {
            const seam = Math.sin(py * 0.54 + time * 4.2 + p * 0.5) * wear;
            r += seam * 5 + dust * 0.42;
            g += seam * 0.7;
            b -= seam * 3.4;
          } else if (mode === 'radio') {
            const carrier = Math.sin(v * 93 + time * 7.1) * noiseAmount * 4.5;
            r += carrier;
            g += carrier;
            b += carrier * 0.82;
          } else if (mode === 'wax') {
            const haze = wear * 0.12;
            const mono = (r + g + b) / 3;
            r = lerp(r, mono + 5, haze);
            g = lerp(g, mono + 2, haze);
            b = lerp(b, mono, haze);
          } else if (mode === 'broken') {
            const tear = Math.sin(py * 0.78 + time * 8.4 + seed) * wear;
            r += tear * 8 + dust;
            g -= tear * 2;
            b -= tear * 5;
          } else {
            const fade = wear * 0.11;
            r = lerp(r, 33, fade);
            g = lerp(g, 30, fade);
            b = lerp(b, 24, fade);
            r += dust * 0.5;
            g += dust * 0.45;
            b += dust * 0.35;
          }
        }

        const horizonLine = Math.exp(-Math.abs(v - horizon) * 40);
        r += horizonLine * (5 + warmBias * 14);
        g += horizonLine * 10;
        b += horizonLine * 12;

        const index = (py * RASTER_W + px) * 4;
        data[index] = Math.max(0, Math.min(255, r));
        data[index + 1] = Math.max(0, Math.min(255, g));
        data[index + 2] = Math.max(0, Math.min(255, b));
        data[index + 3] = 255;
      }
    }

    this.rasterCtx.putImageData(this.imageData, 0, 0);
  }

  private drawEmberSun(
    ctx: CanvasRenderingContext2D,
    time: number,
    module: ModuleState | undefined,
    geometry: ReturnType<DreamFieldEngine['worldGeometry']>,
    crest: number
  ) {
    const w = this.width;
    const h = this.height;
    const minDim = Math.min(w, h);
    const cx = geometry.heroX * w;
    const cy = geometry.heroY * h;
    const amount = geometry.ember;
    const mode = module?.emberMode ?? 'velvet';
    const drive = valueOf(module, 'drive', 0.14);
    const heat = valueOf(module, 'heat', 0.18);
    const character = valueOf(module, 'character', 0.22);
    const core = minDim * (0.025 + amount * 0.023 + crest * 0.006);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (amount > 0) {
      const glow = ctx.createRadialGradient(cx, cy, core * 0.55, cx, cy, core * (4.1 + heat * 1.4));
      glow.addColorStop(0, `rgba(255,215,151,${0.08 + amount * 0.10})`);
      glow.addColorStop(0.28, `rgba(249,148,79,${0.07 + amount * 0.075})`);
      glow.addColorStop(0.58, `rgba(221,78,176,${0.035 + character * 0.04})`);
      glow.addColorStop(0.83, `rgba(78,213,217,${0.018 + amount * 0.022})`);
      glow.addColorStop(1, 'rgba(78,213,217,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, core * (4.1 + heat * 1.4), 0, Math.PI * 2);
      ctx.fill();

      const ringCount = mode === 'console' ? 6 : mode === 'furnace' ? 5 : mode === 'exciter' ? 4 : mode === 'broken' ? 4 : 3;
      for (let i = 0; i < ringCount; i += 1) {
        const p = i / Math.max(1, ringCount - 1);
        const radius = core * (1.20 + p * (2.5 + drive * 1.1));
        const wobble = mode === 'furnace' ? Math.sin(time * 0.12 + i * 1.8) * core * 0.12 * heat : 0;
        const alpha = (0.055 + amount * 0.08) * (1 - p * 0.42);
        ctx.strokeStyle = i % 2
          ? `rgba(222,84,181,${alpha * 0.72})`
          : `rgba(250,169,95,${alpha})`;
        ctx.lineWidth = Math.max(1, minDim * (0.0014 + (1 - p) * 0.0006));
        ctx.beginPath();
        if (mode === 'transformer') {
          ctx.ellipse(cx, cy, radius * 1.24, radius * 0.72, (i % 2 ? -1 : 1) * 0.18, Math.PI * 0.06, Math.PI * 1.94);
        } else if (mode === 'broken') {
          const start = time * 0.025 + i * 1.3;
          ctx.arc(cx, cy, radius + wobble, start, start + Math.PI * (0.72 + p * 0.32));
        } else {
          ctx.arc(cx, cy, radius + wobble, 0, Math.PI * 2);
        }
        ctx.stroke();
      }

      if (mode === 'tube') {
        for (let i = 0; i < 3; i += 1) {
          const radius = core * (1.35 + i * 0.64);
          ctx.strokeStyle = `rgba(255,193,116,${0.045 + heat * 0.045})`;
          ctx.lineWidth = Math.max(1, minDim * 0.0011);
          ctx.beginPath();
          ctx.arc(cx, cy, radius, Math.PI * 0.12, Math.PI * 0.88);
          ctx.stroke();
        }
      } else if (mode === 'exciter') {
        const rays = 10;
        ctx.strokeStyle = `rgba(244,226,186,${0.035 + amount * 0.045})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < rays; i += 1) {
          const angle = i / rays * Math.PI * 2 + time * 0.006;
          const inner = core * 1.25;
          const outer = core * (2.1 + character * 1.7 + (i % 3) * 0.18);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
          ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(1,3,7,0.985)';
    ctx.beginPath();
    ctx.arc(cx, cy, core * 0.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = amount > 0 ? `rgba(246,205,146,${0.10 + amount * 0.09})` : 'rgba(116,151,150,0.07)';
    ctx.lineWidth = Math.max(1, minDim * 0.0015);
    ctx.stroke();
    ctx.restore();
  }

  private drawHaloAccents(
    ctx: CanvasRenderingContext2D,
    time: number,
    module: ModuleState | undefined,
    geometry: ReturnType<DreamFieldEngine['worldGeometry']>
  ) {
    if (!module || geometry.halo <= 0 || module.delayAlgorithm !== 'constellation') return;
    const w = this.width;
    const h = this.height;
    const horizon = geometry.horizon * h;
    const amount = geometry.halo;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 9; i += 1) {
      const u = 0.08 + i / 8 * 0.84;
      const x = u * w;
      const surface = this.mountainSurface(u, geometry.horizon, module, 9.7, time, 0.82) * h;
      const y = Math.min(horizon - 3, surface - 3 - (i % 3) * 2);
      const radius = 0.7 + (i % 3) * 0.35;
      ctx.fillStyle = i % 2 ? `rgba(82,216,220,${0.10 + amount * 0.10})` : `rgba(244,181,108,${0.10 + amount * 0.10})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawAtmosAccents(
    ctx: CanvasRenderingContext2D,
    time: number,
    module: ModuleState | undefined,
    geometry: ReturnType<DreamFieldEngine['worldGeometry']>
  ) {
    if (!module || geometry.atmos <= 0) return;
    const mode = module.algorithm ?? 'hall';
    if (mode !== 'aurora' && mode !== 'celestial') return;
    const w = this.width;
    const h = this.height;
    const horizon = geometry.horizon * h;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (mode === 'aurora') {
      for (let i = 0; i < 4; i += 1) {
        const gradient = ctx.createLinearGradient(w * 0.12, 0, w * 0.88, 0);
        gradient.addColorStop(0, 'rgba(77,214,218,0)');
        gradient.addColorStop(0.38, `rgba(77,214,218,${0.025 + geometry.atmos * 0.028})`);
        gradient.addColorStop(0.62, `rgba(218,83,184,${0.020 + geometry.atmos * 0.024})`);
        gradient.addColorStop(1, 'rgba(218,83,184,0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let step = 0; step <= 30; step += 1) {
          const p = step / 30;
          const x = w * (0.08 + p * 0.84);
          const y = horizon * (0.18 + i * 0.10) + Math.sin(p * Math.PI * 2 + time * 0.08 + i) * h * 0.025;
          step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      const cx = geometry.heroX * w;
      const cy = geometry.heroY * h;
      const radius = Math.min(w, h) * (0.18 + geometry.atmos * 0.08);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glow.addColorStop(0, `rgba(228,239,233,${0.025 + geometry.atmos * 0.035})`);
      glow.addColorStop(0.45, `rgba(88,151,255,${0.012 + geometry.atmos * 0.018})`);
      glow.addColorStop(1, 'rgba(88,151,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawDriftAccents(
    ctx: CanvasRenderingContext2D,
    time: number,
    module: ModuleState | undefined,
    geometry: ReturnType<DreamFieldEngine['worldGeometry']>
  ) {
    if (!module || geometry.drift <= 0) return;
    const w = this.width;
    const h = this.height;
    const horizon = geometry.horizon * h;
    const cx = geometry.heroX * w;
    const mode = module.driftMode ?? 'chorus';
    const spread = valueOf(module, 'spread', 0.62);
    const motion = valueOf(module, 'motion', 0.32);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const count = mode === 'ensemble' ? 7 : mode === 'liquid' ? 5 : 4;
    for (let i = 0; i < count; i += 1) {
      const p = (i + 1) / (count + 1);
      const y = lerp(horizon + h * 0.06, h * 0.91, p);
      const half = w * (0.08 + p * (0.24 + spread * 0.16));
      const wobble = Math.sin(time * (0.035 + motion * 0.05) + i * 1.2) * h * 0.004;
      ctx.strokeStyle = i % 2 ? `rgba(77,214,218,${0.022 + geometry.drift * 0.025})` : `rgba(218,83,184,${0.016 + geometry.drift * 0.020})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (mode === 'rotary' || mode === 'orbit') {
        ctx.ellipse(cx, y, half, h * (0.012 + p * 0.025), (this.x - 0.5) * 0.05, Math.PI, Math.PI * 2);
      } else {
        ctx.moveTo(cx - half, y + wobble);
        ctx.quadraticCurveTo(cx, y - h * (0.006 + geometry.drift * 0.006), cx + half, y - wobble);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGrainWeather(
    ctx: CanvasRenderingContext2D,
    time: number,
    module: ModuleState | undefined,
    geometry: ReturnType<DreamFieldEngine['worldGeometry']>
  ) {
    if (!module || geometry.grain <= 0) return;
    const w = this.width;
    const h = this.height;
    const mode = module.grainMode ?? 'reconstruct';
    const density = valueOf(module, 'density', 0.42);
    const chaos = valueOf(module, 'chaos', 0.16);
    const bloom = valueOf(module, 'bloom', 0.36);
    const pitch = valueOf(module, 'pitch', 0.38);
    const count = 10 + Math.round(density * 34 + geometry.grain * 8);
    const speed = 0.035 + density * 0.045 + pitch * 0.025;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const seed = hash(i * 11.31 + 4.7);
      const lateral = hash(i * 17.2 + 2.3);
      let fall = (time * speed * (0.72 + seed * 0.56) + seed) % 1;
      if (mode === 'stutter') fall = Math.floor(fall * 12) / 12;
      const x = lateral * w + Math.sin(time * 0.04 + i) * chaos * w * 0.012;
      const y = -h * 0.08 + fall * h * 1.12;
      const alpha = (0.025 + geometry.grain * 0.035) * (0.55 + seed * 0.45);

      if (mode === 'shatter' || mode === 'ruin') {
        const size = 1.1 + seed * (2.2 + chaos * 2.2);
        ctx.fillStyle = mode === 'ruin'
          ? `rgba(229,132,189,${alpha * 0.76})`
          : `rgba(116,223,221,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size * 0.8, y + size * 0.4);
        ctx.lineTo(x - size * 0.6, y + size);
        ctx.closePath();
        ctx.fill();
      } else {
        const length = mode === 'smear' ? 11 + bloom * 15 : mode === 'prism' ? 5 + bloom * 7 : 4 + density * 7;
        ctx.strokeStyle = mode === 'prism'
          ? (i % 3 === 0 ? `rgba(244,173,99,${alpha})` : i % 2 ? `rgba(220,88,187,${alpha})` : `rgba(86,216,220,${alpha})`)
          : `rgba(196,229,222,${alpha})`;
        ctx.lineWidth = mode === 'smear' ? 1.1 : 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + chaos * 2.8, y + length);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawArtifactFx(
    ctx: CanvasRenderingContext2D,
    time: number,
    module: ModuleState | undefined,
    geometry: ReturnType<DreamFieldEngine['worldGeometry']>
  ) {
    if (!module || geometry.artifact <= 0) return;
    const w = this.width;
    const h = this.height;
    const mode = module.mediaMode ?? 'cassette';
    const wear = valueOf(module, 'wear', 0.162) * geometry.artifact;
    const wow = valueOf(module, 'wow', 0.16) * geometry.artifact;
    const noiseAmount = valueOf(module, 'noise', 0.1) * geometry.artifact;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (mode === 'vhs' || mode === 'broken') {
      const lines = mode === 'broken' ? 4 : 2;
      for (let i = 0; i < lines; i += 1) {
        const y = (hash(Math.floor(time * (0.45 + i * 0.12)) + i * 9.2) * 0.78 + 0.1) * h;
        const shift = Math.sin(time * 1.3 + i) * (1 + wear * (mode === 'broken' ? 8 : 3));
        ctx.strokeStyle = i % 2 ? `rgba(83,216,220,${0.018 + wear * 0.045})` : `rgba(225,92,188,${0.016 + wear * 0.040})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + shift);
        ctx.stroke();
      }
    } else if (mode === 'vinyl') {
      for (let i = 0; i < 5; i += 1) {
        const x = hash(i * 7.7 + Math.floor(time * 0.15)) * w;
        const y = hash(i * 5.1 + 3.2) * h;
        ctx.fillStyle = `rgba(236,220,181,${0.018 + noiseAmount * 0.055})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.6 + (i % 2) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mode === 'radio') {
      const y = ((time * 0.12) % 1) * h;
      const gradient = ctx.createLinearGradient(0, y - 12, 0, y + 12);
      gradient.addColorStop(0, 'rgba(85,216,220,0)');
      gradient.addColorStop(0.5, `rgba(218,232,220,${0.012 + noiseAmount * 0.035})`);
      gradient.addColorStop(1, 'rgba(85,216,220,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y - 12, w, 24);
    } else if (mode === 'reel' || mode === 'cassette') {
      const x = w * (0.5 + Math.sin(time * 0.045) * wow * 0.03);
      const sheen = ctx.createLinearGradient(x - w * 0.22, 0, x + w * 0.22, 0);
      sheen.addColorStop(0, 'rgba(245,171,100,0)');
      sheen.addColorStop(0.5, `rgba(245,171,100,${0.010 + wear * 0.024})`);
      sheen.addColorStop(1, 'rgba(245,171,100,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'archive') {
      ctx.fillStyle = `rgba(235,205,153,${0.008 + wear * 0.020})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}
