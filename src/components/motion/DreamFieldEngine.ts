import type { ModuleState, XYAssignment } from '../../ui/types';

type RGB = [number, number, number];
type Vec2 = { x: number; y: number };

type DreamFrame = {
  modules: ModuleState[];
  assignments: XYAssignment[];
  x: number;
  y: number;
  dragging: boolean;
  time: number;
};

type MorphWeights = {
  eye: number;
  tree: number;
  ocean: number;
  galaxy: number;
  crystal: number;
  landscape: number;
};

const PALETTE = {
  bone: [238, 244, 239] as RGB,
  copper: [232, 165, 96] as RGB,
  sea: [133, 196, 188] as RGB,
  dusk: [165, 145, 196] as RGB,
  ash: [186, 171, 154] as RGB,
};

const GRID_X = 36;
const GRID_Y = 24;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
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
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private gesture = 0;
  private memory: HTMLCanvasElement | null = null;
  private memoryCtx: CanvasRenderingContext2D | null = null;
  private weights: MorphWeights = {
    eye: 0.24,
    tree: 0.24,
    ocean: 0.24,
    galaxy: 0.24,
    crystal: 0.14,
    landscape: 0.34,
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

    this.smoothedX += (x - this.smoothedX) * (dragging ? 0.24 : 0.055);
    this.smoothedY += (y - this.smoothedY) * (dragging ? 0.24 : 0.055);
    this.gesture += ((dragging ? 1 : 0) - this.gesture) * (dragging ? 0.18 : 0.035);

    const semanticX = this.smoothedX;
    const semanticY = 1 - this.smoothedY;
    const emberMix = valueOf(ember, 'mix', 0);
    const driftMix = valueOf(drift, 'mix', 0);
    const haloMix = valueOf(halo, 'mix', 0);
    const atmosMix = valueOf(atmos, 'mix', 0);
    const grainMix = valueOf(grain, 'mix', 0);
    const artifactMix = valueOf(artifact, 'mix', 0);

    const landscapePulse = Math.sin(time * 0.021) * 0.5 + 0.5;
    const targets: MorphWeights = {
      eye: 0.16 + semanticX * semanticY * 0.44 + emberMix * 0.44 + haloMix * 0.12,
      tree: 0.14 + (1 - semanticX) * 0.40 + atmosMix * 0.46,
      ocean: 0.14 + (1 - semanticX) * (1 - semanticY) * 0.42 + driftMix * 0.50,
      galaxy: 0.16 + semanticX * 0.46 + haloMix * 0.44 + atmosMix * 0.16,
      crystal: 0.07 + semanticY * 0.32 + grainMix * 0.56,
      landscape: 0.24 + landscapePulse * 0.22 + atmosMix * 0.22 + driftMix * 0.12,
    };

    const weightEase = dragging ? 0.05 : 0.013;
    (Object.keys(this.weights) as (keyof MorphWeights)[]).forEach((key) => {
      this.weights[key] = lerp(this.weights[key], clamp01(targets[key]), weightEase);
    });

    const width = this.width;
    const height = this.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width, height) * 1.1;
    const patchEnergy = Math.min(1, assignments.length / 6);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(3,4,4,0.40)';
    ctx.fillRect(0, 0, width, height);
    this.drawMemory(ctx, time, cx, cy, width, height, haloMix, artifactMix);

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.58);
    glow.addColorStop(0, 'rgba(78,84,78,0.16)');
    glow.addColorStop(0.48, 'rgba(22,27,24,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const field = this.buildMorphField(time, semanticX, semanticY, emberMix, driftMix, haloMix, atmosMix, grainMix);
    this.drawField(ctx, field, cx, cy, scale, emberMix, driftMix, haloMix, atmosMix, grainMix, patchEnergy, time);
    this.drawEmergentForms(ctx, field, cx, cy, scale, time, emberMix, haloMix, atmosMix, grainMix);
    this.drawArtifactDecay(ctx, time, width, height, artifactMix, valueOf(artifact, 'wear', 0));
    this.captureMemory(ctx, width, height);
  }

  private buildMorphField(
    time: number,
    semanticX: number,
    semanticY: number,
    emberMix: number,
    driftMix: number,
    haloMix: number,
    atmosMix: number,
    grainMix: number
  ): Vec2[][] {
    const total = Math.max(0.001, Object.values(this.weights).reduce((sum, value) => sum + value, 0));
    const w = {
      eye: this.weights.eye / total,
      tree: this.weights.tree / total,
      ocean: this.weights.ocean / total,
      galaxy: this.weights.galaxy / total,
      crystal: this.weights.crystal / total,
      landscape: this.weights.landscape / total,
    };

    const field: Vec2[][] = [];
    const phase = time * 0.035;

    for (let gy = 0; gy < GRID_Y; gy += 1) {
      const row: Vec2[] = [];
      const v = gy / (GRID_Y - 1) * 2 - 1;
      for (let gx = 0; gx < GRID_X; gx += 1) {
        const u = gx / (GRID_X - 1) * 2 - 1;
        const radius = Math.hypot(u, v);
        const angle = Math.atan2(v, u);

        const eye = this.eyeTarget(u, v, radius, angle, phase, emberMix, haloMix);
        const tree = this.treeTarget(u, v, phase, atmosMix);
        const ocean = this.oceanTarget(u, v, phase, driftMix);
        const galaxy = this.galaxyTarget(u, v, radius, angle, phase, haloMix, atmosMix);
        const crystal = this.crystalTarget(u, v, radius, angle, phase, grainMix);
        const landscape = this.landscapeTarget(u, v, phase, atmosMix, driftMix);

        let px = eye.x * w.eye + tree.x * w.tree + ocean.x * w.ocean + galaxy.x * w.galaxy + crystal.x * w.crystal + landscape.x * w.landscape;
        let py = eye.y * w.eye + tree.y * w.tree + ocean.y * w.ocean + galaxy.y * w.galaxy + crystal.y * w.crystal + landscape.y * w.landscape;

        const flowA = Math.sin(px * 5.4 + py * 3.7 + time * 0.11);
        const flowB = Math.cos(py * 6.1 - px * 2.9 - time * 0.085);
        const surreal = 0.018 + semanticY * 0.024 + this.gesture * 0.015;
        px += flowB * surreal;
        py += flowA * surreal;

        const gravityX = (semanticX - 0.5) * 0.22;
        const gravityY = (0.5 - semanticY) * 0.15;
        const influence = Math.exp(-(px * px + py * py) * 1.8) * (0.18 + this.gesture * 0.22);
        px += gravityX * influence;
        py += gravityY * influence;
        row.push({ x: px, y: py });
      }
      field.push(row);
    }
    return field;
  }

  private eyeTarget(u: number, v: number, radius: number, angle: number, phase: number, emberMix: number, haloMix: number): Vec2 {
    const eyelid = Math.sin((u + 1) * Math.PI * 0.5) * 0.52;
    const lidShape = Math.sign(v || 1) * Math.min(Math.abs(v), eyelid);
    const irisPull = Math.exp(-radius * 3.8);
    const twist = irisPull * (0.24 + haloMix * 0.26) * Math.sin(angle * 8 + phase * 3.2);
    return { x: u * (0.82 + irisPull * 0.18) + Math.cos(angle + twist) * emberMix * irisPull * 0.11, y: lidShape * 0.72 + Math.sin(angle * 6 + phase) * irisPull * 0.045 };
  }

  private treeTarget(u: number, v: number, phase: number, atmosMix: number): Vec2 {
    const trunk = Math.exp(-Math.abs(u) * 4.2) * smoothstep(0.15, 1, 1 - Math.abs(v));
    const branch = Math.sin(u * 5.8 + v * 2.1 + phase * 2.1) * (1 - Math.abs(v));
    const fork = Math.sin(v * 10.5 - Math.abs(u) * 5 + phase) * 0.5;
    return { x: u * (0.72 + atmosMix * 0.12) + branch * 0.10 * (1 - Math.abs(v)) + Math.sign(u || 1) * trunk * 0.04, y: v * 0.88 - trunk * 0.10 + fork * Math.abs(u) * 0.035 };
  }

  private oceanTarget(u: number, v: number, phase: number, driftMix: number): Vec2 {
    const wave = Math.sin(u * 5.2 + phase * (4 + driftMix * 3.5) + v * 1.8);
    const undertow = Math.sin(u * 2.2 - phase * 2.3 + v * 6.3);
    return { x: u + undertow * 0.025 * (0.5 + driftMix), y: v * 0.78 + wave * (0.055 + driftMix * 0.075) + undertow * 0.018 };
  }

  private galaxyTarget(u: number, v: number, radius: number, angle: number, phase: number, haloMix: number, atmosMix: number): Vec2 {
    const spiral = angle + radius * (2.8 + haloMix * 3.8) + phase * (1.4 + haloMix * 1.8);
    const r = radius * (0.82 + Math.sin(radius * 11 - phase) * 0.035);
    return { x: Math.cos(spiral) * r, y: Math.sin(spiral) * r * (0.62 + atmosMix * 0.16) };
  }

  private crystalTarget(u: number, v: number, radius: number, angle: number, phase: number, grainMix: number): Vec2 {
    const facets = 6 + Math.round(grainMix * 6);
    const snappedAngle = Math.round(angle / (Math.PI * 2 / facets)) * (Math.PI * 2 / facets);
    const steppedRadius = Math.round(radius * (7 + grainMix * 10)) / (7 + grainMix * 10);
    const fracture = Math.sin(u * 13.1 + v * 17.3 + phase * 2) * grainMix * 0.035;
    return { x: Math.cos(snappedAngle) * steppedRadius + fracture, y: Math.sin(snappedAngle) * steppedRadius * 0.72 - fracture };
  }

  private landscapeTarget(u: number, v: number, phase: number, atmosMix: number, driftMix: number): Vec2 {
    const depth = (v + 1) * 0.5;
    const horizonPull = Math.pow(depth, 1.55);
    const ridgeA = Math.sin(u * 3.2 + phase * 1.4) * 0.13;
    const ridgeB = Math.sin(u * 7.4 - phase * 0.9 + 1.8) * 0.055;
    const ridgeC = Math.sin(u * 15.1 + phase * 0.45) * 0.022;
    const mountain = (ridgeA + ridgeB + ridgeC) * (0.35 + atmosMix * 0.55);
    const valley = -Math.exp(-Math.pow(u * 1.45, 2)) * 0.10 * (0.5 + driftMix * 0.5);
    const dune = Math.sin(u * 2.1 + phase * 0.35) * 0.045 * (1 - depth);
    return {
      x: u * (0.82 + horizonPull * 0.17) + Math.sin(v * 5 + phase) * 0.012,
      y: lerp(-0.06 + mountain + valley, v * 0.84 + dune, horizonPull),
    };
  }

  private drawField(ctx: CanvasRenderingContext2D, field: Vec2[][], cx: number, cy: number, scale: number, emberMix: number, driftMix: number, haloMix: number, atmosMix: number, grainMix: number, patchEnergy: number, time: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const toScreen = (point: Vec2) => ({ x: cx + point.x * scale * 0.42, y: cy + point.y * scale * 0.42 });

    for (let pass = 0; pass < 2; pass += 1) {
      const count = pass === 0 ? GRID_Y : GRID_X;
      for (let index = 0; index < count; index += 1) {
        ctx.beginPath();
        const length = pass === 0 ? GRID_X : GRID_Y;
        for (let step = 0; step < length; step += 1) {
          const point = pass === 0 ? field[index][step] : field[step][index];
          const screen = toScreen(point);
          if (step === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
        }
        const centerBias = 1 - Math.abs(index / Math.max(1, count - 1) - 0.5) * 2;
        const color = emberMix > 0.15 && centerBias > 0.45 ? PALETTE.copper : driftMix > 0.18 && pass === 0 ? PALETTE.sea : grainMix > 0.2 && index % 4 === 0 ? PALETTE.dusk : PALETTE.bone;
        ctx.strokeStyle = rgba(color, 0.065 + centerBias * 0.13 + haloMix * 0.025 + patchEnergy * 0.018);
        ctx.lineWidth = 0.68 + centerBias * 0.8 + atmosMix * 0.25;
        ctx.stroke();
      }
    }

    for (let vein = 0; vein < 5; vein += 1) {
      const rowIndex = Math.floor(((time * (0.09 + vein * 0.006) + vein * 0.19) % 1) * (GRID_Y - 1));
      ctx.beginPath();
      field[rowIndex].forEach((point, index) => {
        const screen = toScreen(point);
        if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
      });
      ctx.strokeStyle = rgba(vein % 2 ? PALETTE.copper : PALETTE.bone, 0.075 + this.gesture * 0.08);
      ctx.lineWidth = 1.1 + this.gesture * 0.45;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEmergentForms(ctx: CanvasRenderingContext2D, field: Vec2[][], cx: number, cy: number, scale: number, time: number, emberMix: number, haloMix: number, atmosMix: number, grainMix: number) {
    const eyeMoment = smoothstep(0.42, 0.72, this.weights.eye) * smoothstep(0.25, 0.58, Math.sin(time * 0.07) * 0.5 + 0.5);
    const treeMoment = smoothstep(0.40, 0.72, this.weights.tree) * smoothstep(0.28, 0.62, Math.sin(time * 0.053 + 1.7) * 0.5 + 0.5);
    const galaxyMoment = smoothstep(0.40, 0.72, this.weights.galaxy) * smoothstep(0.30, 0.66, Math.sin(time * 0.061 + 3.2) * 0.5 + 0.5);
    const landMoment = smoothstep(0.34, 0.68, this.weights.landscape) * smoothstep(0.22, 0.62, Math.sin(time * 0.041 + 0.8) * 0.5 + 0.5);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (landMoment > 0.02) {
      const horizonRow = field[Math.floor(GRID_Y * 0.28)];
      ctx.beginPath();
      horizonRow.forEach((point, i) => {
        const sx = cx + point.x * scale * 0.42;
        const sy = cy + point.y * scale * 0.42;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = rgba(PALETTE.ash, landMoment * 0.24);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      for (let ridge = 0; ridge < 3; ridge += 1) {
        const row = field[Math.min(GRID_Y - 1, Math.floor(GRID_Y * (0.34 + ridge * 0.08)))];
        ctx.beginPath();
        row.forEach((point, i) => {
          const sx = cx + point.x * scale * 0.42;
          const sy = cy + point.y * scale * 0.42 + ridge * scale * 0.012;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.strokeStyle = rgba(ridge === 0 ? PALETTE.bone : PALETTE.dusk, landMoment * (0.13 - ridge * 0.025));
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    if (eyeMoment > 0.02) {
      const center = field[Math.floor(GRID_Y / 2)][Math.floor(GRID_X / 2)];
      const ex = cx + center.x * scale * 0.42;
      const ey = cy + center.y * scale * 0.42;
      const radius = scale * (0.075 + emberMix * 0.025);
      ctx.strokeStyle = rgba(emberMix > 0.1 ? PALETTE.copper : PALETTE.bone, eyeMoment * 0.22);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(ex, ey, radius * 1.8, radius * 0.72, Math.sin(time * 0.03) * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(ex, ey, radius * 0.34, radius * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (treeMoment > 0.02) {
      const drawBranch = (x: number, y: number, length: number, angle: number, depth: number, seed: number) => {
        if (depth <= 0) return;
        const curl = Math.sin(seed + time * 0.045) * 0.16 + this.weights.galaxy * 0.12;
        const nx = x + Math.cos(angle + curl) * length;
        const ny = y + Math.sin(angle + curl) * length;
        ctx.strokeStyle = rgba(PALETTE.bone, treeMoment * (0.05 + depth * 0.017));
        ctx.lineWidth = Math.max(0.55, depth * 0.3);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo((x + nx) * 0.5, (y + ny) * 0.5 - atmosMix * length * 0.12, nx, ny);
        ctx.stroke();
        drawBranch(nx, ny, length * 0.67, angle - 0.48, depth - 1, seed + 1.7);
        drawBranch(nx, ny, length * 0.64, angle + 0.42, depth - 1, seed + 2.9);
      };
      drawBranch(cx, cy + scale * 0.28, scale * 0.11, -Math.PI * 0.5, 5, 1.3);
    }

    if (galaxyMoment > 0.02) {
      for (let i = 0; i < 48; i += 1) {
        const r = scale * (0.025 + ((i * 17) % 100) / 100 * 0.30);
        const a = i * 2.399 + r * 0.04 + time * (0.018 + haloMix * 0.025);
        ctx.fillStyle = rgba(i % 9 === 0 ? PALETTE.dusk : PALETTE.bone, galaxyMoment * 0.15);
        ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.48, 1.1 + (i % 3) * 0.35, 1.1 + (i % 3) * 0.35);
      }
    }

    if (grainMix > 0.18) {
      for (let i = 0; i < 18; i += 1) {
        const a = i * 2.73 + time * 0.02;
        const r = scale * (0.09 + ((i * 11) % 17) * 0.013);
        ctx.strokeStyle = rgba(PALETTE.dusk, 0.05 + grainMix * 0.12);
        ctx.strokeRect(cx + Math.cos(a) * r - 2, cy + Math.sin(a * 0.83) * r * 0.62 - 2, 4 + (i % 3), 4 + (i % 2));
      }
    }
    ctx.restore();
  }

  private drawMemory(ctx: CanvasRenderingContext2D, time: number, cx: number, cy: number, width: number, height: number, haloMix: number, artifactMix: number) {
    if (!this.memory) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.19 + haloMix * 0.10 + artifactMix * 0.05;
    const breathe = 1.012 + Math.sin(time * 0.075) * 0.007 + haloMix * 0.008;
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 0.031) * 0.006 + artifactMix * Math.sin(time * 0.4) * 0.002);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx + Math.sin(time * 0.12) * artifactMix * 4, -cy + Math.cos(time * 0.08) * haloMix * 1.5);
    ctx.drawImage(this.memory, 0, 0, width, height);
    ctx.restore();
  }

  private captureMemory(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.memory || !this.memoryCtx) return;
    this.memoryCtx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.memoryCtx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, this.memory.width, this.memory.height);
  }

  private drawArtifactDecay(ctx: CanvasRenderingContext2D, time: number, width: number, height: number, mix: number, wear: number) {
    if (mix <= 0.01) return;
    ctx.save();
    const scars = 3 + Math.round(wear * 7);
    for (let i = 0; i < scars; i += 1) {
      const rawY = (Math.sin(i * 8.13) * 0.5 + 0.5) * height + time * (2 + wear * 7) * (i % 2 ? 1 : -1);
      const y = ((rawY % height) + height) % height;
      ctx.fillStyle = rgba(PALETTE.ash, 0.018 + mix * wear * 0.05);
      ctx.fillRect(Math.sin(time * 0.7 + i) * wear * 8, y, width, 1 + (i % 3));
    }
    ctx.restore();
  }
}
