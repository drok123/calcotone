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

const RASTER_W = 112;
const RASTER_H = 64;
const ACTIVE_INTERVAL = 1 / 30;
const IDLE_INTERVAL = 1 / 24;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
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
    const energy = this.energy(frame.modules);
    const interval = frame.dragging ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    if (frame.time - this.lastRasterTime >= interval || this.lastRasterTime < 0) {
      this.renderWorldRaster(frame, energy);
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

    this.drawWorldGeometry(ctx, frame, energy);
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

  private renderWorldRaster(frame: DreamFrame, e: Energy) {
    if (!this.rasterCtx || !this.imageData) return;

    const data = this.imageData.data;
    const aspect = this.width / Math.max(1, this.height);
    const xSteer = clamp01(frame.x) - 0.5;
    const ySteer = clamp01(frame.y) - 0.5;
    const horizon = 0.12 + ySteer * 0.08 + Math.sin(frame.time * 0.021) * 0.025;
    const heroX = xSteer * 0.22 + Math.sin(frame.time * 0.017) * 0.035;
    const t = frame.time;

    for (let py = 0; py < RASTER_H; py += 1) {
      const ny = py / (RASTER_H - 1) * 2 - 1;
      for (let px = 0; px < RASTER_W; px += 1) {
        const nx = (px / (RASTER_W - 1) * 2 - 1) * aspect;
        const sky = ny < horizon;

        const warp = (fbm(nx * 0.82 + t * 0.010, ny * 0.82 - t * 0.008) - 0.5) * (0.11 + e.atmos * 0.06);
        const nebula = fbm(nx * 1.35 + t * 0.012, ny * 1.18 - t * 0.010);
        const cloud = fbm(nx * 2.1 - t * 0.013, ny * 1.9 + t * 0.009);

        let r = 4;
        let g = 8;
        let b = 12;

        if (sky) {
          const vertical = clamp01((horizon - ny + 0.15) / 1.25);
          const magenta = smoothstep(0.50, 0.82, nebula + warp * 0.4);
          const cyan = smoothstep(0.42, 0.78, cloud - warp * 0.25);
          r += 12 + vertical * 18 + magenta * (32 + e.grain * 18);
          g += 16 + vertical * 26 + cyan * (38 + e.drift * 16);
          b += 27 + vertical * 46 + magenta * 30 + cyan * 36;

          const haloDist = Math.abs(Math.hypot((nx - heroX) * 0.82, (ny + 0.42) * 1.05) - (0.54 + e.halo * 0.08));
          const haloGlow = 1 - smoothstep(0.015, 0.11, haloDist);
          r += haloGlow * (72 + e.ember * 58);
          g += haloGlow * (28 + e.halo * 28);
          b += haloGlow * (56 + e.halo * 44);
        } else {
          const depth = clamp01((ny - horizon) / (1 - horizon));
          const waterNoise = noise(nx * 3.2 + t * 0.025, ny * 5.5 - t * (0.025 + e.drift * 0.035));
          const reflection = Math.exp(-Math.abs(nx - heroX) * (5.0 - e.drift * 1.2)) * (1 - depth * 0.55);
          r += 5 + depth * 6 + reflection * (56 + e.ember * 30) + waterNoise * e.grain * 9;
          g += 14 + depth * 11 + reflection * (70 + e.drift * 36);
          b += 20 + depth * 20 + reflection * (78 + e.halo * 36);

          const ripple = Math.sin((Math.hypot((nx - heroX) * 0.9, (ny - 0.72) * 1.8) * (24 + e.grain * 8)) - t * (0.5 + e.drift * 0.5));
          const rippleGlow = Math.pow(clamp01(ripple * 0.5 + 0.5), 8) * smoothstep(horizon, 0.95, ny);
          r += rippleGlow * (28 + e.grain * 30);
          g += rippleGlow * 34;
          b += rippleGlow * 46;
        }

        const horizonGlow = 1 - smoothstep(0.01, 0.11, Math.abs(ny - horizon));
        r += horizonGlow * (44 + e.ember * 28);
        g += horizonGlow * (38 + e.drift * 24);
        b += horizonGlow * 46;

        if (e.artifact > 0.01) {
          const tear = Math.sin(py * 0.42 + t * 7.1) * e.artifact;
          r += tear * 8;
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

  private drawWorldGeometry(ctx: CanvasRenderingContext2D, frame: DreamFrame, e: Energy) {
    const w = this.width;
    const h = this.height;
    const minDim = Math.min(w, h);
    const x = clamp01(frame.x);
    const y = clamp01(frame.y);
    const horizon = h * (0.56 + (0.5 - y) * 0.04 + Math.sin(frame.time * 0.021) * 0.012);
    const heroX = w * (0.5 + (x - 0.5) * 0.10 + Math.sin(frame.time * 0.018) * 0.012);
    const heroY = h * (0.31 + Math.sin(frame.time * 0.019) * 0.008);
    const activity = clamp01(frame.assignments.length / 6 + (frame.dragging ? 0.16 : 0));

    this.drawArches(ctx, heroX, heroY, minDim, e, frame.time);
    this.drawPortal(ctx, heroX, heroY, horizon, minDim, e, activity, frame.time);
    this.drawSilhouettes(ctx, horizon, e, frame.time);
    this.drawReflectionBands(ctx, heroX, horizon, e, frame.time);
    this.drawForegroundBasin(ctx, heroX, e, frame.time);
    this.drawOrbitals(ctx, heroX, heroY, minDim, e, frame.time);
    this.drawAmbiguousForms(ctx, horizon, minDim, e, frame.time);
    this.drawArtifact(ctx, e, frame.time);
  }

  private drawArches(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, t: number) {
    const count = 2 + Math.round(e.halo * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const r = minDim * (0.46 + i * 0.11 + e.atmos * 0.03) * (1 + Math.sin(t * 0.015 + i) * 0.012);
      const alpha = 0.10 - i * 0.014 + e.halo * 0.020;
      const g = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      g.addColorStop(0, `rgba(87,216,220,${alpha * 0.52})`);
      g.addColorStop(0.48, `rgba(224,105,192,${alpha * 0.80})`);
      g.addColorStop(0.72, `rgba(255,156,90,${alpha})`);
      g.addColorStop(1, `rgba(87,216,220,${alpha * 0.40})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(1, minDim * (0.0048 - i * 0.0006));
      ctx.beginPath();
      ctx.arc(cx, cy + minDim * 0.19, r, Math.PI * 1.06, Math.PI * 1.94);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPortal(ctx: CanvasRenderingContext2D, cx: number, cy: number, horizon: number, minDim: number, e: Energy, activity: number, t: number) {
    const r = minDim * (0.145 + e.halo * 0.020 + e.ember * 0.015);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const corona = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r * 1.75);
    corona.addColorStop(0, 'rgba(0,0,0,0)');
    corona.addColorStop(0.38, `rgba(255,148,83,${0.18 + e.ember * 0.12})`);
    corona.addColorStop(0.60, `rgba(232,96,187,${0.12 + e.halo * 0.07})`);
    corona.addColorStop(0.79, `rgba(82,216,222,${0.09 + e.drift * 0.06})`);
    corona.addColorStop(1, 'rgba(82,216,222,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(2,4,9,0.98)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(255,190,121,${0.12 + e.ember * 0.07})`;
    ctx.lineWidth = Math.max(1, minDim * 0.004);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.78 + Math.sin(t * 0.04) * 0.01), 0, Math.PI * 2);
    ctx.stroke();

    const beam = ctx.createLinearGradient(cx, cy + r * 0.45, cx, horizon);
    beam.addColorStop(0, 'rgba(255,180,110,0)');
    beam.addColorStop(1, `rgba(242,248,237,${0.12 + activity * 0.03})`);
    ctx.strokeStyle = beam;
    ctx.lineWidth = Math.max(1, minDim * 0.0038);
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.52);
    ctx.lineTo(cx, horizon);
    ctx.stroke();
    ctx.restore();
  }

  private drawSilhouettes(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (layer === 0 ? 0.52 : 0.78) + e.atmos * 0.08;
      ctx.fillStyle = layer === 0 ? 'rgba(9,19,25,0.84)' : 'rgba(3,8,13,0.94)';
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      const count = 58;
      for (let i = 0; i <= count; i += 1) {
        const p = i / count;
        const px = p * w;
        const edge = 0.62 + Math.abs(p - 0.5) * 1.05;
        const n = Math.sin(i * 0.77 + t * 0.020 + layer * 2.1) * 0.42 + Math.sin(i * 1.71 - t * 0.012) * 0.22;
        const spire = Math.pow(Math.abs(Math.sin(i * 2.43 + layer)), 18) * (0.8 + e.atmos * 0.9);
        const height = h * (0.035 + Math.max(0, n) * 0.045 + spire * 0.115) * edge * (layer ? 1 : 0.72);
        ctx.lineTo(px, horizon - height);
      }
      ctx.lineTo(w, horizon);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawReflectionBands(ctx: CanvasRenderingContext2D, heroX: number, horizon: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 9; i += 1) {
      const yy = horizon + h * (0.028 + i * 0.044);
      const spread = w * (0.035 + i * 0.052);
      const alpha = 0.055 - i * 0.004 + e.drift * 0.012;
      ctx.strokeStyle = i % 2 ? `rgba(93,215,220,${alpha})` : `rgba(232,112,188,${alpha * 0.72})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(heroX - spread, yy + Math.sin(t * 0.06 + i) * 2);
      ctx.quadraticCurveTo(heroX, yy - h * 0.010, heroX + spread, yy + Math.cos(t * 0.055 + i) * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawForegroundBasin(ctx: CanvasRenderingContext2D, heroX: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    const cy = h * (0.90 + Math.sin(t * 0.018) * 0.003);
    const count = 6 + Math.round(e.halo * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = i / Math.max(1, count - 1);
      const rx = w * (0.07 + p * 0.41);
      const ry = h * (0.014 + p * 0.105);
      ctx.strokeStyle = i % 2 ? `rgba(90,214,218,${0.058 - p * 0.025})` : `rgba(226,104,187,${0.052 - p * 0.022 + e.grain * 0.010})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(heroX, cy, rx, ry, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawOrbitals(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, t: number) {
    const count = 4 + Math.round(e.halo * 5);
    ctx.save();
    for (let i = 0; i < count; i += 1) {
      const orbit = minDim * (0.25 + (i % 4) * 0.11);
      const a = i * 1.37 + t * (0.010 + (i % 3) * 0.003);
      const px = cx + Math.cos(a) * orbit * 1.45;
      const py = cy + Math.sin(a) * orbit * 0.72;
      const r = minDim * (0.008 + (i % 3) * 0.0045);
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

  private drawAmbiguousForms(ctx: CanvasRenderingContext2D, horizon: number, minDim: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    const alpha = 0.028 + e.atmos * 0.016 + e.halo * 0.012;
    const forms = [
      [0.16, -0.12, 1.0],
      [0.84, -0.10, 0.92],
      [0.23, 0.09, 0.68],
      [0.77, 0.11, 0.74],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(222,231,222,${alpha})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < forms.length; i += 1) {
      const [xf, yf, s] = forms[i];
      const x = w * xf;
      const y = horizon + h * yf + Math.sin(t * 0.035 + i) * 2;
      const r = minDim * 0.050 * s;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.45, r * 0.62, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.20, 0, Math.PI * 2);
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
    const count = 2 + Math.round(e.artifact * 4);
    for (let i = 0; i < count; i += 1) {
      const y = (Math.sin(i * 4.13 + t * (0.9 + i * 0.2)) * 0.5 + 0.5) * h;
      ctx.strokeStyle = `rgba(223,171,139,${0.015 + e.artifact * 0.028})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + Math.sin(t * 2 + i) * 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}
