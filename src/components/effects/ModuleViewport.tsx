import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';

export function ModuleViewport({
  module,
  visualState,
}: {
  module: ModuleState;
  visualState: VisualAudioState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moduleRef = useRef(module);
  moduleRef.current = module;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let cssWidth = 1;
    let cssHeight = 1;
    let pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);

    const resizeCanvas = (): void => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    const render: ViewportRenderCallback = (time) => {
      const currentModule = moduleRef.current;
      if (!currentModule.enabled) return;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const currentParams: Record<string, number> = {};
      for (const parameter of currentModule.parameters) currentParams[parameter.id] = parameter.value;

      drawModuleViewport(
        context,
        cssWidth,
        cssHeight,
        currentModule,
        visualState,
        currentParams,
        time / 1000
      );
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
    };
  }, [module.id, module.mediaMode]);

  return (
    <div className={`dsp-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}>
      <div className="viewport-glass" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="viewport-caption">{getViewportCaption(module)}</span>
    </div>
  );
}

function getViewportCaption(module: ModuleState): string {
  if (module.id === 'delay') return formatAlgorithmName(module.delayAlgorithm ?? 'tape');
  if (module.id === 'reverb') return (module.algorithm ?? 'hall').toUpperCase();
  if (module.id === 'media') return (module.mediaMode ?? 'cassette').toUpperCase();
  if (module.id === 'bitcrusher') return (module.grainMode ?? 'reconstruct').toUpperCase();
  if (module.id === 'chorus') return 'PHASE CURRENT';
  if (module.id === 'saturation') return 'THERMAL REACTOR';
  return 'SIGNAL WORLD';
}

type RGB = readonly [number, number, number];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const hash = (value: number) => {
  const n = Math.sin(value * 127.1) * 43758.5453123;
  return n - Math.floor(n);
};

function drawModuleViewport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  module: ModuleState,
  _audio: VisualAudioState,
  params: Record<string, number>,
  time: number
) {
  ctx.clearRect(0, 0, width, height);
  if (!module.enabled) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // Intentionally non-audio-reactive. These worlds move continuously from time + module parameters only.
  const cx = width / 2;
  const cy = height / 2;
  const mix = clamp01(params.mix ?? 0.5);
  const mode = module.id === 'saturation' ? (module.emberMode ?? 'velvet')
    : module.id === 'chorus' ? (module.driftMode ?? 'chorus')
    : module.id === 'delay' ? (module.delayAlgorithm ?? 'tape')
    : module.id === 'reverb' ? (module.algorithm ?? 'hall')
    : module.id === 'media' ? (module.mediaMode ?? 'cassette')
    : module.id === 'bitcrusher' ? (module.grainMode ?? 'reconstruct')
    : 'default';

  const primary: RGB = module.id === 'saturation' ? [241, 153, 66]
    : module.id === 'chorus' ? [88, 205, 220]
    : module.id === 'delay' ? [161, 126, 255]
    : module.id === 'reverb' ? [86, 145, 255]
    : module.id === 'media' ? [202, 145, 91]
    : [223, 105, 197];

  const secondary: RGB = module.id === 'saturation' ? [214, 80, 160]
    : module.id === 'chorus' ? [131, 116, 255]
    : module.id === 'delay' ? [76, 212, 218]
    : module.id === 'reverb' ? [96, 220, 206]
    : module.id === 'media' ? [81, 205, 209]
    : [80, 213, 211];

  const warm: RGB = [247, 176, 99];
  const pale: RGB = [228, 239, 233];
  const whiteMix = 0.08 + mix * 0.54;
  const rgba = (color: RGB, alpha: number, whiten = false) => {
    const blend = whiten ? whiteMix : 0;
    const r = Math.round(color[0] + (255 - color[0]) * blend);
    const g = Math.round(color[1] + (255 - color[1]) * blend);
    const b = Math.round(color[2] + (255 - color[2]) * blend);
    return `rgba(${r},${g},${b},${clamp01(alpha)})`;
  };

  const stroke = (color: RGB, alpha = 0.3, lineWidth = 1, whiten = true) => {
    ctx.strokeStyle = rgba(color, alpha, whiten);
    ctx.lineWidth = lineWidth;
  };

  const glowDot = (x: number, y: number, radius = 1.4, alpha = 0.45, color = primary) => {
    ctx.save();
    ctx.fillStyle = rgba(color, alpha, true);
    ctx.shadowColor = rgba(color, Math.min(0.36, alpha));
    ctx.shadowBlur = 3 + radius * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const softOrb = (x: number, y: number, radius: number, color: RGB, alpha: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, alpha, true));
    gradient.addColorStop(0.28, rgba(color, alpha * 0.35));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const project = (x: number, y: number, z: number) => {
    const depth = 1 + z * 0.30;
    return [cx + x * depth, cy + y * depth - z * 7] as const;
  };

  const chamber = (scale = 1, alpha = 0.16) => {
    const points = [
      [-55, -34, -1], [55, -34, -1], [55, 34, -1], [-55, 34, -1],
      [-55, -34, 1], [55, -34, 1], [55, 34, 1], [-55, 34, 1],
    ].map(([x, y, z]) => project(x * scale, y * scale, z));
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    stroke(primary, alpha, 1);
    for (const [a, b] of edges) {
      ctx.beginPath();
      ctx.moveTo(...points[a]);
      ctx.lineTo(...points[b]);
      ctx.stroke();
    }
  };

  const depthPlane = (y: number, halfWidth: number, alpha: number, color = primary) => {
    stroke(color, alpha, 1);
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, y);
    ctx.quadraticCurveTo(cx, y - 4, cx + halfWidth, y);
    ctx.stroke();
  };

  drawAmbientWorld(ctx, width, height, primary, secondary, rgba, time, mix);

  if (module.id === 'saturation') {
    drawEmber(ctx, cx, cy, mode, params, time, primary, secondary, warm, rgba, stroke, glowDot, softOrb, chamber);
  } else if (module.id === 'chorus') {
    drawDrift(ctx, cx, cy, mode, params, time, primary, secondary, pale, rgba, stroke, glowDot, softOrb, chamber);
  } else if (module.id === 'delay') {
    drawHalo(ctx, cx, cy, mode, params, time, primary, secondary, warm, stroke, glowDot, softOrb, depthPlane);
  } else if (module.id === 'reverb') {
    drawAtmos(ctx, cx, cy, mode, params, time, primary, secondary, pale, rgba, stroke, glowDot, softOrb, chamber, depthPlane);
  } else if (module.id === 'media') {
    drawArtifact(ctx, cx, cy, mode, params, time, primary, secondary, warm, rgba, stroke, glowDot, softOrb, chamber);
  } else {
    drawGrain(ctx, cx, cy, mode, params, time, primary, secondary, pale, rgba, stroke, glowDot, softOrb, chamber, project);
  }

  drawOpticalFinish(ctx, width, height, primary, secondary, rgba, time);
}

function drawAmbientWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  primary: RGB,
  secondary: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  time: number,
  mix: number
) {
  const cx = width / 2;
  const cy = height / 2;
  const background = ctx.createRadialGradient(cx, cy * 0.86, 5, cx, cy, width * 0.72);
  background.addColorStop(0, rgba(primary, 0.055 + mix * 0.025));
  background.addColorStop(0.38, rgba(secondary, 0.025));
  background.addColorStop(0.70, 'rgba(3,7,10,.985)');
  background.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const horizonY = height * 0.68;
  const horizon = ctx.createLinearGradient(0, horizonY - 18, 0, horizonY + 28);
  horizon.addColorStop(0, rgba(primary, 0));
  horizon.addColorStop(0.46, rgba(primary, 0.025));
  horizon.addColorStop(0.52, rgba(secondary, 0.035));
  horizon.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, horizonY - 20, width, 50);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 6; i += 1) {
    const seed = hash(i * 9.17 + primary[0]);
    const x = width * (0.08 + seed * 0.84) + Math.sin(time * 0.018 + i) * 2;
    const y = height * (0.14 + hash(i * 4.71 + primary[1]) * 0.48);
    const alpha = 0.035 + hash(i * 7.23) * 0.045;
    ctx.fillStyle = i % 2 ? rgba(primary, alpha, true) : rgba(secondary, alpha, true);
    ctx.beginPath();
    ctx.arc(x, y, 0.65 + (i % 3) * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEmber(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mode: string,
  params: Record<string, number>,
  time: number,
  primary: RGB,
  secondary: RGB,
  warm: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void,
  glowDot: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void,
  softOrb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void,
  chamber: (scale?: number, alpha?: number) => void
) {
  const heat = clamp01(params.heat ?? 0.25);
  const drive = clamp01(params.drive ?? 0.2);
  const character = clamp01(params.character ?? 0.3);
  const pulse = 0.5 + Math.sin(time * 0.32) * 0.5;
  const coreR = 13 + drive * 9 + heat * 4;

  chamber(1, 0.12 + drive * 0.06);
  softOrb(cx, cy + 2, 44 + heat * 12, secondary, 0.055 + heat * 0.035);
  softOrb(cx, cy, 30 + drive * 10, primary, 0.075 + drive * 0.045);

  const core = ctx.createRadialGradient(cx - coreR * 0.2, cy - coreR * 0.25, 1, cx, cy, coreR);
  core.addColorStop(0, rgba(warm, 0.28 + heat * 0.18, true));
  core.addColorStop(0.36, rgba(primary, 0.17 + drive * 0.12));
  core.addColorStop(0.75, rgba(secondary, 0.055 + character * 0.055));
  core.addColorStop(1, rgba(primary, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, coreR * 1.15, coreR * 0.72, Math.sin(time * 0.05) * 0.06, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 4; i += 1) {
    const p = (time * (0.022 + heat * 0.014) + i / 4) % 1;
    const rx = 17 + p * 34;
    const ry = 7 + p * 19;
    stroke(i % 2 ? secondary : primary, (1 - p) * (0.12 + heat * 0.08), 1.05);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, rx, ry, (character - 0.5) * 0.12, Math.PI * 1.04, Math.PI * 1.96);
    ctx.stroke();
  }

  if (mode === 'tube') {
    for (let i = -1; i <= 1; i += 1) {
      const x = cx + i * 31;
      const glowY = cy - 16 + ((time * (6 + heat * 3) + i * 13) % 32);
      stroke(primary, 0.30, 1.1);
      ctx.beginPath();
      ctx.roundRect(x - 8, cy - 23, 16, 46, 7);
      ctx.stroke();
      stroke(warm, 0.17 + heat * 0.08, 1);
      for (let row = -1; row <= 1; row += 1) {
        ctx.beginPath();
        ctx.moveTo(x - 5, cy + row * 10);
        ctx.lineTo(x + 5, cy + row * 10);
        ctx.stroke();
      }
      glowDot(x, glowY, 1.2 + drive * 0.5, 0.38 + heat * 0.18, warm);
    }
  } else if (mode === 'transformer') {
    for (const side of [-1, 1]) {
      for (let band = -1; band <= 1; band += 1) {
        stroke(primary, 0.18 + (band + 1) * 0.05, 1);
        ctx.beginPath();
        for (let i = 0; i <= 42; i += 1) {
          const p = i / 42;
          const x = cx + side * 25 - 18 + p * 36;
          const y = cy + band * 9 + Math.sin(p * Math.PI * 10 + time * 0.10 * side) * 2.8;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    stroke(secondary, 0.18 + drive * 0.11, 1.2);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 28);
    ctx.bezierCurveTo(cx - 7 - pulse * 4, cy - 10, cx + 7 + pulse * 4, cy + 10, cx, cy + 28);
    ctx.stroke();
  } else if (mode === 'console') {
    for (let row = -3; row <= 3; row += 1) {
      const y = cy + row * 8;
      const bend = Math.sin(time * 0.08 + row) * (1 + character * 2);
      stroke(row % 2 ? secondary : primary, 0.16 + Math.abs(row) * 0.018, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 49, y);
      ctx.lineTo(cx - 22, y);
      ctx.quadraticCurveTo(cx, y + bend, cx + 21, y);
      ctx.lineTo(cx + 38, y);
      ctx.lineTo(cx + 38, cy);
      ctx.stroke();
      glowDot(cx - 22, y, 0.9, 0.26, primary);
    }
  } else if (mode === 'furnace') {
    for (let i = -3; i <= 3; i += 1) {
      const x = cx + i * 14;
      const bend = Math.sin(time * 0.30 + i) * heat * 3;
      stroke(i % 2 ? secondary : primary, 0.19 + drive * 0.09, 1.1);
      ctx.beginPath();
      ctx.moveTo(x, cy - 28);
      ctx.lineTo(x - 6, cy - 10 + bend);
      ctx.lineTo(x, cy);
      ctx.lineTo(x + 6, cy + 10 - bend);
      ctx.lineTo(x, cy + 28);
      ctx.stroke();
      glowDot(x, cy, 1.1 + heat * 0.55, 0.33 + heat * 0.16, warm);
    }
  } else if (mode === 'exciter') {
    for (let branch = -4; branch <= 4; branch += 1) {
      const y = cy + branch * 7;
      const shimmer = Math.sin(time * 0.34 + branch) * character * 3;
      stroke(branch % 2 ? secondary : primary, 0.14 + Math.abs(branch) * 0.018, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 47, cy);
      ctx.quadraticCurveTo(cx - 18, y, cx + 11, y + shimmer);
      ctx.quadraticCurveTo(cx + 29, y, cx + 47, cy);
      ctx.stroke();
    }
  } else if (mode === 'broken') {
    for (let i = 0; i < 12; i += 1) {
      const y = cy - 26 + (i % 6) * 10;
      const gap = 8 + (i * 7) % 13;
      stroke(i % 3 ? primary : secondary, 0.13 + (i % 4) * 0.035, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 49, y);
      ctx.lineTo(cx - gap, y);
      ctx.moveTo(cx + gap, y + (i % 2 ? 4 : -4));
      ctx.lineTo(cx + 47, y + (i % 2 ? 4 : -4));
      ctx.stroke();
      if (Math.sin(time * 0.28 + i * 2.7) > 0.68) glowDot(cx - gap, y, 1, 0.30, secondary);
    }
  } else {
    for (let row = -2; row <= 2; row += 1) {
      const y = cy + row * 11;
      const breathe = Math.sin(time * 0.22 + row) * heat * 2.2;
      stroke(row % 2 ? secondary : primary, 0.16 + drive * 0.055, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 48, y);
      ctx.bezierCurveTo(cx - 24, y, cx - 14, y + breathe, cx, y + breathe);
      ctx.bezierCurveTo(cx + 16, y + breathe, cx + 25, y, cx + 46, y);
      ctx.stroke();
    }
  }

  for (let i = 0; i < 7; i += 1) {
    const seed = hash(i * 11.31 + 2.7);
    const life = (time * (0.026 + heat * 0.022) + seed) % 1;
    const x = cx + (hash(i * 17.7) - 0.5) * 76 + Math.sin(time * 0.12 + i) * 2;
    const y = cy + 33 - life * 72;
    glowDot(x, y, 0.55 + seed * 0.55, (1 - life) * 0.14, i % 2 ? warm : secondary);
  }
}

function drawDrift(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mode: string,
  params: Record<string, number>,
  time: number,
  primary: RGB,
  secondary: RGB,
  pale: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void,
  glowDot: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void,
  softOrb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void,
  chamber: (scale?: number, alpha?: number) => void
) {
  const depth = clamp01((params.depth ?? 0.3) * 110);
  const rate = 0.22 + clamp01((params.rate ?? 0.2) / 2.5) * 0.55;
  const spread = clamp01(params.spread ?? 0.5);
  const motion = clamp01(params.motion ?? 0.3);

  chamber(1, 0.10 + spread * 0.04);
  softOrb(cx - 23 - spread * 8, cy, 34, primary, 0.045 + depth * 0.025);
  softOrb(cx + 25 + spread * 8, cy + 2, 34, secondary, 0.045 + motion * 0.025);

  for (let ribbon = 0; ribbon < 3; ribbon += 1) {
    const offset = (ribbon - 1) * 13;
    const phase = time * rate * (0.42 + ribbon * 0.04) + ribbon * 1.7;
    const gradient = ctx.createLinearGradient(cx - 55, cy, cx + 55, cy);
    gradient.addColorStop(0, rgba(primary, 0));
    gradient.addColorStop(0.34, rgba(primary, 0.025 + depth * 0.02));
    gradient.addColorStop(0.65, rgba(secondary, 0.025 + motion * 0.02));
    gradient.addColorStop(1, rgba(secondary, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let step = 0; step <= 28; step += 1) {
      const p = step / 28;
      const x = cx - 58 + p * 116;
      const y = cy + offset + Math.sin(p * Math.PI * 2.0 + phase) * (5 + depth * 6);
      step === 0 ? ctx.moveTo(x, y - 4) : ctx.lineTo(x, y - 4);
    }
    for (let step = 28; step >= 0; step -= 1) {
      const p = step / 28;
      const x = cx - 58 + p * 116;
      const y = cy + offset + Math.sin(p * Math.PI * 2.0 + phase) * (5 + depth * 6);
      ctx.lineTo(x, y + 4);
    }
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 9; i += 1) {
    ctx.beginPath();
    for (let step = 0; step <= 30; step += 1) {
      const p = step / 30;
      const x = cx - 56 + p * 112;
      let y = cy + (i - 4) * 7;
      y += Math.sin(p * Math.PI * 2.35 + time * rate + i * 0.55) * (2.5 + depth * 6);
      if (mode === 'liquid') y += Math.sin(p * Math.PI * 5 - time * 0.18 + i) * 4.5 * motion;
      if (mode === 'dimension') y += (p - 0.5) * (i - 4) * 4 * spread;
      if (mode === 'vibrato') y += Math.sin(p * Math.PI * 6 + time * rate * 2) * (2 + depth * 4);
      step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    stroke(i % 2 ? secondary : primary, 0.13 + i * 0.018, 1.05);
    ctx.stroke();
  }

  if (mode === 'rotary' || mode === 'orbit') {
    const rings = mode === 'orbit' ? 5 : 3;
    for (let i = 0; i < rings; i += 1) {
      const angle = time * rate * (i % 2 ? -0.12 : 0.10);
      stroke(i % 2 ? secondary : primary, 0.20 + i * 0.025, 1.1);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 18 + i * 8, 8 + i * 4, angle, 0, Math.PI * 2);
      ctx.stroke();
      const particleAngle = time * rate * 1.7 + i * 1.25;
      glowDot(cx + Math.cos(particleAngle) * (18 + i * 8), cy + Math.sin(particleAngle) * (8 + i * 4), 1.1, 0.35, i % 2 ? pale : primary);
    }
  } else if (mode === 'doppler') {
    const sourceX = cx + Math.sin(time * rate * 0.75) * 35;
    softOrb(sourceX, cy, 18, primary, 0.05);
    glowDot(sourceX, cy, 2.2, 0.50, pale);
    for (let i = 0; i < 6; i += 1) {
      const rr = 8 + i * 10 + (time * rate * 8) % 10;
      stroke(i % 2 ? secondary : primary, 0.18 - i * 0.015, 1);
      ctx.beginPath();
      ctx.arc(sourceX, cy, rr, Math.PI * 0.72, Math.PI * 1.28);
      ctx.stroke();
    }
  } else if (mode === 'ensemble') {
    for (let i = 0; i < 7; i += 1) {
      const angle = time * (0.10 + i * 0.004) + i * 0.94;
      glowDot(cx + Math.cos(angle) * (20 + i * 4), cy + Math.sin(angle * 0.93) * (9 + i * 2), 1.05 + (i % 2) * 0.3, 0.24 + i * 0.02, i % 2 ? secondary : primary);
    }
  }

  for (let i = 0; i < 4; i += 1) {
    const y = cy + 27 + i * 3;
    stroke(i % 2 ? secondary : primary, 0.055, 0.8, false);
    ctx.beginPath();
    ctx.moveTo(cx - 50, y);
    ctx.bezierCurveTo(cx - 20, y - 5 - Math.sin(time * 0.11 + i) * 3, cx + 19, y + 4, cx + 50, y - 1);
    ctx.stroke();
  }
}

function drawHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mode: string,
  params: Record<string, number>,
  time: number,
  primary: RGB,
  secondary: RGB,
  warm: RGB,
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void,
  glowDot: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void,
  softOrb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void,
  depthPlane: (y: number, halfWidth: number, alpha: number, color?: RGB) => void
) {
  const feedback = clamp01(params.feedback ?? 0.3);
  const character = clamp01(params.character ?? 0.2);
  const widthParam = clamp01(params.width ?? 0.5);
  const tunnelDepth = 5 + Math.round(feedback * 4);

  softOrb(cx, cy - 2, 42, primary, 0.045 + feedback * 0.025);
  softOrb(cx + 8, cy + 8, 36, secondary, 0.030 + character * 0.025);

  for (let i = tunnelDepth - 1; i >= 0; i -= 1) {
    const k = i / Math.max(1, tunnelDepth - 1);
    const scale = 0.28 + (1 - k) * 0.78;
    const w = 90 * scale * (0.92 + widthParam * 0.12);
    const h = 50 * scale;
    const x = cx + Math.sin(time * 0.028 + i * 0.7) * character * 2.2;
    const y = cy + (k - 0.5) * 5;
    stroke(i % 2 ? secondary : primary, 0.08 + (1 - k) * 0.16, 1);
    ctx.beginPath();
    if (mode === 'diffuse' || mode === 'constellation') ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(x - w / 2, y - h / 2, w, h, 3 + scale * 5);
    ctx.stroke();
  }

  for (let i = 0; i < 5; i += 1) depthPlane(cy + 19 + i * 8, 48 - i * 6, 0.055 + (4 - i) * 0.012, i % 2 ? secondary : primary);
  glowDot(cx, cy - 2, 2.1, 0.48, warm);

  if (mode === 'pingpong') {
    let x = cx - 42;
    let y = cy - 21;
    for (let i = 0; i < 8; i += 1) {
      const nx = i % 2 ? cx - 34 + i * 3 : cx + 34 - i * 3;
      const ny = cy - 21 + i * 6.1;
      stroke(i % 2 ? secondary : primary, 0.30 - i * 0.018, 1.15);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      glowDot(nx, ny, 1.0, 0.34 - i * 0.02, i % 2 ? secondary : primary);
      x = nx;
      y = ny;
    }
  } else if (mode === 'scatter') {
    for (let i = 0; i < 14; i += 1) {
      const angle = i * 4.13 + time * 0.055;
      const length = 20 + (i % 5) * 7;
      stroke(i % 2 ? secondary : primary, 0.09 + (i % 4) * 0.025, 0.9);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(angle * 1.7) * length, cy + Math.cos(angle * 0.83) * length * 0.65);
      ctx.stroke();
    }
  } else if (mode === 'constellation' || mode === 'diffuse') {
    const count = mode === 'constellation' ? 14 : 10;
    const points: Array<readonly [number, number]> = [];
    for (let i = 0; i < count; i += 1) {
      const angle = i * 2.399 + time * 0.028;
      const radius = 10 + (i % 6) * 7;
      const point = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.5] as const;
      points.push(point);
      glowDot(point[0], point[1], 0.9 + (i % 3) * 0.25, 0.22 + (i % 4) * 0.025, i % 2 ? secondary : primary);
    }
    if (mode === 'constellation') {
      stroke(primary, 0.08, 0.8, false);
      ctx.beginPath();
      points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.stroke();
    }
  } else {
    const count = 5 + Math.round(feedback * 5);
    for (let i = 0; i < count; i += 1) {
      const phase = (time * 0.055 + i / count) % 1;
      const w = 11 + phase * 88;
      const h = 6 + phase * 49;
      stroke(i % 2 ? secondary : primary, (1 - phase) * 0.28, 1);
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (mode === 'bbd') {
      stroke(secondary, 0.08, 0.8, false);
      for (let x = cx - 42; x <= cx + 42; x += 12) {
        ctx.beginPath();
        ctx.moveTo(x, cy - 25);
        ctx.lineTo(x, cy + 25);
        ctx.stroke();
      }
    }
  }
}

function drawAtmos(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mode: string,
  params: Record<string, number>,
  time: number,
  primary: RGB,
  secondary: RGB,
  pale: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void,
  glowDot: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void,
  softOrb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void,
  chamber: (scale?: number, alpha?: number) => void,
  depthPlane: (y: number, halfWidth: number, alpha: number, color?: RGB) => void
) {
  const size = 0.55 + clamp01(params.size ?? 0.5) * 0.45;
  const motion = clamp01(params.motion ?? 0.2);
  const diffusion = clamp01(params.diffusion ?? 0.5);

  softOrb(cx - 20, cy - 10, 50 * size, primary, 0.035 + diffusion * 0.025);
  softOrb(cx + 24, cy + 4, 46 * size, secondary, 0.030 + motion * 0.022);

  for (let i = 0; i < 6; i += 1) depthPlane(cy + 10 + i * 8, 53 - i * 5, 0.045 + (5 - i) * 0.008, i % 2 ? secondary : primary);

  if (mode === 'room' || mode === 'hall' || mode === 'cinema') {
    chamber(1, 0.10);
    const columns = mode === 'cinema' ? 7 : mode === 'hall' ? 5 : 3;
    const scale = (mode === 'room' ? 0.68 : mode === 'hall' ? 0.82 : 0.94) * size;
    for (let i = 0; i < columns; i += 1) {
      const x = cx + (-45 + i * (90 / Math.max(1, columns - 1))) * scale;
      const top = cy - 31 * scale;
      const bottom = cy + 29 * scale;
      const shaft = ctx.createLinearGradient(x - 4, top, x + 4, bottom);
      shaft.addColorStop(0, rgba(i % 2 ? secondary : primary, 0.055));
      shaft.addColorStop(1, rgba(primary, 0));
      ctx.fillStyle = shaft;
      ctx.fillRect(x - 3, top, 6, bottom - top);
      stroke(i % 2 ? secondary : primary, 0.15 + diffusion * 0.06, 1);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
  } else if (mode === 'plate') {
    stroke(primary, 0.32, 1.25);
    ctx.strokeRect(cx - 48 * size, cy - 27 * size, 96 * size, 54 * size);
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      for (let step = 0; step <= 32; step += 1) {
        const p = step / 32;
        const x = cx - 48 * size + p * 96 * size;
        const y = cy + (i - 3.5) * 6 + Math.sin(p * Math.PI * 4 + time * 0.18 + i) * (1.5 + motion * 4.5);
        step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      stroke(i % 2 ? secondary : primary, 0.10 + i * 0.014, 0.9);
      ctx.stroke();
    }
  } else if (mode === 'cloud' || mode === 'nebula') {
    const count = mode === 'nebula' ? 30 : 20;
    for (let i = 0; i < count; i += 1) {
      const angle = i * 2.399 + time * (0.018 + motion * 0.022);
      const radius = 7 + (i % 8) * 6.2 * size;
      glowDot(cx + Math.cos(angle) * radius, cy + Math.sin(angle * 1.13) * radius * 0.46, 0.7 + (i % 3) * 0.32, 0.10 + (i % 6) * 0.018, i % 3 ? primary : secondary);
    }
  } else if (mode === 'freeze') {
    chamber(1, 0.08);
    for (let i = 0; i < 9; i += 1) {
      stroke(i % 2 ? secondary : primary, 0.11 + i * 0.018, 1);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 8 + i * 6, 4 + i * 3, Math.sin(i) * 0.15, 0, Math.PI * 2);
      ctx.stroke();
    }
    softOrb(cx, cy, 22, pale, 0.035);
  } else if (mode === 'celestial') {
    chamber(1, 0.07);
    softOrb(cx, cy - 4, 25, pale, 0.05);
    glowDot(cx, cy - 4, 2.6, 0.50, pale);
    for (let i = -3; i <= 3; i += 1) {
      const yy = cy + i * 9 + Math.sin(time * 0.10 + i) * 2.5;
      stroke(i % 2 ? secondary : primary, 0.12 + Math.abs(i) * 0.018, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 50, yy);
      ctx.lineTo(cx + 50, yy - 9 * Math.sin(i));
      ctx.stroke();
    }
  } else if (mode === 'aurora') {
    chamber(1, 0.06);
    for (let i = 0; i < 8; i += 1) {
      const gradient = ctx.createLinearGradient(cx - 54, cy, cx + 54, cy);
      gradient.addColorStop(0, rgba(primary, 0));
      gradient.addColorStop(0.45, rgba(i % 2 ? secondary : primary, 0.045 + i * 0.004));
      gradient.addColorStop(1, rgba(secondary, 0));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let step = 0; step <= 36; step += 1) {
        const x = cx - 54 + step * 3;
        const y = cy + (i - 3.5) * 7 + Math.sin((x - cx) * 0.045 + time * 0.17 + i * 0.5) * (4 + motion * 7);
        step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 8; i += 1) {
      const k = i / 7;
      const y = cy - 29 + k * 59;
      const half = 52 * (1 - k * 0.72);
      stroke(i % 2 ? secondary : primary, 0.18 - k * 0.11, 1);
      ctx.beginPath();
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx + half, y);
      ctx.stroke();
    }
  }

  for (let i = 0; i < 3; i += 1) {
    const phase = (time * (0.035 + motion * 0.035) + i * 0.31) % 1;
    stroke(i % 2 ? secondary : primary, (1 - phase) * 0.10, 0.9);
    ctx.beginPath();
    ctx.ellipse(cx, cy, phase * 57 * size, phase * 29 * size, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGrain(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mode: string,
  params: Record<string, number>,
  time: number,
  primary: RGB,
  secondary: RGB,
  pale: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void,
  glowDot: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void,
  softOrb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void,
  chamber: (scale?: number, alpha?: number) => void,
  project: (x: number, y: number, z: number) => readonly [number, number]
) {
  const density = clamp01(params.density ?? 0.4);
  const chaos = clamp01(params.chaos ?? 0.2);
  const bloom = clamp01(params.bloom ?? 0.3);
  const pitch = clamp01(params.pitch ?? 0.38);
  const bits = clamp01(((params.bits ?? 13) - 4) / 12);

  chamber(1, 0.08 + (1 - bits) * 0.05);
  softOrb(cx, cy, 42, primary, 0.035 + bloom * 0.025);
  softOrb(cx + 14, cy - 6, 34, secondary, 0.025 + chaos * 0.025);

  const gridAlpha = 0.035 + (mode === 'reconstruct' ? 0.045 : 0) + (1 - bits) * 0.015;
  stroke(secondary, gridAlpha, 0.75, false);
  for (let i = -3; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(cx - 48, cy + i * 9);
    ctx.lineTo(cx + 48, cy + i * 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + i * 14, cy - 30);
    ctx.lineTo(cx + i * 14, cy + 30);
    ctx.stroke();
  }

  const count = 14 + Math.round(density * 28);
  for (let i = 0; i < count; i += 1) {
    const seed = i * 12.9898;
    let orbit = time * (0.055 + chaos * 0.11) + seed;
    let radiusX = 15 + (i % 7) * 5.2;
    let radiusY = 8 + (i % 5) * 4.3;
    if (mode === 'shatter') { radiusX *= 1.22; radiusY *= 1.15; }
    if (mode === 'smear') radiusX *= 1.35;
    if (mode === 'stutter') orbit = Math.floor(orbit * 4) / 4;
    const x = Math.sin(seed * 1.7 + orbit) * radiusX;
    const y = Math.cos(seed * 0.9 + orbit * 1.2) * radiusY;
    const z = Math.sin(seed + orbit * 0.7);
    const [px, py] = project(x, y, z);
    const scale = 1 + ((i % 4) / 3) * (1 + bloom * 1.7);
    const angle = seed + time * (0.03 + pitch * 0.05) * (i % 2 ? -1 : 1);
    const color = mode === 'prism' ? (i % 3 === 0 ? pale : i % 2 ? secondary : primary) : i % 4 === 0 ? secondary : primary;
    const alpha = 0.10 + (z + 1) * 0.035 + bloom * 0.035;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = rgba(color, alpha, true);
    ctx.beginPath();
    if (mode === 'ruin') {
      ctx.moveTo(-scale * 1.5, scale);
      ctx.lineTo(scale * 0.2, -scale * 2);
      ctx.lineTo(scale * 1.8, scale * 0.4);
    } else {
      ctx.moveTo(0, -scale * 2);
      ctx.lineTo(scale * 1.4, 0);
      ctx.lineTo(0, scale * 1.7);
      ctx.lineTo(-scale * 1.4, 0);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  if (mode === 'reconstruct') {
    stroke(pale, 0.12, 1);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 21 + Math.sin(time * 0.06) * 2, 11, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mode === 'smear') {
    for (let i = -2; i <= 2; i += 1) {
      stroke(i % 2 ? secondary : primary, 0.08, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 47, cy + i * 10);
      ctx.bezierCurveTo(cx - 8, cy + i * 11 + Math.sin(time * 0.10 + i) * 4, cx + 14, cy + i * 7, cx + 48, cy + i * 10);
      ctx.stroke();
    }
  } else if (mode === 'shatter' || mode === 'ruin') {
    for (let i = 0; i < 5; i += 1) {
      const a = i * 1.31 + time * 0.02;
      stroke(i % 2 ? secondary : primary, 0.07, 0.8, false);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 28);
      ctx.stroke();
    }
  }

  for (let i = 0; i < 4; i += 1) {
    const p = (time * 0.025 + i * 0.24) % 1;
    glowDot(cx + Math.sin(i * 2.1) * 32, cy + 30 - p * 62, 0.65, (1 - p) * 0.10, i % 2 ? secondary : pale);
  }
}

function drawArtifact(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mode: string,
  params: Record<string, number>,
  time: number,
  primary: RGB,
  secondary: RGB,
  warm: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  stroke: (color: RGB, alpha?: number, lineWidth?: number, whiten?: boolean) => void,
  glowDot: (x: number, y: number, radius?: number, alpha?: number, color?: RGB) => void,
  softOrb: (x: number, y: number, radius: number, color: RGB, alpha: number) => void,
  chamber: (scale?: number, alpha?: number) => void
) {
  const wear = clamp01(params.wear ?? 0.25);
  const wow = clamp01(params.wow ?? 0.16);
  const noiseAmount = clamp01(params.noise ?? 0.1);
  const tone = clamp01(params.tone ?? 0.62);

  chamber(0.96, 0.07 + wear * 0.035);
  softOrb(cx - 17, cy, 40, primary, 0.035 + wear * 0.02);
  softOrb(cx + 23, cy + 6, 36, secondary, 0.025 + wow * 0.025);

  for (let i = 0; i < 3; i += 1) {
    const offset = (i + 1) * (2 + wow * 2);
    ctx.save();
    ctx.translate(Math.sin(time * 0.05 + i) * offset, Math.cos(time * 0.043 + i) * offset * 0.35);
    stroke(i % 2 ? secondary : primary, 0.025 + wear * 0.018, 0.8, false);
    ctx.strokeRect(cx - 48, cy - 27, 96, 54);
    ctx.restore();
  }

  if (mode === 'cassette') {
    const shellW = 104;
    const shellH = 58;
    const left = cx - shellW / 2;
    const top = cy - shellH / 2;
    const shellGradient = ctx.createLinearGradient(left, top, left, top + shellH);
    shellGradient.addColorStop(0, rgba(primary, 0.065 + tone * 0.025));
    shellGradient.addColorStop(1, 'rgba(3,5,7,.16)');
    ctx.fillStyle = shellGradient;
    ctx.fillRect(left, top, shellW, shellH);
    stroke(primary, 0.34, 1.2);
    ctx.strokeRect(left + 0.5, top + 0.5, shellW - 1, shellH - 1);
    stroke(secondary, 0.12, 0.9);
    ctx.strokeRect(cx - 38, cy - 17, 76, 27);
    const spin = time * (0.55 + wear * 0.65);
    for (const rx of [-24, 24]) {
      stroke(primary, 0.30, 1.05);
      ctx.beginPath();
      ctx.arc(cx + rx, cy - 4, 11, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i += 1) {
        const a = spin + i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(cx + rx + Math.cos(a) * 5, cy - 4 + Math.sin(a) * 5);
        ctx.lineTo(cx + rx + Math.cos(a) * 9, cy - 4 + Math.sin(a) * 9);
        ctx.stroke();
      }
    }
    stroke(warm, 0.18 + wear * 0.05, 1);
    ctx.beginPath();
    ctx.moveTo(cx - 32, cy + 19);
    ctx.lineTo(cx - 24, cy + 27);
    ctx.lineTo(cx + 24, cy + 27);
    ctx.lineTo(cx + 32, cy + 19);
    ctx.stroke();
  } else if (mode === 'vinyl' || mode === 'wax') {
    const spin = time * (0.26 + wow * 0.18);
    ctx.save();
    ctx.translate(cx - 7, cy + 5);
    ctx.scale(1, 0.48);
    for (let r = 10; r <= 45; r += mode === 'wax' ? 4 : 5) {
      stroke(r % 2 ? secondary : primary, 0.08 + r / 500, r === 45 ? 1.2 : 0.8);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    stroke(warm, 0.28, 1.1);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i += 1) {
      const a = spin + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
      ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.stroke();
    }
    ctx.restore();
    if (mode === 'vinyl') {
      const armPhase = 0.04 * Math.sin(time * 0.10);
      stroke(primary, 0.30, 1.15);
      ctx.beginPath();
      ctx.arc(cx + 42, cy - 23, 6, 0, Math.PI * 2);
      ctx.moveTo(cx + 40, cy - 19);
      ctx.lineTo(cx + 18 + armPhase * 22, cy + 4);
      ctx.lineTo(cx + 11 + armPhase * 18, cy + 10);
      ctx.stroke();
    }
  } else if (mode === 'reel') {
    for (const xOffset of [-28, 28]) {
      stroke(primary, 0.30, 1.15);
      ctx.beginPath();
      ctx.arc(cx + xOffset, cy - 4, 18, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i += 1) {
        const a = time * (0.22 + wear * 0.30) + i * Math.PI * 2 / 3;
        ctx.beginPath();
        ctx.moveTo(cx + xOffset, cy - 4);
        ctx.lineTo(cx + xOffset + Math.cos(a) * 14, cy - 4 + Math.sin(a) * 14);
        ctx.stroke();
      }
    }
    stroke(secondary, 0.24, 1.1);
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy + 14);
    ctx.quadraticCurveTo(cx, cy + 28, cx + 28, cy + 14);
    ctx.stroke();
  } else if (mode === 'vhs') {
    for (let row = -3; row <= 3; row += 1) {
      const y = cy + row * 8;
      const skew = Math.sin(time * 0.45 + row) * wear * 2.4;
      stroke(row % 2 ? secondary : primary, 0.12 + (row + 3) * 0.018, 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - 52, y + skew);
      ctx.lineTo(cx + 52, y);
      ctx.stroke();
    }
    const scan = ((time * 0.16) % 1) * 56 - 28;
    stroke(warm, 0.34, 1.2);
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy + scan);
    ctx.lineTo(cx + 50, cy + scan);
    ctx.stroke();
  } else if (mode === 'radio') {
    stroke(primary, 0.28, 1.1);
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy + 12);
    ctx.lineTo(cx + 50, cy + 12);
    ctx.stroke();
    for (let i = 0; i < 13; i += 1) {
      const x = cx - 48 + i * 8;
      const h = 5 + (i % 4) * 4;
      stroke(i % 2 ? secondary : primary, 0.12 + (i % 3) * 0.035, 0.9);
      ctx.beginPath();
      ctx.moveTo(x, cy + 12);
      ctx.lineTo(x, cy + 12 - h);
      ctx.stroke();
    }
    const needle = cx - 45 + ((Math.sin(time * 0.10) + 1) / 2) * 90;
    stroke(warm, 0.40, 1.2);
    ctx.beginPath();
    ctx.moveTo(needle, cy - 20);
    ctx.lineTo(needle, cy + 18);
    ctx.stroke();
  } else if (mode === 'broken') {
    let px = cx - 52;
    let py = cy;
    for (let i = 1; i <= 15; i += 1) {
      const x = cx - 52 + i * (104 / 15);
      const y = cy + Math.sin(i * 9.13 + time * 0.24) * 22 * wear + ((i % 4) - 2) * 4;
      stroke(i % 2 ? secondary : primary, 0.15 + (i % 3) * 0.04, 1);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      px = x;
      py = y;
    }
  } else {
    stroke(primary, 0.28, 1.05);
    ctx.beginPath();
    for (let step = 0; step <= 52; step += 1) {
      const x = cx - 52 + step * 2;
      const y = cy + Math.sin(step * 0.23 + time * 0.055) * 6.5;
      step === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const x = cx - 48 + i * 14 + Math.sin(i * 3.7) * 3;
      stroke(i % 2 ? secondary : primary, 0.07 + wear * 0.10, 0.8, false);
      ctx.beginPath();
      ctx.moveTo(x, cy - 28);
      ctx.lineTo(x, cy + 28);
      ctx.stroke();
    }
  }

  const flecks = 3 + Math.round(noiseAmount * 5);
  for (let i = 0; i < flecks; i += 1) {
    const x = cx - 50 + hash(i * 8.23 + 1.7) * 100;
    const y = cy - 30 + hash(i * 6.19 + 3.1) * 60;
    glowDot(x, y, 0.55, 0.06 + wear * 0.05, i % 2 ? secondary : warm);
  }
}

function drawOpticalFinish(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  primary: RGB,
  secondary: RGB,
  rgba: (color: RGB, alpha: number, whiten?: boolean) => string,
  time: number
) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const sheen = ctx.createLinearGradient(-width * 0.2, 0, width * 1.2, height);
  const drift = (Math.sin(time * 0.035) + 1) * 0.5;
  sheen.addColorStop(0, rgba(primary, 0));
  sheen.addColorStop(0.28 + drift * 0.08, rgba(primary, 0.018));
  sheen.addColorStop(0.50 + drift * 0.06, rgba(secondary, 0.012));
  sheen.addColorStop(0.78, rgba(secondary, 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.28, width / 2, height / 2, width * 0.72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,.44)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,.020)';
  ctx.lineWidth = 1;
  for (let y = 6; y < height; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
}
