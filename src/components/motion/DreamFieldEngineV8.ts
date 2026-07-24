import { DreamFieldEngine as ReferenceDreamEngine } from './DreamFieldEngineV7';
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mixOf = (modules: ModuleState[], id: string) => {
  const module = modules.find((item) => item.id === id && item.enabled && item.available);
  return module?.parameters.find((parameter) => parameter.id === 'mix')?.value ?? 0;
};

export class DreamFieldEngine {
  private readonly core = new ReferenceDreamEngine();
  private width = 1;
  private height = 1;

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.core.resize(this.width, this.height);
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    this.core.render(ctx, frame);

    const w = this.width;
    const h = this.height;
    const t = frame.time;
    const energy = this.energy(frame.modules);
    const x = clamp01(frame.x);
    const y = clamp01(frame.y);
    const patch = clamp01(frame.assignments.length / 6 + (frame.dragging ? 0.14 : 0));
    const horizon = h * (0.565 + (0.5 - y) * 0.025 + Math.sin(t * 0.024) * 0.014);
    const heroX = w * (0.5 + (x - 0.5) * 0.10 + Math.sin(t * 0.018) * 0.012);
    const heroY = h * (0.335 - energy.halo * 0.016 + Math.sin(t * 0.021) * 0.010);
    const minDim = Math.min(w, h);

    this.drawSceneWash(ctx, horizon, energy, patch);
    this.drawNestedArches(ctx, heroX, heroY, minDim, energy, t);
    this.drawHeroPortal(ctx, heroX, heroY, horizon, minDim, energy, patch, t);
    this.drawWorldRidges(ctx, horizon, energy, t);
    this.drawWater(ctx, horizon, heroX, energy, t);
    this.drawForegroundRings(ctx, heroX, energy, t);
    this.drawSideDreamMasses(ctx, horizon, energy, t);
    this.drawOrbitalBodies(ctx, heroX, heroY, minDim, energy, t);
    this.drawEmbeddedMasks(ctx, horizon, minDim, energy, t);
    this.drawArtifactSeams(ctx, energy, t);
  }

  private energy(modules: ModuleState[]): Energy {
    return {
      ember: mixOf(modules, 'saturation'),
      drift: mixOf(modules, 'chorus'),
      halo: mixOf(modules, 'delay'),
      atmos: mixOf(modules, 'reverb'),
      grain: mixOf(modules, 'bitcrusher'),
      artifact: mixOf(modules, 'media'),
    };
  }

  private drawSceneWash(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, patch: number) {
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const sky = ctx.createLinearGradient(0, 0, 0, horizon + h * 0.15);
    sky.addColorStop(0, `rgba(31,41,78,${0.035 + e.halo * 0.020})`);
    sky.addColorStop(0.34, `rgba(76,31,100,${0.045 + e.grain * 0.018})`);
    sky.addColorStop(0.66, `rgba(206,72,139,${0.034 + e.ember * 0.024})`);
    sky.addColorStop(1, `rgba(72,196,205,${0.045 + e.drift * 0.030})`);
    ctx.fillStyle = sky;
    ctx.globalAlpha = 0.78 + patch * 0.06;
    ctx.fillRect(0, 0, w, horizon + h * 0.16);

    const glow = ctx.createLinearGradient(0, horizon - h * 0.11, 0, horizon + h * 0.11);
    glow.addColorStop(0, 'rgba(255,145,90,0)');
    glow.addColorStop(0.46, `rgba(255,150,88,${0.080 + e.ember * 0.050})`);
    glow.addColorStop(0.53, `rgba(229,99,184,${0.050 + e.halo * 0.035})`);
    glow.addColorStop(0.60, `rgba(91,218,220,${0.080 + e.drift * 0.040})`);
    glow.addColorStop(1, 'rgba(91,218,220,0)');
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.95;
    ctx.fillRect(0, horizon - h * 0.11, w, h * 0.22);
    ctx.restore();
  }

  private drawNestedArches(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, t: number) {
    const count = 3 + Math.round(e.halo * 3);
    const base = minDim * (0.43 + e.atmos * 0.025);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const r = base * (1 + i * 0.20) * (1 + Math.sin(t * 0.016 + i) * 0.014);
      const alpha = Math.max(0.018, 0.105 - i * 0.017 + e.halo * 0.014);
      const gradient = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      gradient.addColorStop(0, `rgba(82,214,219,${alpha * 0.55})`);
      gradient.addColorStop(0.42, `rgba(221,104,191,${alpha * 0.82})`);
      gradient.addColorStop(0.67, `rgba(255,158,91,${alpha})`);
      gradient.addColorStop(1, `rgba(90,204,216,${alpha * 0.45})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(1, minDim * (0.0052 - i * 0.00055));
      ctx.beginPath();
      ctx.arc(cx, cy + minDim * 0.19, r, Math.PI * 1.055, Math.PI * 1.945);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHeroPortal(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    horizon: number,
    minDim: number,
    e: Energy,
    patch: number,
    t: number
  ) {
    const r = minDim * (0.145 + e.halo * 0.022 + e.ember * 0.012) * (1 + Math.sin(t * 0.048) * 0.016);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const corona = ctx.createRadialGradient(cx, cy, r * 0.56, cx, cy, r * 1.72);
    corona.addColorStop(0, 'rgba(0,0,0,0)');
    corona.addColorStop(0.42, `rgba(255,148,83,${0.17 + e.ember * 0.11})`);
    corona.addColorStop(0.58, `rgba(234,97,187,${0.12 + e.halo * 0.08})`);
    corona.addColorStop(0.75, `rgba(78,216,222,${0.10 + e.drift * 0.06})`);
    corona.addColorStop(1, 'rgba(78,216,222,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.72, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 3; i += 1) {
      const rr = r * (1.12 + i * 0.26);
      ctx.strokeStyle = i === 0
        ? `rgba(255,177,105,${0.135 + patch * 0.025})`
        : `rgba(105,213,222,${0.060 - i * 0.010 + e.halo * 0.018})`;
      ctx.lineWidth = Math.max(1, minDim * (0.0044 - i * 0.00075));
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const dark = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r * 0.74);
    dark.addColorStop(0, 'rgba(8,10,18,0.99)');
    dark.addColorStop(0.72, 'rgba(4,7,12,0.97)');
    dark.addColorStop(1, 'rgba(17,6,18,0.92)');
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.70, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const beam = ctx.createLinearGradient(cx, cy + r * 0.42, cx, horizon);
    beam.addColorStop(0, 'rgba(255,176,103,0)');
    beam.addColorStop(0.48, `rgba(255,181,108,${0.07 + e.ember * 0.035})`);
    beam.addColorStop(1, `rgba(236,244,234,${0.13 + patch * 0.02})`);
    ctx.strokeStyle = beam;
    ctx.lineWidth = Math.max(1, minDim * 0.0042);
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.55);
    ctx.lineTo(cx, horizon);
    ctx.stroke();
    ctx.restore();
  }

  private drawWorldRidges(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    const layers = [
      { alpha: 0.24, scale: 0.050, phase: 0.0, fill: 'rgba(12,26,31,0.72)' },
      { alpha: 0.42, scale: 0.082, phase: 2.5, fill: 'rgba(5,13,18,0.90)' },
    ];

    for (const layer of layers) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = layer.alpha + e.atmos * 0.09;
      ctx.fillStyle = layer.fill;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      const count = 54;
      for (let i = 0; i <= count; i += 1) {
        const px = (i / count) * w;
        const centerFalloff = 0.72 + Math.abs(i / count - 0.5) * 0.72;
        const n = Math.sin(i * 0.71 + t * 0.022 + layer.phase) * 0.50 + Math.sin(i * 1.83 - t * 0.015) * 0.28;
        const spire = Math.pow(Math.abs(Math.sin(i * 2.51 + layer.phase)), 16) * (0.8 + e.atmos * 0.7);
        const height = h * (layer.scale + Math.max(0, n) * layer.scale * 0.66 + spire * 0.095) * centerFalloff;
        ctx.lineTo(px, horizon - height);
      }
      ctx.lineTo(w, horizon);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D, horizon: number, heroX: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const water = ctx.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, `rgba(90,218,219,${0.042 + e.drift * 0.045})`);
    water.addColorStop(0.44, `rgba(75,135,179,${0.028 + e.halo * 0.020})`);
    water.addColorStop(0.74, `rgba(213,89,176,${0.030 + e.grain * 0.022})`);
    water.addColorStop(1, 'rgba(13,20,27,0)');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, h - horizon);

    const reflection = ctx.createLinearGradient(heroX, horizon, heroX, h);
    reflection.addColorStop(0, `rgba(255,205,142,${0.14 + e.ember * 0.05})`);
    reflection.addColorStop(0.34, `rgba(235,128,186,${0.075 + e.halo * 0.025})`);
    reflection.addColorStop(1, 'rgba(82,215,219,0)');
    ctx.strokeStyle = reflection;
    ctx.lineWidth = Math.max(1, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(heroX, horizon);
    ctx.quadraticCurveTo(heroX + Math.sin(t * 0.08) * w * 0.01, h * 0.74, heroX, h * 0.96);
    ctx.stroke();

    for (let i = 0; i < 8; i += 1) {
      const yy = horizon + h * (0.030 + i * 0.043);
      const spread = w * (0.045 + i * 0.052);
      const alpha = 0.060 - i * 0.005 + e.drift * 0.010;
      ctx.strokeStyle = i % 2
        ? `rgba(102,216,219,${alpha})`
        : `rgba(239,122,184,${alpha * 0.76})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(heroX - spread, yy + Math.sin(t * 0.07 + i) * 2);
      ctx.quadraticCurveTo(heroX, yy - h * 0.012, heroX + spread, yy + Math.cos(t * 0.065 + i) * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawForegroundRings(ctx: CanvasRenderingContext2D, heroX: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    const cy = h * (0.895 + Math.sin(t * 0.020) * 0.004);
    const count = 7 + Math.round(e.halo * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const p = i / Math.max(1, count - 1);
      const rx = w * (0.08 + p * 0.39);
      const ry = h * (0.016 + p * 0.11);
      ctx.strokeStyle = i % 2
        ? `rgba(99,213,216,${0.060 - p * 0.025 + e.drift * 0.010})`
        : `rgba(228,102,185,${0.054 - p * 0.022 + e.grain * 0.010})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(heroX, cy, rx, ry, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSideDreamMasses(ctx: CanvasRenderingContext2D, horizon: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    for (const side of [-1, 1] as const) {
      const baseX = side < 0 ? 0 : w;
      const innerX = side < 0 ? w * 0.20 : w * 0.80;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(5,10,15,${0.58 + e.atmos * 0.10})`;
      ctx.beginPath();
      ctx.moveTo(baseX, h);
      ctx.lineTo(baseX, h * 0.13);
      const steps = 16;
      for (let i = 0; i <= steps; i += 1) {
        const p = i / steps;
        const yy = h * (0.14 + p * 0.72);
        const wobble = Math.sin(p * 8 + t * 0.04 + side) * w * 0.012 + Math.sin(p * 17 - t * 0.025) * w * 0.006;
        const xx = innerX + side * (w * (0.04 + p * 0.07) + wobble);
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(baseX, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = side < 0
        ? `rgba(85,216,220,${0.035 + e.drift * 0.015})`
        : `rgba(231,107,185,${0.035 + e.grain * 0.015})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        const y = h * (0.30 + i * 0.13);
        const x = side < 0 ? w * (0.11 + i * 0.018) : w * (0.89 - i * 0.018);
        ctx.beginPath();
        ctx.arc(x, y, h * (0.035 + i * 0.009), Math.PI * 0.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.restore();
    }

    // A thin dark shoreline grounds the side masses into the world.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(5,11,15,0.66)';
    ctx.fillRect(0, horizon - 1, w, 2);
    ctx.restore();
  }

  private drawOrbitalBodies(ctx: CanvasRenderingContext2D, cx: number, cy: number, minDim: number, e: Energy, t: number) {
    const count = 5 + Math.round(e.halo * 5);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i += 1) {
      const orbit = minDim * (0.24 + (i % 4) * 0.10);
      const angle = i * 1.41 + t * (0.011 + (i % 3) * 0.0035);
      const px = cx + Math.cos(angle) * orbit * (1.45 + (i % 2) * 0.10);
      const py = cy + Math.sin(angle) * orbit * 0.72;
      const r = minDim * (0.009 + (i % 3) * 0.005);
      const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 1.9);
      glow.addColorStop(0, 'rgba(244,239,221,0.22)');
      glow.addColorStop(0.42, i % 2 ? 'rgba(92,209,217,0.18)' : 'rgba(244,139,95,0.19)');
      glow.addColorStop(1, 'rgba(48,32,67,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5,8,14,0.88)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.66, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'screen';
    }
    ctx.restore();
  }

  private drawEmbeddedMasks(ctx: CanvasRenderingContext2D, horizon: number, minDim: number, e: Energy, t: number) {
    const w = this.width;
    const h = this.height;
    const alpha = 0.025 + e.atmos * 0.018 + e.halo * 0.012;
    const positions = [
      { x: w * 0.23, y: horizon - h * 0.15, s: 1.0 },
      { x: w * 0.77, y: horizon - h * 0.12, s: 0.9 },
      { x: w * 0.17, y: horizon + h * 0.08, s: 0.65 },
      { x: w * 0.83, y: horizon + h * 0.10, s: 0.7 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(222,230,221,${alpha})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < positions.length; i += 1) {
      const p = positions[i];
      const r = minDim * 0.055 * p.s;
      const wobble = Math.sin(t * 0.041 + i * 1.7) * r * 0.08;
      // Eye / cave-mouth ambiguity: paired arcs plus a dark implied pupil.
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + wobble, r * 1.45, r * 0.65, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + wobble, r * 1.15, r * 0.48, 0, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y + wobble, r * 0.19, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawArtifactSeams(ctx: CanvasRenderingContext2D, e: Energy, t: number) {
    if (e.artifact <= 0.02) return;
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const count = 2 + Math.round(e.artifact * 4);
    for (let i = 0; i < count; i += 1) {
      const y = ((Math.sin(i * 4.13 + t * (0.9 + i * 0.2)) * 0.5 + 0.5) * h);
      ctx.strokeStyle = `rgba(223,171,139,${0.015 + e.artifact * 0.028})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + Math.sin(t * 2 + i) * 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}
