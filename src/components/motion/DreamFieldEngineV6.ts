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
        { x: 0.28, y: 0.34, radius: 0.29, phase: 0.3, drift: 0.7, zoom: 1.16 },
        { x: 0.70, y: 0.42, radius: 0.34, phase: 2.1, drift: 0.5, zoom: 1.20 },
        { x: 0.46, y: 0.72, radius: 0.31, phase: 4.4, drift: 0.8, zoom: 1.13 },
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

    // Let the bloom remember previous shapes, but decay them every frame so highlights do not
    // accumulate into a flat white fog.
    this.bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.bloomCtx.globalCompositeOperation = 'source-over';
    this.bloomCtx.globalAlpha = 0.16;
    this.bloomCtx.fillStyle = 'rgba(5,8,7,0.55)';
    this.bloomCtx.fillRect(0, 0, this.bloom.width, this.bloom.height);
    this.bloomCtx.globalCompositeOperation = 'screen';
    this.bloomCtx.globalAlpha = 0.10;
    this.bloomCtx.filter = 'blur(7px) saturate(1.04)';
    this.bloomCtx.drawImage(this.snapshot, 0, 0, w, h);
    this.bloomCtx.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.16;
    ctx.drawImage(this.bloom, 0, 0, w, h);
    ctx.restore();

    const activity = clamp01(frame.assignments.length / 5 + (frame.dragging ? 0.22 : 0));
    // Engine input is already normalized: x/y are 0..1 with y increasing upward.
    const steerX = clamp01(frame.x) - 0.5;
    const steerY = 0.5 - clamp01(frame.y);

    // Local semantic lenses: pieces of the current scene inflate, drift and overlap their
    // neighbours. The masks are feathered so the eye reads metamorphosis, not picture-in-picture.
    for (let index = 0; index < this.lenses.length; index += 1) {
      const lens = this.lenses[index];
      const t = frame.time * (0.10 + lens.drift * 0.035) + lens.phase;
      const cx = w * (lens.x + Math.sin(t * 0.73) * 0.055 + steerX * 0.05);
      const cy = h * (lens.y + Math.cos(t * 0.61) * 0.045 + steerY * 0.04);
      const radius = Math.min(w, h) * lens.radius * (0.92 + Math.sin(t * 0.47) * 0.10);
      const zoom = lens.zoom + Math.sin(t * 0.39 + index) * 0.045 + activity * 0.035;
      const pullX = Math.sin(t * 0.83 + index * 1.7) * radius * 0.10;
      const pullY = Math.cos(t * 0.69 + index * 2.1) * radius * 0.08;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalCompositeOperation = index === 1 ? 'screen' : 'source-over';
      ctx.globalAlpha = 0.20 + activity * 0.05;
      ctx.translate(cx + pullX, cy + pullY);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
      ctx.drawImage(this.snapshot, 0, 0, w, h);
      ctx.restore();

      // Feather the lens boundary with a very faint luminous membrane.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(220,232,225,${0.018 + activity * 0.012})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.82 + Math.sin(t) * 0.03), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
