import type { ModuleState, XYAssignment } from '../../ui/types';

type RGB = [number, number, number];
type MorphKey = 'eye' | 'tree' | 'ocean' | 'galaxy' | 'crystal' | 'landscape';
type MorphWeights = Record<MorphKey, number>;

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
};

const PALETTE = {
  bone: [238, 244, 239] as RGB,
  copper: [232, 165, 96] as RGB,
  sea: [133, 196, 188] as RGB,
  dusk: [165, 145, 196] as RGB,
  ash: [186, 171, 154] as RGB,
};

const MORPHS: MorphKey[] = ['eye', 'tree', 'ocean', 'galaxy', 'crystal', 'landscape'];
const RASTER_W = 112;
const RASTER_H = 72;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
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
const fbm = (x: number, y: number) => {
  let value = 0;
  let amp = 0.55;
  let freq = 1;
  for (let octave = 0; octave < 3; octave += 1) {
    value += noise(x * freq, y * freq) * amp;
    freq *= 2.03;
    amp *= 0.47;
  }
  return value;
};

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
  private weights: MorphWeights = {
    eye: 0.08,
    tree: 0.10,
    ocean: 0.12,
    galaxy: 0.10,
    crystal: 0.05,
    landscape: 0.55,
  };

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

    const follow = expEase(frame.dragging ? 18 : 5.2, dt);
    this.x = lerp(this.x, clamp01(frame.x), follow);
    this.y = lerp(this.y, clamp01(frame.y), follow);
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, expEase(frame.dragging ? 12 : 3.2, dt));

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

    const targetWeights = this.resolveDominantWeights(frame.time, emberMix, driftMix, haloMix, atmosMix, grainMix);
    const morphEase = expEase(frame.dragging ? 3.2 : 0.82, dt);
    for (const key of MORPHS) this.weights[key] = lerp(this.weights[key], targetWeights[key], morphEase);

    const width = this.width;
    const height = this.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const patchEnergy = Math.min(1, frame.assignments.length / 6);

    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderRaster(frame.time, emberMix, driftMix, haloMix, atmosMix, grainMix, artifactMix, patchEnergy);
      this.lastRasterTime = frame.time;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgb(8,11,10)';
    ctx.fillRect(0, 0, width, height);
    this.drawMemory(ctx, frame.time, cx, cy, width, height, haloMix, artifactMix);

    if (this.raster) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.97;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.raster, 0, 0, width, height);
      ctx.restore();
    }

    this.drawRecognitionAccents(ctx, frame.time, width, height, emberMix, haloMix, atmosMix);
    this.drawArtifactDecay(ctx, frame.time, width, height, artifactMix, valueOf(artifact, 'wear', 0));
    this.captureMemory(ctx, width, height);
  }

  private resolveDominantWeights(time: number, ember: number, drift: number, halo: number, atmos: number, grain: number): MorphWeights {
    const up = this.y;
    const right = this.x;
    const slowA = Math.sin(time * 0.061) * 0.5 + 0.5;
    const slowB = Math.sin(time * 0.043 + 2.1) * 0.5 + 0.5;
    const slowC = Math.sin(time * 0.029 + 4.2) * 0.5 + 0.5;

    const scores: MorphWeights = {
      eye: 0.12 + right * up * 0.34 + ember * 0.82 + halo * 0.12 + slowA * 0.16,
      tree: 0.12 + (1 - right) * 0.28 + atmos * 0.82 + slowB * 0.15,
      ocean: 0.12 + (1 - right) * (1 - up) * 0.30 + drift * 0.86 + slowC * 0.15,
      galaxy: 0.13 + right * 0.30 + halo * 0.88 + atmos * 0.18 + slowA * 0.17,
      crystal: 0.06 + up * 0.20 + grain * 0.98 + slowB * 0.10,
      landscape: 0.24 + (1 - up) * 0.16 + atmos * 0.22 + drift * 0.10 + slowC * 0.20,
    };

    const ranked = [...MORPHS].sort((a, b) => scores[b] - scores[a]);
    const raw: MorphWeights = { eye: 0, tree: 0, ocean: 0, galaxy: 0, crystal: 0, landscape: 0 };
    raw[ranked[0]] = Math.pow(scores[ranked[0]], 3.1);
    raw[ranked[1]] = Math.pow(scores[ranked[1]], 2.7) * 0.70;
    raw[ranked[2]] = Math.pow(scores[ranked[2]], 2.3) * 0.10;

    const total = MORPHS.reduce((sum, key) => sum + raw[key], 0) || 1;
    for (const key of MORPHS) raw[key] /= total;
    return raw;
  }

  private renderRaster(time: number, ember: number, drift: number, halo: number, atmos: number, grain: number, artifact: number, patchEnergy: number) {
    if (!this.rasterCtx || !this.imageData) return;
    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const t = time * 0.12;
    const copperBias = clamp01(this.weights.eye * 0.72 + ember * 0.66 + artifact * 0.12);
    const seaBias = clamp01(this.weights.ocean * 0.72 + drift * 0.48);
    const duskBias = clamp01(this.weights.galaxy * 0.48 + this.weights.crystal * 0.52 + halo * 0.20);
    const tintTotal = Math.max(1, 1 + copperBias + seaBias + duskBias);
    const tintR = (PALETTE.bone[0] + PALETTE.copper[0] * copperBias + PALETTE.sea[0] * seaBias + PALETTE.dusk[0] * duskBias) / tintTotal;
    const tintG = (PALETTE.bone[1] + PALETTE.copper[1] * copperBias + PALETTE.sea[1] * seaBias + PALETTE.dusk[1] * duskBias) / tintTotal;
    const tintB = (PALETTE.bone[2] + PALETTE.copper[2] * copperBias + PALETTE.sea[2] * seaBias + PALETTE.dusk[2] * duskBias) / tintTotal;

    for (let py = 0; py < RASTER_H; py += 1) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px += 1) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;
        const warp = fbm(nx * 1.15 + t * 0.32, ny * 1.15 - t * 0.20) - 0.5;
        const warp2 = noise(nx * 2.2 - t * 0.16, ny * 2.0 + t * 0.24) - 0.5;
        const weird = 0.08 + this.y * 0.06 + this.gesture * 0.05 + grain * 0.04;
        const x = nx + warp2 * weird;
        const y = ny + warp * weird;

        const eye = this.eyeField(x, y, t, ember, halo);
        const tree = this.treeField(x, y, t, atmos);
        const ocean = this.oceanField(x, y, t, drift);
        const galaxy = this.galaxyField(x, y, t, halo, atmos);
        const crystal = this.crystalField(x, y, t, grain);
        const landscape = this.landscapeField(x, y, t, atmos, drift);
        let intensity = eye * this.weights.eye + tree * this.weights.tree + ocean * this.weights.ocean
          + galaxy * this.weights.galaxy + crystal * this.weights.crystal + landscape * this.weights.landscape;

        const fog = smoothstep(0.34, 0.82, noise(x * 3.0 + t * 0.35, y * 3.0 - t * 0.26)) * (0.10 + atmos * 0.18 + halo * 0.08);
        intensity = clamp01(intensity * 1.26 + fog + patchEnergy * 0.035);

        const radial = Math.hypot(nx / Math.max(0.01, aspect), ny);
        const vignette = 1 - smoothstep(0.78, 1.36, radial);
        intensity *= 0.58 + vignette * 0.70;

        const sparkle = galaxy > 0.58 && hash(px * 0.73 + Math.floor(time * 2), py * 1.13) > 0.986 ? 0.72 : 0;
        const hot = clamp01(intensity + sparkle);
        const base = 9 + intensity * 28;
        let r = base + tintR * hot * 0.82;
        let g = base + tintG * hot * 0.82;
        let b = base + tintB * hot * 0.82;

        if (artifact > 0.01) {
          const tear = Math.sin(py * 0.31 + time * 8.0) * artifact;
          r += tear * 10;
          b -= tear * 6;
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

  private eyeField(x: number, y: number, t: number, ember: number, halo: number) {
    const rx = x * (0.76 + halo * 0.08);
    const ry = y * 1.42;
    const r = Math.hypot(rx, ry);
    const angle = Math.atan2(ry, rx);
    const lid = Math.abs(ry) - (0.34 + 0.10 * Math.cos(rx * 2.8 + t));
    const lidLine = 1 - smoothstep(0.0, 0.075, Math.abs(lid));
    const irisRing = 1 - smoothstep(0.03, 0.095, Math.abs(r - (0.26 + Math.sin(t * 0.7) * 0.012)));
    const pupil = 1 - smoothstep(0.10, 0.18, r);
    const spokes = Math.pow(Math.max(0, Math.sin(angle * 20 + r * 17 - t * 2.0)), 7) * (1 - smoothstep(0.20, 0.48, r));
    return clamp01(lidLine * 0.55 + irisRing * 0.88 + pupil * (0.45 + ember * 0.35) + spokes * 0.22);
  }

  private treeField(x: number, y: number, t: number, atmos: number) {
    const trunkCenter = Math.sin((y + 0.4) * 4 + t * 0.7) * 0.04;
    const trunk = 1 - smoothstep(0.025, 0.10 + atmos * 0.035, Math.abs(x - trunkCenter));
    const heightMask = 1 - smoothstep(0.70, 0.94, y);
    let branches = 0;
    for (let level = 0; level < 3; level += 1) {
      const yy = -0.05 - level * 0.22;
      const spread = 0.22 + level * 0.15 + atmos * 0.08;
      const local = Math.abs(y - yy);
      const branchMask = 1 - smoothstep(0.015, 0.060, local);
      const left = 1 - smoothstep(0.025, 0.080, Math.abs(x + spread * (0.45 + local * 2.1) + Math.sin(t + level) * 0.025));
      const right = 1 - smoothstep(0.025, 0.080, Math.abs(x - spread * (0.45 + local * 2.1) - Math.cos(t * 0.8 + level) * 0.025));
      branches = Math.max(branches, branchMask * Math.max(left, right));
    }
    const canopyNoise = noise(x * 4.6 + t * 0.18, y * 4.6 - t * 0.13);
    const canopyShape = 1 - smoothstep(0.48, 0.82, Math.hypot(x * 0.82, (y + 0.33) * 1.3));
    const canopy = canopyShape * smoothstep(0.44, 0.70, canopyNoise) * (0.34 + atmos * 0.40);
    return clamp01(trunk * heightMask + branches * 0.80 + canopy);
  }

  private oceanField(x: number, y: number, t: number, drift: number) {
    const horizon = 1 - smoothstep(0.015, 0.06, Math.abs(y + 0.05 + Math.sin(t * 0.25) * 0.025));
    const wave1 = Math.sin(x * 5.2 + t * (2.0 + drift * 2.2) + y * 3.1);
    const wave2 = Math.sin(x * 9.1 - t * 1.6 - y * 5.8);
    const bands = Math.pow(clamp01((wave1 + wave2 * 0.45) * 0.5 + 0.5), 5);
    const waterMask = smoothstep(-0.18, 0.12, y);
    const foam = bands * waterMask * (0.42 + drift * 0.45);
    return clamp01(horizon * 0.72 + foam + smoothstep(0.58, 0.82, noise(x * 4, y * 4 + t)) * waterMask * 0.14);
  }

  private galaxyField(x: number, y: number, t: number, halo: number, atmos: number) {
    const r = Math.hypot(x, y * 1.15);
    const a = Math.atan2(y, x);
    const spiral = Math.sin(a * 4 - r * (10 + halo * 7) + t * (2 + halo * 2.4));
    const arm = Math.pow(clamp01(spiral * 0.5 + 0.5), 5) * (1 - smoothstep(0.10, 1.08, r));
    const core = 1 - smoothstep(0.0, 0.24 + atmos * 0.08, r);
    const dust = smoothstep(0.56, 0.80, noise(x * 5.5 + t * 0.18, y * 5.5 - t * 0.15)) * (1 - smoothstep(0.2, 1.1, r));
    return clamp01(core * 0.72 + arm * 0.82 + dust * 0.20);
  }

  private crystalField(x: number, y: number, t: number, grain: number) {
    const angle = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const facets = 6 + Math.round(grain * 8);
    const sector = Math.abs(Math.sin(angle * facets * 0.5 + t * 0.7));
    const rings = Math.abs(Math.sin(r * (12 + grain * 18) - t * 1.4));
    const edges = 1 - smoothstep(0.03, 0.13, Math.min(sector, rings));
    const shards = smoothstep(0.64, 0.86, noise(x * 7.0 - t * 0.25, y * 7.0 + t * 0.22));
    return clamp01(edges * (0.40 + grain * 0.55) + shards * grain * 0.30);
  }

  private landscapeField(x: number, y: number, t: number, atmos: number, drift: number) {
    const ridgeNoise = fbm(x * 1.45 + t * 0.10, 1.7 + t * 0.035);
    const detail = noise(x * 4.2 - t * 0.04, 4.1);
    const ridgeY = -0.10 + (ridgeNoise - 0.5) * (0.58 + atmos * 0.22) + (detail - 0.5) * 0.14;
    const ridge = 1 - smoothstep(0.015, 0.075, Math.abs(y - ridgeY));
    const farNoise = noise(x * 1.05 - t * 0.07, 7.2);
    const farY = -0.32 + (farNoise - 0.5) * 0.28;
    const farRidge = 1 - smoothstep(0.025, 0.085, Math.abs(y - farY));
    const valleyGlow = smoothstep(ridgeY - 0.12, ridgeY + 0.42, y) * (1 - smoothstep(ridgeY + 0.22, 1.1, y));
    const skyMask = 1 - smoothstep(ridgeY - 0.08, ridgeY + 0.10, y);
    const sky = smoothstep(0.55, 0.82, noise(x * 2.2 + t * 0.07, y * 2.2 - t * 0.05)) * skyMask;
    const shoreline = 1 - smoothstep(0.015, 0.05, Math.abs(y - 0.42 - Math.sin(x * 2.1 + t * 0.25) * 0.04 * (0.4 + drift)));
    return clamp01(ridge * 0.86 + farRidge * 0.45 + valleyGlow * 0.18 + sky * 0.15 + shoreline * drift * 0.22);
  }

  private drawRecognitionAccents(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, ember: number, halo: number, atmos: number) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (this.weights.eye > 0.48) {
      ctx.strokeStyle = `rgba(${PALETTE.copper.join(',')},${0.10 + ember * 0.12})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, width * 0.17, height * 0.11, Math.sin(time * 0.05) * 0.04, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.weights.landscape > 0.46) {
      ctx.strokeStyle = `rgba(${PALETTE.ash.join(',')},0.10)`;
      ctx.beginPath();
      for (let i = 0; i <= 36; i += 1) {
        const x = i / 36 * width;
        const nx = i / 36 * 2 - 1;
        const y = height * (0.43 + (noise(nx * 1.5 + time * 0.02, 3.2) - 0.5) * (0.18 + atmos * 0.05));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (this.weights.galaxy > 0.46) {
      ctx.fillStyle = `rgba(${PALETTE.bone.join(',')},${0.10 + halo * 0.08})`;
      for (let i = 0; i < 22; i += 1) {
        const a = i * 2.399 + time * 0.025;
        const r = (0.08 + ((i * 17) % 100) / 100 * 0.38) * Math.min(width, height);
        ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.52, 1.2, 1.2);
      }
    }
    ctx.restore();
  }

  private drawMemory(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, width: number, height: number, halo: number, artifact: number) {
    if (!this.memory) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.08 + halo * 0.07 + artifact * 0.03;
    const breathe = 1.003 + Math.sin(time * 0.08) * 0.003 + halo * 0.004;
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 0.027) * 0.003 + artifact * Math.sin(time * 0.5) * 0.0015);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx + Math.sin(time * 0.11) * artifact * 2.5, -cy);
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
    const scars = 3 + Math.round(wear * 5);
    for (let i = 0; i < scars; i += 1) {
      const rawY = (Math.sin(i * 8.13) * 0.5 + 0.5) * height + time * (2 + wear * 7) * (i % 2 ? 1 : -1);
      const y = ((rawY % height) + height) % height;
      ctx.fillStyle = `rgba(${PALETTE.ash.join(',')},${0.018 + mix * wear * 0.05})`;
      ctx.fillRect(Math.sin(time * 0.7 + i) * wear * 8, y, width, 1 + (i % 3));
    }
    ctx.restore();
  }
}
