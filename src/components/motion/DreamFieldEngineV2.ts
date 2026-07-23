import type { ModuleState, XYAssignment } from '../../ui/types';

type RGB = [number, number, number];
type Vec2 = { x: number; y: number };
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
const GRID_X = 32;
const GRID_Y = 21;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
const expEase = (rate: number, dt: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(0.1, dt)));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const rgba = (rgb: RGB, alpha: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp01(alpha)})`;
const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
  module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

export class DreamFieldEngine {
  private width = 1;
  private height = 1;
  private x = 0.5;
  private y = 0.5;
  private gesture = 0;
  private lastTime = 0;
  private memory: HTMLCanvasElement | null = null;
  private memoryCtx: CanvasRenderingContext2D | null = null;
  private weights: MorphWeights = {
    eye: 0.08,
    tree: 0.12,
    ocean: 0.12,
    galaxy: 0.10,
    crystal: 0.05,
    landscape: 0.53,
  };

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const changed = Math.abs(nextWidth - this.width) > 0.5 || Math.abs(nextHeight - this.height) > 0.5;
    this.width = nextWidth;
    this.height = nextHeight;

    if (!this.memory && typeof document !== 'undefined') {
      this.memory = document.createElement('canvas');
      this.memoryCtx = this.memory.getContext('2d', { alpha: true });
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

    const targetWeights = this.resolveDominantWeights(
      frame.time,
      emberMix,
      driftMix,
      haloMix,
      atmosMix,
      grainMix
    );
    const morphEase = expEase(frame.dragging ? 3.4 : 1.15, dt);
    for (const key of MORPHS) this.weights[key] = lerp(this.weights[key], targetWeights[key], morphEase);

    const width = this.width;
    const height = this.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width, height) * 1.12;
    const patchEnergy = Math.min(1, frame.assignments.length / 6);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(3,4,4,0.50)';
    ctx.fillRect(0, 0, width, height);
    this.drawMemory(ctx, frame.time, cx, cy, width, height, haloMix, artifactMix);

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.58);
    glow.addColorStop(0, 'rgba(82,88,82,0.13)');
    glow.addColorStop(0.52, 'rgba(22,27,24,0.055)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const field = this.buildMorphField(frame.time, emberMix, driftMix, haloMix, atmosMix, grainMix);
    this.drawSurface(ctx, field, cx, cy, scale, emberMix, driftMix, haloMix, atmosMix, grainMix, patchEnergy, frame.time);
    this.drawSemanticReveal(ctx, field, cx, cy, scale, frame.time, emberMix, haloMix, grainMix);
    this.drawArtifactDecay(ctx, frame.time, width, height, artifactMix, valueOf(artifact, 'wear', 0));
    this.captureMemory(ctx, width, height);
  }

  private resolveDominantWeights(
    time: number,
    ember: number,
    drift: number,
    halo: number,
    atmos: number,
    grain: number
  ): MorphWeights {
    const up = this.y;
    const right = this.x;
    const slowA = Math.sin(time * 0.075) * 0.5 + 0.5;
    const slowB = Math.sin(time * 0.047 + 2.1) * 0.5 + 0.5;
    const slowC = Math.sin(time * 0.031 + 4.2) * 0.5 + 0.5;

    const scores: MorphWeights = {
      eye: 0.14 + right * up * 0.42 + ember * 0.70 + halo * 0.14 + slowA * 0.10,
      tree: 0.16 + (1 - right) * 0.34 + atmos * 0.72 + slowB * 0.12,
      ocean: 0.15 + (1 - right) * (1 - up) * 0.38 + drift * 0.78 + slowC * 0.10,
      galaxy: 0.16 + right * 0.38 + halo * 0.76 + atmos * 0.18 + slowA * 0.12,
      crystal: 0.08 + up * 0.28 + grain * 0.92 + slowB * 0.08,
      landscape: 0.25 + (1 - up) * 0.18 + atmos * 0.25 + drift * 0.12 + slowC * 0.18,
    };

    const ranked = [...MORPHS].sort((a, b) => scores[b] - scores[a]);
    const raw: MorphWeights = { eye: 0, tree: 0, ocean: 0, galaxy: 0, crystal: 0, landscape: 0 };

    // Two forms lead. A third is allowed to leak in so transitions stay uncanny rather than binary.
    raw[ranked[0]] = Math.pow(scores[ranked[0]], 2.8);
    raw[ranked[1]] = Math.pow(scores[ranked[1]], 2.45) * 0.82;
    raw[ranked[2]] = Math.pow(scores[ranked[2]], 2.1) * 0.22;

    const total = MORPHS.reduce((sum, key) => sum + raw[key], 0) || 1;
    for (const key of MORPHS) raw[key] /= total;
    return raw;
  }

  private buildMorphField(time: number, ember: number, drift: number, halo: number, atmos: number, grain: number): Vec2[][] {
    const field: Vec2[][] = [];
    const phase = time * 0.055;
    const gravityX = (this.x - 0.5) * 0.24;
    const gravityY = (0.5 - this.y) * 0.18;

    for (let gy = 0; gy < GRID_Y; gy += 1) {
      const row: Vec2[] = [];
      const v = gy / (GRID_Y - 1) * 2 - 1;
      for (let gx = 0; gx < GRID_X; gx += 1) {
        const u = gx / (GRID_X - 1) * 2 - 1;
        const radius = Math.hypot(u, v);
        const angle = Math.atan2(v, u);

        const eye = this.eyeTarget(u, v, radius, angle, phase, ember, halo);
        const tree = this.treeTarget(u, v, phase, atmos);
        const ocean = this.oceanTarget(u, v, phase, drift);
        const galaxy = this.galaxyTarget(u, v, radius, angle, phase, halo, atmos);
        const crystal = this.crystalTarget(u, v, radius, angle, phase, grain);
        const landscape = this.landscapeTarget(u, v, phase, atmos, drift);

        let px = eye.x * this.weights.eye + tree.x * this.weights.tree + ocean.x * this.weights.ocean
          + galaxy.x * this.weights.galaxy + crystal.x * this.weights.crystal + landscape.x * this.weights.landscape;
        let py = eye.y * this.weights.eye + tree.y * this.weights.tree + ocean.y * this.weights.ocean
          + galaxy.y * this.weights.galaxy + crystal.y * this.weights.crystal + landscape.y * this.weights.landscape;

        // Domain warping is shared by every grammar, so the dream is one object rather than composited motifs.
        const warpA = Math.sin(px * 5.1 + py * 3.8 + time * 0.14);
        const warpB = Math.cos(py * 5.8 - px * 3.2 - time * 0.10);
        const weird = 0.018 + this.y * 0.020 + this.gesture * 0.014 + grain * 0.008;
        px += warpB * weird;
        py += warpA * weird;

        const influence = Math.exp(-(px * px + py * py) * 1.65) * (0.14 + this.gesture * 0.24);
        px += gravityX * influence;
        py += gravityY * influence;
        row.push({ x: px, y: py });
      }
      field.push(row);
    }
    return field;
  }

  private eyeTarget(u: number, v: number, radius: number, angle: number, phase: number, ember: number, halo: number): Vec2 {
    const eyelid = Math.sin((u + 1) * Math.PI * 0.5) * 0.50;
    const lid = Math.sign(v || 1) * Math.min(Math.abs(v), eyelid);
    const iris = Math.exp(-radius * 3.6);
    const twist = iris * (0.20 + halo * 0.32) * Math.sin(angle * 8 + phase * 2.5);
    return {
      x: u * (0.83 + iris * 0.17) + Math.cos(angle + twist) * ember * iris * 0.12,
      y: lid * 0.70 + Math.sin(angle * 6 + phase) * iris * 0.052,
    };
  }

  private treeTarget(u: number, v: number, phase: number, atmos: number): Vec2 {
    const trunk = Math.exp(-Math.abs(u) * 4.4) * smoothstep(0.08, 0.92, 1 - Math.abs(v));
    const branch = Math.sin(u * 5.5 + v * 2.4 + phase * 1.8) * (1 - Math.abs(v));
    const fork = Math.sin(v * 10.2 - Math.abs(u) * 5.2 + phase) * 0.55;
    return {
      x: u * (0.73 + atmos * 0.11) + branch * 0.11 * (1 - Math.abs(v)) + Math.sign(u || 1) * trunk * 0.038,
      y: v * 0.88 - trunk * 0.12 + fork * Math.abs(u) * 0.04,
    };
  }

  private oceanTarget(u: number, v: number, phase: number, drift: number): Vec2 {
    const wave = Math.sin(u * 5.0 + phase * (3.8 + drift * 3.2) + v * 1.9);
    const undertow = Math.sin(u * 2.1 - phase * 2.1 + v * 6.1);
    return {
      x: u + undertow * 0.028 * (0.45 + drift),
      y: v * 0.77 + wave * (0.060 + drift * 0.080) + undertow * 0.020,
    };
  }

  private galaxyTarget(u: number, v: number, radius: number, angle: number, phase: number, halo: number, atmos: number): Vec2 {
    const spiral = angle + radius * (2.7 + halo * 4.1) + phase * (1.2 + halo * 1.9);
    const r = radius * (0.82 + Math.sin(radius * 10.6 - phase) * 0.040);
    return { x: Math.cos(spiral) * r, y: Math.sin(spiral) * r * (0.61 + atmos * 0.17) };
  }

  private crystalTarget(u: number, v: number, radius: number, angle: number, phase: number, grain: number): Vec2 {
    const facets = 6 + Math.round(grain * 7);
    const unit = Math.PI * 2 / facets;
    const snapped = Math.round(angle / unit) * unit;
    const stepped = Math.round(radius * (7 + grain * 11)) / (7 + grain * 11);
    const fracture = Math.sin(u * 13.1 + v * 17.3 + phase * 2) * grain * 0.040;
    return { x: Math.cos(snapped) * stepped + fracture, y: Math.sin(snapped) * stepped * 0.72 - fracture };
  }

  private landscapeTarget(u: number, v: number, phase: number, atmos: number, drift: number): Vec2 {
    const depth = clamp01((v + 1) * 0.5);
    const horizon = Math.pow(depth, 1.55);
    const ridge = (
      Math.sin(u * 3.1 + phase * 1.25) * 0.14
      + Math.sin(u * 7.2 - phase * 0.8 + 1.8) * 0.060
      + Math.sin(u * 14.7 + phase * 0.42) * 0.024
    ) * (0.34 + atmos * 0.58);
    const valley = -Math.exp(-Math.pow(u * 1.45, 2)) * 0.11 * (0.5 + drift * 0.5);
    const dune = Math.sin(u * 2.0 + phase * 0.32) * 0.048 * (1 - depth);
    return {
      x: u * (0.82 + horizon * 0.17) + Math.sin(v * 5 + phase) * 0.012,
      y: lerp(-0.07 + ridge + valley, v * 0.84 + dune, horizon),
    };
  }

  private drawSurface(
    ctx: CanvasRenderingContext2D,
    field: Vec2[][],
    cx: number,
    cy: number,
    scale: number,
    ember: number,
    drift: number,
    halo: number,
    atmos: number,
    grain: number,
    patchEnergy: number,
    time: number
  ) {
    const toScreen = (p: Vec2) => ({ x: cx + p.x * scale * 0.43, y: cy + p.y * scale * 0.43 });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Translucent cells give the field visual mass; this keeps it from reading as stacked line art.
    for (let gy = 0; gy < GRID_Y - 1; gy += 1) {
      for (let gx = 0; gx < GRID_X - 1; gx += 1) {
        if ((gx + gy) % 2 !== 0) continue;
        const a = toScreen(field[gy][gx]);
        const b = toScreen(field[gy][gx + 1]);
        const c = toScreen(field[gy + 1][gx + 1]);
        const d = toScreen(field[gy + 1][gx]);
        const center = 1 - Math.abs(gy / (GRID_Y - 1) - 0.5) * 2;
        const tint = ember > 0.18 && center > 0.5 ? PALETTE.copper : drift > 0.22 ? PALETTE.sea : PALETTE.bone;
        ctx.fillStyle = rgba(tint, 0.006 + center * 0.010 + atmos * 0.006);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
        ctx.fill();
      }
    }

    // Sparse contours reveal the warped surface without turning it back into a wire grid.
    for (let gy = 0; gy < GRID_Y; gy += 2) {
      ctx.beginPath();
      field[gy].forEach((point, i) => {
        const p = toScreen(point);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      const center = 1 - Math.abs(gy / (GRID_Y - 1) - 0.5) * 2;
      ctx.strokeStyle = rgba(center > 0.55 && ember > 0.12 ? PALETTE.copper : PALETTE.bone, 0.055 + center * 0.11 + halo * 0.025 + patchEnergy * 0.018);
      ctx.lineWidth = 0.72 + center * 0.75 + atmos * 0.24;
      ctx.stroke();
    }

    for (let gx = 0; gx < GRID_X; gx += 4) {
      ctx.beginPath();
      for (let gy = 0; gy < GRID_Y; gy += 1) {
        const p = toScreen(field[gy][gx]);
        if (gy === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = rgba(grain > 0.22 && gx % 8 === 0 ? PALETTE.dusk : PALETTE.ash, 0.030 + drift * 0.025);
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }

    const veinRow = Math.floor(((time * 0.055) % 1) * (GRID_Y - 1));
    ctx.beginPath();
    field[veinRow].forEach((point, i) => {
      const p = toScreen(point);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = rgba(PALETTE.bone, 0.11 + this.gesture * 0.09);
    ctx.lineWidth = 1.25 + this.gesture * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawSemanticReveal(ctx: CanvasRenderingContext2D, field: Vec2[][], cx: number, cy: number, scale: number, time: number, ember: number, halo: number, grain: number) {
    const ranked = [...MORPHS].sort((a, b) => this.weights[b] - this.weights[a]);
    const lead = ranked[0];
    const strength = smoothstep(0.46, 0.78, this.weights[lead]);
    if (strength < 0.02) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const center = field[Math.floor(GRID_Y / 2)][Math.floor(GRID_X / 2)];
    const x = cx + center.x * scale * 0.43;
    const y = cy + center.y * scale * 0.43;

    if (lead === 'eye') {
      const r = scale * (0.070 + ember * 0.026);
      ctx.strokeStyle = rgba(ember > 0.1 ? PALETTE.copper : PALETTE.bone, strength * 0.26);
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.8, r * 0.70, Math.sin(time * 0.025) * 0.12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.30, r * 0.30, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (lead === 'galaxy') {
      for (let i = 0; i < 38; i += 1) {
        const rr = scale * (0.018 + ((i * 17) % 100) / 100 * 0.27);
        const a = i * 2.399 + rr * 0.05 + time * (0.014 + halo * 0.022);
        ctx.fillStyle = rgba(i % 8 === 0 ? PALETTE.dusk : PALETTE.bone, strength * 0.13);
        ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.48, 1.2, 1.2);
      }
    } else if (lead === 'crystal' && grain > 0.12) {
      for (let i = 0; i < 14; i += 1) {
        const a = i * 2.73 + time * 0.018;
        const rr = scale * (0.08 + ((i * 11) % 17) * 0.012);
        ctx.strokeStyle = rgba(PALETTE.dusk, strength * (0.10 + grain * 0.10));
        ctx.strokeRect(cx + Math.cos(a) * rr - 2, cy + Math.sin(a * 0.83) * rr * 0.62 - 2, 4 + (i % 3), 4 + (i % 2));
      }
    }
    ctx.restore();
  }

  private drawMemory(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, width: number, height: number, halo: number, artifact: number) {
    if (!this.memory || this.memory.width < 2 || this.memory.height < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.13 + halo * 0.10 + artifact * 0.035;
    const breathe = 1.006 + Math.sin(time * 0.07) * 0.004 + halo * 0.006;
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 0.028) * 0.004 + artifact * Math.sin(time * 0.35) * 0.002);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx + Math.sin(time * 0.11) * artifact * 3.5, -cy + Math.cos(time * 0.075) * halo * 1.2);
    ctx.drawImage(this.memory, 0, 0, width, height);
    ctx.restore();
  }

  private captureMemory(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.memory || !this.memoryCtx) return;
    this.memoryCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.memoryCtx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.memoryCtx.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, width, height);
  }

  private drawArtifactDecay(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, mix: number, wear: number) {
    if (mix <= 0.01) return;
    ctx.save();
    const scars = 2 + Math.round(wear * 6);
    for (let i = 0; i < scars; i += 1) {
      const rawY = (Math.sin(i * 8.13) * 0.5 + 0.5) * height + time * (2 + wear * 7) * (i % 2 ? 1 : -1);
      const y = ((rawY % height) + height) % height;
      ctx.fillStyle = rgba(PALETTE.ash, 0.014 + mix * wear * 0.045);
      ctx.fillRect(Math.sin(time * 0.7 + i) * wear * 8, y, width, 1 + (i % 3));
    }
    ctx.restore();
  }
}
