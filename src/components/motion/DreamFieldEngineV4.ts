import type { ModuleState, XYAssignment } from '../../ui/types';

type RGB = [number, number, number];
type DreamKey = 'eye' | 'tree' | 'ocean' | 'galaxy' | 'crystal' | 'landscape';
type DreamScores = Record<DreamKey, number>;

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
};

type DreamPair = {
  a: DreamKey;
  b: DreamKey;
  blend: number;
};

const PALETTE = {
  bone: [238, 244, 239] as RGB,
  copper: [232, 165, 96] as RGB,
  sea: [133, 196, 188] as RGB,
  dusk: [165, 145, 196] as RGB,
  ash: [186, 171, 154] as RGB,
};

const DREAMS: DreamKey[] = ['landscape', 'tree', 'eye', 'galaxy', 'ocean', 'crystal'];
const RASTER_W = 104;
const RASTER_H = 68;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
const fract = (value: number) => value - Math.floor(value);
const expEase = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
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

const fbm2 = (x: number, y: number) =>
  noise(x, y) * 0.66 + noise(x * 2.03 + 8.7, y * 2.03 - 4.1) * 0.34;

export class DreamFieldEngine {
  private width = 1;
  private height = 1;
  private x = 0.5;
  private y = 0.5;
  private gesture = 0;
  private lastTime = 0;
  private lastRasterTime = -Infinity;
  private memory: HTMLCanvasElement | null = null;
  private memoryCtx: CanvasRenderingContext2D | null = null;
  private raster: HTMLCanvasElement | null = null;
  private rasterCtx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const changed = Math.abs(nextWidth - this.width) > 0.5 || Math.abs(nextHeight - this.height) > 0.5;
    this.width = nextWidth;
    this.height = nextHeight;

    if (typeof document !== 'undefined') {
      if (!this.memory) {
        this.memory = document.createElement('canvas');
        this.memoryCtx = this.memory.getContext('2d', { alpha: true });
      }
      if (!this.raster) {
        this.raster = document.createElement('canvas');
        this.raster.width = RASTER_W;
        this.raster.height = RASTER_H;
        this.rasterCtx = this.raster.getContext('2d', { alpha: true });
        this.imageData = this.rasterCtx?.createImageData(RASTER_W, RASTER_H) ?? null;
      }
    }

    if (this.memory && changed) {
      this.memory.width = Math.max(1, Math.round(this.width));
      this.memory.height = Math.max(1, Math.round(this.height));
      this.memoryCtx?.clearRect(0, 0, this.memory.width, this.memory.height);
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    const dt = this.lastTime > 0 ? frame.time - this.lastTime : 1 / 60;
    this.lastTime = frame.time;

    const follow = expEase(frame.dragging ? 18 : 5.0, dt);
    this.x = lerp(this.x, clamp01(frame.x), follow);
    this.y = lerp(this.y, clamp01(frame.y), follow);
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, expEase(frame.dragging ? 12 : 3.0, dt));

    const active = frame.modules.filter((module) => module.enabled && module.available);
    const byId = (id: string) => active.find((module) => module.id === id);
    const ember = byId('saturation');
    const drift = byId('chorus');
    const halo = byId('delay');
    const atmos = byId('reverb');
    const grain = byId('bitcrusher');
    const artifact = byId('media');

    const emberMix = valueOf(ember, 'mix', 0);
    const driftMix = valueOf(drift, 'mix', 0);
    const haloMix = valueOf(halo, 'mix', 0);
    const atmosMix = valueOf(atmos, 'mix', 0);
    const grainMix = valueOf(grain, 'mix', 0);
    const artifactMix = valueOf(artifact, 'mix', 0);
    const patchEnergy = Math.min(1, frame.assignments.length / 6);

    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderJourneyRaster(
        frame.time,
        emberMix,
        driftMix,
        haloMix,
        atmosMix,
        grainMix,
        artifactMix,
        patchEnergy
      );
      this.lastRasterTime = frame.time;
    }

    const width = this.width;
    const height = this.height;
    const cx = width * 0.5;
    const cy = height * 0.5;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgb(7,10,9)';
    ctx.fillRect(0, 0, width, height);
    this.drawMemory(ctx, frame.time, cx, cy, width, height, haloMix, artifactMix);

    if (this.raster) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.98;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.raster, 0, 0, width, height);
      ctx.restore();
    }

    this.drawJourneyAccents(ctx, frame.time, width, height, emberMix, haloMix, atmosMix);
    this.drawArtifactDecay(ctx, frame.time, width, height, artifactMix, valueOf(artifact, 'wear', 0));
    this.captureMemory(ctx, width, height);
  }

  private dreamPairAt(time: number, ember: number, drift: number, halo: number, atmos: number, grain: number): DreamPair {
    const slowA = Math.sin(time * 0.19) * 0.5 + 0.5;
    const slowB = Math.sin(time * 0.137 + 2.1) * 0.5 + 0.5;
    const slowC = Math.sin(time * 0.101 + 4.2) * 0.5 + 0.5;
    const scores: DreamScores = {
      eye: 0.18 + this.x * this.y * 0.28 + ember * 0.92 + halo * 0.10 + slowA * 0.20,
      tree: 0.18 + (1 - this.x) * 0.24 + atmos * 0.92 + slowB * 0.18,
      ocean: 0.18 + (1 - this.x) * (1 - this.y) * 0.24 + drift * 0.96 + slowC * 0.18,
      galaxy: 0.18 + this.x * 0.24 + halo * 0.98 + atmos * 0.16 + slowA * 0.22,
      crystal: 0.12 + this.y * 0.18 + grain * 1.06 + slowB * 0.14,
      landscape: 0.30 + (1 - this.y) * 0.16 + atmos * 0.24 + drift * 0.10 + slowC * 0.22,
    };
    const ranked = [...DREAMS].sort((a, b) => scores[b] - scores[a]);
    const first = scores[ranked[0]];
    const second = scores[ranked[1]];
    const blend = clamp01(second / Math.max(0.001, first + second));
    return { a: ranked[0], b: ranked[1], blend: 0.16 + blend * 0.54 };
  }

  private renderJourneyRaster(
    time: number,
    ember: number,
    drift: number,
    halo: number,
    atmos: number,
    grain: number,
    artifact: number,
    patchEnergy: number
  ) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const zoomSpeed = 0.055 + drift * 0.018 + halo * 0.012 + this.gesture * 0.018;
    const journey = time * zoomSpeed;
    const phase = fract(journey);
    const easedPhase = phase * phase * (3 - 2 * phase);
    const zoom = Math.pow(2, phase * 1.72);
    const futureZoom = Math.pow(2, fract(phase + 0.46) * 1.54);
    const currentPair = this.dreamPairAt(time, ember, drift, halo, atmos, grain);
    const futurePair = this.dreamPairAt(time + 13.5, ember * 0.92, drift, halo, atmos, grain);

    const portalX = (this.x - 0.5) * 0.32 + Math.sin(time * 0.071) * 0.055;
    const portalY = (0.5 - this.y) * 0.23 + Math.cos(time * 0.059) * 0.045;
    const portalRadius = 0.10 + easedPhase * 1.34;

    const copperBias = clamp01((currentPair.a === 'eye' || futurePair.a === 'eye' ? 0.38 : 0) + ember * 0.70 + artifact * 0.10);
    const seaBias = clamp01((currentPair.a === 'ocean' || futurePair.a === 'ocean' ? 0.35 : 0) + drift * 0.48);
    const duskBias = clamp01((currentPair.a === 'galaxy' || futurePair.a === 'galaxy' ? 0.34 : 0) + grain * 0.24 + halo * 0.26);
    const tintTotal = Math.max(1, 1 + copperBias + seaBias + duskBias);
    const tintR = (PALETTE.bone[0] + PALETTE.copper[0] * copperBias + PALETTE.sea[0] * seaBias + PALETTE.dusk[0] * duskBias) / tintTotal;
    const tintG = (PALETTE.bone[1] + PALETTE.copper[1] * copperBias + PALETTE.sea[1] * seaBias + PALETTE.dusk[1] * duskBias) / tintTotal;
    const tintB = (PALETTE.bone[2] + PALETTE.copper[2] * copperBias + PALETTE.sea[2] * seaBias + PALETTE.dusk[2] * duskBias) / tintTotal;

    for (let py = 0; py < RASTER_H; py += 1) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px += 1) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;

        const driftWarp = noise(nx * 1.7 + time * 0.031, ny * 1.7 - time * 0.025) - 0.5;
        const curlWarp = noise(nx * 3.1 - time * 0.019, ny * 2.8 + time * 0.027) - 0.5;
        const warpAmount = 0.055 + grain * 0.035 + this.gesture * 0.035;

        const cx = (nx + driftWarp * warpAmount) / zoom + portalX * (1 - 1 / zoom);
        const cy = (ny + curlWarp * warpAmount) / zoom + portalY * (1 - 1 / zoom);

        const fx = (nx - portalX) / futureZoom;
        const fy = (ny - portalY) / futureZoom;

        const current = this.samplePair(currentPair, cx, cy, time * 0.12, ember, drift, halo, atmos, grain);
        const future = this.samplePair(futurePair, fx, fy, time * 0.12 + 1.7, ember, drift, halo, atmos, grain);

        const portalNoise = (noise(nx * 2.4 + time * 0.04, ny * 2.4 - time * 0.033) - 0.5) * 0.16;
        const portalDistance = Math.hypot((nx - portalX) / Math.max(0.7, aspect), ny - portalY) + portalNoise;
        const portal = 1 - smoothstep(portalRadius - 0.22, portalRadius + 0.16, portalDistance);

        let intensity = lerp(current, future, portal);
        const fog = smoothstep(0.48, 0.82, noise(nx * 2.2 + time * 0.025, ny * 2.2 - time * 0.021));
        intensity = clamp01(intensity * 1.18 + fog * (0.08 + atmos * 0.13 + halo * 0.06) + patchEnergy * 0.025);

        const edgeDepth = 1 - smoothstep(0.88, 1.42, Math.hypot(nx / Math.max(0.01, aspect), ny));
        intensity *= 0.68 + edgeDepth * 0.52;

        const sparkle = futurePair.a === 'galaxy' && hash(px * 0.91 + Math.floor(time * 2), py * 1.21) > 0.988 ? 0.68 : 0;
        const hot = clamp01(intensity + sparkle);
        const base = 10 + intensity * 30;
        let r = base + tintR * hot * 0.84;
        let g = base + tintG * hot * 0.84;
        let b = base + tintB * hot * 0.84;

        if (artifact > 0.01) {
          const tear = Math.sin(py * 0.33 + time * 7.4) * artifact;
          r += tear * 9;
          b -= tear * 5;
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

  private samplePair(pair: DreamPair, x: number, y: number, t: number, ember: number, drift: number, halo: number, atmos: number, grain: number) {
    const a = this.sampleDream(pair.a, x, y, t, ember, drift, halo, atmos, grain);
    const b = this.sampleDream(pair.b, x, y, t + 0.43, ember, drift, halo, atmos, grain);
    const localMorph = clamp01(pair.blend + (noise(x * 1.6 + t * 0.2, y * 1.6 - t * 0.15) - 0.5) * 0.22);
    return lerp(a, b, localMorph);
  }

  private sampleDream(key: DreamKey, x: number, y: number, t: number, ember: number, drift: number, halo: number, atmos: number, grain: number) {
    switch (key) {
      case 'eye': return this.eyeField(x, y, t, ember, halo);
      case 'tree': return this.treeField(x, y, t, atmos);
      case 'ocean': return this.oceanField(x, y, t, drift);
      case 'galaxy': return this.galaxyField(x, y, t, halo, atmos);
      case 'crystal': return this.crystalField(x, y, t, grain);
      case 'landscape': return this.landscapeField(x, y, t, atmos, drift);
    }
  }

  private eyeField(x: number, y: number, t: number, ember: number, halo: number) {
    const rx = x * (0.72 + halo * 0.10);
    const ry = y * 1.36;
    const r = Math.hypot(rx, ry);
    const angle = Math.atan2(ry, rx);
    const lidShape = 0.31 + Math.cos(rx * 2.3 + t * 0.7) * 0.08;
    const lid = 1 - smoothstep(0.018, 0.085, Math.abs(Math.abs(ry) - lidShape));
    const iris = 1 - smoothstep(0.025, 0.10, Math.abs(r - (0.25 + Math.sin(t * 0.63) * 0.018)));
    const pupil = 1 - smoothstep(0.08, 0.17, r);
    const spokes = Math.pow(clamp01(Math.sin(angle * 18 + r * 16 - t * 1.7) * 0.5 + 0.5), 7) * (1 - smoothstep(0.18, 0.49, r));
    const haloRing = 1 - smoothstep(0.02, 0.08, Math.abs(r - 0.43));
    return clamp01(lid * 0.52 + iris * 0.86 + pupil * (0.42 + ember * 0.34) + spokes * 0.24 + haloRing * halo * 0.18);
  }

  private treeField(x: number, y: number, t: number, atmos: number) {
    const sway = Math.sin(t * 0.75 + y * 3.2) * 0.045;
    const trunk = 1 - smoothstep(0.024, 0.10 + atmos * 0.028, Math.abs(x - sway));
    const heightMask = 1 - smoothstep(0.62, 0.95, y);
    const root = smoothstep(0.10, 0.85, y) * (1 - smoothstep(0.05, 0.22, Math.abs(x)));
    let branches = 0;
    for (let level = 0; level < 3; level += 1) {
      const yy = -0.04 - level * 0.23;
      const localY = Math.abs(y - yy);
      const branchBand = 1 - smoothstep(0.012, 0.065, localY);
      const spread = 0.19 + level * 0.15 + atmos * 0.08;
      const branchX = spread * (0.40 + localY * 2.1);
      const left = 1 - smoothstep(0.02, 0.08, Math.abs(x + branchX + Math.sin(t + level) * 0.035));
      const right = 1 - smoothstep(0.02, 0.08, Math.abs(x - branchX - Math.cos(t * 0.8 + level) * 0.035));
      branches = Math.max(branches, branchBand * Math.max(left, right));
    }
    const canopyShape = 1 - smoothstep(0.45, 0.86, Math.hypot(x * 0.80, (y + 0.34) * 1.22));
    const canopy = canopyShape * smoothstep(0.48, 0.73, noise(x * 4.2 + t * 0.17, y * 4.2 - t * 0.12));
    return clamp01(trunk * heightMask * 0.82 + branches * 0.88 + root * 0.30 + canopy * (0.30 + atmos * 0.44));
  }

  private oceanField(x: number, y: number, t: number, drift: number) {
    const horizonY = -0.08 + Math.sin(t * 0.22) * 0.035;
    const horizon = 1 - smoothstep(0.012, 0.065, Math.abs(y - horizonY));
    const waterMask = smoothstep(-0.20, 0.12, y);
    const wave1 = Math.sin(x * 5.0 + t * (1.7 + drift * 2.2) + y * 3.1);
    const wave2 = Math.sin(x * 9.0 - t * 1.5 - y * 5.4);
    const wave3 = Math.sin(x * 2.4 + y * 8.0 + t * 0.8);
    const bands = Math.pow(clamp01((wave1 + wave2 * 0.45 + wave3 * 0.25) * 0.38 + 0.5), 5);
    const foam = bands * waterMask * (0.40 + drift * 0.48);
    const reflection = (1 - smoothstep(0.0, 0.48, Math.abs(x))) * waterMask * (0.12 + Math.sin(y * 20 + t) * 0.04);
    return clamp01(horizon * 0.72 + foam + reflection + smoothstep(0.60, 0.84, noise(x * 3.5, y * 3.5 + t)) * waterMask * 0.13);
  }

  private galaxyField(x: number, y: number, t: number, halo: number, atmos: number) {
    const r = Math.hypot(x, y * 1.12);
    const a = Math.atan2(y, x);
    const spiral = Math.sin(a * 4 - r * (9.5 + halo * 7.5) + t * (1.7 + halo * 2.4));
    const arm = Math.pow(clamp01(spiral * 0.5 + 0.5), 5) * (1 - smoothstep(0.10, 1.18, r));
    const core = 1 - smoothstep(0.02, 0.25 + atmos * 0.09, r);
    const dust = smoothstep(0.58, 0.82, noise(x * 5.0 + t * 0.16, y * 5.0 - t * 0.14)) * (1 - smoothstep(0.22, 1.15, r));
    const ring = 1 - smoothstep(0.02, 0.08, Math.abs(r - (0.52 + Math.sin(a * 3 + t) * 0.08)));
    return clamp01(core * 0.76 + arm * 0.86 + dust * 0.19 + ring * halo * 0.14);
  }

  private crystalField(x: number, y: number, t: number, grain: number) {
    const angle = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const facets = 6 + Math.round(grain * 8);
    const sector = Math.abs(Math.sin(angle * facets * 0.5 + t * 0.65));
    const rings = Math.abs(Math.sin(r * (11 + grain * 19) - t * 1.25));
    const edges = 1 - smoothstep(0.025, 0.14, Math.min(sector, rings));
    const shards = smoothstep(0.65, 0.87, noise(x * 6.5 - t * 0.22, y * 6.5 + t * 0.20));
    const core = 1 - smoothstep(0.10, 0.42, r);
    return clamp01(edges * (0.36 + grain * 0.56) + shards * grain * 0.31 + core * grain * 0.13);
  }

  private landscapeField(x: number, y: number, t: number, atmos: number, drift: number) {
    const ridgeNoise = fbm2(x * 1.28 + t * 0.075, 1.7 + t * 0.028);
    const detail = noise(x * 3.8 - t * 0.035, 4.1);
    const ridgeY = -0.10 + (ridgeNoise - 0.5) * (0.62 + atmos * 0.25) + (detail - 0.5) * 0.15;
    const ridge = 1 - smoothstep(0.014, 0.080, Math.abs(y - ridgeY));
    const farNoise = noise(x * 1.0 - t * 0.055, 7.2);
    const farY = -0.34 + (farNoise - 0.5) * 0.30;
    const farRidge = 1 - smoothstep(0.024, 0.090, Math.abs(y - farY));
    const valleyGlow = smoothstep(ridgeY - 0.12, ridgeY + 0.44, y) * (1 - smoothstep(ridgeY + 0.24, 1.1, y));
    const skyMask = 1 - smoothstep(ridgeY - 0.08, ridgeY + 0.12, y);
    const clouds = smoothstep(0.58, 0.84, noise(x * 2.0 + t * 0.055, y * 2.0 - t * 0.04)) * skyMask;
    const path = (1 - smoothstep(0.04, 0.18 + y * 0.12, Math.abs(x + Math.sin(y * 3 + t * 0.3) * 0.12))) * smoothstep(0.05, 0.92, y);
    const shoreline = 1 - smoothstep(0.015, 0.055, Math.abs(y - 0.44 - Math.sin(x * 2.0 + t * 0.21) * 0.045 * (0.4 + drift)));
    return clamp01(ridge * 0.88 + farRidge * 0.42 + valleyGlow * 0.18 + clouds * 0.15 + path * 0.17 + shoreline * drift * 0.18);
  }

  private drawJourneyAccents(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, ember: number, halo: number, atmos: number) {
    const pair = this.dreamPairAt(time, ember, 0, halo, atmos, 0);
    const cx = width * (0.5 + (this.x - 0.5) * 0.08);
    const cy = height * (0.5 - (this.y - 0.5) * 0.06);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    if (pair.a === 'eye' || pair.b === 'eye') {
      ctx.strokeStyle = `rgba(${PALETTE.copper.join(',')},${0.08 + ember * 0.10})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, width * 0.17, height * 0.105, Math.sin(time * 0.04) * 0.035, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (pair.a === 'galaxy' || pair.b === 'galaxy') {
      ctx.fillStyle = `rgba(${PALETTE.bone.join(',')},${0.075 + halo * 0.06})`;
      for (let i = 0; i < 18; i += 1) {
        const a = i * 2.399 + time * 0.021;
        const r = (0.06 + ((i * 17) % 100) / 100 * 0.36) * Math.min(width, height);
        ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.52, 1.1, 1.1);
      }
    }
    ctx.restore();
  }

  private drawMemory(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, width: number, height: number, halo: number, artifact: number) {
    if (!this.memory) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.07 + halo * 0.06 + artifact * 0.025;
    const breathe = 1.006 + Math.sin(time * 0.07) * 0.003 + halo * 0.004;
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 0.024) * 0.0025 + artifact * Math.sin(time * 0.45) * 0.0015);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx + Math.sin(time * 0.10) * artifact * 2, -cy + Math.cos(time * 0.08) * halo * 1.2);
    ctx.drawImage(this.memory, 0, 0, width, height);
    ctx.restore();
  }

  private captureMemory(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.memory || !this.memoryCtx) return;
    this.memoryCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.memoryCtx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.memoryCtx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, this.memory.width, this.memory.height);
  }

  private drawArtifactDecay(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, mix: number, wear: number) {
    if (mix <= 0.01) return;
    ctx.save();
    const scars = 2 + Math.round(wear * 5);
    for (let i = 0; i < scars; i += 1) {
      const rawY = (Math.sin(i * 8.13) * 0.5 + 0.5) * height + time * (2 + wear * 6) * (i % 2 ? 1 : -1);
      const y = ((rawY % height) + height) % height;
      ctx.fillStyle = `rgba(${PALETTE.ash.join(',')},${0.014 + mix * wear * 0.045})`;
      ctx.fillRect(Math.sin(time * 0.7 + i) * wear * 7, y, width, 1 + (i % 2));
    }
    ctx.restore();
  }
}
