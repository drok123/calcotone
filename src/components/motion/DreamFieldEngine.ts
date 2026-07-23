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
  private memory: HTMLCanvasElement | null = null;
  private memoryCtx: CanvasRenderingContext2D | null = null;
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

    this.smoothedX += (x - this.smoothedX) * (dragging ? 0.22 : 0.06);
    this.smoothedY += (y - this.smoothedY) * (dragging ? 0.22 : 0.06);
    this.gesture += ((dragging ? 1 : 0) - this.gesture) * (dragging ? 0.16 : 0.035);

    const target: DreamWeights = {
      organic: 0.08 + (atmos ? 0.30 + valueOf(atmos, 'size', 0.5) * 0.40 : 0),
      ocean: 0.07 + (drift ? 0.34 + valueOf(drift, 'depth', 0.3) * 0.40 : 0),
      radial: 0.11 + (ember ? 0.24 + valueOf(ember, 'heat', 0.25) * 0.48 : 0) + (halo ? 0.12 : 0),
      cosmic: 0.12 + (halo ? 0.28 + valueOf(halo, 'feedback', 0.25) * 0.40 : 0) + (atmos ? 0.18 : 0),
      crystal: 0.03 + (grain ? 0.38 + valueOf(grain, 'chaos', 0.15) * 0.46 : 0),
      decay: artifact ? 0.24 + valueOf(artifact, 'wear', 0.2) * 0.60 : 0.02,
    };

    const semanticX = this.smoothedX;
    const semanticY = 1 - this.smoothedY;
    target.organic += (1 - semanticX) * 0.28;
    target.ocean += (1 - semanticX) * (1 - semanticY) * 0.22;
    target.cosmic += semanticX * 0.32;
    target.radial += semanticX * semanticY * 0.25;
    target.crystal += semanticY * 0.26;

    const smoothing = dragging ? 0.052 : 0.018;
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
    ctx.fillStyle = 'rgba(2,3,3,0.90)';
    ctx.fillRect(0, 0, width, height);

    this.drawMemory(ctx, time, cx, cy, width, height, haloMix, artifactMix);

    const vignette = ctx.createRadialGradient(cx, cy, scale * 0.03, cx, cy, scale * 0.84);
    vignette.addColorStop(0, 'rgba(26,27,24,0.18)');
    vignette.addColorStop(0.55, 'rgba(8,10,9,0.08)');
    vignette.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const metamorph = (Math.sin(time * 0.055) * 0.5 + 0.5) * 0.5 + semanticX * 0.5;
    this.drawNebulaOrganism(ctx, time, cx, cy, scale, haloMix, atmosMix, metamorph);
    this.drawFlowFabric(ctx, time, cx, cy, scale, driftMix, semanticY, metamorph);
    this.drawBranchGalaxy(ctx, time, cx, cy, scale, atmosMix, semanticX, metamorph);
    this.drawEyeGalaxy(ctx, time, cx, cy, scale, emberMix, haloMix, metamorph);
    this.drawCrystalBloom(ctx, time, cx, cy, scale, grainMix, semanticY, metamorph);
    this.drawEchoArchitecture(ctx, time, cx, cy, scale, haloMix, patchEnergy, metamorph);
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
    ctx.globalAlpha = 0.075 + haloMix * 0.055 + artifactMix * 0.025;
    const breathe = 1.006 + Math.sin(time * 0.08) * 0.003 + haloMix * 0.004;
    const rotate = Math.sin(time * 0.035) * 0.0025;
    ctx.translate(cx, cy);
    ctx.rotate(rotate);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx + Math.sin(time * 0.12) * artifactMix * 1.8, -cy);
    ctx.drawImage(this.memory, 0, 0, width, height);
    ctx.restore();
  }

  private captureMemory(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.memory || !this.memoryCtx) return;
    this.memoryCtx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.memoryCtx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, this.memory.width, this.memory.height);
  }

  private drawNebulaOrganism(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    scale: number,
    haloMix: number,
    atmosMix: number,
    morph: number
  ) {
    const weight = this.weights.cosmic;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const count = 70 + Math.round(weight * 120);
    for (let i = 0; i < count; i += 1) {
      const seed = i * 12.9898;
      const u = ((i * 37) % 101) / 100;
      const arm = i % 5;
      const radius = scale * (0.025 + u * (0.34 + atmosMix * 0.14));
      const spiral = arm * Math.PI * 0.4 + u * (3.5 + morph * 4.2) + time * (0.02 + haloMix * 0.025);
      const organicCurl = Math.sin(u * 12 + seed) * (1 - morph) * 0.18;
      const angle = spiral + organicCurl;
      const squeeze = 0.42 + atmosMix * 0.24 + Math.sin(seed) * 0.035;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius * squeeze;
      const pulse = 0.45 + Math.sin(time * 0.43 + seed) * 0.35;
      const color = i % 13 === 0 ? PALETTE.dusk : PALETTE.bone;
      ctx.fillStyle = rgba(color, weight * (0.025 + pulse * 0.055));
      const size = 0.55 + (i % 5) * 0.24 + atmosMix * 0.4;
      ctx.fillRect(px, py, size, size);
    }
    ctx.restore();
  }

  private drawFlowFabric(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    scale: number,
    driftMix: number,
    semanticY: number,
    morph: number
  ) {
    const weight = this.weights.ocean;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lines = 11;
    for (let row = 0; row < lines; row += 1) {
      const v = row / (lines - 1) - 0.5;
      ctx.beginPath();
      for (let step = 0; step <= 110; step += 1) {
        const u = step / 110;
        const fold = Math.sin(u * Math.PI * (2.8 + morph * 3.2) + time * (0.13 + driftMix * 0.28) + row * 0.55);
        const undertow = Math.sin(u * 9.1 - time * 0.09 + row * 0.83) * 0.35;
        const depth = Math.cos(u * Math.PI * 2 + row * 0.35 + time * 0.07);
        const px = cx + (u - 0.5) * scale * (0.94 + depth * morph * 0.05);
        const py = cy + v * scale * 0.30 + (fold + undertow) * scale * (0.012 + weight * 0.024 + semanticY * 0.01) + depth * morph * scale * 0.018;
        if (step === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(PALETTE.sea, weight * (0.025 + row * 0.0045));
      ctx.lineWidth = 0.65 + driftMix * 0.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBranchGalaxy(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    scale: number,
    atmosMix: number,
    semanticX: number,
    morph: number
  ) {
    const weight = this.weights.organic;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rootX = cx - scale * (0.02 + (1 - semanticX) * 0.07);
    const rootY = cy + scale * 0.28;
    const sway = Math.sin(time * 0.11) * 0.045;

    const branch = (x: number, y: number, length: number, angle: number, depth: number, seed: number) => {
      if (depth <= 0 || length < 2) return;
      const curl = morph * (0.10 + (6 - depth) * 0.035) * Math.sin(seed * 1.7 + time * 0.045);
      const nextAngle = angle + sway * depth + curl;
      const nx = x + Math.cos(nextAngle) * length;
      const ny = y + Math.sin(nextAngle) * length;
      const color = depth <= 2 && morph > 0.55 ? PALETTE.dusk : PALETTE.bone;
      ctx.strokeStyle = rgba(color, weight * (0.022 + depth * 0.016));
      ctx.lineWidth = Math.max(0.45, depth * 0.27);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        (x + nx) * 0.5 + Math.sin(seed + time * 0.06) * length * 0.11,
        (y + ny) * 0.5 - morph * length * 0.07,
        nx,
        ny
      );
      ctx.stroke();

      if (depth === 1 && morph > 0.38) {
        const galaxyRadius = scale * (0.006 + morph * 0.008);
        ctx.beginPath();
        ctx.ellipse(nx, ny, galaxyRadius, galaxyRadius * 0.42, nextAngle, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(PALETTE.dusk, weight * morph * 0.06);
        ctx.stroke();
      }

      const spread = 0.39 + atmosMix * 0.24 + morph * 0.08;
      branch(nx, ny, length * 0.70, nextAngle - spread, depth - 1, seed + 1.7);
      branch(nx, ny, length * 0.67, nextAngle + spread * 0.84, depth - 1, seed + 2.9);
    };

    branch(rootX, rootY, scale * (0.14 + weight * 0.085), -Math.PI * 0.5, 7, 1.2);
    ctx.restore();
  }

  private drawEyeGalaxy(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    scale: number,
    emberMix: number,
    haloMix: number,
    morph: number
  ) {
    const weight = this.weights.radial;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const radius = scale * (0.095 + weight * 0.12);
    const open = 0.46 + morph * 0.34 + Math.sin(time * 0.09) * 0.025;
    const irisColor = emberMix > 0.08 ? PALETTE.copper : PALETTE.bone;

    // Eyelids gradually become spiral arms.
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (let i = 0; i <= 70; i += 1) {
        const u = i / 70;
        const xx = (u - 0.5) * radius * 2.6;
        const lid = Math.sin(u * Math.PI) * radius * open * side;
        const spiral = Math.sin(u * Math.PI * 4 + time * 0.08) * radius * morph * 0.10;
        const px = cx + xx * Math.cos(morph * 0.12) - spiral * Math.sin(morph * 0.12);
        const py = cy + lid + spiral;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(irisColor, weight * 0.075);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    const rings = 9;
    for (let ring = 0; ring < rings; ring += 1) {
      const rr = radius * (0.17 + ring * 0.09 + Math.sin(time * 0.16 + ring) * 0.01);
      const rotation = morph * ring * 0.08 + time * 0.018;
      ctx.strokeStyle = rgba(irisColor, weight * (0.025 + ring * 0.006));
      ctx.lineWidth = ring === 0 ? 1.2 : 0.65;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr * (1 + haloMix * 0.14), rr * (0.72 - morph * 0.17), rotation, 0, Math.PI * 2);
      ctx.stroke();
    }

    const spokes = 48;
    for (let i = 0; i < spokes; i += 1) {
      const a = (i / spokes) * Math.PI * 2 + morph * Math.sin(i * 2.31 + time * 0.07) * 0.20;
      const inner = radius * 0.14;
      const outer = radius * (0.72 + Math.sin(i * 2.11 + time * 0.10) * 0.19 + morph * 0.28);
      const twist = morph * outer * 0.12;
      ctx.strokeStyle = rgba(irisColor, weight * 0.04);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner * 0.68);
      ctx.quadraticCurveTo(
        cx + Math.cos(a + morph * 0.55) * outer * 0.58,
        cy + Math.sin(a + morph * 0.55) * outer * 0.34 + twist * Math.sin(a * 3),
        cx + Math.cos(a + morph * 0.9) * outer,
        cy + Math.sin(a + morph * 0.9) * outer * (0.48 + morph * 0.12)
      );
      ctx.stroke();
    }

    const pupil = radius * (0.09 + emberMix * 0.025);
    ctx.fillStyle = rgba(PALETTE.bone, 0.05 + weight * 0.06);
    ctx.beginPath();
    ctx.ellipse(cx, cy, pupil, pupil * (0.74 - morph * 0.2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCrystalBloom(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    scale: number,
    grainMix: number,
    semanticY: number,
    morph: number
  ) {
    const weight = this.weights.crystal;
    if (weight < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const shards = 16 + Math.round(weight * 34);
    for (let i = 0; i < shards; i += 1) {
      const seed = i * 4.123;
      const radial = ((i * 29) % 101) / 100;
      const angle = seed * 0.71 + time * 0.018 + morph * radial * 2.2;
      const ring = scale * (0.07 + radial * 0.36);
      const px = cx + Math.cos(angle) * ring;
      const py = cy + Math.sin(angle * (0.72 + morph * 0.16)) * ring * 0.58;
      const length = scale * (0.012 + ((i * 13) % 9) * 0.003 + semanticY * 0.014 + morph * 0.007);
      const a = angle * 1.55 + Math.sin(seed) * 0.5;
      ctx.strokeStyle = rgba(PALETTE.dusk, weight * (0.035 + grainMix * 0.055));
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(a) * length, py - Math.sin(a) * length);
      ctx.lineTo(px + Math.cos(a) * length, py + Math.sin(a) * length);
      ctx.lineTo(px + Math.cos(a + 1.3) * length * 0.52, py + Math.sin(a + 1.3) * length * 0.52);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEchoArchitecture(
    ctx: CanvasRenderingContext2D,
    time: number,
    cx: number,
    cy: number,
    scale: number,
    haloMix: number,
    patchEnergy: number,
    morph: number
  ) {
    const total = 7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < total; i += 1) {
      const phase = (time * 0.04 + i / total) % 1;
      const radius = scale * (0.06 + phase * 0.41);
      const sides = 6 + Math.round(morph * 5);
      ctx.strokeStyle = rgba(PALETTE.ash, (1 - phase) * (0.012 + patchEnergy * 0.024 + haloMix * 0.025));
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      for (let side = 0; side <= sides; side += 1) {
        const a = (side / sides) * Math.PI * 2 + phase * morph * 0.8;
        const rx = radius * (1 + Math.sin(a * 3 + time * 0.08) * morph * 0.08);
        const px = cx + Math.cos(a) * rx;
        const py = cy + Math.sin(a) * rx * (0.46 + morph * 0.08);
        if (side === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSemanticGravity(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number,
    semanticX: number,
    semanticY: number
  ) {
    const px = lerp(cx - scale * 0.27, cx + scale * 0.27, semanticX);
    const py = lerp(cy + scale * 0.17, cy - scale * 0.17, semanticY);
    const glow = ctx.createRadialGradient(px, py, 0, px, py, scale * (0.07 + this.gesture * 0.055));
    glow.addColorStop(0, rgba(PALETTE.bone, 0.035 + this.gesture * 0.065));
    glow.addColorStop(0.45, rgba(PALETTE.copper, this.gesture * 0.012));
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
      const h = 0.6 + (i % 3) * 0.9;
      ctx.fillStyle = `rgba(190,160,120,${0.012 + mix * wear * 0.035})`;
      ctx.fillRect(0, y, width, h);
    }

    if (wear > 0.45) {
      const slices = 2 + Math.round(wear * 3);
      for (let i = 0; i < slices; i += 1) {
        const y = ((Math.sin(time * 0.21 + i * 4.7) * 0.5 + 0.5) * height);
        const sliceH = 2 + (i % 3) * 2;
        ctx.fillStyle = rgba(PALETTE.ash, mix * wear * 0.018);
        ctx.fillRect(Math.sin(time + i) * 7, y, width, sliceH);
      }
    }
    ctx.restore();
  }
}
