import { DreamFieldEngine as OpticsDreamEngine } from './DreamFieldEngineV6';
import type { ModuleState, XYAssignment } from '../../ui/types';

type DreamFrame = { modules: ModuleState[]; assignments: XYAssignment[]; x: number; y: number; dragging: boolean; time: number };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class DreamFieldEngine {
  private readonly core = new OpticsDreamEngine();
  private width = 1;
  private height = 1;

  resize(width: number, height: number) {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.core.resize(this.width, this.height);
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    this.core.render(ctx, frame);
    const w = this.width, h = this.height, t = frame.time;
    const activity = clamp01(frame.assignments.length / 6 + (frame.dragging ? 0.18 : 0));
    const x = clamp01(frame.x), y = clamp01(frame.y);
    const horizon = h * (0.53 + Math.sin(t * 0.035) * 0.035 + (0.5 - y) * 0.05);
    const cx = w * (0.50 + (x - 0.5) * 0.16 + Math.sin(t * 0.027) * 0.025);

    // Reference grammar: a stable horizon gives the eye a world to inhabit while everything else mutates.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const hg = ctx.createLinearGradient(0, horizon - h * 0.09, 0, horizon + h * 0.10);
    hg.addColorStop(0, 'rgba(255,154,103,0)'); hg.addColorStop(0.48, `rgba(244,159,105,${0.07 + activity * 0.025})`);
    hg.addColorStop(0.53, `rgba(112,219,218,${0.08 + activity * 0.025})`); hg.addColorStop(1, 'rgba(80,174,184,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, horizon - h * 0.10, w, h * 0.20);
    ctx.restore();

    // Giant celestial arch / eclipse mask. It is deliberately incomplete so it can read as planet,
    // eye, cave mouth or halo depending on what the semantic raster beneath it is doing.
    const archR = Math.min(w, h) * (0.43 + Math.sin(t * 0.041) * 0.035);
    const archY = horizon - archR * (0.42 + Math.sin(t * 0.023) * 0.06);
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.010);
    const ag = ctx.createLinearGradient(cx - archR, archY, cx + archR, archY);
    ag.addColorStop(0, 'rgba(102,224,218,0.05)'); ag.addColorStop(0.45, 'rgba(236,246,237,0.17)'); ag.addColorStop(0.72, 'rgba(255,157,95,0.16)'); ag.addColorStop(1, 'rgba(215,102,184,0.04)');
    ctx.strokeStyle = ag; ctx.beginPath(); ctx.arc(cx, archY, archR, Math.PI * 1.04, Math.PI * 1.96); ctx.stroke(); ctx.restore();

    // Nested portal/eclipses: one near the horizon and one foreground anchor. These are the strongest
    // recurring compositional masks in the sampled reference frames.
    this.portal(ctx, cx, horizon - h * 0.12, Math.min(w, h) * (0.055 + activity * 0.012), t, 0.16);
    this.portal(ctx, w * (0.50 + Math.sin(t * 0.021) * 0.025), h * 0.82, Math.min(w, h) * 0.085, t + 2.4, 0.11);

    // Planet/orb chain. Sparse, asymmetric orbital beads make the scene feel authored rather than noisy.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 7; i++) {
      const a = -2.72 + i * 0.38 + Math.sin(t * 0.018 + i) * 0.035;
      const rr = archR * (0.90 + i * 0.025);
      const px = cx + Math.cos(a) * rr;
      const py = archY + Math.sin(a) * rr * 0.72;
      const pr = Math.max(1.2, Math.min(w, h) * (0.010 + (i % 3) * 0.004));
      const pg = ctx.createRadialGradient(px - pr * 0.25, py - pr * 0.25, 0, px, py, pr);
      pg.addColorStop(0, 'rgba(246,240,218,0.20)'); pg.addColorStop(0.45, i % 2 ? 'rgba(105,205,210,0.15)' : 'rgba(241,136,103,0.16)'); pg.addColorStop(1, 'rgba(10,12,15,0)');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Mirrored landscape silhouette. The reference repeatedly uses forests/mountains as dark masks,
    // not detailed tree drawings. This keeps the semantic raster visible through the negative space.
    this.ridge(ctx, horizon, t, false);
    this.ridge(ctx, horizon + 1, t + 1.7, true);

    // Concentric foreground terrain/ripple bands create depth and a destination for the camera push.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      const ry = h * (0.79 + i * 0.052);
      const rx = w * (0.20 + i * 0.105);
      ctx.strokeStyle = i % 2 ? 'rgba(111,210,205,0.035)' : 'rgba(228,116,188,0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.86, rx, Math.max(2, ry - h * 0.79), 0, Math.PI, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private portal(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number, alpha: number) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(x, y, r * 0.18, x, y, r * 1.55);
    glow.addColorStop(0, 'rgba(5,7,9,0)'); glow.addColorStop(0.45, `rgba(255,168,91,${alpha})`); glow.addColorStop(0.64, `rgba(235,104,177,${alpha * 0.75})`); glow.addColorStop(0.82, `rgba(91,214,217,${alpha * 0.62})`); glow.addColorStop(1, 'rgba(91,214,217,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 1.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(4,7,8,${0.74 + Math.sin(time * 0.2) * 0.05})`; ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  private ridge(ctx: CanvasRenderingContext2D, horizon: number, time: number, reflected: boolean) {
    const w = this.width, h = this.height;
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = reflected ? 0.18 : 0.34;
    ctx.fillStyle = reflected ? 'rgba(14,30,34,0.65)' : 'rgba(7,14,17,0.82)';
    ctx.beginPath(); ctx.moveTo(0, horizon);
    const count = 34;
    for (let i = 0; i <= count; i++) {
      const px = (i / count) * w;
      const n = Math.sin(i * 1.73 + time * 0.07) * 0.5 + Math.sin(i * 0.47 - time * 0.04) * 0.5;
      const spike = Math.pow(Math.abs(Math.sin(i * 2.31 + 0.7)), 8);
      const height = h * (0.035 + (n * 0.5 + 0.5) * 0.075 + spike * 0.10);
      ctx.lineTo(px, reflected ? horizon + height * 0.72 : horizon - height);
    }
    ctx.lineTo(w, reflected ? horizon : horizon); ctx.closePath(); ctx.fill(); ctx.restore();
  }
}
