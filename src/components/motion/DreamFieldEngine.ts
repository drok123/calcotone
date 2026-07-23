import type { ModuleState, XYAssignment } from '../../ui/types';

type RGB = [number, number, number];
type DreamWeights = {
  organic: number;
  ocean: number;
  radial: number;
  cosmic: number;
  crystal: number;
  decay: number;
};

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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
const rgba = (rgb: RGB, alpha: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp01(alpha)})`;
const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
  module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

export class DreamFieldEngine {
  private width = 1;
  private height = 1;
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private gesture = 0;
  private memory: HTMLCanvasElement | null = null;
  private memoryCtx: CanvasRenderingContext2D | null = null;
  private weights: DreamWeights = {
    organic: 0.32,
    ocean: 0.24,
    radial: 0.34,
    cosmic: 0.34,
    crystal: 0.18,
    decay: 0.08,
  };

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    if (!this.memory && typeof document !== 'undefined') {
      this.memory = document.createElement('canvas');
      this.memoryCtx = this.memory.getContext('2d', { alpha: true });
    }

    if (this.memory) {
      const w = Math.max(1, Math.round(this.width));
      const h = Math.max(1, Math.round(this.height));
      if (this.memory.width !== w || this.memory.height !== h) {
        this.memory.width = w;
        this.memory.height = h;
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: DreamFrame) {
    const { modules, assignments, x, y, dragging, time } = frame;
    const active = modules.filter((module) => module.enabled && module.available);
    const byId = (id: string) => active.find((module) => module.id === id);
    const ember = byId('saturation');
    const drift = byId('chorus');
    const halo = byId('delay');
    const atmos = byId('reverb');
    const grain = byId('bitcrusher');
    const artifact = byId('media');

    this.smoothedX += (x - this.smoothedX) * (dragging ? 0.24 : 0.065);
    this.smoothedY += (y - this.smoothedY) * (dragging ? 0.24 : 0.065);
    this.gesture += ((dragging ? 1 : 0) - this.gesture) * (dragging ? 0.18 : 0.04);

    const target: DreamWeights = {
      organic: 0.18 + (atmos ? 0.38 + valueOf(atmos, 'size', 0.5) * 0.42 : 0),
      ocean: 0.14 + (drift ? 0.42 + valueOf(drift, 'depth', 0.3) * 0.42 : 0),
      radial: 0.20 + (ember ? 0.36 + valueOf(ember, 'heat', 0.25) * 0.48 : 0) + (halo ? 0.12 : 0),
      cosmic: 0.20 + (halo ? 0.36 + valueOf(halo, 'feedback', 0.25) * 0.42 : 0) + (atmos ? 0.18 : 0),
      crystal: 0.10 + (grain ? 0.44 + valueOf(grain, 'chaos', 0.15) * 0.46 : 0),
      decay: artifact ? 0.30 + valueOf(artifact, 'wear', 0.2) * 0.60 : 0.04,
    };

    const semanticX = this.smoothedX;
    const semanticY = 1 - this.smoothedY;
    target.organic += (1 - semanticX) * 0.32;
    target.ocean += (1 - semanticX) * (1 - semanticY) * 0.26;
    target.cosmic += semanticX * 0.38;
    target.radial += semanticX * semanticY * 0.30;
    target.crystal += semanticY * 0.30;

    const smoothing = dragging ? 0.06 : 0.022;
    (Object.keys(this.weights) as (keyof DreamWeights)[]).forEach((key) => {
      this.weights[key] = lerp(this.weights[key], clamp01(target[key]), smoothing);
    });

    const width = this.width;
    const height = this.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width, height) * 1.18;
    const patchEnergy = Math.min(1, assignments.length / 6);
    const emberMix = valueOf(ember, 'mix', 0);
    const driftMix = valueOf(drift, 'mix', 0);
    const haloMix = valueOf(halo, 'mix', 0);
    const atmosMix = valueOf(atmos, 'mix', 0);
    const grainMix = valueOf(grain, 'mix', 0);
    const artifactMix = valueOf(artifact, 'mix', 0);

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.fillStyle = 'rgba(3,4,4,0.64)';
    ctx.fillRect(0, 0, width, height);

    this.drawMemory(ctx, time, cx, cy, width, height, haloMix, artifactMix);

    const vignette = ctx.createRadialGradient(cx, cy, scale * 0.02, cx, cy, scale * 0.56);
    vignette.addColorStop(0, 'rgba(62,66,61,0.22)');
    vignette.addColorStop(0.55, 'rgba(18,22,20,0.10)');
    vignette.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const metamorph = (Math.sin(time * 0.07) * 0.5 + 0.5) * 0.52 + semanticX * 0.48;
    this.drawNebula(ctx, time, cx, cy, scale, haloMix, atmosMix, metamorph);
    this.drawFlowFabric(ctx, time, cx, cy, scale, driftMix, semanticY, metamorph);
    this.drawBranchGalaxy(ctx, time, cx, cy, scale, atmosMix, semanticX, metamorph);
    this.drawEyeGalaxy(ctx, time, cx, cy, scale, emberMix, haloMix, metamorph);
    this.drawCrystalBloom(ctx, time, cx, cy, scale, grainMix, semanticY, metamorph);
    this.drawEchoArchitecture(ctx, time, cx, cy, scale, haloMix, patchEnergy, metamorph);
    this.drawSeedForm(ctx, time, cx, cy, scale, metamorph);
    this.drawSemanticGravity(ctx, cx, cy, scale, semanticX, semanticY);

    if (artifact && artifactMix > 0.01) {
      this.drawDecay(ctx, time, width, height, artifactMix, valueOf(artifact, 'wear', 0.2));
    }

    ctx.restore();
    this.captureMemory(ctx, width, height);
  }

  private drawMemory(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    width: number,
    height: number,
    haloMix: number,
    artifactMix: number
  ) {
    if (!this.memory) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.18 + haloMix * 0.12 + artifactMix * 0.05;
    const breathe = 1.010 + Math.sin(time * 0.10) * 0.006 + haloMix * 0.008;
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 0.04) * 0.004);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx + Math.sin(time * 0.14) * artifactMix * 3.0, -cy);
    ctx.drawImage(this.memory, 0, 0, width, height);
    ctx.restore();
  }

  private captureMemory(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.memory || !this.memoryCtx) return;
    this.memoryCtx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.memoryCtx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, this.memory.width, this.memory.height);
  }

  private drawNebula(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, haloMix: number, atmosMix: number, morph: number) {
    const weight = this.weights.cosmic;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const count = 90 + Math.round(weight * 150);
    for (let i = 0; i < count; i += 1) {
      const seed = i * 12.9898;
      const u = ((i * 37) % 101) / 100;
      const arm = i % 5;
      const radius = scale * (0.02 + u * (0.30 + atmosMix * 0.12));
      const angle = arm * Math.PI * 0.4 + u * (3.8 + morph * 4.8) + time * (0.024 + haloMix * 0.032) + Math.sin(seed) * 0.12;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius * (0.42 + atmosMix * 0.22);
      const pulse = 0.55 + Math.sin(time * 0.5 + seed) * 0.35;
      ctx.fillStyle = rgba(i % 11 === 0 ? PALETTE.dusk : PALETTE.bone, weight * (0.07 + pulse * 0.14));
      const size = 1.0 + (i % 5) * 0.34 + atmosMix * 0.7;
      ctx.fillRect(px, py, size, size);
    }
    ctx.restore();
  }

  private drawFlowFabric(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, driftMix: number, semanticY: number, morph: number) {
    const weight = this.weights.ocean;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lines = 13;
    for (let row = 0; row < lines; row += 1) {
      const v = row / (lines - 1) - 0.5;
      ctx.beginPath();
      for (let step = 0; step <= 120; step += 1) {
        const u = step / 120;
        const fold = Math.sin(u * Math.PI * (2.8 + morph * 3.6) + time * (0.15 + driftMix * 0.32) + row * 0.5);
        const undertow = Math.sin(u * 9.2 - time * 0.11 + row * 0.8) * 0.42;
        const depth = Math.cos(u * Math.PI * 2 + row * 0.35 + time * 0.08);
        const px = cx + (u - 0.5) * scale * 0.82;
        const py = cy + v * scale * 0.25 + (fold + undertow) * scale * (0.018 + weight * 0.035 + semanticY * 0.012) + depth * morph * scale * 0.020;
        if (step === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(PALETTE.sea, weight * (0.07 + row * 0.008));
      ctx.lineWidth = 1.0 + driftMix * 0.75;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBranchGalaxy(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, atmosMix: number, semanticX: number, morph: number) {
    const weight = this.weights.organic;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rootX = cx - scale * (0.02 + (1 - semanticX) * 0.05);
    const rootY = cy + scale * 0.22;
    const sway = Math.sin(time * 0.13) * 0.055;

    const branch = (x: number, y: number, length: number, angle: number, depth: number, seed: number) => {
      if (depth <= 0 || length < 2) return;
      const curl = morph * (0.11 + (7 - depth) * 0.04) * Math.sin(seed * 1.7 + time * 0.05);
      const nextAngle = angle + sway * depth + curl;
      const nx = x + Math.cos(nextAngle) * length;
      const ny = y + Math.sin(nextAngle) * length;
      ctx.strokeStyle = rgba(depth <= 2 && morph > 0.52 ? PALETTE.dusk : PALETTE.bone, weight * (0.07 + depth * 0.028));
      ctx.lineWidth = Math.max(0.8, depth * 0.42);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo((x + nx) * 0.5 + Math.sin(seed + time * 0.07) * length * 0.12, (y + ny) * 0.5 - morph * length * 0.08, nx, ny);
      ctx.stroke();
      if (depth === 1 && morph > 0.35) {
        const r = scale * (0.008 + morph * 0.012);
        ctx.strokeStyle = rgba(PALETTE.dusk, weight * morph * 0.18);
        ctx.beginPath();
        ctx.ellipse(nx, ny, r, r * 0.44, nextAngle, 0, Math.PI * 2);
        ctx.stroke();
      }
      const spread = 0.40 + atmosMix * 0.25 + morph * 0.09;
      branch(nx, ny, length * 0.70, nextAngle - spread, depth - 1, seed + 1.7);
      branch(nx, ny, length * 0.67, nextAngle + spread * 0.84, depth - 1, seed + 2.9);
    };

    branch(rootX, rootY, scale * (0.12 + weight * 0.085), -Math.PI * 0.5, 7, 1.2);
    ctx.restore();
  }

  private drawEyeGalaxy(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, emberMix: number, haloMix: number, morph: number) {
    const weight = this.weights.radial;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const radius = scale * (0.10 + weight * 0.12);
    const open = 0.48 + morph * 0.36 + Math.sin(time * 0.10) * 0.03;
    const color = emberMix > 0.08 ? PALETTE.copper : PALETTE.bone;

    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (let i = 0; i <= 72; i += 1) {
        const u = i / 72;
        const xx = (u - 0.5) * radius * 2.9;
        const lid = Math.sin(u * Math.PI) * radius * open * side;
        const spiral = Math.sin(u * Math.PI * 4.2 + time * 0.09) * radius * morph * 0.14;
        const px = cx + xx;
        const py = cy + lid + spiral;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(color, weight * 0.30);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    for (let ring = 0; ring < 10; ring += 1) {
      const rr = radius * (0.16 + ring * 0.085 + Math.sin(time * 0.17 + ring) * 0.012);
      ctx.strokeStyle = rgba(color, weight * (0.10 + ring * 0.015));
      ctx.lineWidth = ring === 0 ? 1.5 : 0.9;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr * (1 + haloMix * 0.15), rr * (0.72 - morph * 0.17), morph * ring * 0.07 + time * 0.018, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let i = 0; i < 52; i += 1) {
      const a = (i / 52) * Math.PI * 2 + morph * Math.sin(i * 2.31 + time * 0.08) * 0.22;
      const inner = radius * 0.13;
      const outer = radius * (0.72 + Math.sin(i * 2.11 + time * 0.11) * 0.20 + morph * 0.30);
      ctx.strokeStyle = rgba(color, weight * 0.13);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner * 0.68);
      ctx.quadraticCurveTo(cx + Math.cos(a + morph * 0.55) * outer * 0.58, cy + Math.sin(a + morph * 0.55) * outer * 0.35, cx + Math.cos(a + morph * 0.9) * outer, cy + Math.sin(a + morph * 0.9) * outer * 0.54);
      ctx.stroke();
    }

    ctx.fillStyle = rgba(PALETTE.bone, 0.14 + weight * 0.16);
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.10, radius * 0.072, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCrystalBloom(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, grainMix: number, semanticY: number, morph: number) {
    const weight = this.weights.crystal;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const shards = 18 + Math.round(weight * 40);
    for (let i = 0; i < shards; i += 1) {
      const seed = i * 4.123;
      const radial = ((i * 29) % 101) / 100;
      const angle = seed * 0.71 + time * 0.02 + morph * radial * 2.4;
      const ring = scale * (0.06 + radial * 0.31);
      const px = cx + Math.cos(angle) * ring;
      const py = cy + Math.sin(angle * (0.72 + morph * 0.17)) * ring * 0.58;
      const length = scale * (0.012 + ((i * 13) % 9) * 0.0035 + semanticY * 0.015 + morph * 0.008);
      const a = angle * 1.55 + Math.sin(seed) * 0.5;
      ctx.strokeStyle = rgba(PALETTE.dusk, weight * (0.10 + grainMix * 0.14));
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(a) * length, py - Math.sin(a) * length);
      ctx.lineTo(px + Math.cos(a) * length, py + Math.sin(a) * length);
      ctx.lineTo(px + Math.cos(a + 1.3) * length * 0.52, py + Math.sin(a + 1.3) * length * 0.52);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEchoArchitecture(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, haloMix: number, patchEnergy: number, morph: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i += 1) {
      const phase = (time * 0.045 + i / 8) % 1;
      const radius = scale * (0.05 + phase * 0.34);
      const sides = 6 + Math.round(morph * 6);
      ctx.strokeStyle = rgba(PALETTE.ash, (1 - phase) * (0.05 + patchEnergy * 0.09 + haloMix * 0.08));
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let side = 0; side <= sides; side += 1) {
        const a = (side / sides) * Math.PI * 2 + phase * morph * 0.85;
        const rx = radius * (1 + Math.sin(a * 3 + time * 0.09) * morph * 0.10);
        const px = cx + Math.cos(a) * rx;
        const py = cy + Math.sin(a) * rx * (0.46 + morph * 0.08);
        if (side === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSeedForm(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, morph: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const radius = scale * (0.18 + Math.sin(time * 0.12) * 0.015);
    ctx.strokeStyle = rgba(PALETTE.bone, 0.18);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * (0.42 + morph * 0.10), time * 0.02, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(PALETTE.copper, 0.09);
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.72, radius * 0.31, -time * 0.025, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawSemanticGravity(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, semanticX: number, semanticY: number) {
    const px = lerp(cx - scale * 0.22, cx + scale * 0.22, semanticX);
    const py = lerp(cy + scale * 0.14, cy - scale * 0.14, semanticY);
    const glow = ctx.createRadialGradient(px, py, 0, px, py, scale * (0.08 + this.gesture * 0.06));
    glow.addColorStop(0, rgba(PALETTE.bone, 0.12 + this.gesture * 0.15));
    glow.addColorStop(0.45, rgba(PALETTE.copper, 0.03 + this.gesture * 0.04));
    glow.addColorStop(1, rgba(PALETTE.bone, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawDecay(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, mix: number, wear: number) {
    ctx.save();
    const scars = 4 + Math.round(wear * 9);
    for (let i = 0; i < scars; i += 1) {
      const seed = i * 8.13;
      const rawY = (Math.sin(seed) * 0.5 + 0.5) * height + time * (3 + wear * 9) * (i % 2 ? 1 : -1);
      const y = ((rawY % height) + height) % height;
      ctx.fillStyle = `rgba(220,180,120,${0.035 + mix * wear * 0.07})`;
      ctx.fillRect(0, y, width, 1 + (i % 3));
    }
    ctx.restore();
  }
}
