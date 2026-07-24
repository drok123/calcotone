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

const RASTER_W = 112;
const RASTER_H = 64;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;
const ENERGY_KEYS: (keyof Energy)[] = ['ember', 'drift', 'halo', 'atmos', 'grain', 'artifact'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
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
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderWorldRaster(frame.time, this.energyState, patch);
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

    this.drawWorldGeometry(ctx, frame.time, this.energyState, patch);
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

  private renderWorldRaster(time: number, e: Energy, patch: PatchField) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const xSteer = this.x - 0.5;
    const horizon = -0.10 + (0.5 - this.y) * 0.38 + Math.sin(time * 0.021) * 0.014;
    const heroX = xSteer * aspect * 0.48;
    const heroY = horizon - (0.34 + this.y * 0.12);
    const warmBias = clamp01(0.40 + xSteer * 0.85 + e.ember * 0.30);
    const coolBias = clamp01(0.48 - xSteer * 0.72 + e.drift * 0.28);
    const patchEnergy = clamp01((patch.xStrength + patch.yStrength) * 0.42 + patch.total * 0.045);

    for (let py = 0; py < RASTER_H; py += 1) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px += 1) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;
        const sky = ny < horizon;

        const fieldWarp = fbm(
          nx * 0.86 + time * (0.008 + xSteer * 0.006),
          ny * 0.86 - time * 0.007
        ) - 0.5;
        const localX = nx + fieldWarp * (0.06 + e.atmos * 0.055 + patch.xStrength * 0.035) + ny * xSteer * 0.035;
        const nebula = fbm(localX * 1.34 + time * 0.010, ny * 1.18 - time * 0.009);
        const detail = noise(localX * 3.0 - time * 0.014, ny * 2.7 + time * 0.010);

        let r = 4;
        let g = 8;
        let b = 13;

        if (sky) {
          const altitude = clamp01((horizon - ny + 0.12) / 1.20);
          const magenta = smoothstep(0.47, 0.82, nebula + fieldWarp * 0.26);
          const cyan = smoothstep(0.43, 0.80, detail - fieldWarp * 0.20);
          r += 10 + altitude * 17 + magenta * (24 + warmBias * 31 + e.grain * 10);
          g += 14 + altitude * 23 + cyan * (29 + coolBias * 31 + e.drift * 10);
          b += 25 + altitude * 42 + magenta * 25 + cyan * 31;

          const ringRadius = 0.47 + this.y * 0.11 + e.halo * 0.075 + patch.yStrength * 0.025;
          const haloDist = Math.abs(Math.hypot((nx - heroX) * 0.86, (ny - heroY) * 1.03) - ringRadius);
          const haloGlow = 1 - smoothstep(0.012, 0.095, haloDist);
          r += haloGlow * (53 + warmBias * 48 + e.ember * 40);
          g += haloGlow * (21 + coolBias * 28 + e.halo * 22);
          b += haloGlow * (42 + e.halo * 38);

          const star = hash(px * 1.77 + 13.1, py * 2.13 + 7.7);
          const starGate = 0.992 - e.grain * 0.006 - patchEnergy * 0.002;
          if (star > starGate && ny < horizon - 0.05) {
            const sparkle = (star - starGate) / Math.max(0.001, 1 - starGate);
            r += sparkle * 80;
            g += sparkle * 88;
            b += sparkle * 96;
          }
        } else {
          const depth = clamp01((ny - horizon) / Math.max(0.01, 1 - horizon));
          const waterNoise = noise(
            localX * (3.0 + e.grain * 0.7) + time * 0.020,
            ny * 5.2 - time * (0.020 + e.drift * 0.042)
          );
          const reflectionWidth = 4.8 - e.drift * 1.1 - patch.xStrength * 0.65;
          const reflection = Math.exp(-Math.abs(nx - heroX) * reflectionWidth) * (1 - depth * 0.52);
          r += 5 + depth * 7 + reflection * (43 + warmBias * 35 + e.ember * 22) + waterNoise * e.grain * 8;
          g += 13 + depth * 12 + reflection * (50 + coolBias * 40 + e.drift * 28);
          b += 20 + depth * 22 + reflection * (62 + e.halo * 30);

          const basinCenterY = 0.72 + (0.5 - this.y) * 0.10;
          const rippleDistance = Math.hypot((nx - heroX) * (0.86 + patch.xStrength * 0.06), (ny - basinCenterY) * 1.72);
          const ripple = Math.sin(rippleDistance * (22 + e.grain * 8 + patch.yStrength * 4) - time * (0.42 + e.drift * 0.62));
          const rippleGlow = Math.pow(clamp01(ripple * 0.5 + 0.5), 9) * smoothstep(horizon, 0.96, ny);
          r += rippleGlow * (20 + warmBias * 19 + e.grain * 23);
          g += rippleGlow * (27 + coolBias * 21);
          b += rippleGlow * 39;
        }

        const horizonGlow = 1 - smoothstep(0.008, 0.095, Math.abs(ny - horizon));
        r += horizonGlow * (35 + warmBias * 23 + e.ember * 22);
        g += horizonGlow * (33 + coolBias * 24 + e.drift * 17);
        b += horizonGlow * 40;

        if (e.artifact > 0.01) {
          const tear = Math.sin(py * 0.39 + time * 6.7 + nx * 0.7) * e.artifact;
          r += tear * 6;
          g += tear * 1.5;
          b -= tear * 4;
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

  private drawWorldGeometry(ctx: CanvasRenderingContext2D, time: number, e: Energy, patch: PatchField) {
    const w = this.width;
    const h = this.height;
    const minDim = Math.min(w, h);
    const xSteer = this.x - 0.5;
    const horizon = h * (0.61 - this.y * 0.21 + Math.sin(time * 0.021) * 0.008);
    const heroX = w * (0.5 + xSteer * 0.32 + Math.sin(time * 0.018) * 0.008);
    const heroY = horizon - h * (0.20 + this.y * 0.12);
    const activity = clamp01(patch.total / 6 + this.gesture * 0.22);

    this.drawArches(ctx, heroX, heroY, minDim, e, patch, time);
    this.drawPortal(ctx, heroX, heroY, horizon, minDim, e, patch, activity, time);
    this.drawSilhouettes(ctx, horizon, e, time);
    this.drawReflectionBands(ctx, heroX, horizon, e, patch, time);
    this.drawForegroundBasin(ctx, heroX, e, patch, time);
    this.drawOrbitals(ctx, heroX, heroY, minDim, e, patch, time);
    this.drawAmbiguousForms(ctx, horizon, minDim, e, patch, time);
    this.drawArtifact(ctx, e, time);
  }

  private drawArches(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    minDim: number,
    e: Energy,
    patch: PatchField,
    t: number
  ) {
    const count = Math.min(5, 2 + Math.round(e.halo * 2 + patch.xStrength));
    const tilt = (this.x - 0.5) * 0.10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.translate(-cx, -cy);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < count; i += 1) {
      const r = minDim * (0.43 + this.y * 0.055 + i * 0.115 + e.atmos * 0.025);
      const alpha = Math.max(0.024, 0.105 - i * 0.016 + e.halo * 0.018 + patch.xStrength * 0.008);
      const g = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      g.addColorStop(0, `rgba(79,215,220,${alpha * (0.62 + (1 - this.x) * 0.18)})`);
      g.addColorStop(0.46, `rgba(220,104,191,${alpha * 0.76})`);
      g.addColorStop(0.72, `rgba(255,157,92,${alpha * (0.74 + this.x * 0.26)})`);
      g.addColorStop(1, `rgba(81,210,219,${alpha * 0.38})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(1, minDim * (0.0046 - i * 0.00055));
      ctx.beginPath();
      ctx.arc(cx, cy + minDim * 0.18, r, Math.PI * 1.055, Math.PI * 1.945);
      ctx.stroke();
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
    activity: number,
    t: number
  ) {
    const base = minDim * (0.10 + this.y * 0.065 + e.halo * 0.020 + e.ember * 0.012);
    const squash = 0.90 + (this.x - 0.5) * 0.16 + patch.xStrength * 0.035;
    const rx = base * squash;
    const ry = base / Math.max(0.82, squash);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const corona = ctx.createRadialGradient(cx, cy, base * 0.42, cx, cy, base * 1.82);
    corona.addColorStop(0, 'rgba(0,0,0,0)');
    corona.addColorStop(0.36, `rgba(255,148,83,${0.16 + e.ember * 0.11 + this.x * 0.025})`);
    corona.addColorStop(0.59, `rgba(232,96,187,${0.105 + e.halo * 0.07})`);
    corona.addColorStop(0.80, `rgba(82,216,222,${0.085 + e.drift * 0.055 + (1 - this.x) * 0.02})`);
    corona.addColorStop(1, 'rgba(82,216,222,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(2,4,9,0.985)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.69, ry * 0.69, (this.x - 0.5) * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(255,190,121,${0.105 + e.ember * 0.065 + activity * 0.025})`;
    ctx.lineWidth = Math.max(1, minDim * 0.0038);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.80, ry * 0.80, (this.x - 0.5) * 0.08, 0, Math.PI * 2);
    ctx.stroke();

    const beam = ctx.createLinearGradient(cx, cy + ry * 0.4, cx, horizon);
    beam.addColorStop(0, 'rgba(255,180,110,0)');
    beam.addColorStop(1, `rgba(242,248,237,${0.085 + patch.yStrength * 0.07 + this.gesture * 0.025})`);
    ctx.strokeStyle = beam;
    ctx.lineWidth = Math.max(1, minDim * (0.0028 + patch.yStrength * 0.0014));
    ctx.beginPath();
    ctx.moveTo(cx, cy + ry * 0.52);
    ctx.lineTo(cx + Math.sin(t * 0.11) * minDim * 0.006, horizon);
    ctx.stroke();
    ctx.restore();
  }

  private drawSilhouettes(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (layer === 0 ? 0.48 : 0.74) + e.atmos * 0.10;
      ctx.fillStyle = layer === 0 ? 'rgba(9,19,25,0.84)' : 'rgba(3,8,13,0.95)';
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      const count = 58;
      for (let i = 0; i <= count; i += 1) {
        const p = i / count;
        const px = p * w;
        const sideBias = 0.64 + Math.abs(p - 0.5 - (this.x - 0.5) * 0.08) * 1.02;
        const n = Math.sin(i * 0.77 + t * 0.010 + layer * 2.1) * 0.38 + Math.sin(i * 1.71) * 0.22;
        const spire = Math.pow(Math.abs(Math.sin(i * 2.43 + layer)), 18) * (0.74 + e.atmos * 0.92);
        const height = h * (0.032 + Math.max(0, n) * 0.043 + spire * 0.11) * sideBias * (layer ? 1 : 0.72);
        ctx.lineTo(px, horizon - height);
      }
      ctx.lineTo(w, horizon);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawReflectionBands(
    ctx: CanvasRenderingContext2D,
    heroX: number,
    horizon: number,
    e: Energy,
    patch: PatchField,
    t: number
  ) {
    const w = this.width;
    const h = this.height;
    const count = 7 + Math.round(e.drift * 2 + patch.yStrength * 2);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const yy = horizon + h * (0.026 + i * 0.045);
      const spread = w * (0.035 + i * (0.050 + patch.xStrength * 0.003));
      const alpha = Math.max(0.016, 0.054 - i * 0.004 + e.drift * 0.012);
      ctx.strokeStyle = i % 2
        ? `rgba(93,215,220,${alpha})`
        : `rgba(232,112,188,${alpha * 0.72})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(heroX - spread, yy + Math.sin(t * 0.055 + i) * (1.2 + e.drift * 1.3));
      ctx.quadraticCurveTo(
        heroX + (this.x - 0.5) * w * 0.015,
        yy - h * (0.008 + patch.yStrength * 0.005),
        heroX + spread,
        yy + Math.cos(t * 0.050 + i) * (1.2 + e.drift * 1.3)
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawForegroundBasin(ctx: CanvasRenderingContext2D, heroX: number, e: Energy, patch: PatchField, t: number) {
    const w = this.width;
    const h = this.height;
    const lowField = 1 - this.y;
    const cy = h * (0.88 + lowField * 0.035 + Math.sin(t * 0.018) * 0.002);
    const count = 5 + Math.round(e.halo * 2 + patch.yStrength * 2);
    const rotation = (this.x - 0.5) * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = i / Math.max(1, count - 1);
      const rx = w * (0.07 + p * (0.35 + lowField * 0.08));
      const ry = h * (0.012 + p * (0.082 + lowField * 0.035));
      ctx.strokeStyle = i % 2
        ? `rgba(90,214,218,${0.054 - p * 0.022 + e.drift * 0.008})`
        : `rgba(226,104,187,${0.048 - p * 0.020 + e.grain * 0.009})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(heroX, cy, rx, ry, rotation, Math.PI, Math.PI * 2);
      ctx.stroke();
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
    t: number
  ) {
    const count = Math.min(8, 3 + Math.round(e.halo * 4 + patch.xStrength));
    ctx.save();
    for (let i = 0; i < count; i += 1) {
      const orbit = minDim * (0.24 + (i % 4) * 0.105 + this.y * 0.018);
      const a = i * 1.37 + t * (0.008 + (i % 3) * 0.0025) + (this.x - 0.5) * 0.45;
      const px = cx + Math.cos(a) * orbit * (1.38 + patch.xStrength * 0.16);
      const py = cy + Math.sin(a) * orbit * (0.67 + this.y * 0.09);
      const r = minDim * (0.0075 + (i % 3) * 0.0042);
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(px, py, 0, px, py, r * 1.9);
      g.addColorStop(0, 'rgba(246,241,221,0.20)');
      g.addColorStop(0.46, i % 2 ? 'rgba(90,210,219,0.17)' : 'rgba(244,139,95,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,6,12,0.91)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.64, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawAmbiguousForms(
    ctx: CanvasRenderingContext2D,
    horizon: number,
    minDim: number,
    e: Energy,
    patch: PatchField,
    t: number
  ) {
    const w = this.width;
    const h = this.height;
    const alpha = 0.020 + e.atmos * 0.015 + e.halo * 0.010 + (patch.xStrength + patch.yStrength) * 0.006;
    const forms = [
      [0.16 + (this.x - 0.5) * 0.03, -0.11, 1.0],
      [0.84 + (this.x - 0.5) * 0.03, -0.09, 0.92],
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(222,231,222,${alpha})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < forms.length; i += 1) {
      const [xf, yf, s] = forms[i];
      const x = w * xf;
      const y = horizon + h * yf + Math.sin(t * 0.025 + i) * 1.5;
      const r = minDim * 0.052 * s;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.55, r * (0.52 + this.y * 0.12), (i ? -1 : 1) * (this.x - 0.5) * 0.10, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + (this.x - 0.5) * r * 0.35, y, r * 0.16, 0, Math.PI * 2);
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
      const y = (Math.sin(i * 4.13 + t * (0.55 + i * 0.15)) * 0.5 + 0.5) * h;
      ctx.strokeStyle = `rgba(223,171,139,${0.012 + e.artifact * 0.024})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + Math.sin(t * 1.4 + i) * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
