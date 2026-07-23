import { DreamFieldEngine as RegionalDreamEngine } from './DreamFieldEngineV5';
import type { ModuleState, XYAssignment } from '../../ui/types';

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
};

type Lens = {
  x: number;
  y: number;
  radius: number;
  phase: number;
  drift: number;
  zoom: number;
  squash: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class DreamFieldEngine {
  private readonly core = new RegionalDreamEngine();
  private width = 1;
  private height = 1;
  private snapshot: HTMLCanvasElement | null = null;
  private snapshotCtx: CanvasRenderingContext2D | null = null;
  private bloom: HTMLCanvasElement | null = null;
  private bloomCtx: CanvasRenderingContext2D | null = null;
  private lenses: Lens[] = [];

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.core.resize(this.width, this.height);

    if (typeof document === 'undefined') return;
    if (!this.snapshot) {
      this.snapshot = document.createElement('canvas');
      this.snapshotCtx = this.snapshot.getContext('2d', { alpha: true });
    }
    if (!this.bloom) {
      this.bloom = document.createElement('canvas');
      this.bloomCtx = this.bloom.getContext('2d', { alpha: true });
    }

    const pixelWidth = Math.max(1, Math.round(this.width));
    const pixelHeight = Math.max(1, Math.round(this.height));
    if (this.snapshot.width !== pixelWidth || this.snapshot.height !== pixelHeight) {
      this.snapshot.width = pixelWidth;
      this.snapshot.height = pixelHeight;
      this.bloom.width = pixelWidth;
      this.bloom.height = pixelHeight;
      this.bloomCtx?.clearRect(0, 0, pixelWidth, pixelHeight);
    }

    if (!this.lenses.length) {
      this.lenses = [
        { x: 0.24, y: 0.31, radius: 0.34, phase: 0.2, drift: 0.66, zoom: 1.14, squash: 0.78 },
        { x: 0.70, y: 0.40, radius: 0.41, phase: 2.0, drift: 0.48, zoom: 1.21, squash: 1.18 },
        { x: 0.48, y: 0.73, radius: 0.36, phase: 4.3, drift: 0.82, zoom: 1.12, squash: 0.92 },
      ];
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    this.core.render(ctx, frame);
    if (!this.snapshot || !this.snapshotCtx || !this.bloom || !this.bloomCtx) return;

    const w = this.width;
    const h = this.height;
    const source = ctx.canvas;

    this.snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.snapshotCtx.clearRect(0, 0, this.snapshot.width, this.snapshot.height);
    this.snapshotCtx.drawImage(source, 0, 0, source.width, source.height, 0, 0, this.snapshot.width, this.snapshot.height);

    // Dream memory: soft, decaying persistence rather than a static blur layer.
    this.bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.bloomCtx.globalCompositeOperation = 'source-over';
    this.bloomCtx.globalAlpha = 0.18;
    this.bloomCtx.fillStyle = 'rgba(5,8,7,0.62)';
    this.bloomCtx.fillRect(0, 0, this.bloom.width, this.bloom.height);
    this.bloomCtx.globalCompositeOperation = 'screen';
    this.bloomCtx.globalAlpha = 0.095;
    this.bloomCtx.filter = 'blur(8px) saturate(1.05)';
    this.bloomCtx.drawImage(this.snapshot, 0, 0, w, h);
    this.bloomCtx.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.15;
    ctx.drawImage(this.bloom, 0, 0, w, h);
    ctx.restore();

    const activity = clamp01(frame.assignments.length / 5 + (frame.dragging ? 0.24 : 0));
    const steerX = clamp01(frame.x) - 0.5;
    const steerY = 0.5 - clamp01(frame.y);

    for (let index = 0; index < this.lenses.length; index += 1) {
      const lens = this.lenses[index];
      const t = frame.time * (0.085 + lens.drift * 0.031) + lens.phase;
      const takeover = 0.5 - 0.5 * Math.cos(t * 0.41 + index * 1.73);
      const hesitate = Math.pow(takeover, 2.4) * (3 - 2 * takeover);
      const cx = w * (lens.x + Math.sin(t * 0.69) * 0.070 + steerX * 0.055);
      const cy = h * (lens.y + Math.cos(t * 0.57) * 0.058 + steerY * 0.045);
      const baseRadius = Math.min(w, h) * lens.radius;
      const radius = baseRadius * (0.72 + hesitate * 0.72 + Math.sin(t * 0.43) * 0.07);
      const zoom = lens.zoom + hesitate * 0.16 + Math.sin(t * 0.35 + index) * 0.035 + activity * 0.035;
      const pullX = Math.sin(t * 0.79 + index * 1.7) * radius * (0.09 + hesitate * 0.05);
      const pullY = Math.cos(t * 0.63 + index * 2.1) * radius * (0.07 + hesitate * 0.04);
      const rotation = Math.sin(t * 0.31 + index) * (0.035 + hesitate * 0.025);

      ctx.save();
      this.organicClip(ctx, cx, cy, radius, lens.squash, t, index);
      ctx.globalCompositeOperation = index === 1 ? 'screen' : 'source-over';
      ctx.globalAlpha = 0.14 + hesitate * 0.16 + activity * 0.035;
      ctx.translate(cx + pullX, cy + pullY);
      ctx.rotate(rotation);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
      ctx.drawImage(this.snapshot, 0, 0, w, h);
      ctx.restore();
    }
  }

  private organicClip(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    squash: number,
    time: number,
    index: number
  ) {
    const points = 18;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const a = (i / points) * Math.PI * 2;
      const wobble =
        1 +
        Math.sin(a * 3 + time * 0.91 + index) * 0.10 +
        Math.sin(a * 5 - time * 0.57 + index * 2.3) * 0.055 +
        Math.cos(a * 2 + time * 0.33) * 0.035;
      const rx = radius * wobble;
      const x = cx + Math.cos(a) * rx * squash;
      const y = cy + Math.sin(a) * rx / Math.max(0.72, squash);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
  }
}
