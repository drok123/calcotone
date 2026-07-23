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

type DreamPair = { a: DreamKey; b: DreamKey; blend: number };

type Region = {
  x: number;
  y: number;
  radius: number;
  seed: number;
  key: DreamKey;
  next: DreamKey;
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const expEase = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
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
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
};
const fbm2 = (x: number, y: number) => noise(x, y) * 0.66 + noise(x * 2.03 + 8.7, y * 2.03 - 4.1) * 0.34;

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
  private regions: Region[] = [];

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, width), nextHeight = Math.max(1, height);
    const changed = Math.abs(nextWidth - this.width) > 0.5 || Math.abs(nextHeight - this.height) > 0.5;
    this.width = nextWidth; this.height = nextHeight;
    if (typeof document !== 'undefined') {
      if (!this.memory) { this.memory = document.createElement('canvas'); this.memoryCtx = this.memory.getContext('2d', { alpha: true }); }
      if (!this.raster) {
        this.raster = document.createElement('canvas'); this.raster.width = RASTER_W; this.raster.height = RASTER_H;
        this.rasterCtx = this.raster.getContext('2d', { alpha: true });
        this.imageData = this.rasterCtx?.createImageData(RASTER_W, RASTER_H) ?? null;
      }
    }
    if (this.memory && changed) {
      this.memory.width = Math.max(1, Math.round(this.width)); this.memory.height = Math.max(1, Math.round(this.height));
      this.memoryCtx?.clearRect(0, 0, this.memory.width, this.memory.height);
    }
    if (!this.regions.length) this.buildRegions();
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    const dt = this.lastTime > 0 ? frame.time - this.lastTime : 1 / 60; this.lastTime = frame.time;
    const follow = expEase(frame.dragging ? 18 : 5, dt);
    this.x = lerp(this.x, clamp01(frame.x), follow); this.y = lerp(this.y, clamp01(frame.y), follow);
    this.gesture = lerp(this.gesture, frame.dragging ? 1 : 0, expEase(frame.dragging ? 12 : 3, dt));

    const active = frame.modules.filter((m) => m.enabled && m.available);
    const byId = (id: string) => active.find((m) => m.id === id);
    const ember = byId('saturation'), drift = byId('chorus'), halo = byId('delay'), atmos = byId('reverb'), grain = byId('bitcrusher'), artifact = byId('media');
    const emberMix = valueOf(ember, 'mix', 0), driftMix = valueOf(drift, 'mix', 0), haloMix = valueOf(halo, 'mix', 0), atmosMix = valueOf(atmos, 'mix', 0), grainMix = valueOf(grain, 'mix', 0), artifactMix = valueOf(artifact, 'mix', 0);
    const patchEnergy = Math.min(1, frame.assignments.length / 6);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderRaster(frame.time, emberMix, driftMix, haloMix, atmosMix, grainMix, artifactMix, patchEnergy);
      this.lastRasterTime = frame.time;
    }

    const width = this.width, height = this.height, cx = width * 0.5, cy = height * 0.5;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = 'rgb(7,10,9)'; ctx.fillRect(0, 0, width, height);
    this.drawMemory(ctx, frame.time, cx, cy, width, height, haloMix, artifactMix);
    if (this.raster) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.99; ctx.imageSmoothingEnabled = true; ctx.drawImage(this.raster, 0, 0, width, height); ctx.restore(); }
    this.drawArtifactDecay(ctx, frame.time, width, height, artifactMix, valueOf(artifact, 'wear', 0));
    this.captureMemory(ctx);
  }

  private buildRegions() {
    this.regions = Array.from({ length: 11 }, (_, i) => {
      const seed = i * 19.37 + 4.2;
      return {
        x: hash(seed, 1.3) * 2 - 1,
        y: hash(seed, 8.1) * 1.8 - 0.9,
        radius: 0.32 + hash(seed, 4.7) * 0.44,
        seed,
        key: DREAMS[Math.floor(hash(seed, 2.2) * DREAMS.length) % DREAMS.length],
        next: DREAMS[Math.floor(hash(seed, 9.9) * DREAMS.length) % DREAMS.length],
      };
    });
  }

  private pairAt(time: number, ember: number, drift: number, halo: number, atmos: number, grain: number): DreamPair {
    const scores: DreamScores = {
      eye: 0.18 + this.x * this.y * 0.28 + ember * 0.92 + Math.sin(time * 0.19) * 0.10,
      tree: 0.18 + (1 - this.x) * 0.24 + atmos * 0.92 + Math.sin(time * 0.137 + 2.1) * 0.09,
      ocean: 0.18 + (1 - this.x) * (1 - this.y) * 0.24 + drift * 0.96 + Math.sin(time * 0.101 + 4.2) * 0.09,
      galaxy: 0.18 + this.x * 0.24 + halo * 0.98 + atmos * 0.16 + Math.sin(time * 0.17 + 1.1) * 0.11,
      crystal: 0.12 + this.y * 0.18 + grain * 1.06 + Math.sin(time * 0.113 + 3.2) * 0.07,
      landscape: 0.30 + (1 - this.y) * 0.16 + atmos * 0.24 + drift * 0.10 + Math.sin(time * 0.083) * 0.11,
    };
    const ranked = [...DREAMS].sort((a, b) => scores[b] - scores[a]);
    const first = scores[ranked[0]], second = scores[ranked[1]];
    return { a: ranked[0], b: ranked[1], blend: 0.18 + clamp01(second / Math.max(0.001, first + second)) * 0.50 };
  }

  private renderRaster(time: number, ember: number, drift: number, halo: number, atmos: number, grain: number, artifact: number, patchEnergy: number) {
    if (!this.rasterCtx || !this.imageData) return;
    const data = this.imageData.data, aspect = this.width / Math.max(1, this.height);
    const journey = time * (0.050 + drift * 0.016 + halo * 0.012 + this.gesture * 0.016);
    const phase = fract(journey), zoom = Math.pow(2, phase * 1.55);
    const pair = this.pairAt(time, ember, drift, halo, atmos, grain);
    const futurePair = this.pairAt(time + 12.7, ember, drift, halo, atmos, grain);
    const portalX = (this.x - 0.5) * 0.36 + Math.sin(time * 0.067) * 0.06;
    const portalY = (0.5 - this.y) * 0.27 + Math.cos(time * 0.053) * 0.05;
    const portalRadius = 0.08 + smoothstep(0, 1, phase) * 1.38;

    const copperBias = clamp01((pair.a === 'eye' ? 0.34 : 0) + ember * 0.68 + artifact * 0.10);
    const seaBias = clamp01((pair.a === 'ocean' ? 0.34 : 0) + drift * 0.46);
    const duskBias = clamp01((pair.a === 'galaxy' ? 0.34 : 0) + grain * 0.24 + halo * 0.26);
    const total = Math.max(1, 1 + copperBias + seaBias + duskBias);
    const tint: RGB = [
      (PALETTE.bone[0] + PALETTE.copper[0] * copperBias + PALETTE.sea[0] * seaBias + PALETTE.dusk[0] * duskBias) / total,
      (PALETTE.bone[1] + PALETTE.copper[1] * copperBias + PALETTE.sea[1] * seaBias + PALETTE.dusk[1] * duskBias) / total,
      (PALETTE.bone[2] + PALETTE.copper[2] * copperBias + PALETTE.sea[2] * seaBias + PALETTE.dusk[2] * duskBias) / total,
    ];

    for (let py = 0; py < RASTER_H; py++) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px++) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;
        const warpA = noise(nx * 1.6 + time * 0.029, ny * 1.6 - time * 0.023) - 0.5;
        const warpB = noise(nx * 2.8 - time * 0.017, ny * 2.6 + time * 0.025) - 0.5;
        const warp = 0.055 + grain * 0.035 + this.gesture * 0.035;
        const x = (nx + warpA * warp) / zoom + portalX * (1 - 1 / zoom);
        const y = (ny + warpB * warp) / zoom + portalY * (1 - 1 / zoom);

        let current = this.samplePair(pair, x, y, time * 0.12, ember, drift, halo, atmos, grain);
        let regional = 0, regionalWeight = 0;
        for (const region of this.regions) {
          const driftX = region.x + Math.sin(time * 0.037 + region.seed) * 0.18;
          const driftY = region.y + Math.cos(time * 0.031 + region.seed * 0.7) * 0.14;
          const d = Math.hypot((nx - driftX) / Math.max(0.75, aspect), ny - driftY);
          const mask = 1 - smoothstep(region.radius * 0.55, region.radius, d);
          if (mask <= 0.001) continue;
          const localPhase = fract(time * (0.018 + hash(region.seed, 3.4) * 0.014) + hash(region.seed, 6.8));
          const morph = smoothstep(0.18, 0.82, localPhase);
          const scale = 0.65 + localPhase * 1.55;
          const rx = (nx - driftX) / scale;
          const ry = (ny - driftY) / scale;
          const a = this.sampleDream(region.key, rx, ry, time * 0.11 + region.seed, ember, drift, halo, atmos, grain);
          const b = this.sampleDream(region.next, rx, ry, time * 0.11 + region.seed + 1.7, ember, drift, halo, atmos, grain);
          const value = lerp(a, b, morph);
          regional += value * mask; regionalWeight += mask;
        }
        if (regionalWeight > 0) current = lerp(current, regional / regionalWeight, clamp01(regionalWeight * 0.72));

        const fx = (nx - portalX) / (0.52 + phase * 1.45);
        const fy = (ny - portalY) / (0.52 + phase * 1.45);
        const future = this.samplePair(futurePair, fx, fy, time * 0.12 + 1.9, ember, drift, halo, atmos, grain);
        const portalNoise = (noise(nx * 2.3 + time * 0.04, ny * 2.3 - time * 0.031) - 0.5) * 0.18;
        const portalD = Math.hypot((nx - portalX) / Math.max(0.72, aspect), ny - portalY) + portalNoise;
        const portal = 1 - smoothstep(portalRadius - 0.22, portalRadius + 0.17, portalD);
        let intensity = lerp(current, future, portal);

        const organic = fbm2(x * 2.1 + time * 0.025, y * 2.1 - time * 0.021);
        const cellular = Math.abs(noise(x * 5.2 + time * 0.018, y * 5.2 - time * 0.016) - 0.5) * 2;
        const membrane = smoothstep(0.56, 0.82, organic) * (1 - smoothstep(0.62, 0.92, cellular));
        intensity = clamp01(intensity * 1.12 + membrane * (0.10 + atmos * 0.10 + grain * 0.06) + patchEnergy * 0.022);
        const depth = 1 - smoothstep(0.90, 1.46, Math.hypot(nx / Math.max(0.01, aspect), ny));
        intensity *= 0.70 + depth * 0.50;

        const hot = clamp01(intensity);
        const base = 11 + intensity * 32;
        let r = base + tint[0] * hot * 0.86, g = base + tint[1] * hot * 0.86, b = base + tint[2] * hot * 0.86;
        if (artifact > 0.01) { const tear = Math.sin(py * 0.33 + time * 7.2) * artifact; r += tear * 9; b -= tear * 5; }
        const index = (py * RASTER_W + px) * 4;
        data[index] = Math.max(0, Math.min(255, r)); data[index + 1] = Math.max(0, Math.min(255, g)); data[index + 2] = Math.max(0, Math.min(255, b)); data[index + 3] = 255;
      }
    }
    this.rasterCtx.putImageData(this.imageData, 0, 0);
  }

  private samplePair(pair: DreamPair, x: number, y: number, t: number, ember: number, drift: number, halo: number, atmos: number, grain: number) {
    const a = this.sampleDream(pair.a, x, y, t, ember, drift, halo, atmos, grain);
    const b = this.sampleDream(pair.b, x, y, t + 0.43, ember, drift, halo, atmos, grain);
    return lerp(a, b, clamp01(pair.blend + (noise(x * 1.5 + t * 0.18, y * 1.5 - t * 0.14) - 0.5) * 0.26));
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
    const rx = x * (0.72 + halo * 0.10), ry = y * 1.36, r = Math.hypot(rx, ry), a = Math.atan2(ry, rx);
    const lidShape = 0.31 + Math.cos(rx * 2.3 + t * 0.7) * 0.08;
    const lid = 1 - smoothstep(0.018, 0.085, Math.abs(Math.abs(ry) - lidShape));
    const iris = 1 - smoothstep(0.025, 0.10, Math.abs(r - (0.25 + Math.sin(t * 0.63) * 0.018)));
    const pupil = 1 - smoothstep(0.08, 0.17, r);
    const spokes = Math.pow(clamp01(Math.sin(a * 18 + r * 16 - t * 1.7) * 0.5 + 0.5), 7) * (1 - smoothstep(0.18, 0.49, r));
    return clamp01(lid * 0.52 + iris * 0.86 + pupil * (0.42 + ember * 0.34) + spokes * 0.24);
  }
  private treeField(x: number, y: number, t: number, atmos: number) {
    const sway = Math.sin(t * 0.75 + y * 3.2) * 0.045;
    const trunk = 1 - smoothstep(0.024, 0.10 + atmos * 0.028, Math.abs(x - sway));
    const heightMask = 1 - smoothstep(0.62, 0.95, y);
    let branches = 0;
    for (let level = 0; level < 3; level++) {
      const yy = -0.04 - level * 0.23, localY = Math.abs(y - yy), band = 1 - smoothstep(0.012, 0.065, localY), spread = 0.19 + level * 0.15 + atmos * 0.08;
      const bx = spread * (0.40 + localY * 2.1);
      branches = Math.max(branches, band * Math.max(1 - smoothstep(0.02, 0.08, Math.abs(x + bx + Math.sin(t + level) * 0.035)), 1 - smoothstep(0.02, 0.08, Math.abs(x - bx - Math.cos(t * 0.8 + level) * 0.035))));
    }
    const canopy = (1 - smoothstep(0.45, 0.86, Math.hypot(x * 0.80, (y + 0.34) * 1.22))) * smoothstep(0.48, 0.73, noise(x * 4.2 + t * 0.17, y * 4.2 - t * 0.12));
    return clamp01(trunk * heightMask * 0.82 + branches * 0.88 + canopy * (0.30 + atmos * 0.44));
  }
  private oceanField(x: number, y: number, t: number, drift: number) {
    const horizon = 1 - smoothstep(0.012, 0.065, Math.abs(y + 0.08 - Math.sin(t * 0.22) * 0.035));
    const water = smoothstep(-0.20, 0.12, y);
    const bands = Math.pow(clamp01((Math.sin(x * 5 + t * (1.7 + drift * 2.2) + y * 3.1) + Math.sin(x * 9 - t * 1.5 - y * 5.4) * 0.45) * 0.42 + 0.5), 5);
    return clamp01(horizon * 0.72 + bands * water * (0.40 + drift * 0.48) + smoothstep(0.60, 0.84, noise(x * 3.5, y * 3.5 + t)) * water * 0.13);
  }
  private galaxyField(x: number, y: number, t: number, halo: number, atmos: number) {
    const r = Math.hypot(x, y * 1.12), a = Math.atan2(y, x);
    const arm = Math.pow(clamp01(Math.sin(a * 4 - r * (9.5 + halo * 7.5) + t * (1.7 + halo * 2.4)) * 0.5 + 0.5), 5) * (1 - smoothstep(0.10, 1.18, r));
    const core = 1 - smoothstep(0.02, 0.25 + atmos * 0.09, r);
    return clamp01(core * 0.76 + arm * 0.86 + smoothstep(0.58, 0.82, noise(x * 5 + t * 0.16, y * 5 - t * 0.14)) * (1 - smoothstep(0.22, 1.15, r)) * 0.19);
  }
  private crystalField(x: number, y: number, t: number, grain: number) {
    const a = Math.atan2(y, x), r = Math.hypot(x, y), facets = 6 + Math.round(grain * 8);
    const edges = 1 - smoothstep(0.025, 0.14, Math.min(Math.abs(Math.sin(a * facets * 0.5 + t * 0.65)), Math.abs(Math.sin(r * (11 + grain * 19) - t * 1.25))));
    return clamp01(edges * (0.36 + grain * 0.56) + smoothstep(0.65, 0.87, noise(x * 6.5 - t * 0.22, y * 6.5 + t * 0.20)) * grain * 0.31);
  }
  private landscapeField(x: number, y: number, t: number, atmos: number, drift: number) {
    const ridgeY = -0.10 + (fbm2(x * 1.28 + t * 0.075, 1.7 + t * 0.028) - 0.5) * (0.62 + atmos * 0.25) + (noise(x * 3.8 - t * 0.035, 4.1) - 0.5) * 0.15;
    const ridge = 1 - smoothstep(0.014, 0.080, Math.abs(y - ridgeY));
    const farY = -0.34 + (noise(x * 1.0 - t * 0.055, 7.2) - 0.5) * 0.30;
    const far = 1 - smoothstep(0.024, 0.090, Math.abs(y - farY));
    const valley = smoothstep(ridgeY - 0.12, ridgeY + 0.44, y) * (1 - smoothstep(ridgeY + 0.24, 1.1, y));
    const path = (1 - smoothstep(0.04, 0.18 + Math.max(0, y) * 0.12, Math.abs(x + Math.sin(y * 3 + t * 0.3) * 0.12))) * smoothstep(0.05, 0.92, y);
    return clamp01(ridge * 0.88 + far * 0.42 + valley * 0.18 + path * 0.17 + (1 - smoothstep(0.015, 0.055, Math.abs(y - 0.44 - Math.sin(x * 2 + t * 0.21) * 0.045 * (0.4 + drift)))) * drift * 0.18);
  }

  private drawMemory(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, width: number, height: number, halo: number, artifact: number) {
    if (!this.memory) return;
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.065 + halo * 0.055 + artifact * 0.022;
    const breathe = 1.007 + Math.sin(time * 0.07) * 0.003 + halo * 0.004;
    ctx.translate(cx, cy); ctx.rotate(Math.sin(time * 0.024) * 0.0025); ctx.scale(breathe, breathe); ctx.translate(-cx + Math.sin(time * 0.10) * artifact * 2, -cy); ctx.drawImage(this.memory, 0, 0, width, height); ctx.restore();
  }
  private captureMemory(ctx: CanvasRenderingContext2D) {
    if (!this.memory || !this.memoryCtx) return;
    this.memoryCtx.setTransform(1, 0, 0, 1, 0, 0); this.memoryCtx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.memoryCtx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, this.memory.width, this.memory.height);
  }
  private drawArtifactDecay(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, mix: number, wear: number) {
    if (mix <= 0.01) return;
    ctx.save(); const scars = 2 + Math.round(wear * 5);
    for (let i = 0; i < scars; i++) {
      const rawY = (Math.sin(i * 8.13) * 0.5 + 0.5) * height + time * (2 + wear * 6) * (i % 2 ? 1 : -1), y = ((rawY % height) + height) % height;
      ctx.fillStyle = `rgba(${PALETTE.ash.join(',')},${0.014 + mix * wear * 0.045})`; ctx.fillRect(Math.sin(time * 0.7 + i) * wear * 7, y, width, 1 + (i % 2));
    }
    ctx.restore();
  }
}
