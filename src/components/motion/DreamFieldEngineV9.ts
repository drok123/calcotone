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
  xCount: number;
  yCount: number;
  xStrength: number;
  yStrength: number;
};

type SceneProfile = {
  horizon: number;
  heroX: number;
  heroLift: number;
  portalScale: number;
  portalSquash: number;
  archScale: number;
  archSpacing: number;
  archCount: number;
  archLift: number;
  symmetry: number;
  mirror: number;
  foreground: number;
  mass: number;
  orbitSweep: number;
  foregroundOrb: number;
  corridor: number;
  basinFull: number;
  warm: number;
  cool: number;
  canopy: number;
  shrine: number;
  glyphs: number;
  mask: number;
  roots: number;
  flora: number;
  calligraphy: number;
  constellation: number;
};

type SceneState = SceneProfile & {
  chapterA: number;
  chapterB: number;
  transition: number;
  takeover: number;
  reveal: number;
};

const RASTER_W = 112;
const RASTER_H = 64;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;
const CHAPTER_SECONDS = 13.5;
const TRANSITION_START = 0.67;
const ENERGY_KEYS: (keyof Energy)[] = ['ember', 'drift', 'halo', 'atmos', 'grain', 'artifact'];

// Four art-directed compositions built from the same V9 primitives.
// The art fields crossfade with the scene, so motifs become one another instead of stacking forever.
const SCENES: SceneProfile[] = [
  {
    horizon: 0.58,
    heroX: 0.07,
    heroLift: 0.24,
    portalScale: 0.13,
    portalSquash: 0.92,
    archScale: 0.82,
    archSpacing: 0.10,
    archCount: 2.2,
    archLift: 0.18,
    symmetry: 0.18,
    mirror: 0.18,
    foreground: 0.28,
    mass: 0.42,
    orbitSweep: 0.92,
    foregroundOrb: 0,
    corridor: 0.18,
    basinFull: 0.08,
    warm: 0.62,
    cool: 0.72,
    canopy: 0.82,
    shrine: 0.12,
    glyphs: 0.34,
    mask: 0.22,
    roots: 0.36,
    flora: 0.78,
    calligraphy: 0.24,
    constellation: 0.96,
  },
  {
    horizon: 0.58,
    heroX: 0,
    heroLift: 0.14,
    portalScale: 0.105,
    portalSquash: 1.02,
    archScale: 0.78,
    archSpacing: 0.095,
    archCount: 3.5,
    archLift: 0.21,
    symmetry: 0.96,
    mirror: 0.54,
    foreground: 0.92,
    mass: 0.82,
    orbitSweep: 0.66,
    foregroundOrb: 0.18,
    corridor: 0.94,
    basinFull: 0.86,
    warm: 0.78,
    cool: 0.78,
    canopy: 0.92,
    shrine: 0.72,
    glyphs: 0.88,
    mask: 0.42,
    roots: 0.94,
    flora: 0.62,
    calligraphy: 0.58,
    constellation: 0.46,
  },
  {
    horizon: 0.51,
    heroX: 0,
    heroLift: 0.015,
    portalScale: 0.072,
    portalSquash: 0.98,
    archScale: 1.08,
    archSpacing: 0.11,
    archCount: 2.4,
    archLift: 0.12,
    symmetry: 0.88,
    mirror: 0.72,
    foreground: 1,
    mass: 0.46,
    orbitSweep: 0.46,
    foregroundOrb: 0.08,
    corridor: 0.54,
    basinFull: 0.58,
    warm: 0.68,
    cool: 0.88,
    canopy: 0.28,
    shrine: 0.96,
    glyphs: 0.76,
    mask: 0.24,
    roots: 0.42,
    flora: 0.20,
    calligraphy: 0.96,
    constellation: 0.40,
  },
  {
    horizon: 0.51,
    heroX: 0,
    heroLift: 0.16,
    portalScale: 0.065,
    portalSquash: 1,
    archScale: 1.04,
    archSpacing: 0.12,
    archCount: 1.8,
    archLift: 0.16,
    symmetry: 1,
    mirror: 1,
    foreground: 0.84,
    mass: 0.76,
    orbitSweep: 0.72,
    foregroundOrb: 0.92,
    corridor: 0.70,
    basinFull: 0.28,
    warm: 0.82,
    cool: 0.78,
    canopy: 0.48,
    shrine: 0.58,
    glyphs: 0.92,
    mask: 1,
    roots: 0.60,
    flora: 0.36,
    calligraphy: 0.82,
    constellation: 0.72,
  },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const followAmount = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
  module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;
const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
};
const noise = (x: number, y: number) => {
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
};
const fbm = (x: number, y: number) =>
  noise(x, y) * 0.62 + noise(x * 2.03 + 7.1, y * 2.03 - 3.6) * 0.28 + noise(x * 4.11 - 2.4, y * 4.11 + 5.8) * 0.10;

function mixProfile(a: SceneProfile, b: SceneProfile, t: number): SceneProfile {
  return {
    horizon: lerp(a.horizon, b.horizon, t),
    heroX: lerp(a.heroX, b.heroX, t),
    heroLift: lerp(a.heroLift, b.heroLift, t),
    portalScale: lerp(a.portalScale, b.portalScale, t),
    portalSquash: lerp(a.portalSquash, b.portalSquash, t),
    archScale: lerp(a.archScale, b.archScale, t),
    archSpacing: lerp(a.archSpacing, b.archSpacing, t),
    archCount: lerp(a.archCount, b.archCount, t),
    archLift: lerp(a.archLift, b.archLift, t),
    symmetry: lerp(a.symmetry, b.symmetry, t),
    mirror: lerp(a.mirror, b.mirror, t),
    foreground: lerp(a.foreground, b.foreground, t),
    mass: lerp(a.mass, b.mass, t),
    orbitSweep: lerp(a.orbitSweep, b.orbitSweep, t),
    foregroundOrb: lerp(a.foregroundOrb, b.foregroundOrb, t),
    corridor: lerp(a.corridor, b.corridor, t),
    basinFull: lerp(a.basinFull, b.basinFull, t),
    warm: lerp(a.warm, b.warm, t),
    cool: lerp(a.cool, b.cool, t),
    canopy: lerp(a.canopy, b.canopy, t),
    shrine: lerp(a.shrine, b.shrine, t),
    glyphs: lerp(a.glyphs, b.glyphs, t),
    mask: lerp(a.mask, b.mask, t),
    roots: lerp(a.roots, b.roots, t),
    flora: lerp(a.flora, b.flora, t),
    calligraphy: lerp(a.calligraphy, b.calligraphy, t),
    constellation: lerp(a.constellation, b.constellation, t),
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

    const positionFollow = followAmount(frame.dragging ? 20 : 5.5, dt);
    this.x = lerp(this.x, clamp01(frame.x), positionFollow);
    this.y = lerp(this.y, clamp01(frame.y), positionFollow);
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, followAmount(frame.dragging ? 15 : 4.2, dt));

    const targetEnergy = this.energy(frame.modules);
    const energyFollow = followAmount(frame.dragging ? 11 : 3.8, dt);
    for (const key of ENERGY_KEYS) {
      this.energyState[key] = lerp(this.energyState[key], targetEnergy[key], energyFollow);
    }

    const patch = this.patchField(frame.assignments);
    const scene = this.sceneState(frame.time, this.energyState, patch);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderWorldRaster(frame.time, this.energyState, patch, scene);
      this.lastRasterTime = frame.time;
    }

    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05080b';
    ctx.fillRect(0, 0, w, h);

    if (this.raster) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.raster, 0, 0, w, h);
      ctx.restore();
    }

    this.drawWorldGeometry(ctx, frame.time, this.energyState, patch, scene);
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
    let xCount = 0;
    let yCount = 0;
    let xDepth = 0;
    let yDepth = 0;

    for (const assignment of assignments) {
      if (assignment.axis === 'x') {
        xCount += 1;
        xDepth += assignment.depth;
      } else {
        yCount += 1;
        yDepth += assignment.depth;
      }
    }

    return {
      total: assignments.length,
      xCount,
      yCount,
      xStrength: xCount ? clamp01(xDepth / xCount) : 0,
      yStrength: yCount ? clamp01(yDepth / yCount) : 0,
    };
  }

  private sceneState(time: number, e: Energy, patch: PatchField): SceneState {
    const journey = time / CHAPTER_SECONDS;
    const chapterFloor = Math.floor(journey);
    const chapterA = ((chapterFloor % SCENES.length) + SCENES.length) % SCENES.length;
    const chapterB = (chapterA + 1) % SCENES.length;
    const local = fract(journey);
    const transition = smoothstep(TRANSITION_START, 1, local);
    const profile = mixProfile(SCENES[chapterA], SCENES[chapterB], transition);
    const transitionPulse = Math.sin(transition * Math.PI);
    const patchDrive = clamp01((patch.xStrength + patch.yStrength) * 0.34 + patch.total * 0.032);
    const takeover = clamp01(transitionPulse * 0.72 + this.gesture * 0.22 + patchDrive * 0.16);
    const reveal = clamp01(Math.pow(takeover, 1.45) + e.halo * 0.04 + e.atmos * 0.025);
    const breath = Math.sin(time * 0.047 + chapterA * 1.31) * 0.5 + 0.5;

    return {
      ...profile,
      chapterA,
      chapterB,
      transition,
      takeover,
      reveal,
      portalScale: profile.portalScale * (1 + breath * 0.025 + takeover * 0.10),
      archScale: profile.archScale * (1 + takeover * 0.09),
      mirror: clamp01(profile.mirror + e.drift * 0.13 + patch.yStrength * 0.10 + takeover * 0.12),
      foreground: clamp01(profile.foreground + (1 - this.y) * 0.08 + patch.yStrength * 0.10 + takeover * 0.14),
      mass: clamp01(profile.mass + e.atmos * 0.16 + patch.xStrength * 0.05 + takeover * 0.10),
      orbitSweep: clamp01(profile.orbitSweep + e.halo * 0.12 + patch.xStrength * 0.08 + takeover * 0.10),
      foregroundOrb: clamp01(profile.foregroundOrb + takeover * profile.foregroundOrb * 0.12),
      canopy: clamp01(profile.canopy + reveal * 0.10),
      shrine: clamp01(profile.shrine + takeover * 0.09),
      glyphs: clamp01(profile.glyphs + reveal * 0.13),
      mask: clamp01(profile.mask + reveal * 0.17),
      roots: clamp01(profile.roots + e.atmos * 0.08 + reveal * 0.06),
      flora: clamp01(profile.flora + e.grain * 0.06 + reveal * 0.08),
      calligraphy: clamp01(profile.calligraphy + e.drift * 0.08 + takeover * 0.07),
      constellation: clamp01(profile.constellation + e.halo * 0.06),
    };
  }

  private renderWorldRaster(time: number, e: Energy, patch: PatchField, scene: SceneState) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const xSteer = this.x - 0.5;
    const horizon = scene.horizon * 2 - 1 + (0.5 - this.y) * 0.10 + scene.takeover * 0.018;
    const heroX = (scene.heroX + xSteer * (0.18 + patch.xStrength * 0.07)) * aspect;
    const heroY = horizon - scene.heroLift * 2 - this.y * 0.025;
    const warmBias = clamp01(scene.warm + xSteer * 0.34 + e.ember * 0.20);
    const coolBias = clamp01(scene.cool - xSteer * 0.24 + e.drift * 0.18);
    const patchEnergy = clamp01((patch.xStrength + patch.yStrength) * 0.40 + patch.total * 0.04);
    const archRadius = 0.30 + scene.archScale * 0.25 + e.halo * 0.045;
    const portalRadius = 0.018 + scene.portalScale * 0.46;

    for (let py = 0; py < RASTER_H; py += 1) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px += 1) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;
        const sky = ny < horizon;

        const fieldWarp = fbm(nx * 0.86 + time * (0.007 + xSteer * 0.004), ny * 0.86 - time * 0.006) - 0.5;
        const warpAmount = 0.05 + e.atmos * 0.045 + patch.xStrength * 0.025 + scene.takeover * 0.020;
        const localX = nx + fieldWarp * warpAmount + ny * xSteer * (0.025 + scene.takeover * 0.020);
        const mirroredX = Math.abs(localX - heroX) + heroX;
        const textureX = lerp(localX, mirroredX, scene.symmetry * 0.62);
        const nebula = fbm(textureX * 1.30 + time * 0.009, ny * 1.16 - time * 0.008);
        const detail = noise(textureX * 3.0 - time * 0.012, ny * 2.7 + time * 0.009);

        let r = 4;
        let g = 8;
        let b = 13;

        if (sky) {
          const altitude = clamp01((horizon - ny + 0.12) / 1.20);
          const magenta = smoothstep(0.47, 0.82, nebula + fieldWarp * 0.25);
          const cyan = smoothstep(0.43, 0.80, detail - fieldWarp * 0.18);
          r += 9 + altitude * 17 + magenta * (23 + warmBias * 35 + e.grain * 10);
          g += 13 + altitude * 23 + cyan * (28 + coolBias * 34 + e.drift * 10);
          b += 24 + altitude * 43 + magenta * 26 + cyan * 33;

          const archRadial = Math.hypot((nx - heroX) * 0.88, (ny - (heroY + scene.archLift * 0.35)) * 1.03);
          const archGlow = 1 - smoothstep(0.010, 0.085 + scene.takeover * 0.020, Math.abs(archRadial - archRadius));
          r += archGlow * (43 + warmBias * 54 + e.ember * 30 + scene.reveal * 20);
          g += archGlow * (18 + coolBias * 31 + e.halo * 20);
          b += archGlow * (38 + e.halo * 34 + scene.reveal * 14);

          const portalRadial = Math.hypot((nx - heroX) / Math.max(0.75, scene.portalSquash), ny - heroY);
          const portalEdge = 1 - smoothstep(0.006, 0.045, Math.abs(portalRadial - portalRadius));
          r += portalEdge * (68 + e.ember * 38 + scene.reveal * 24);
          g += portalEdge * (28 + e.halo * 26);
          b += portalEdge * (50 + e.halo * 34);

          const portalVoid = 1 - smoothstep(portalRadius * 0.40, portalRadius * 0.82, portalRadial);
          r *= 1 - portalVoid * 0.72;
          g *= 1 - portalVoid * 0.76;
          b *= 1 - portalVoid * 0.68;

          const star = hash(px * 1.77 + 13.1 + scene.chapterA * 4.7, py * 2.13 + 7.7);
          const starGate = 0.993 - e.grain * 0.005 - patchEnergy * 0.0015 - scene.reveal * 0.001;
          if (star > starGate && ny < horizon - 0.05) {
            const sparkle = (star - starGate) / Math.max(0.001, 1 - starGate);
            r += sparkle * 72;
            g += sparkle * 82;
            b += sparkle * 94;
          }
        } else {
          const depth = clamp01((ny - horizon) / Math.max(0.01, 1 - horizon));
          const waterNoise = noise(
            textureX * (2.8 + e.grain * 0.65) + time * 0.018,
            ny * 5.0 - time * (0.018 + e.drift * 0.038)
          );
          const reflectionWidth = Math.max(1.6, 4.6 - e.drift * 0.9 - patch.xStrength * 0.5 - scene.mirror * 1.45);
          const reflection = Math.exp(-Math.abs(nx - heroX) * reflectionWidth) * (1 - depth * (0.54 - scene.mirror * 0.20));
          r += 5 + depth * 7 + reflection * (39 + warmBias * 39 + e.ember * 20 + scene.mirror * 30) + waterNoise * e.grain * 7;
          g += 13 + depth * 12 + reflection * (47 + coolBias * 43 + e.drift * 26 + scene.mirror * 27);
          b += 20 + depth * 23 + reflection * (59 + e.halo * 28 + scene.mirror * 32);

          const basinCenterY = 0.72 - scene.foreground * 0.055 + (0.5 - this.y) * 0.06;
          const rippleDistance = Math.hypot(
            (nx - heroX) * (0.88 - scene.foreground * 0.12 + patch.xStrength * 0.04),
            (ny - basinCenterY) * (1.76 - scene.foreground * 0.36)
          );
          const ripple = Math.sin(
            rippleDistance * (23 + e.grain * 7 + patch.yStrength * 3 - scene.foreground * 4.5) -
            time * (0.36 + e.drift * 0.55)
          );
          const rippleGlow = Math.pow(clamp01(ripple * 0.5 + 0.5), 9) * smoothstep(horizon, 0.98, ny);
          r += rippleGlow * (18 + warmBias * 20 + e.grain * 21 + scene.foreground * 18);
          g += rippleGlow * (24 + coolBias * 22 + scene.foreground * 12);
          b += rippleGlow * (35 + scene.foreground * 18);
        }

        const horizonGlow = 1 - smoothstep(0.006, 0.080, Math.abs(ny - horizon));
        r += horizonGlow * (34 + warmBias * 28 + e.ember * 18 + scene.mirror * 13);
        g += horizonGlow * (32 + coolBias * 27 + e.drift * 15 + scene.mirror * 15);
        b += horizonGlow * (39 + scene.mirror * 12);

        if (e.artifact > 0.01) {
          const tear = Math.sin(py * 0.39 + time * 6.2 + nx * 0.7) * e.artifact;
          r += tear * 5;
          g += tear * 1.2;
          b -= tear * 3.5;
        }

        const index = (py * RASTER_W + px) * 4;
        data[index] = Math.max(0, Math.min(255, r));
        data[index + 1] = Math.max(0, Math.min(255, g));
        data[index + 2] = Math.max(0, Math.min(255, b));
        data[index + 3] = 255;
      }
    }

    this.rasterCtx.putImageData(this.imageData, 0, 0);
  }

  private drawWorldGeometry(ctx: CanvasRenderingContext2D, time: number, e: Energy, patch: PatchField, scene: SceneState) {
    const w = this.width;
    const h = this.height;
    const minDim = Math.min(w, h);
    const xSteer = this.x - 0.5;
    const horizon = h * (scene.horizon + (0.5 - this.y) * 0.055 + scene.takeover * 0.008);
    const heroX = w * (0.5 + scene.heroX + xSteer * (0.20 + patch.xStrength * 0.05));
    const heroY = horizon - h * (scene.heroLift + this.y * 0.018 + scene.takeover * 0.012);
    const activity = clamp01(patch.total / 6 + this.gesture * 0.22);

    this.drawArches(ctx, heroX, heroY, minDim, e, patch, scene, time);
    this.drawCelestialConstellation(ctx, heroX, heroY, minDim, e, scene, time);
    this.drawPortal(ctx, heroX, heroY, horizon, minDim, e, patch, scene, activity, time);
    this.drawPortalGlyphs(ctx, heroX, heroY, minDim, e, scene, time);
    this.drawSilhouettes(ctx, horizon, e, scene, time);
    this.drawSideCanopies(ctx, horizon, minDim, e, scene, time);
    this.drawShrineSpines(ctx, horizon, minDim, e, scene, time);
    this.drawRootVeins(ctx, horizon, e, scene, time);
    this.drawReflectionBands(ctx, heroX, horizon, e, patch, scene, time);
    this.drawWaterCalligraphy(ctx, heroX, horizon, e, scene, time);
    this.drawForegroundBasin(ctx, heroX, e, patch, scene, time);
    this.drawOrbitals(ctx, heroX, heroY, minDim, e, patch, scene, time);
    this.drawForegroundOrb(ctx, heroX, heroY, horizon, minDim, e, scene);
    this.drawMaskHints(ctx, heroX, heroY, horizon, minDim, e, scene, time);
    this.drawAmbiguousForms(ctx, horizon, minDim, e, patch, scene, time);
    this.drawArtifact(ctx, e, time);
  }

  private drawArches(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    minDim: number,
    e: Energy,
    patch: PatchField,
    scene: SceneState,
    _t: number
  ) {
    const count = Math.max(1, Math.min(5, Math.round(scene.archCount + e.halo * 1.2 + patch.xStrength * 0.5)));
    const tilt = (this.x - 0.5) * (0.07 + (1 - scene.symmetry) * 0.12) + scene.takeover * (this.x - 0.5) * 0.05;
    const centerY = cy + minDim * scene.archLift;

    ctx.save();
    ctx.translate(cx, centerY);
    ctx.rotate(tilt);
    ctx.translate(-cx, -centerY);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < count; i += 1) {
      const radius = minDim * (0.30 + scene.archScale * 0.22 + i * scene.archSpacing);
      const rx = radius * (1.04 + scene.corridor * 0.14);
      const ry = radius * (0.78 + scene.symmetry * 0.13);
      const alpha = Math.max(0.022, 0.092 - i * 0.014 + e.halo * 0.018 + scene.reveal * 0.020);
      const gradient = ctx.createLinearGradient(cx - rx, centerY, cx + rx, centerY);
      gradient.addColorStop(0, `rgba(74,214,220,${alpha * (0.60 + (1 - this.x) * 0.18)})`);
      gradient.addColorStop(0.46, `rgba(224,103,193,${alpha * 0.80})`);
      gradient.addColorStop(0.72, `rgba(255,158,91,${alpha * (0.76 + this.x * 0.24)})`);
      gradient.addColorStop(1, `rgba(81,211,219,${alpha * 0.42})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(1, minDim * (0.0043 - i * 0.00045 + scene.reveal * 0.0007));
      ctx.beginPath();
      ctx.ellipse(cx, centerY, rx, ry, 0, Math.PI * 1.035, Math.PI * 1.965);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCelestialConstellation(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    minDim: number,
    e: Energy,
    scene: SceneState,
    t: number
  ) {
    if (scene.constellation < 0.06) return;
    const count = 5 + Math.round(scene.constellation * 5);
    const points: [number, number][] = [];
    const alpha = scene.constellation * (0.025 + e.halo * 0.018);

    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0 : i / (count - 1);
      const angle = Math.PI * (1.06 + p * 0.88) + Math.sin(t * 0.018 + i) * 0.015;
      const radius = minDim * (0.30 + (i % 3) * 0.055 + scene.archScale * 0.055);
      points.push([
        cx + Math.cos(angle) * radius * 1.33,
        cy + minDim * scene.archLift * 0.72 + Math.sin(angle) * radius * 0.72,
      ]);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(185,223,219,${alpha})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();

    for (let i = 0; i < points.length; i += 1) {
      const [x, y] = points[i];
      const r = minDim * (0.0024 + (i % 3) * 0.0011);
      ctx.fillStyle = i % 2
        ? `rgba(91,215,220,${alpha * 2.7})`
        : `rgba(247,171,112,${alpha * 2.5})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPortal(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    horizon: number,
    minDim: number,
    e: Energy,
    patch: PatchField,
    scene: SceneState,
    activity: number,
    t: number
  ) {
    const base = minDim * scene.portalScale * (1 + e.halo * 0.10 + e.ember * 0.07 + scene.reveal * 0.12);
    const squash = scene.portalSquash + (this.x - 0.5) * 0.10 + patch.xStrength * 0.025;
    const rx = base * squash;
    const ry = base / Math.max(0.78, squash);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const corona = ctx.createRadialGradient(cx, cy, base * 0.34, cx, cy, base * (1.85 + scene.reveal * 0.55));
    corona.addColorStop(0, 'rgba(0,0,0,0)');
    corona.addColorStop(0.33, `rgba(255,149,82,${0.17 + e.ember * 0.11 + scene.warm * 0.035 + scene.reveal * 0.055})`);
    corona.addColorStop(0.58, `rgba(232,96,187,${0.10 + e.halo * 0.065 + scene.reveal * 0.032})`);
    corona.addColorStop(0.80, `rgba(82,216,222,${0.085 + e.drift * 0.050 + scene.cool * 0.024})`);
    corona.addColorStop(1, 'rgba(82,216,222,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (1.85 + scene.reveal * 0.55), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(2,4,9,0.988)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.69, ry * 0.69, (this.x - 0.5) * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(255,191,121,${0.11 + e.ember * 0.065 + activity * 0.02 + scene.reveal * 0.055})`;
    ctx.lineWidth = Math.max(1, minDim * (0.0036 + scene.reveal * 0.0011));
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.81, ry * 0.81, (this.x - 0.5) * 0.055, 0, Math.PI * 2);
    ctx.stroke();

    if (scene.reveal > 0.06) {
      const innerAlpha = scene.reveal * (0.040 + e.halo * 0.020);
      for (let i = 0; i < 2; i += 1) {
        const scale = 1.16 + i * 0.27;
        ctx.strokeStyle = i === 0
          ? `rgba(235,108,191,${innerAlpha})`
          : `rgba(92,216,220,${innerAlpha * 0.76})`;
        ctx.lineWidth = Math.max(1, minDim * 0.0017);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * scale, ry * scale, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const beamBottom = lerp(horizon, this.height * 0.84, scene.corridor * 0.82 + scene.foregroundOrb * 0.18);
    const beam = ctx.createLinearGradient(cx, cy + ry * 0.4, cx, beamBottom);
    beam.addColorStop(0, 'rgba(255,180,110,0)');
    beam.addColorStop(1, `rgba(242,248,237,${0.060 + patch.yStrength * 0.055 + scene.corridor * 0.075 + scene.mirror * 0.025})`);
    ctx.strokeStyle = beam;
    ctx.lineWidth = Math.max(1, minDim * (0.0024 + patch.yStrength * 0.0012 + scene.corridor * 0.0012));
    ctx.beginPath();
    ctx.moveTo(cx, cy + ry * 0.52);
    ctx.lineTo(cx + Math.sin(t * 0.09) * minDim * 0.004, beamBottom);
    ctx.stroke();
    ctx.restore();
  }

  private drawPortalGlyphs(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    minDim: number,
    e: Energy,
    scene: SceneState,
    t: number
  ) {
    const amount = scene.glyphs * (0.36 + scene.reveal * 0.64);
    if (amount < 0.05) return;

    const base = minDim * scene.portalScale * (1.50 + scene.reveal * 0.20);
    const count = 7 + Math.round(scene.glyphs * 7);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';

    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + t * 0.008 * (i % 2 ? 1 : -1);
      const arc = 0.12 + (i % 3) * 0.045;
      const radius = base * (1.02 + (i % 4) * 0.12);
      const alpha = amount * (0.018 + e.halo * 0.012);
      ctx.strokeStyle = i % 3 === 0
        ? `rgba(247,177,112,${alpha})`
        : i % 3 === 1
          ? `rgba(91,215,220,${alpha})`
          : `rgba(229,114,192,${alpha * 0.90})`;
      ctx.lineWidth = Math.max(0.75, minDim * 0.0012);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, a, a + arc);
      ctx.stroke();

      if (i % 2 === 0) {
        const x1 = cx + Math.cos(a) * radius * 0.93;
        const y1 = cy + Math.sin(a) * radius * 0.93;
        const x2 = cx + Math.cos(a) * radius * 1.04;
        const y2 = cy + Math.sin(a) * radius * 1.04;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private silhouetteShape(index: number, layer: number, chapter: number, symmetry: number): number {
    const mirroredIndex = index <= 32 ? index : 64 - index;
    const baseIndex = lerp(index, mirroredIndex, symmetry);
    const phase = chapter * 1.73 + layer * 2.11;

    if (chapter === 0) {
      const branch = Math.sin(baseIndex * 0.48 + phase) * 0.30 + Math.sin(baseIndex * 1.47 - phase * 0.4) * 0.20;
      const antler = Math.pow(Math.abs(Math.sin(baseIndex * 0.91 + phase)), 7) * 0.34;
      return branch + antler;
    }
    if (chapter === 1) {
      const forest = Math.sin(baseIndex * 0.79 + phase) * 0.35 + Math.sin(baseIndex * 1.69 - phase * 0.55) * 0.18;
      const needles = Math.pow(Math.abs(Math.sin(baseIndex * 2.38 + phase)), 15) * 0.42;
      return forest + needles;
    }
    if (chapter === 2) {
      const mountain = Math.sin(baseIndex * 0.19 + phase) * 0.30 + Math.sin(baseIndex * 0.39 - phase) * 0.22;
      const tower = Math.pow(Math.abs(Math.sin(baseIndex * 0.72 + phase)), 11) * 0.30;
      return mountain + tower;
    }
    const shoulders = Math.sin(baseIndex * 0.31 + phase) * 0.28 + Math.sin(baseIndex * 0.62 - phase * 0.7) * 0.18;
    const maskSpine = Math.pow(Math.abs(Math.sin(baseIndex * 1.24 + phase)), 9) * 0.34;
    return shoulders + maskSpine;
  }

  private drawSilhouettes(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, scene: SceneState, _t: number) {
    const w = this.width;
    const h = this.height;
    const count = 64;

    for (let layer = 0; layer < 2; layer += 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (layer === 0 ? 0.46 : 0.75) + e.atmos * 0.08 + scene.mass * 0.07;
      ctx.fillStyle = layer === 0 ? 'rgba(9,19,25,0.86)' : 'rgba(3,8,13,0.96)';
      ctx.beginPath();
      ctx.moveTo(0, horizon);

      const peakExponent = Math.max(6, 18 - scene.mass * 10);
      for (let i = 0; i <= count; i += 1) {
        const p = i / count;
        const px = p * w;
        const shapeA = this.silhouetteShape(i, layer, scene.chapterA, scene.symmetry);
        const shapeB = this.silhouetteShape(i, layer, scene.chapterB, scene.symmetry);
        const n = lerp(shapeA, shapeB, scene.transition);
        const symmetricP = Math.min(p, 1 - p) * 2;
        const corridorWall = Math.pow(1 - symmetricP, 1.6) * scene.corridor;
        const sideBias = 0.62 + Math.abs(p - 0.5 - (this.x - 0.5) * (1 - scene.symmetry) * 0.10) * 0.94;
        const spireSeedA = Math.abs(Math.sin(i * 2.37 + layer + scene.chapterA * 0.77));
        const spireSeedB = Math.abs(Math.sin(i * 2.37 + layer + scene.chapterB * 0.77));
        const spireSeed = lerp(spireSeedA, spireSeedB, scene.transition);
        const spire = Math.pow(spireSeed, peakExponent) * (0.72 + e.atmos * 0.85 + scene.mass * 0.52);
        const broadMass = Math.pow(Math.abs(Math.sin(i * 0.39 + scene.chapterA * 0.9)), 4) * scene.mass * 0.050;
        const height = h * (
          0.028 +
          Math.max(0, n) * 0.042 +
          spire * 0.105 +
          broadMass +
          corridorWall * (0.055 + layer * 0.018)
        ) * sideBias * (layer ? 1 : 0.72) * (1 + scene.takeover * 0.18);
        ctx.lineTo(px, horizon - height);
      }

      ctx.lineTo(w, horizon);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSideCanopies(
    ctx: CanvasRenderingContext2D,
    horizon: number,
    minDim: number,
    e: Energy,
    scene: SceneState,
    t: number
  ) {
    const amount = scene.canopy;
    if (amount < 0.05) return;
    const w = this.width;
    const h = this.height;
    const branchCount = 3 + Math.round(amount * 3);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';

    for (const side of [-1, 1] as const) {
      const edgeX = side < 0 ? 0 : w;
      for (let i = 0; i < branchCount; i += 1) {
        const seed = i + scene.chapterA * 5.7 + (side > 0 ? 13.4 : 0);
        const baseY = horizon - h * (0.025 + i * 0.032);
        const reach = w * (0.10 + amount * 0.11 + hash(seed, 4.1) * 0.05);
        const lift = h * (0.06 + hash(seed, 2.7) * 0.11 + scene.flora * 0.04);
        const endX = edgeX - side * reach;
        const endY = baseY - lift * (0.55 + hash(seed, 8.3) * 0.55);
        const c1x = edgeX - side * reach * 0.32;
        const c1y = baseY - lift * 0.18;
        const c2x = edgeX - side * reach * 0.72;
        const c2y = endY + Math.sin(t * 0.018 + seed) * 2;
        const alpha = amount * (0.025 + e.atmos * 0.014 + scene.reveal * 0.012);

        ctx.strokeStyle = i % 2
          ? `rgba(84,208,210,${alpha})`
          : `rgba(216,111,185,${alpha * 0.78})`;
        ctx.lineWidth = Math.max(0.8, minDim * (0.0015 + amount * 0.0006));
        ctx.beginPath();
        ctx.moveTo(edgeX, baseY);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endX, endY);
        ctx.stroke();

        const forks = 2 + Math.round(scene.flora * 2);
        for (let f = 0; f < forks; f += 1) {
          const q = 0.48 + f * 0.16;
          const bx = lerp(edgeX, endX, q);
          const by = lerp(baseY, endY, q) - lift * 0.08;
          const twig = minDim * (0.028 + f * 0.010 + scene.flora * 0.012);
          const dir = side * (f % 2 ? -1 : 1);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(bx - side * twig * 0.45, by - twig * 0.55, bx - side * twig, by - twig * (0.72 + dir * 0.08));
          ctx.stroke();

          if (scene.flora > 0.25) {
            const podAlpha = alpha * (0.60 + scene.flora * 0.45);
            ctx.fillStyle = `rgba(238,181,130,${podAlpha})`;
            ctx.beginPath();
            ctx.ellipse(
              bx - side * twig,
              by - twig * 0.72,
              minDim * 0.0045 * (0.8 + scene.flora),
              minDim * 0.0025 * (0.8 + scene.flora),
              side * 0.45,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }

  private drawShrineSpines(
    ctx: CanvasRenderingContext2D,
    horizon: number,
    minDim: number,
    e: Energy,
    scene: SceneState,
    t: number
  ) {
    const amount = scene.shrine;
    if (amount < 0.05) return;
    const w = this.width;
    const count = 3 + Math.round(amount * 5);
    const spread = w * (0.18 + scene.corridor * 0.18);
    const center = w * (0.5 + scene.heroX * 0.35);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0.5 : i / (count - 1);
      const x = center + (p - 0.5) * spread * 2;
      const symmetrical = 1 - Math.abs(p - 0.5) * 2;
      const height = minDim * (0.07 + symmetrical * 0.12 + amount * 0.08) * (0.88 + hash(i + scene.chapterA * 3.2, 2.9) * 0.25);
      const width = minDim * (0.011 + amount * 0.010);
      const alpha = amount * (0.020 + e.halo * 0.010 + scene.reveal * 0.010);
      ctx.strokeStyle = i % 2
        ? `rgba(93,215,220,${alpha})`
        : `rgba(244,160,104,${alpha * 0.82})`;
      ctx.lineWidth = Math.max(0.8, minDim * 0.0014);

      ctx.beginPath();
      ctx.moveTo(x - width, horizon);
      ctx.lineTo(x - width * 0.55, horizon - height * 0.72);
      ctx.quadraticCurveTo(x, horizon - height * (1.02 + Math.sin(t * 0.011 + i) * 0.01), x + width * 0.55, horizon - height * 0.72);
      ctx.lineTo(x + width, horizon);
      ctx.stroke();

      if (amount > 0.58 && i % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(x - width * 0.55, horizon - height * 0.45);
        ctx.lineTo(x + width * 0.55, horizon - height * 0.45);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawRootVeins(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, scene: SceneState, t: number) {
    const amount = scene.roots;
    if (amount < 0.06) return;
    const w = this.width;
    const h = this.height;
    const alpha = amount * (0.018 + e.atmos * 0.010);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(116,202,188,${alpha})`;
    ctx.lineWidth = 0.8;

    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        const sx = side < 0 ? w * (0.08 + i * 0.045) : w * (0.92 - i * 0.045);
        const sy = horizon - h * (0.01 + i * 0.018);
        const ex = side < 0 ? w * (0.20 + i * 0.06) : w * (0.80 - i * 0.06);
        const ey = h * (0.72 + i * 0.065);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(
          sx - side * w * 0.035,
          h * 0.61,
          ex + side * w * 0.035,
          h * (0.65 + Math.sin(t * 0.015 + i) * 0.004),
          ex,
          ey
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawReflectionBands(
    ctx: CanvasRenderingContext2D,
    heroX: number,
    horizon: number,
    e: Energy,
    patch: PatchField,
    scene: SceneState,
    t: number
  ) {
    const w = this.width;
    const h = this.height;
    const count = Math.min(13, 6 + Math.round(e.drift * 2 + patch.yStrength * 2 + scene.mirror * 4));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < count; i += 1) {
      const yy = horizon + h * (0.022 + i * (0.043 - scene.mirror * 0.0024));
      const spread = w * (0.032 + i * (0.048 + patch.xStrength * 0.0025 + scene.mirror * 0.003));
      const alpha = Math.max(0.014, 0.052 - i * 0.0037 + e.drift * 0.011 + scene.mirror * 0.013);
      ctx.strokeStyle = i % 2
        ? `rgba(93,215,220,${alpha})`
        : `rgba(232,112,188,${alpha * 0.74})`;
      ctx.lineWidth = 1;
      const wobble = (1 - scene.mirror * 0.72) * (1.0 + e.drift * 1.2);
      ctx.beginPath();
      ctx.moveTo(heroX - spread, yy + Math.sin(t * 0.050 + i) * wobble);
      ctx.quadraticCurveTo(
        heroX + (this.x - 0.5) * w * 0.012 * (1 - scene.symmetry),
        yy - h * (0.007 + patch.yStrength * 0.004 + scene.mirror * 0.006),
        heroX + spread,
        yy + Math.cos(t * 0.046 + i) * wobble
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWaterCalligraphy(
    ctx: CanvasRenderingContext2D,
    heroX: number,
    horizon: number,
    e: Energy,
    scene: SceneState,
    t: number
  ) {
    const amount = scene.calligraphy;
    if (amount < 0.06) return;
    const w = this.width;
    const h = this.height;
    const count = 3 + Math.round(amount * 5);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i += 1) {
      const seed = i + scene.chapterA * 7.3;
      const side = i % 2 ? 1 : -1;
      const startX = heroX + side * w * (0.025 + hash(seed, 2.7) * 0.08);
      const startY = horizon + h * (0.04 + i * 0.045);
      const endX = heroX + side * w * (0.18 + amount * 0.08 + hash(seed, 6.1) * 0.08);
      const endY = startY + h * (0.045 + hash(seed, 9.4) * 0.055);
      const alpha = amount * (0.018 + e.drift * 0.010 + scene.mirror * 0.010);
      ctx.strokeStyle = i % 3 === 0
        ? `rgba(235,111,190,${alpha})`
        : `rgba(91,215,220,${alpha})`;
      ctx.lineWidth = Math.max(0.7, 0.8 + amount * 0.4);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(
        startX + side * w * 0.04,
        startY + Math.sin(t * 0.020 + i) * 2,
        endX - side * w * 0.055,
        endY - h * 0.035,
        endX,
        endY
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawForegroundBasin(
    ctx: CanvasRenderingContext2D,
    heroX: number,
    e: Energy,
    patch: PatchField,
    scene: SceneState,
    t: number
  ) {
    const w = this.width;
    const h = this.height;
    const cy = h * (0.89 - scene.foreground * 0.035 + Math.sin(t * 0.015) * 0.0015);
    const count = Math.min(11, 4 + Math.round(e.halo * 2 + patch.yStrength * 2 + scene.foreground * 4));
    const rotation = (this.x - 0.5) * (1 - scene.symmetry) * 0.09;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = i / Math.max(1, count - 1);
      const rx = w * (0.055 + p * (0.30 + scene.foreground * 0.18));
      const ry = h * (0.010 + p * (0.060 + scene.foreground * 0.075));
      const alpha = 0.045 - p * 0.019 + scene.foreground * 0.012;
      ctx.strokeStyle = i % 2
        ? `rgba(90,214,218,${alpha + e.drift * 0.006})`
        : `rgba(226,104,187,${alpha * 0.92 + e.grain * 0.007})`;
      ctx.lineWidth = 1 + scene.reveal * (1 - p) * 0.30;

      ctx.beginPath();
      ctx.ellipse(heroX, cy, rx, ry, rotation, Math.PI, Math.PI * 2);
      ctx.stroke();

      if (scene.basinFull > 0.05) {
        ctx.globalAlpha = scene.basinFull * (0.34 + (1 - p) * 0.24);
        ctx.beginPath();
        ctx.ellipse(heroX, cy, rx, ry, rotation, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  private drawOrbitals(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    minDim: number,
    e: Energy,
    patch: PatchField,
    scene: SceneState,
    t: number
  ) {
    const count = Math.min(10, 3 + Math.round(e.halo * 3 + patch.xStrength + scene.orbitSweep * 4));
    const centerY = cy + minDim * scene.archLift * 0.65;
    ctx.save();

    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0.5 : i / (count - 1);
      const arcAngle = Math.PI * (1.08 + p * 0.84);
      const randomAngle = i * 1.37 + scene.chapterA * 0.61 + t * (0.006 + (i % 3) * 0.0017);
      const organized = clamp01(scene.symmetry * 0.55 + scene.corridor * 0.30 + scene.orbitSweep * 0.15);
      const angle = lerp(randomAngle, arcAngle + (this.x - 0.5) * 0.25, organized);
      const orbit = minDim * (0.27 + (i % 4) * 0.075 + scene.archScale * 0.055 + scene.orbitSweep * 0.025);
      const px = cx + Math.cos(angle) * orbit * (1.34 + patch.xStrength * 0.10);
      const py = centerY + Math.sin(angle) * orbit * (0.70 + scene.symmetry * 0.06);
      const r = minDim * (0.0065 + (i % 3) * 0.0038 + scene.reveal * 0.0014);

      ctx.globalCompositeOperation = 'screen';
      const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 1.9);
      glow.addColorStop(0, `rgba(246,241,221,${0.18 + scene.reveal * 0.045})`);
      glow.addColorStop(0.46, i % 2 ? 'rgba(90,210,219,0.16)' : 'rgba(244,139,95,0.17)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 1.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,6,12,0.93)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.64, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawForegroundOrb(
    ctx: CanvasRenderingContext2D,
    heroX: number,
    heroY: number,
    horizon: number,
    minDim: number,
    e: Energy,
    scene: SceneState
  ) {
    if (scene.foregroundOrb < 0.03) return;

    const h = this.height;
    const amount = smoothstep(0.02, 0.88, scene.foregroundOrb);
    const cy = h * lerp(0.84, 0.79, amount);
    const radius = minDim * lerp(0.011, 0.060, amount);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(heroX, cy, radius * 0.55, heroX, cy, radius * 2.4);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(0.38, `rgba(238,102,191,${0.055 + amount * 0.065})`);
    glow.addColorStop(0.66, `rgba(82,216,222,${0.050 + amount * 0.050 + e.drift * 0.018})`);
    glow.addColorStop(1, 'rgba(82,216,222,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(heroX, cy, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(2,4,9,0.985)';
    ctx.beginPath();
    ctx.arc(heroX, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(91,216,220,${0.05 + amount * 0.08})`;
    ctx.lineWidth = Math.max(1, minDim * 0.0020);
    ctx.beginPath();
    ctx.ellipse(heroX, cy + radius * 0.72, radius * (1.5 + amount * 0.8), radius * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (amount > 0.45) {
      const beam = ctx.createLinearGradient(heroX, heroY, heroX, cy - radius);
      beam.addColorStop(0, 'rgba(245,190,125,0.015)');
      beam.addColorStop(0.48, `rgba(238,244,236,${0.035 + amount * 0.035})`);
      beam.addColorStop(1, 'rgba(91,216,220,0.01)');
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.beginPath();
      ctx.moveTo(heroX, Math.max(horizon, heroY + radius));
      ctx.lineTo(heroX, cy - radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMaskHints(
    ctx: CanvasRenderingContext2D,
    heroX: number,
    heroY: number,
    horizon: number,
    minDim: number,
    e: Energy,
    scene: SceneState,
    t: number
  ) {
    const amount = scene.mask * (0.30 + scene.reveal * 0.70);
    if (amount < 0.08) return;

    const w = this.width;
    const h = this.height;
    const centerX = lerp(w * 0.5, heroX, 0.25);
    const centerY = lerp(heroY, horizon - h * 0.06, 0.62);
    const eyeDx = minDim * (0.080 + amount * 0.020);
    const eyeRy = minDim * (0.018 + amount * 0.008);
    const alpha = amount * (0.018 + e.atmos * 0.010 + scene.reveal * 0.012);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(224,231,221,${alpha})`;
    ctx.lineWidth = Math.max(0.8, minDim * 0.0013);

    for (const side of [-1, 1] as const) {
      const ex = centerX + side * eyeDx;
      const ey = centerY + Math.sin(t * 0.015 + side) * 1.2;
      ctx.beginPath();
      ctx.ellipse(ex, ey, eyeDx * 0.54, eyeRy, side * 0.08, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      if (scene.reveal > 0.28) {
        ctx.beginPath();
        ctx.arc(ex + side * eyeDx * 0.06, ey, minDim * (0.004 + scene.reveal * 0.003), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = `rgba(245,169,111,${alpha * 0.66})`;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY + eyeRy * 0.6);
    ctx.quadraticCurveTo(centerX + Math.sin(t * 0.012) * 1.5, centerY + minDim * 0.045, centerX, centerY + minDim * 0.075);
    ctx.stroke();

    if (scene.mask > 0.72) {
      ctx.strokeStyle = `rgba(92,214,219,${alpha * 0.72})`;
      ctx.beginPath();
      ctx.arc(centerX, centerY + minDim * 0.055, minDim * 0.095, Math.PI * 0.14, Math.PI * 0.86);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawAmbiguousForms(
    ctx: CanvasRenderingContext2D,
    horizon: number,
    minDim: number,
    e: Energy,
    patch: PatchField,
    scene: SceneState,
    t: number
  ) {
    if (scene.reveal < 0.10) return;

    const w = this.width;
    const h = this.height;
    const alpha = (0.010 + e.atmos * 0.010 + e.halo * 0.007 + (patch.xStrength + patch.yStrength) * 0.003) * scene.reveal;
    const forms = [
      [0.15 + (this.x - 0.5) * 0.025, -0.10, 1.0],
      [0.85 + (this.x - 0.5) * 0.025, -0.09, 0.92],
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(222,231,222,${alpha})`;
    ctx.lineWidth = 1 + scene.reveal * 0.30;
    for (let i = 0; i < forms.length; i += 1) {
      const [xf, yf, s] = forms[i];
      const x = w * xf;
      const y = horizon + h * yf + Math.sin(t * 0.022 + i) * 1.2;
      const r = minDim * 0.050 * s * (1 + scene.reveal * 0.26);
      const open = 0.50 + this.y * 0.10 + scene.reveal * 0.13;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.55, r * open, (i ? -1 : 1) * (this.x - 0.5) * 0.08, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + (this.x - 0.5) * r * 0.28, y, r * (0.12 + scene.reveal * 0.07), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawArtifact(ctx: CanvasRenderingContext2D, e: Energy, t: number) {
    if (e.artifact <= 0.02) return;
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const count = 1 + Math.round(e.artifact * 3);
    for (let i = 0; i < count; i += 1) {
      const y = (Math.sin(i * 4.13 + t * (0.52 + i * 0.13)) * 0.5 + 0.5) * h;
      ctx.strokeStyle = `rgba(223,171,139,${0.010 + e.artifact * 0.022})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + Math.sin(t * 1.3 + i) * 1.8);
      ctx.stroke();
    }
    ctx.restore();
  }
}
