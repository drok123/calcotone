import type { ModuleState, XYAssignment } from '../../ui/types';

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
};

type Energy = {
  ember: number;
  drift: number;
  halo: number;
  atmos: number;
  grain: number;
  artifact: number;
};

type PatchField = {
  total: number;
  xStrength: number;
  yStrength: number;
};

type WorldProfile = {
  seed: number;
  horizon: number;
  heroX: number;
  heroLift: number;
  portal: number;
  arch: number;
  archLift: number;
  symmetry: number;
  mirror: number;
  terrain: number;
  cavern: number;
  basin: number;
  orbit: number;
  warm: number;
};

type SceneState = {
  a: WorldProfile;
  b: WorldProfile;
  transition: number;
  heroMix: number;
  worldMix: number;
  foregroundMix: number;
  crest: number;
};

const RASTER_W = 112;
const RASTER_H = 64;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;
const SCENE_SECONDS = 19;
const ENERGY_KEYS: (keyof Energy)[] = ['ember', 'drift', 'halo', 'atmos', 'grain', 'artifact'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const followAmount = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
const hash = (x: number, y = 0) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
  module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

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
  return noise(x, y) * 0.68 + noise(x * 2.03 + 7.1, y * 2.03 - 3.7) * 0.32;
}

function profileFor(epoch: number): WorldProfile {
  const archetype = ((epoch % 4) + 4) % 4;
  const h = (channel: number) => hash(epoch * 17.17 + channel * 9.31, channel * 3.7);
  const sign = h(8) > 0.5 ? 1 : -1;

  if (archetype === 0) {
    return {
      seed: epoch * 13.71 + 1.9,
      horizon: 0.57 + (h(0) - 0.5) * 0.035,
      heroX: sign * (0.055 + h(1) * 0.045),
      heroLift: 0.20 + h(2) * 0.055,
      portal: 0.083 + h(3) * 0.035,
      arch: 0.48 + h(4) * 0.06,
      archLift: 0.035 + h(5) * 0.045,
      symmetry: 0.18 + h(6) * 0.24,
      mirror: 0.20 + h(7) * 0.20,
      terrain: 0.58 + h(9) * 0.24,
      cavern: 0.58 + h(10) * 0.22,
      basin: 0.24 + h(11) * 0.22,
      orbit: 0.68 + h(12) * 0.25,
      warm: 0.50 + h(13) * 0.20,
    };
  }

  if (archetype === 1) {
    return {
      seed: epoch * 13.71 + 4.2,
      horizon: 0.585 + (h(0) - 0.5) * 0.025,
      heroX: (h(1) - 0.5) * 0.018,
      heroLift: 0.125 + h(2) * 0.035,
      portal: 0.068 + h(3) * 0.025,
      arch: 0.43 + h(4) * 0.05,
      archLift: 0.055 + h(5) * 0.035,
      symmetry: 0.82 + h(6) * 0.16,
      mirror: 0.55 + h(7) * 0.22,
      terrain: 0.72 + h(9) * 0.20,
      cavern: 0.78 + h(10) * 0.18,
      basin: 0.68 + h(11) * 0.22,
      orbit: 0.28 + h(12) * 0.30,
      warm: 0.58 + h(13) * 0.18,
    };
  }

  if (archetype === 2) {
    return {
      seed: epoch * 13.71 + 8.6,
      horizon: 0.505 + (h(0) - 0.5) * 0.026,
      heroX: (h(1) - 0.5) * 0.025,
      heroLift: 0.035 + h(2) * 0.025,
      portal: 0.045 + h(3) * 0.020,
      arch: 0.57 + h(4) * 0.07,
      archLift: 0.018 + h(5) * 0.025,
      symmetry: 0.72 + h(6) * 0.22,
      mirror: 0.68 + h(7) * 0.24,
      terrain: 0.42 + h(9) * 0.18,
      cavern: 0.22 + h(10) * 0.20,
      basin: 0.82 + h(11) * 0.16,
      orbit: 0.20 + h(12) * 0.24,
      warm: 0.52 + h(13) * 0.18,
    };
  }

  return {
    seed: epoch * 13.71 + 11.4,
    horizon: 0.515 + (h(0) - 0.5) * 0.025,
    heroX: (h(1) - 0.5) * 0.016,
    heroLift: 0.15 + h(2) * 0.035,
    portal: 0.048 + h(3) * 0.018,
    arch: 0.54 + h(4) * 0.055,
    archLift: 0.045 + h(5) * 0.035,
    symmetry: 0.90 + h(6) * 0.10,
    mirror: 0.88 + h(7) * 0.12,
    terrain: 0.62 + h(9) * 0.20,
    cavern: 0.44 + h(10) * 0.20,
    basin: 0.58 + h(11) * 0.20,
    orbit: 0.48 + h(12) * 0.24,
    warm: 0.66 + h(13) * 0.18,
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
  private energyState: Energy = {
    ember: 0,
    drift: 0,
    halo: 0,
    atmos: 0,
    grain: 0,
    artifact: 0,
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
    const dt = this.lastTime > 0 ? frame.time - this.lastTime : 1 / 60;
    this.lastTime = frame.time;

    this.x = lerp(this.x, clamp01(frame.x), followAmount(frame.dragging ? 20 : 5, dt));
    this.y = lerp(this.y, clamp01(frame.y), followAmount(frame.dragging ? 20 : 5, dt));
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, followAmount(frame.dragging ? 14 : 3.6, dt));

    const targetEnergy = this.energy(frame.modules);
    const energyFollow = followAmount(frame.dragging ? 10 : 3.4, dt);
    for (const key of ENERGY_KEYS) {
      this.energyState[key] = lerp(this.energyState[key], targetEnergy[key], energyFollow);
    }

    const patch = this.patchField(frame.assignments);
    const scene = this.sceneState(frame.time);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderRaster(frame.time, this.energyState, patch, scene);
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

    this.drawAccents(ctx, frame.time, this.energyState, patch, scene);
  }

  private energy(modules: ModuleState[]): Energy {
    const active = modules.filter((module) => module.enabled && module.available);
    const byId = (id: string) => active.find((module) => module.id === id);
    return {
      ember: valueOf(byId('saturation'), 'mix', 0),
      drift: valueOf(byId('chorus'), 'mix', 0),
      halo: valueOf(byId('delay'), 'mix', 0),
      atmos: valueOf(byId('reverb'), 'mix', 0),
      grain: valueOf(byId('bitcrusher'), 'mix', 0),
      artifact: valueOf(byId('media'), 'mix', 0),
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
    const transition = smoothstep(0.69, 1, local);
    const heroMix = smoothstep(0.00, 0.54, transition);
    const worldMix = smoothstep(0.18, 0.84, transition);
    const foregroundMix = smoothstep(0.50, 1.00, transition);
    const crest = Math.pow(Math.sin(transition * Math.PI), 1.35);
    return {
      a: profileFor(epoch),
      b: profileFor(epoch + 1),
      transition,
      heroMix,
      worldMix,
      foregroundMix,
      crest,
    };
  }

  private terrainSurface(u: number, horizon: number, profile: WorldProfile, time: number): number {
    const p = u * 2 - 1;
    const q = Math.abs(p);
    const seed = profile.seed;
    const asymmetric = fbm(p * 1.32 + seed * 0.13, seed * 0.07 + time * 0.0022);
    const mirrored = fbm(q * 1.44 + seed * 0.13, seed * 0.07 + time * 0.0022);
    const body = lerp(asymmetric, mirrored, profile.symmetry);
    const spirePhase = lerp(p, q, profile.symmetry) * (13.0 + hash(seed, 5.1) * 7.0) + seed;
    const spires = Math.pow(Math.abs(Math.sin(spirePhase)), 14 - profile.terrain * 5);
    const broad = Math.pow(Math.abs(Math.sin(lerp(p, q, profile.symmetry) * 4.1 + seed * 0.37)), 3.4);
    const corridor = Math.pow(q, 1.75) * Math.max(0, profile.cavern - 0.28);
    const height =
      0.018 +
      body * (0.032 + profile.terrain * 0.030) +
      spires * (0.018 + profile.terrain * 0.078) +
      broad * profile.terrain * 0.038 +
      corridor * 0.082;
    return horizon - height;
  }

  private renderRaster(time: number, e: Energy, patch: PatchField, scene: SceneState) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const xSteer = this.x - 0.5;
    const heroMix = scene.heroMix;
    const worldMix = scene.worldMix;
    const fgMix = scene.foregroundMix;
    const a = scene.a;
    const b = scene.b;

    const horizonBase = lerp(a.horizon, b.horizon, worldMix);
    const horizon = horizonBase + (0.5 - this.y) * (0.045 + patch.yStrength * 0.022);
    const heroX = 0.5 + lerp(a.heroX, b.heroX, heroMix) + xSteer * (0.14 + patch.xStrength * 0.06);
    const heroLift = lerp(a.heroLift, b.heroLift, heroMix);
    const heroY = horizon - heroLift - (this.y - 0.5) * 0.018;
    const portalBase = lerp(a.portal, b.portal, heroMix);
    const portalRadius = portalBase * (1 + scene.crest * 0.72 + this.gesture * 0.08 + e.halo * 0.08);
    const archRadius = lerp(a.arch, b.arch, heroMix) * (1 + scene.crest * 0.18 + e.halo * 0.045);
    const archY = heroY + lerp(a.archLift, b.archLift, heroMix);
    const mirror = clamp01(lerp(a.mirror, b.mirror, worldMix) + e.drift * 0.12 + patch.yStrength * 0.06);
    const cavern = lerp(a.cavern, b.cavern, fgMix);
    const basin = clamp01(lerp(a.basin, b.basin, fgMix) + (1 - this.y) * 0.07 + patch.yStrength * 0.06);
    const warm = clamp01(lerp(a.warm, b.warm, worldMix) + xSteer * 0.20 + e.ember * 0.14);
    const patchDrive = clamp01(patch.total * 0.04 + (patch.xStrength + patch.yStrength) * 0.24);

    const surfaceA = new Float32Array(RASTER_W);
    const surfaceB = new Float32Array(RASTER_W);
    for (let px = 0; px < RASTER_W; px += 1) {
      const u = px / (RASTER_W - 1);
      surfaceA[px] = this.terrainSurface(u, horizon, a, time);
      surfaceB[px] = this.terrainSurface(u, horizon, b, time);
    }

    for (let py = 0; py < RASTER_H; py += 1) {
      const v = py / (RASTER_H - 1);
      for (let px = 0; px < RASTER_W; px += 1) {
        const u = px / (RASTER_W - 1);
        const p = u * 2 - 1;
        const dx = (u - heroX) * aspect;
        const dy = v - heroY;
        const seedA = a.seed;
        const seedB = b.seed;
        const fieldA = fbm(p * 0.82 + seedA * 0.08 + time * 0.006, v * 1.18 - time * 0.004);
        const fieldB = fbm(p * 0.82 + seedB * 0.08 + time * 0.006, v * 1.18 - time * 0.004);
        const field = lerp(fieldA, fieldB, worldMix);
        const detailA = noise(p * 2.55 + seedA * 0.13 - time * 0.008, v * 2.15 + seedA * 0.04);
        const detailB = noise(p * 2.55 + seedB * 0.13 - time * 0.008, v * 2.15 + seedB * 0.04);
        const detail = lerp(detailA, detailB, worldMix);
        const surface = lerp(surfaceA[px], surfaceB[px], worldMix);
        const aboveWaterTerrain = smoothstep(surface - 0.010, surface + 0.006, v) * (1 - smoothstep(horizon - 0.002, horizon + 0.008, v));
        const reflectedV = horizon - (v - horizon);
        const reflectedTerrain = v > horizon
          ? smoothstep(surface - 0.010, surface + 0.006, reflectedV) * (1 - smoothstep(horizon - 0.002, horizon + 0.008, reflectedV))
          : 0;

        let r = 3;
        let g = 6;
        let bch = 12;

        if (v < horizon) {
          const altitude = clamp01((horizon - v) / Math.max(0.20, horizon));
          const nebula = smoothstep(0.42, 0.76, field);
          const cyan = smoothstep(0.50, 0.80, detail + field * 0.18);
          const horizonLight = Math.exp(-Math.abs(v - horizon) * (18 - e.atmos * 4));
          r += 7 + altitude * 11 + nebula * (22 + warm * 24) + horizonLight * (26 + warm * 25);
          g += 10 + altitude * 18 + cyan * 30 + horizonLight * (30 + (1 - warm) * 20);
          bch += 21 + altitude * 34 + nebula * 28 + cyan * 26 + horizonLight * 33;
        } else {
          const depth = clamp01((v - horizon) / Math.max(0.001, 1 - horizon));
          const waterNoise = noise(p * (3.2 + e.grain * 0.8) + time * 0.012, v * 9.0 - time * (0.025 + e.drift * 0.045));
          const lightPath = Math.exp(-Math.abs(u - heroX) * (7.0 - mirror * 3.0)) * (1 - depth * 0.55);
          r += 4 + depth * 5 + lightPath * (25 + warm * 40);
          g += 10 + depth * 10 + lightPath * (36 + (1 - warm) * 30);
          bch += 18 + depth * 18 + lightPath * 52;
          const waterGrain = (waterNoise - 0.5) * (4 + e.grain * 10);
          r += waterGrain * 0.55;
          g += waterGrain * 0.70;
          bch += waterGrain;

          const basinY = 0.84 - basin * 0.09;
          const basinDistance = Math.hypot((u - heroX) * (1.30 - basin * 0.25), (v - basinY) * (3.0 - basin * 0.55));
          const ripplePhase = basinDistance * (31 - basin * 7 + e.grain * 4) - time * (0.20 + e.drift * 0.42);
          const ripple = Math.pow(clamp01(Math.cos(ripplePhase) * 0.5 + 0.5), 13) * smoothstep(horizon + 0.02, 0.98, v);
          r += ripple * (8 + warm * 18 + e.ember * 10);
          g += ripple * (16 + (1 - warm) * 20 + e.drift * 10);
          bch += ripple * (28 + e.halo * 14);
        }

        if (aboveWaterTerrain > 0) {
          const rim = 1 - smoothstep(0.002, 0.018 + e.atmos * 0.008, Math.abs(v - surface));
          const terrainLight = rim * (0.12 + e.atmos * 0.10);
          r = lerp(r, 4 + warm * 8 + terrainLight * 28, aboveWaterTerrain * 0.94);
          g = lerp(g, 9 + terrainLight * 30, aboveWaterTerrain * 0.96);
          bch = lerp(bch, 12 + terrainLight * 34, aboveWaterTerrain * 0.95);
        }

        if (reflectedTerrain > 0) {
          const fade = mirror * (1 - clamp01((v - horizon) * 1.65));
          const broken = 0.58 + detail * 0.42;
          const amount = reflectedTerrain * fade * broken * 0.62;
          r = lerp(r, 8 + warm * 18, amount);
          g = lerp(g, 20 + (1 - warm) * 16, amount);
          bch = lerp(bch, 29 + mirror * 18, amount);
        }

        const archDistance = Math.abs(Math.hypot(dx * 0.88, (v - archY) * 1.02) - archRadius);
        const archGlow = 1 - smoothstep(0.006, 0.050 + e.halo * 0.018, archDistance);
        const archGate = 1 - smoothstep(horizon + 0.07, horizon + 0.20, v);
        const archAmount = archGlow * archGate;
        r += archAmount * (27 + warm * 56 + e.ember * 24);
        g += archAmount * (19 + (1 - warm) * 38 + e.halo * 18);
        bch += archAmount * (38 + e.halo * 36);

        const portalDistance = Math.hypot(dx, dy);
        const corona = 1 - smoothstep(0.010, 0.055 + e.halo * 0.018, Math.abs(portalDistance - portalRadius));
        r += corona * (45 + warm * 52 + e.ember * 30 + scene.crest * 16);
        g += corona * (24 + (1 - warm) * 33 + e.halo * 22);
        bch += corona * (42 + e.halo * 38);

        const insidePortal = 1 - smoothstep(portalRadius * 0.72, portalRadius * 0.94, portalDistance);
        if (insidePortal > 0) {
          const innerReveal = clamp01(scene.crest * 1.25 + this.gesture * 0.08 + patchDrive * 0.08);
          let ir = 1.5;
          let ig = 2.0;
          let ib = 4.5;
          if (innerReveal > 0.02) {
            const pu = clamp01((dx / Math.max(0.001, portalRadius) + 1) * 0.5);
            const pv = clamp01((dy / Math.max(0.001, portalRadius) + 1) * 0.5);
            const innerHorizon = 0.53;
            const innerNoise = fbm((pu * 2 - 1) * 1.7 + b.seed * 0.09, pv * 1.4 + b.seed * 0.03);
            if (pv < innerHorizon) {
              const glow = Math.exp(-Math.abs(pv - innerHorizon) * 14);
              ir = 5 + innerNoise * 18 + glow * (28 + warm * 20);
              ig = 8 + innerNoise * 20 + glow * 26;
              ib = 19 + innerNoise * 30 + glow * 32;
            } else {
              const innerRipple = Math.pow(clamp01(Math.cos(Math.hypot(pu - 0.5, (pv - 0.72) * 2.1) * 34 - time * 0.25) * 0.5 + 0.5), 10);
              ir = 3 + innerRipple * (12 + warm * 12);
              ig = 8 + innerRipple * 18;
              ib = 14 + innerRipple * 28;
            }
            const innerTerrain = smoothstep(innerHorizon - (0.04 + innerNoise * 0.13), innerHorizon - (0.02 + innerNoise * 0.06), pv)
              * (1 - smoothstep(innerHorizon, innerHorizon + 0.02, pv));
            if (innerTerrain > 0) {
              ir = lerp(ir, 2, innerTerrain * 0.92);
              ig = lerp(ig, 5, innerTerrain * 0.92);
              ib = lerp(ib, 7, innerTerrain * 0.92);
            }
          }
          const revealMix = insidePortal * innerReveal;
          r = lerp(r * 0.08, ir, revealMix);
          g = lerp(g * 0.07, ig, revealMix);
          bch = lerp(bch * 0.10, ib, revealMix);
        }

        const edge = Math.abs(p);
        const sideNoiseA = fbm(p * 1.7 + a.seed * 0.11, v * 1.6 + a.seed * 0.03 + time * 0.0015);
        const sideNoiseB = fbm(p * 1.7 + b.seed * 0.11, v * 1.6 + b.seed * 0.03 + time * 0.0015);
        const sideNoise = lerp(sideNoiseA, sideNoiseB, fgMix);
        const sideThreshold = 0.79 - cavern * 0.20 + (sideNoise - 0.5) * 0.12 + (0.48 - v) * 0.06;
        const sideMask = smoothstep(sideThreshold, sideThreshold + 0.11, edge) * smoothstep(0.08, 0.64, v);
        const foregroundMask = smoothstep(0.78 - cavern * 0.08, 0.98, v) * smoothstep(0.52, 0.98, edge + sideNoise * 0.16);
        const occlusion = clamp01(sideMask * (0.72 + cavern * 0.22) + foregroundMask * (0.40 + cavern * 0.24));
        if (occlusion > 0) {
          r = lerp(r, 1.5, occlusion);
          g = lerp(g, 4.0, occlusion);
          bch = lerp(bch, 6.0, occlusion);
        }

        const horizonGlow = Math.exp(-Math.abs(v - horizon) * 34);
        r += horizonGlow * (8 + warm * 18);
        g += horizonGlow * 14;
        bch += horizonGlow * 16;

        if (e.grain > 0.01) {
          const texture = (hash(px + Math.floor(time * 2), py + a.seed) - 0.5) * e.grain * 5.5;
          r += texture;
          g += texture * 0.72;
          bch += texture * 0.94;
        }

        if (e.artifact > 0.02) {
          const seam = Math.sin(py * 0.48 + time * 5.5 + p * 0.5) * e.artifact;
          r += seam * 4.2;
          g += seam * 0.9;
          bch -= seam * 2.7;
        }

        const index = (py * RASTER_W + px) * 4;
        data[index] = Math.max(0, Math.min(255, r));
        data[index + 1] = Math.max(0, Math.min(255, g));
        data[index + 2] = Math.max(0, Math.min(255, bch));
        data[index + 3] = 255;
      }
    }

    this.rasterCtx.putImageData(this.imageData, 0, 0);
  }

  private drawAccents(ctx: CanvasRenderingContext2D, time: number, e: Energy, patch: PatchField, scene: SceneState) {
    const w = this.width;
    const h = this.height;
    const minDim = Math.min(w, h);
    const xSteer = this.x - 0.5;
    const horizon = h * (lerp(scene.a.horizon, scene.b.horizon, scene.worldMix) + (0.5 - this.y) * (0.045 + patch.yStrength * 0.022));
    const heroX = w * (0.5 + lerp(scene.a.heroX, scene.b.heroX, scene.heroMix) + xSteer * (0.14 + patch.xStrength * 0.06));
    const heroY = horizon - h * (lerp(scene.a.heroLift, scene.b.heroLift, scene.heroMix) + (this.y - 0.5) * 0.018);
    const portalRadius = minDim * lerp(scene.a.portal, scene.b.portal, scene.heroMix) * (1 + scene.crest * 0.72 + this.gesture * 0.08 + e.halo * 0.08);
    const archRadius = minDim * lerp(scene.a.arch, scene.b.arch, scene.heroMix) * (1 + scene.crest * 0.18 + e.halo * 0.045);
    const archY = heroY + minDim * lerp(scene.a.archLift, scene.b.archLift, scene.heroMix);
    const warm = clamp01(lerp(scene.a.warm, scene.b.warm, scene.worldMix) + xSteer * 0.20 + e.ember * 0.14);
    const orbit = lerp(scene.a.orbit, scene.b.orbit, scene.worldMix);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const archGradient = ctx.createLinearGradient(heroX - archRadius, archY, heroX + archRadius, archY);
    archGradient.addColorStop(0, `rgba(71,216,219,${0.025 + orbit * 0.018})`);
    archGradient.addColorStop(0.46, `rgba(224,91,191,${0.045 + e.halo * 0.025})`);
    archGradient.addColorStop(0.72, `rgba(249,157,91,${0.055 + warm * 0.035 + e.ember * 0.022})`);
    archGradient.addColorStop(1, 'rgba(71,216,219,0.018)');
    ctx.strokeStyle = archGradient;
    ctx.lineWidth = Math.max(1, minDim * 0.0032);
    ctx.beginPath();
    ctx.ellipse(heroX, archY, archRadius * 1.05, archRadius * 0.82, (this.x - 0.5) * 0.025, Math.PI * 1.04, Math.PI * 1.96);
    ctx.stroke();

    if (scene.crest > 0.18) {
      ctx.globalAlpha = scene.crest * 0.34;
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.strokeStyle = `rgba(93,214,218,${0.08 + e.halo * 0.04})`;
      ctx.beginPath();
      ctx.ellipse(heroX, archY, archRadius * 1.18, archRadius * 0.92, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const corona = ctx.createRadialGradient(heroX, heroY, portalRadius * 0.55, heroX, heroY, portalRadius * 1.75);
    corona.addColorStop(0, 'rgba(0,0,0,0)');
    corona.addColorStop(0.42, `rgba(249,153,91,${0.09 + e.ember * 0.06 + scene.crest * 0.04})`);
    corona.addColorStop(0.68, `rgba(218,82,184,${0.06 + e.halo * 0.05})`);
    corona.addColorStop(0.86, `rgba(72,211,218,${0.045 + e.drift * 0.03})`);
    corona.addColorStop(1, 'rgba(72,211,218,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(heroX, heroY, portalRadius * 1.75, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(238,215,174,${0.18 + e.ember * 0.08 + scene.crest * 0.05})`;
    ctx.lineWidth = Math.max(1, minDim * 0.0022);
    ctx.beginPath();
    ctx.arc(heroX, heroY, portalRadius * 0.82, 0, Math.PI * 2);
    ctx.stroke();

    const count = Math.max(2, Math.min(6, 2 + Math.round(orbit * 4 + e.halo)));
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0.5 : i / (count - 1);
      const angle = Math.PI * (1.08 + p * 0.84) + time * (0.002 + i * 0.0004);
      const rr = archRadius * (0.84 + (i % 3) * 0.08);
      const px = heroX + Math.cos(angle) * rr * 1.16;
      const py = archY + Math.sin(angle) * rr * 0.78;
      const pr = minDim * (0.0045 + (i % 3) * 0.0018);
      ctx.fillStyle = i % 2
        ? `rgba(83,216,220,${0.13 + orbit * 0.05})`
        : `rgba(247,155,94,${0.13 + orbit * 0.05})`;
      ctx.beginPath();
      ctx.arc(px, py, pr * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(2,4,7,0.96)';
      ctx.beginPath();
      ctx.arc(px, py, pr * 0.70, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'screen';
    }

    const beamAlpha = 0.025 + lerp(scene.a.mirror, scene.b.mirror, scene.worldMix) * 0.040 + e.drift * 0.018;
    const beam = ctx.createLinearGradient(heroX, horizon, heroX, h * 0.93);
    beam.addColorStop(0, `rgba(248,196,133,${beamAlpha * 0.75})`);
    beam.addColorStop(0.42, `rgba(220,236,229,${beamAlpha})`);
    beam.addColorStop(1, 'rgba(78,214,220,0)');
    ctx.strokeStyle = beam;
    ctx.lineWidth = Math.max(1, minDim * (0.0018 + scene.crest * 0.0012));
    ctx.beginPath();
    ctx.moveTo(heroX, horizon + 2);
    ctx.lineTo(heroX + Math.sin(time * 0.035) * minDim * 0.003, h * 0.90);
    ctx.stroke();

    ctx.restore();
  }
}
