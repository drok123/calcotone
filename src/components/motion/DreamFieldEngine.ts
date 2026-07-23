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
  bone: [220, 226, 221] as RGB,
  copper: [204, 145, 92] as RGB,
  sea: [116, 151, 151] as RGB,
  dusk: [132, 122, 150] as RGB,
  ash: [148, 137, 127] as RGB,
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
  private weights: DreamWeights = {
    organic: 0.2,
    ocean: 0.15,
    radial: 0.2,
    cosmic: 0.2,
    crystal: 0.1,
    decay: 0.05,
  };

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
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

    this.smoothedX += (x - this.smoothedX) * (dragging ? 0.22 : 0.065);
    this.smoothedY += (y - this.smoothedY) * (dragging ? 0.22 : 0.065);
    this.gesture += ((dragging ? 1 : 0) - this.gesture) * (dragging ? 0.16 : 0.035);

    const target: DreamWeights = {
      organic: 0.10 + (atmos ? 0.34 + valueOf(atmos, 'size', 0.5) * 0.36 : 0),
      ocean: 0.08 + (drift ? 0.38 + valueOf(drift, 'depth', 0.3) * 0.34 : 0),
      radial: 0.12 + (ember ? 0.28 + valueOf(ember, 'heat', 0.25) * 0.42 : 0) + (halo ? 0.18 : 0),
      cosmic: 0.14 + (halo ? 0.30 + valueOf(halo, 'feedback', 0.25) * 0.34 : 0) + (atmos ? 0.16 : 0),
      crystal: 0.04 + (grain ? 0.40 + valueOf(grain, 'chaos', 0.15) * 0.40 : 0),
      decay: artifact ? 0.28 + valueOf(artifact, 'wear', 0.2) * 0.55 : 0.03,
    };

    // XY is semantic rather than merely positional: left leans organic/oceanic,
    // right leans cosmic/radial; upward increases surreal/crystalline behavior.
    const semanticX = this.smoothedX;
    const semanticY = 1 - this.smoothedY;
    target.organic += (1 - semanticX) * 0.24;
    target.ocean += (1 - semanticX) * (1 - semanticY) * 0.18;
    target.cosmic += semanticX * 0.30;
    target.radial += semanticX * semanticY * 0.20;
    target.crystal += semanticY * 0.22;

    const smoothing = dragging ? 0.055 : 0.022;
    (Object.keys(this.weights) as (keyof DreamWeights)[]).forEach((key) => {
      this.weights[key] = lerp(this.weights[key], clamp01(target[key]), smoothing);
    });

    const width = this.width;
    const height = this.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width, height);
    const patchEnergy = Math.min(1, assignments.length / 6);
    const emberMix = valueOf(ember, 'mix', 0);
    const driftMix = valueOf(drift, 'mix', 0);
    const haloMix = valueOf(halo, 'mix', 0);
    const atmosMix = valueOf(atmos, 'mix', 0);
    const grainMix = valueOf(grain, 'mix', 0);
    const artifactMix = valueOf(artifact, 'mix', 0);

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.fillStyle = 'rgba(2,3,3,0.92)';
    ctx.fillRect(0, 0, width, height);

    const vignette = ctx.createRadialGradient(cx, cy, scale * 0.08, cx, cy, scale * 0.78);
    vignette.addColorStop(0, 'rgba(24,25,23,0.22)');
    vignette.addColorStop(0.55, 'rgba(8,10,9,0.10)');
    vignette.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    this.drawCosmicField(ctx, time, cx, cy, scale, haloMix, atmosMix);
    this.drawOceanField(ctx, time, cx, cy, scale, driftMix, semanticY);
    this.drawBranchField(ctx, time, cx, cy, scale, atmosMix, semanticX);
    this.drawRadialOrganism(ctx, time, cx, cy, scale, emberMix, haloMix);
    this.drawCrystalField(ctx, time, cx, cy, scale, grainMix, semanticY);
    this.drawSignalGhosts(ctx, time, cx, cy, scale, artifactMix, patchEnergy);
    this.drawSemanticFocus(ctx, cx, cy, scale, semanticX, semanticY);

    if (artifact && artifactMix > 0.01) {
      this.drawDecay(ctx, time, width, height, artifactMix, valueOf(artifact, 'wear', 0.2));
    }

    ctx.restore();
  }

  private drawCosmicField(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, haloMix: number, atmosMix: number) {
    const weight = this.weights.cosmic;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const count = 42 + Math.round(weight * 80);
    for (let i = 0; i < count; i += 1) {
      const seed = i * 12.9898;
      const arm = i % 4;
      const radius = (0.05 + ((i * 37) % 100) / 100 * 0.47) * scale;
      const angle = arm * Math.PI * 0.5 + radius * 0.025 + time * (0.025 + haloMix * 0.035) + Math.sin(seed) * 0.32;
      const stretch = 0.46 + atmosMix * 0.26;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * stretch;
      const twinkle = 0.45 + Math.sin(time * 0.7 + seed) * 0.35;
      ctx.fillStyle = rgba(PALETTE.bone, weight * (0.07 + twinkle * 0.08));
      const size = 0.7 + (i % 5) * 0.22;
      ctx.fillRect(x, y, size, size);
    }
    for (let ring = 0; ring < 4; ring += 1) {
      const phase = (time * 0.035 + ring * 0.21) % 1;
      ctx.strokeStyle = rgba(PALETTE.dusk, weight * (0.05 + haloMix * 0.08) * (1 - phase));
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.ellipse(cx, cy, scale * (0.10 + phase * 0.42), scale * (0.05 + phase * 0.19), phase * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawOceanField(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, driftMix: number, semanticY: number) {
    const weight = this.weights.ocean;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lines = 8;
    for (let line = 0; line < lines; line += 1) {
      const baseY = cy + (line - (lines - 1) / 2) * scale * 0.035;
      ctx.beginPath();
      for (let step = 0; step <= 90; step += 1) {
        const u = step / 90;
        const x = cx + (u - 0.5) * scale * 0.95;
        const wave = Math.sin(u * Math.PI * 4.2 + time * (0.18 + driftMix * 0.34) + line * 0.62);
        const undertow = Math.sin(u * Math.PI * 1.7 - time * 0.11 + line) * 0.45;
        const y = baseY + (wave + undertow) * scale * (0.012 + weight * 0.022 + semanticY * 0.008);
        if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(PALETTE.sea, weight * (0.045 + line * 0.006));
      ctx.lineWidth = 0.8 + driftMix * 0.35;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBranchField(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, atmosMix: number, semanticX: number) {
    const weight = this.weights.organic;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rootX = cx - scale * (0.03 + (1 - semanticX) * 0.08);
    const rootY = cy + scale * 0.26;
    const sway = Math.sin(time * 0.12) * 0.05;
    const drawBranch = (x: number, y: number, length: number, angle: number, depth: number, seed: number) => {
      if (depth <= 0 || length < 2) return;
      const nx = x + Math.cos(angle + sway * depth) * length;
      const ny = y + Math.sin(angle + sway * depth) * length;
      ctx.strokeStyle = rgba(PALETTE.bone, weight * (0.035 + depth * 0.018));
      ctx.lineWidth = Math.max(0.55, depth * 0.34);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        (x + nx) * 0.5 + Math.sin(seed + time * 0.07) * length * 0.08,
        (y + ny) * 0.5,
        nx,
        ny
      );
      ctx.stroke();
      const spread = 0.42 + atmosMix * 0.22;
      drawBranch(nx, ny, length * 0.70, angle - spread, depth - 1, seed + 1.7);
      drawBranch(nx, ny, length * 0.66, angle + spread * 0.82, depth - 1, seed + 2.9);
    };
    drawBranch(rootX, rootY, scale * (0.13 + weight * 0.08), -Math.PI * 0.5, 6, 1.2);
    ctx.restore();
  }

  private drawRadialOrganism(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, emberMix: number, haloMix: number) {
    const weight = this.weights.radial;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const radius = scale * (0.10 + weight * 0.09);
    const irisColor = emberMix > 0.08 ? PALETTE.copper : PALETTE.bone;
    for (let ring = 0; ring < 7; ring += 1) {
      const rr = radius * (0.28 + ring * 0.12 + Math.sin(time * 0.18 + ring) * 0.012);
      ctx.strokeStyle = rgba(irisColor, weight * (0.035 + ring * 0.009));
      ctx.lineWidth = ring === 0 ? 1.3 : 0.75;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr * (1 + haloMix * 0.15), rr * (0.62 + haloMix * 0.05), Math.sin(time * 0.05) * 0.12, 0, Math.PI * 2);
      ctx.stroke();
    }
    const spokes = 32;
    for (let i = 0; i < spokes; i += 1) {
      const a = (i / spokes) * Math.PI * 2 + Math.sin(time * 0.09 + i) * 0.02;
      const inner = radius * 0.20;
      const outer = radius * (0.82 + Math.sin(i * 2.31 + time * 0.12) * 0.16);
      ctx.strokeStyle = rgba(irisColor, weight * 0.055);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner * 0.62);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer * 0.62);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(PALETTE.bone, 0.08 + weight * 0.08);
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.12, radius * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCrystalField(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, grainMix: number, semanticY: number) {
    const weight = this.weights.crystal;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const shards = 10 + Math.round(weight * 18);
    for (let i = 0; i < shards; i += 1) {
      const seed = i * 4.123;
      const angle = seed + time * 0.025;
      const ring = scale * (0.10 + ((i * 17) % 100) / 100 * 0.31);
      const x = cx + Math.cos(angle * 0.73) * ring;
      const y = cy + Math.sin(angle * 0.51) * ring * 0.58;
      const length = scale * (0.018 + ((i * 13) % 9) * 0.004 + semanticY * 0.012);
      const a = angle * 1.7 + Math.sin(seed) * 0.5;
      ctx.strokeStyle = rgba(PALETTE.dusk, weight * (0.06 + grainMix * 0.06));
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * length, y - Math.sin(a) * length);
      ctx.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length);
      ctx.lineTo(x + Math.cos(a + 1.2) * length * 0.45, y + Math.sin(a + 1.2) * length * 0.45);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSignalGhosts(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, scale: number, artifactMix: number, patchEnergy: number) {
    const total = 6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < total; i += 1) {
      const phase = (time * 0.07 + i / total) % 1;
      const radius = scale * (0.07 + phase * 0.39);
      ctx.strokeStyle = rgba(PALETTE.ash, (1 - phase) * (0.018 + patchEnergy * 0.025 + artifactMix * 0.018));
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * 0.48, phase * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSemanticFocus(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, semanticX: number, semanticY: number) {
    const px = lerp(cx - scale * 0.28, cx + scale * 0.28, semanticX);
    const py = lerp(cy + scale * 0.17, cy - scale * 0.17, semanticY);
    const glow = ctx.createRadialGradient(px, py, 0, px, py, scale * (0.08 + this.gesture * 0.05));
    glow.addColorStop(0, rgba(PALETTE.bone, 0.05 + this.gesture * 0.07));
    glow.addColorStop(1, rgba(PALETTE.bone, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawDecay(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, mix: number, wear: number) {
    ctx.save();
    const scars = 4 + Math.round(wear * 8);
    for (let i = 0; i < scars; i += 1) {
      const seed = i * 8.13;
      const y = ((Math.sin(seed) * 0.5 + 0.5) * height + time * (3 + wear * 9) * (i % 2 ? 1 : -1)) % height;
      const h = 0.6 + (i % 3) * 0.9;
      ctx.fillStyle = `rgba(190,160,120,${0.015 + mix * wear * 0.035})`;
      ctx.fillRect(0, y, width, h);
    }
    ctx.restore();
  }
}
