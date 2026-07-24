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

type SceneProfile = {
  horizon: number;
  heroX: number;
  heroLift: number;
  portalScale: number;
  archScale: number;
  archCount: number;
  archLift: number;
  symmetry: number;
  mirror: number;
  mass: number;
  corridor: number;
  basin: number;
  foregroundOrb: number;
  sideMass: number;
  shrine: number;
  flora: number;
  mask: number;
  glyphs: number;
  constellations: number;
  warm: number;
  cool: number;
};

type SceneState = SceneProfile & {
  chapterA: number;
  chapterB: number;
  transition: number;
  portalMorph: number;
  terrainMorph: number;
  waterMorph: number;
  foregroundMorph: number;
  reveal: number;
};

const RASTER_W = 112;
const RASTER_H = 64;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;
const CHAPTER_SECONDS = 16;
const ENERGY_KEYS: (keyof Energy)[] = ['ember', 'drift', 'halo', 'atmos', 'grain', 'artifact'];

const SCENES: SceneProfile[] = [
  {
    horizon: 0.58,
    heroX: 0.08,
    heroLift: 0.25,
    portalScale: 0.15,
    archScale: 0.78,
    archCount: 2.2,
    archLift: 0.17,
    symmetry: 0.22,
    mirror: 0.18,
    mass: 0.40,
    corridor: 0.12,
    basin: 0.30,
    foregroundOrb: 0,
    sideMass: 0.72,
    shrine: 0.12,
    flora: 0.88,
    mask: 0.18,
    glyphs: 0.34,
    constellations: 0.92,
    warm: 0.62,
    cool: 0.74,
  },
  {
    horizon: 0.59,
    heroX: 0,
    heroLift: 0.15,
    portalScale: 0.11,
    archScale: 0.76,
    archCount: 3.6,
    archLift: 0.20,
    symmetry: 0.95,
    mirror: 0.56,
    mass: 0.82,
    corridor: 0.96,
    basin: 0.92,
    foregroundOrb: 0.16,
    sideMass: 0.90,
    shrine: 0.52,
    flora: 0.66,
    mask: 0.34,
    glyphs: 0.84,
    constellations: 0.50,
    warm: 0.76,
    cool: 0.78,
  },
  {
    horizon: 0.51,
    heroX: 0,
    heroLift: 0.035,
    portalScale: 0.075,
    archScale: 1.08,
    archCount: 2.3,
    archLift: 0.105,
    symmetry: 0.88,
    mirror: 0.76,
    mass: 0.45,
    corridor: 0.46,
    basin: 1,
    foregroundOrb: 0.06,
    sideMass: 0.36,
    shrine: 0.96,
    flora: 0.20,
    mask: 0.14,
    glyphs: 0.70,
    constellations: 0.38,
    warm: 0.68,
    cool: 0.88,
  },
  {
    horizon: 0.52,
    heroX: 0,
    heroLift: 0.17,
    portalScale: 0.068,
    archScale: 1.02,
    archCount: 1.7,
    archLift: 0.16,
    symmetry: 1,
    mirror: 1,
    mass: 0.72,
    corridor: 0.68,
    basin: 0.76,
    foregroundOrb: 0.96,
    sideMass: 0.52,
    shrine: 0.48,
    flora: 0.32,
    mask: 1,
    glyphs: 0.90,
    constellations: 0.68,
    warm: 0.82,
    cool: 0.80,
  },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const followAmount = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
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
    archScale: lerp(a.archScale, b.archScale, t),
    archCount: lerp(a.archCount, b.archCount, t),
    archLift: lerp(a.archLift, b.archLift, t),
    symmetry: lerp(a.symmetry, b.symmetry, t),
    mirror: lerp(a.mirror, b.mirror, t),
    mass: lerp(a.mass, b.mass, t),
    corridor: lerp(a.corridor, b.corridor, t),
    basin: lerp(a.basin, b.basin, t),
    foregroundOrb: lerp(a.foregroundOrb, b.foregroundOrb, t),
    sideMass: lerp(a.sideMass, b.sideMass, t),
    shrine: lerp(a.shrine, b.shrine, t),
    flora: lerp(a.flora, b.flora, t),
    mask: lerp(a.mask, b.mask, t),
    glyphs: lerp(a.glyphs, b.glyphs, t),
    constellations: lerp(a.constellations, b.constellations, t),
    warm: lerp(a.warm, b.warm, t),
    cool: lerp(a.cool, b.cool, t),
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

    const positionFollow = followAmount(frame.dragging ? 22 : 5.2, dt);
    this.x = lerp(this.x, clamp01(frame.x), positionFollow);
    this.y = lerp(this.y, clamp01(frame.y), positionFollow);
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, followAmount(frame.dragging ? 16 : 4.0, dt));

    const targetEnergy = this.energy(frame.modules);
    const energyFollow = followAmount(frame.dragging ? 11 : 3.7, dt);
    for (const key of ENERGY_KEYS) {
      this.energyState[key] = lerp(this.energyState[key], targetEnergy[key], energyFollow);
    }

    const patch = this.patchField(frame.assignments);
    const scene = this.sceneState(frame.time, this.energyState, patch);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;

    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderRaster(frame.time, this.energyState, patch, scene);
      this.lastRasterTime = frame.time;
    }

    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#04070a';
    ctx.fillRect(0, 0, w, h);

    if (this.raster) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.raster, 0, 0, w, h);
      ctx.restore();
    }

    this.drawWorld(ctx, frame.time, this.energyState, patch, scene);
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

  private sceneState(time: number, e: Energy, patch: PatchField): SceneState {
    const journey = time / CHAPTER_SECONDS;
    const chapterFloor = Math.floor(journey);
    const chapterA = ((chapterFloor % SCENES.length) + SCENES.length) % SCENES.length;
    const chapterB = (chapterA + 1) % SCENES.length;
    const local = fract(journey);

    const transition = smoothstep(0.64, 1, local);
    const portalMorph = smoothstep(0.00, 0.42, transition);
    const terrainMorph = smoothstep(0.16, 0.68, transition);
    const waterMorph = smoothstep(0.34, 0.84, transition);
    const foregroundMorph = smoothstep(0.56, 1.00, transition);
    const profile = mixProfile(SCENES[chapterA], SCENES[chapterB], transition);

    const infection = Math.sin(transition * Math.PI);
    const patchDrive = clamp01((patch.xStrength + patch.yStrength) * 0.28 + patch.total * 0.025);
    const reveal = clamp01(infection * 0.78 + this.gesture * 0.18 + patchDrive * 0.14 + e.halo * 0.035);
    const breath = Math.sin(time * 0.044 + chapterA * 1.17) * 0.5 + 0.5;

    return {
      ...profile,
      chapterA,
      chapterB,
      transition,
      portalMorph,
      terrainMorph,
      waterMorph,
      foregroundMorph,
      reveal,
      portalScale: profile.portalScale * (1 + breath * 0.025 + reveal * 0.12),
      archScale: profile.archScale * (1 + reveal * 0.06),
      mirror: clamp01(profile.mirror + e.drift * 0.12 + patch.yStrength * 0.08 + waterMorph * reveal * 0.12),
      mass: clamp01(profile.mass + e.atmos * 0.16 + terrainMorph * reveal * 0.10),
      basin: clamp01(profile.basin + (1 - this.y) * 0.06 + patch.yStrength * 0.08 + foregroundMorph * reveal * 0.12),
      foregroundOrb: clamp01(profile.foregroundOrb + foregroundMorph * profile.foregroundOrb * 0.10),
    };
  }

  private renderRaster(time: number, e: Energy, patch: PatchField, scene: SceneState) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const xSteer = this.x - 0.5;
    const horizon = scene.horizon * 2 - 1 + (0.5 - this.y) * 0.10;
    const heroX = (scene.heroX + xSteer * (0.17 + patch.xStrength * 0.06)) * aspect;
    const heroY = horizon - scene.heroLift * 2;
    const archRadius = 0.31 + scene.archScale * 0.24 + e.halo * 0.04;
    const portalRadius = 0.02 + scene.portalScale * 0.45;
    const warmBias = clamp01(scene.warm + xSteer * 0.30 + e.ember * 0.18);
    const coolBias = clamp01(scene.cool - xSteer * 0.22 + e.drift * 0.17);

    for (let py = 0; py < RASTER_H; py += 1) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px += 1) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;
        const sky = ny < horizon;
        const field = fbm(nx * 0.82 + time * 0.007, ny * 0.82 - time * 0.006) - 0.5;
        const warp = 0.045 + e.atmos * 0.045 + patch.xStrength * 0.022 + scene.reveal * 0.018;
        const localX = nx + field * warp + ny * xSteer * 0.025;
        const mirrorX = Math.abs(localX - heroX) + heroX;
        const texX = lerp(localX, mirrorX, scene.symmetry * 0.60);
        const n1 = fbm(texX * 1.30 + time * 0.009, ny * 1.15 - time * 0.008);
        const n2 = noise(texX * 3.0 - time * 0.012, ny * 2.7 + time * 0.009);

        let r = 4;
        let g = 8;
        let b = 13;

        if (sky) {
          const altitude = clamp01((horizon - ny + 0.12) / 1.20);
          const magenta = smoothstep(0.48, 0.82, n1 + field * 0.24);
          const cyan = smoothstep(0.43, 0.80, n2 - field * 0.18);
          r += 9 + altitude * 16 + magenta * (21 + warmBias * 34 + e.grain * 9);
          g += 13 + altitude * 22 + cyan * (27 + coolBias * 33 + e.drift * 9);
          b += 24 + altitude * 42 + magenta * 25 + cyan * 32;

          const archRadial = Math.hypot((nx - heroX) * 0.88, (ny - (heroY + scene.archLift * 0.35)) * 1.03);
          const arch = 1 - smoothstep(0.010, 0.080, Math.abs(archRadial - archRadius));
          r += arch * (42 + warmBias * 50 + e.ember * 28 + scene.portalMorph * 12);
          g += arch * (18 + coolBias * 29 + e.halo * 19);
          b += arch * (37 + e.halo * 32 + scene.portalMorph * 10);

          const portalRadial = Math.hypot(nx - heroX, ny - heroY);
          const portalEdge = 1 - smoothstep(0.006, 0.042, Math.abs(portalRadial - portalRadius));
          r += portalEdge * (69 + e.ember * 36 + scene.reveal * 24);
          g += portalEdge * (28 + e.halo * 24);
          b += portalEdge * (49 + e.halo * 32);
          const voidMask = 1 - smoothstep(portalRadius * 0.38, portalRadius * 0.78, portalRadial);
          r *= 1 - voidMask * 0.72;
          g *= 1 - voidMask * 0.76;
          b *= 1 - voidMask * 0.68;
        } else {
          const depth = clamp01((ny - horizon) / Math.max(0.01, 1 - horizon));
          const water = noise(texX * (2.8 + e.grain * 0.6) + time * 0.018, ny * 5.0 - time * (0.018 + e.drift * 0.038));
          const reflectionWidth = Math.max(1.6, 4.7 - e.drift * 0.9 - scene.mirror * 1.4);
          const reflection = Math.exp(-Math.abs(nx - heroX) * reflectionWidth) * (1 - depth * (0.54 - scene.mirror * 0.18));
          r += 5 + depth * 7 + reflection * (38 + warmBias * 38 + e.ember * 19 + scene.mirror * 27) + water * e.grain * 7;
          g += 13 + depth * 12 + reflection * (46 + coolBias * 41 + e.drift * 25 + scene.mirror * 25);
          b += 20 + depth * 23 + reflection * (58 + e.halo * 27 + scene.mirror * 29);

          const basinY = 0.72 - scene.basin * 0.055;
          const dist = Math.hypot((nx - heroX) * (0.88 - scene.basin * 0.10), (ny - basinY) * (1.76 - scene.basin * 0.34));
          const ripple = Math.sin(dist * (23 + e.grain * 7 - scene.basin * 4.2) - time * (0.34 + e.drift * 0.55));
          const rippleGlow = Math.pow(clamp01(ripple * 0.5 + 0.5), 9) * smoothstep(horizon, 0.98, ny);
          r += rippleGlow * (18 + warmBias * 19 + e.grain * 20 + scene.basin * 17);
          g += rippleGlow * (24 + coolBias * 21 + scene.basin * 11);
          b += rippleGlow * (35 + scene.basin * 17);
        }

        const horizonGlow = 1 - smoothstep(0.006, 0.080, Math.abs(ny - horizon));
        r += horizonGlow * (33 + warmBias * 27 + e.ember * 17 + scene.mirror * 12);
        g += horizonGlow * (31 + coolBias * 26 + e.drift * 14 + scene.mirror * 14);
        b += horizonGlow * (38 + scene.mirror * 11);

        if (e.artifact > 0.01) {
          const tear = Math.sin(py * 0.39 + time * 6.1 + nx * 0.7) * e.artifact;
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

  private drawWorld(ctx: CanvasRenderingContext2D, time: number, e: Energy, patch: PatchField, scene: SceneState) {
    const w = this.width;
    const h = this.height;
    const minDim = Math.min(w, h);
    const xSteer = this.x - 0.5;
    const horizon = h * (scene.horizon + (0.5 - this.y) * 0.055);
    const heroX = w * (0.5 + scene.heroX + xSteer * (0.20 + patch.xStrength * 0.05));
    const heroY = horizon - h * (scene.heroLift + this.y * 0.018);

    this.drawDistantArches(ctx, heroX, heroY, minDim, e, scene);
    this.drawConstellations(ctx, heroX, heroY, minDim, e, scene, time);
    this.drawPortal(ctx, heroX, heroY, horizon, minDim, e, scene, time);
    this.drawTerrain(ctx, horizon, e, scene, time);
    this.drawSideMasses(ctx, horizon, minDim, e, scene, time);
    this.drawShrines(ctx, horizon, minDim, e, scene, time);
    this.drawReflections(ctx, heroX, horizon, e, scene, time);
    this.drawWaterScript(ctx, heroX, horizon, e, scene, time);
    this.drawBasin(ctx, heroX, scene, time);
    this.drawOrbitals(ctx, heroX, heroY, minDim, e, scene, time);
    this.drawForegroundOccluders(ctx, horizon, minDim, e, scene, time);
    this.drawForegroundOrb(ctx, heroX, heroY, horizon, minDim, e, scene);
    this.drawMaskHints(ctx, heroX, heroY, horizon, minDim, e, scene, time);
    this.drawArtifact(ctx, e, time);
  }

  private drawDistantArches(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, scene: SceneState) {
    const count = Math.max(1, Math.min(5, Math.round(scene.archCount + e.halo)));
    const centerY = cy + minDim * scene.archLift;
    const tilt = (this.x - 0.5) * (1 - scene.symmetry) * 0.16;

    ctx.save();
    ctx.translate(cx, centerY);
    ctx.rotate(tilt);
    ctx.translate(-cx, -centerY);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < count; i += 1) {
      const radius = minDim * (0.29 + scene.archScale * 0.23 + i * 0.095);
      const rx = radius * (1.05 + scene.corridor * 0.13);
      const ry = radius * (0.78 + scene.symmetry * 0.12);
      const alpha = Math.max(0.022, 0.092 - i * 0.015 + e.halo * 0.018 + scene.portalMorph * 0.012);
      const gradient = ctx.createLinearGradient(cx - rx, centerY, cx + rx, centerY);
      gradient.addColorStop(0, `rgba(74,214,220,${alpha * 0.62})`);
      gradient.addColorStop(0.48, `rgba(224,103,193,${alpha * 0.80})`);
      gradient.addColorStop(0.74, `rgba(255,158,91,${alpha})`);
      gradient.addColorStop(1, `rgba(81,211,219,${alpha * 0.42})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(1, minDim * (0.0042 - i * 0.00045));
      ctx.beginPath();
      ctx.ellipse(cx, centerY, rx, ry, 0, Math.PI * 1.035, Math.PI * 1.965);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawConstellations(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    if (scene.constellations < 0.08) return;
    const count = 4 + Math.round(scene.constellations * 5);
    const points: [number, number][] = [];
    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0 : i / (count - 1);
      const angle = Math.PI * (1.06 + p * 0.88) + Math.sin(t * 0.015 + i) * 0.012;
      const radius = minDim * (0.28 + (i % 3) * 0.052 + scene.archScale * 0.055);
      points.push([cx + Math.cos(angle) * radius * 1.32, cy + Math.sin(angle) * radius * 0.72]);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(188,224,220,${0.018 + scene.constellations * 0.022})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    for (let i = 0; i < points.length; i += 1) {
      const [x, y] = points[i];
      const r = minDim * (0.0035 + (i % 3) * 0.0017);
      ctx.fillStyle = i % 2 ? 'rgba(87,216,220,0.18)' : 'rgba(247,160,100,0.18)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPortal(ctx: CanvasRenderingContext2D, cx: number, cy: number, horizon: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    const r = minDim * scene.portalScale * (1 + e.halo * 0.10 + e.ember * 0.06 + scene.reveal * 0.10);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const corona = ctx.createRadialGradient(cx, cy, r * 0.34, cx, cy, r * (1.85 + scene.portalMorph * 0.45));
    corona.addColorStop(0, 'rgba(0,0,0,0)');
    corona.addColorStop(0.34, `rgba(255,149,82,${0.17 + e.ember * 0.11 + scene.reveal * 0.05})`);
    corona.addColorStop(0.60, `rgba(232,96,187,${0.10 + e.halo * 0.06})`);
    corona.addColorStop(0.81, `rgba(82,216,222,${0.08 + e.drift * 0.05})`);
    corona.addColorStop(1, 'rgba(82,216,222,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.85 + scene.portalMorph * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(1,3,7,0.99)';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (scene.portalMorph > 0.04) {
      const innerHorizon = cy + r * lerp(0.28, -0.10, scene.portalMorph);
      const innerGlow = ctx.createLinearGradient(cx, innerHorizon - r * 0.35, cx, innerHorizon + r * 0.35);
      innerGlow.addColorStop(0, `rgba(100,41,126,${0.08 + scene.portalMorph * 0.15})`);
      innerGlow.addColorStop(0.48, `rgba(247,145,93,${0.10 + scene.portalMorph * 0.20})`);
      innerGlow.addColorStop(0.55, `rgba(82,216,222,${0.08 + scene.portalMorph * 0.16})`);
      innerGlow.addColorStop(1, 'rgba(2,5,9,0)');
      ctx.fillStyle = innerGlow;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      ctx.strokeStyle = `rgba(238,244,235,${0.055 + scene.portalMorph * 0.12})`;
      ctx.lineWidth = Math.max(1, minDim * 0.0015);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.70, innerHorizon);
      ctx.lineTo(cx + r * 0.70, innerHorizon);
      ctx.stroke();

      for (let i = 0; i < 4; i += 1) {
        const p = i / 3;
        ctx.strokeStyle = i % 2
          ? `rgba(87,216,220,${0.05 + scene.portalMorph * 0.08})`
          : `rgba(233,104,190,${0.045 + scene.portalMorph * 0.07})`;
        ctx.beginPath();
        ctx.ellipse(cx, innerHorizon + r * (0.18 + p * 0.22), r * (0.18 + p * 0.42), r * (0.035 + p * 0.06), 0, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(255,191,121,${0.11 + e.ember * 0.06 + scene.reveal * 0.05})`;
    ctx.lineWidth = Math.max(1, minDim * 0.0035);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.80, 0, Math.PI * 2);
    ctx.stroke();

    if (scene.glyphs > 0.08 && scene.portalMorph > 0.08) {
      const glyphAlpha = scene.glyphs * scene.portalMorph * 0.055;
      for (let i = 0; i < 3; i += 1) {
        const rr = r * (1.08 + i * 0.23);
        const start = t * (0.018 + i * 0.004) + i * 1.3;
        ctx.strokeStyle = i % 2 ? `rgba(88,215,220,${glyphAlpha})` : `rgba(236,111,191,${glyphAlpha})`;
        ctx.lineWidth = Math.max(1, minDim * 0.0015);
        ctx.beginPath();
        ctx.arc(cx, cy, rr, start, start + Math.PI * (0.52 + i * 0.12));
        ctx.stroke();
      }
    }

    const beamBottom = lerp(horizon, this.height * 0.84, scene.corridor * 0.78 + scene.foregroundOrb * 0.18);
    ctx.strokeStyle = `rgba(242,248,237,${0.045 + scene.corridor * 0.055 + scene.mirror * 0.020})`;
    ctx.lineWidth = Math.max(1, minDim * 0.0022);
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.55);
    ctx.lineTo(cx, beamBottom);
    ctx.stroke();
    ctx.restore();
  }

  private terrainShape(index: number, layer: number, chapter: number, symmetry: number): number {
    const phase = chapter * 1.73 + layer * 2.11;
    const asymmetric = Math.sin(index * (0.72 + chapter * 0.032) + phase) * 0.43
      + Math.sin(index * (1.56 + chapter * 0.038) - phase * 0.58) * 0.22;
    const mirrorIndex = index <= 32 ? index : 64 - index;
    const mirrored = Math.sin(mirrorIndex * (0.78 + chapter * 0.028) + phase) * 0.44
      + Math.sin(mirrorIndex * (1.61 + chapter * 0.025) - phase * 0.54) * 0.21;
    return lerp(asymmetric, mirrored, symmetry);
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, scene: SceneState, _t: number) {
    const w = this.width;
    const h = this.height;
    const count = 64;

    for (let layer = 0; layer < 3; layer += 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.34 + layer * 0.22 + e.atmos * 0.05;
      ctx.fillStyle = layer === 0 ? 'rgba(12,23,28,0.86)' : layer === 1 ? 'rgba(6,13,18,0.93)' : 'rgba(2,6,10,0.98)';
      ctx.beginPath();
      ctx.moveTo(0, horizon);

      for (let i = 0; i <= count; i += 1) {
        const p = i / count;
        const px = p * w;
        const shapeA = this.terrainShape(i, layer, scene.chapterA, scene.symmetry);
        const shapeB = this.terrainShape(i, layer, scene.chapterB, scene.symmetry);
        const n = lerp(shapeA, shapeB, scene.terrainMorph);
        const centerDistance = Math.abs(p - 0.5) * 2;
        const corridorWall = Math.pow(centerDistance, 1.7) * scene.corridor;
        const broad = Math.pow(Math.abs(Math.sin(i * 0.37 + scene.chapterA * 0.91)), 4) * scene.mass * 0.050;
        const spikeSeedA = Math.abs(Math.sin(i * 2.31 + layer + scene.chapterA * 0.83));
        const spikeSeedB = Math.abs(Math.sin(i * 2.31 + layer + scene.chapterB * 0.83));
        const spikeSeed = lerp(spikeSeedA, spikeSeedB, scene.terrainMorph);
        const spike = Math.pow(spikeSeed, Math.max(6, 17 - scene.mass * 9)) * (0.068 + scene.flora * 0.046);
        const height = h * (0.025 + Math.max(0, n) * 0.042 + broad + spike + corridorWall * 0.070) * (0.65 + layer * 0.16);
        ctx.lineTo(px, horizon - height);
      }

      ctx.lineTo(w, horizon);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSideMasses(ctx: CanvasRenderingContext2D, horizon: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    if (scene.sideMass < 0.04) return;
    const w = this.width;
    const h = this.height;

    for (let side = 0; side < 2; side += 1) {
      const dir = side === 0 ? 1 : -1;
      const edgeX = side === 0 ? 0 : w;
      const reach = w * (0.10 + scene.sideMass * 0.15 + scene.foregroundMorph * 0.04);
      const top = horizon - h * (0.28 + scene.flora * 0.10);

      ctx.save();
      ctx.fillStyle = 'rgba(2,6,9,0.96)';
      ctx.beginPath();
      ctx.moveTo(edgeX, h);
      ctx.lineTo(edgeX, top);
      for (let i = 0; i <= 18; i += 1) {
        const p = i / 18;
        const yy = lerp(top, h * 0.86, p);
        const branch = Math.pow(Math.abs(Math.sin(i * 1.72 + scene.chapterA * 0.81 + side * 0.7)), 4);
        const nextBranch = Math.pow(Math.abs(Math.sin(i * 1.72 + scene.chapterB * 0.81 + side * 0.7)), 4);
        const morphBranch = lerp(branch, nextBranch, scene.terrainMorph);
        const flutter = Math.sin(t * 0.035 + i * 0.6 + side) * minDim * 0.003;
        const xx = edgeX + dir * (reach * (0.35 + morphBranch * 0.65) * (1 - p * 0.28) + flutter);
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(edgeX, h);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(79,213,218,${0.015 + scene.flora * 0.025 + e.atmos * 0.010})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        const rootY = horizon + h * (0.05 + i * 0.10);
        const tipX = edgeX + dir * reach * (0.55 + i * 0.11);
        ctx.beginPath();
        ctx.moveTo(edgeX, rootY);
        ctx.quadraticCurveTo(edgeX + dir * reach * 0.30, rootY - h * 0.09, tipX, rootY - h * (0.03 + i * 0.012));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawShrines(ctx: CanvasRenderingContext2D, horizon: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    if (scene.shrine < 0.05) return;
    const w = this.width;
    const count = 3 + Math.round(scene.shrine * 5);

    ctx.save();
    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0.5 : i / (count - 1);
      const centered = (p - 0.5) * 2;
      const x = w * (0.5 + centered * (0.34 + scene.corridor * 0.08));
      const seed = hash(i + scene.chapterA * 11.7, 3.2);
      const nextSeed = hash(i + scene.chapterB * 11.7, 3.2);
      const mixedSeed = lerp(seed, nextSeed, scene.terrainMorph);
      const height = minDim * (0.08 + mixedSeed * 0.18) * (0.55 + scene.shrine * 0.75);
      const width = minDim * (0.009 + mixedSeed * 0.010);
      const sway = Math.sin(t * 0.018 + i) * minDim * 0.002;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,7,11,0.93)';
      ctx.beginPath();
      ctx.moveTo(x - width, horizon);
      ctx.lineTo(x - width * 0.55 + sway, horizon - height * 0.76);
      ctx.lineTo(x + sway, horizon - height);
      ctx.lineTo(x + width * 0.55 + sway, horizon - height * 0.76);
      ctx.lineTo(x + width, horizon);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(244,158,99,${0.018 + scene.shrine * 0.025 + e.ember * 0.012})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, horizon - height * 0.94);
      ctx.lineTo(x, horizon - height * 0.38);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawReflections(ctx: CanvasRenderingContext2D, heroX: number, horizon: number, e: Energy, scene: SceneState, t: number) {
    const w = this.width;
    const h = this.height;
    const count = Math.min(13, 6 + Math.round(e.drift * 2 + scene.mirror * 5));

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const yy = horizon + h * (0.022 + i * (0.043 - scene.mirror * 0.0025));
      const spread = w * (0.032 + i * (0.048 + scene.mirror * 0.003));
      const wobble = (1 - scene.mirror * 0.70) * (1 + e.drift * 1.1);
      const alpha = Math.max(0.013, 0.050 - i * 0.0036 + e.drift * 0.010 + scene.mirror * 0.013);
      ctx.strokeStyle = i % 2 ? `rgba(92,215,220,${alpha})` : `rgba(232,112,188,${alpha * 0.74})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(heroX - spread, yy + Math.sin(t * 0.047 + i) * wobble);
      ctx.quadraticCurveTo(heroX, yy - h * (0.007 + scene.mirror * 0.006), heroX + spread, yy + Math.cos(t * 0.043 + i) * wobble);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWaterScript(ctx: CanvasRenderingContext2D, heroX: number, horizon: number, e: Energy, scene: SceneState, t: number) {
    const amount = scene.waterMorph * (0.25 + scene.glyphs * 0.75) * scene.mirror;
    if (amount < 0.04) return;

    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i += 1) {
      const y = horizon + h * (0.10 + i * 0.075);
      const width = w * (0.12 + i * 0.06);
      const phase = t * 0.028 + i * 1.1;
      ctx.strokeStyle = i % 2
        ? `rgba(86,214,219,${0.012 + amount * 0.032})`
        : `rgba(231,111,189,${0.010 + amount * 0.028})`;
      ctx.beginPath();
      ctx.moveTo(heroX - width, y);
      ctx.bezierCurveTo(
        heroX - width * 0.45,
        y + Math.sin(phase) * h * 0.018,
        heroX + width * 0.10,
        y - Math.cos(phase * 1.2) * h * 0.022,
        heroX + width,
        y + Math.sin(phase * 0.8) * h * 0.014
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBasin(ctx: CanvasRenderingContext2D, heroX: number, scene: SceneState, t: number) {
    const w = this.width;
    const h = this.height;
    const cy = h * (0.89 - scene.basin * 0.035 + Math.sin(t * 0.015) * 0.0015);
    const count = 4 + Math.round(scene.basin * 6);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = i / Math.max(1, count - 1);
      const rx = w * (0.052 + p * (0.29 + scene.basin * 0.19));
      const ry = h * (0.010 + p * (0.055 + scene.basin * 0.078));
      const alpha = 0.042 - p * 0.018 + scene.basin * 0.011;
      ctx.strokeStyle = i % 2 ? `rgba(90,214,218,${alpha})` : `rgba(226,104,187,${alpha * 0.92})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(heroX, cy, rx, ry, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawOrbitals(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    const count = Math.min(9, 3 + Math.round(scene.constellations * 3 + e.halo * 3));
    ctx.save();
    for (let i = 0; i < count; i += 1) {
      const p = count <= 1 ? 0.5 : i / (count - 1);
      const organized = clamp01(scene.symmetry * 0.55 + scene.corridor * 0.25 + scene.portalMorph * 0.20);
      const arcAngle = Math.PI * (1.08 + p * 0.84);
      const freeAngle = i * 1.37 + scene.chapterA * 0.61 + t * (0.006 + (i % 3) * 0.0016);
      const angle = lerp(freeAngle, arcAngle, organized);
      const orbit = minDim * (0.26 + (i % 4) * 0.075 + scene.archScale * 0.05);
      const px = cx + Math.cos(angle) * orbit * 1.34;
      const py = cy + Math.sin(angle) * orbit * 0.70;
      const r = minDim * (0.0065 + (i % 3) * 0.0036);

      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = i % 2 ? 'rgba(90,210,219,0.17)' : 'rgba(244,139,95,0.18)';
      ctx.beginPath();
      ctx.arc(px, py, r * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,6,12,0.93)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawForegroundOccluders(ctx: CanvasRenderingContext2D, horizon: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    const amount = clamp01(scene.sideMass * 0.55 + scene.foregroundMorph * 0.45);
    if (amount < 0.08) return;
    const w = this.width;
    const h = this.height;

    for (let side = 0; side < 2; side += 1) {
      const dir = side === 0 ? 1 : -1;
      const edgeX = side === 0 ? 0 : w;
      const reach = w * (0.08 + amount * 0.13);
      ctx.save();
      ctx.fillStyle = 'rgba(1,4,7,0.97)';
      ctx.beginPath();
      ctx.moveTo(edgeX, h);
      ctx.lineTo(edgeX, horizon + h * 0.12);
      ctx.bezierCurveTo(
        edgeX + dir * reach * 0.20,
        horizon + h * 0.08,
        edgeX + dir * reach * 0.86,
        h * (0.68 + side * 0.02),
        edgeX + dir * reach,
        h * 0.88
      );
      ctx.quadraticCurveTo(edgeX + dir * reach * 0.55, h * (0.94 + Math.sin(t * 0.018 + side) * 0.005), edgeX, h);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = side === 0
        ? `rgba(86,214,219,${0.012 + amount * 0.022 + e.drift * 0.008})`
        : `rgba(231,111,189,${0.012 + amount * 0.022 + e.ember * 0.008})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(edgeX + dir * reach * 0.10, horizon + h * 0.18);
      ctx.quadraticCurveTo(edgeX + dir * reach * 0.76, h * 0.71, edgeX + dir * reach * 0.94, h * 0.87);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawForegroundOrb(ctx: CanvasRenderingContext2D, heroX: number, heroY: number, horizon: number, minDim: number, e: Energy, scene: SceneState) {
    if (scene.foregroundOrb < 0.04) return;
    const h = this.height;
    const amount = smoothstep(0.02, 0.88, scene.foregroundOrb);
    const cy = h * lerp(0.85, 0.79, amount);
    const radius = minDim * lerp(0.012, 0.062, amount);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(heroX, cy, radius * 0.55, heroX, cy, radius * 2.4);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(0.38, `rgba(238,102,191,${0.05 + amount * 0.065})`);
    glow.addColorStop(0.66, `rgba(82,216,222,${0.05 + amount * 0.05 + e.drift * 0.018})`);
    glow.addColorStop(1, 'rgba(82,216,222,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(heroX, cy, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(2,4,9,0.988)';
    ctx.beginPath();
    ctx.arc(heroX, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (amount > 0.45) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(235,242,235,${0.025 + amount * 0.035})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(heroX, Math.max(horizon, heroY + radius));
      ctx.lineTo(heroX, cy - radius);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawMaskHints(ctx: CanvasRenderingContext2D, heroX: number, heroY: number, horizon: number, minDim: number, e: Energy, scene: SceneState, t: number) {
    const amount = scene.mask * scene.reveal;
    if (amount < 0.10) return;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(224,232,224,${0.012 + amount * 0.045 + e.atmos * 0.006})`;
    ctx.lineWidth = 1;

    for (let side = 0; side < 2; side += 1) {
      const x = w * (side === 0 ? 0.18 : 0.82);
      const y = horizon - h * (0.08 + scene.corridor * 0.04);
      const r = minDim * (0.045 + amount * 0.018);
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.55, r * 0.55, (side ? -1 : 1) * (this.x - 0.5) * 0.08, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + (this.x - 0.5) * r * 0.20, y, r * (0.11 + amount * 0.07), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (amount > 0.55) {
      ctx.strokeStyle = `rgba(236,180,137,${(amount - 0.55) * 0.05})`;
      ctx.beginPath();
      ctx.moveTo(heroX, heroY + minDim * 0.08);
      ctx.quadraticCurveTo(heroX + Math.sin(t * 0.021) * minDim * 0.012, horizon - minDim * 0.04, heroX, horizon + minDim * 0.015);
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
