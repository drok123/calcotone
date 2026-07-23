import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';

export function XYSignalField({
  modules,
  assignments,
  position,
  dragging,
}: {
  modules: ModuleState[];
  assignments: XYAssignment[];
  position: { x: number; y: number };
  dragging: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modulesRef = useRef(modules);
  const assignmentsRef = useRef(assignments);
  const positionRef = useRef(position);
  const draggingRef = useRef(dragging);

  modulesRef.current = modules;
  assignmentsRef.current = assignments;
  positionRef.current = position;
  draggingRef.current = dragging;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let cursorX = 0.5;
    let cursorY = 0.5;
    let motion = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const nextWidth = Math.round(width * dpr);
      const nextHeight = Math.round(height * dpr);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) canvas.width = nextWidth;
      if (canvas.height !== nextHeight) canvas.height = nextHeight;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
      module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

    const moduleColor = (moduleId: string): [number, number, number] =>
      moduleId === 'saturation' ? [241, 153, 66] :
      moduleId === 'chorus' ? [68, 214, 232] :
      moduleId === 'delay' ? [166, 112, 255] :
      moduleId === 'reverb' ? [72, 133, 255] :
      moduleId === 'bitcrusher' ? [236, 88, 207] :
      moduleId === 'media' ? [214, 139, 72] :
      [101, 255, 154];

    const rgba = (color: [number, number, number], alpha: number) =>
      `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;

    const render: ViewportRenderCallback = (stamp) => {
      const t = stamp / 1000;
      const active = modulesRef.current.filter((module) => module.enabled && module.available);
      const byId = (id: string) => active.find((module) => module.id === id);

      const ember = byId('saturation');
      const drift = byId('chorus');
      const halo = byId('delay');
      const atmos = byId('reverb');
      const grain = byId('bitcrusher');
      const artifact = byId('media');

      const emberMix = valueOf(ember, 'mix');
      const heat = valueOf(ember, 'heat');
      const drive = valueOf(ember, 'drive');
      const driftMix = valueOf(drift, 'mix');
      const rate = valueOf(drift, 'rate');
      const depth = valueOf(drift, 'depth');
      const spread = valueOf(drift, 'spread');
      const haloMix = valueOf(halo, 'mix');
      const haloTime = valueOf(halo, 'time');
      const feedback = valueOf(halo, 'feedback');
      const atmosMix = valueOf(atmos, 'mix');
      const size = valueOf(atmos, 'size');
      const diffusion = valueOf(atmos, 'diffusion');
      const grainMix = valueOf(grain, 'mix');
      const density = valueOf(grain, 'density');
      const chaos = valueOf(grain, 'chaos');
      const artifactMix = valueOf(artifact, 'mix');
      const wow = valueOf(artifact, 'wow');
      const wear = valueOf(artifact, 'wear');

      const targetX = positionRef.current.x / 100;
      const targetY = 1 - positionRef.current.y / 100;
      const follow = draggingRef.current ? 0.28 : 0.09;
      cursorX += (targetX - cursorX) * follow;
      cursorY += (targetY - cursorY) * follow;
      motion += ((draggingRef.current ? 1 : 0) - motion) * (draggingRef.current ? 0.18 : 0.045);

      const cx = cursorX * width;
      const cy = cursorY * height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const scale = Math.min(width, height);
      const patchEnergy = Math.min(1, assignmentsRef.current.length / 6);
      const activeEnergy = Math.min(1, active.length / 6);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Deep instrument glass with a faint phosphor pool under the control point.
      const glass = context.createRadialGradient(cx, cy, 2, centerX, centerY, scale * 0.78);
      glass.addColorStop(0, `rgba(101,255,154,${0.028 + motion * 0.055})`);
      glass.addColorStop(0.35, 'rgba(9,28,17,0.025)');
      glass.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = glass;
      context.fillRect(0, 0, width, height);

      // Minimal scope geometry. This is instrumentation, not decoration.
      context.strokeStyle = 'rgba(160,200,177,0.028)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(centerX, height * 0.06);
      context.lineTo(centerX, height * 0.94);
      context.moveTo(width * 0.06, centerY);
      context.lineTo(width * 0.94, centerY);
      context.stroke();

      const owners = active.length ? active : modulesRef.current.slice(0, 1);
      const lineCount = 11;
      const pointsPerLine = 56;
      const fieldStrength = 0.16 + motion * 0.34 + patchEnergy * 0.12;
      const waveSpeed = 0.18 + rate * driftMix * 0.8;
      const expansion = 0.92 + size * atmosMix * 0.3;

      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const owner = owners[lineIndex % Math.max(1, owners.length)];
        const color = moduleColor(owner?.id ?? 'saturation');
        const lane = lineIndex / (lineCount - 1);
        const baseY = height * (0.13 + lane * 0.74);
        const phase = t * waveSpeed + lineIndex * 0.42;

        context.beginPath();
        for (let pointIndex = 0; pointIndex < pointsPerLine; pointIndex += 1) {
          const u = pointIndex / (pointsPerLine - 1);
          const x = width * (0.04 + u * 0.92);

          const dx = x - cx;
          const normalizedDx = dx / Math.max(1, scale);
          const cursorFalloff = Math.exp(-Math.abs(normalizedDx) * (3.4 - diffusion * atmosMix));
          const signedLane = lane - 0.5;
          const pull = (cy - baseY) * cursorFalloff * fieldStrength;

          const slowWave = Math.sin(u * Math.PI * (1.4 + depth * driftMix * 1.6) + phase) * scale * (0.010 + depth * driftMix * 0.028);
          const secondary = Math.sin(u * Math.PI * 4.2 - phase * 0.58 + lineIndex) * scale * 0.006 * (0.25 + spread * driftMix);
          const breathing = Math.sin(t * 0.22 + lineIndex * 0.5) * scale * 0.004 * atmosMix;
          const edgeCurve = Math.sin(u * Math.PI) * signedLane * scale * 0.035 * atmosMix * expansion;

          let y = baseY + pull + slowWave + secondary + breathing + edgeCurve;

          if (ember) {
            const facets = 5 + Math.round(heat * 6);
            const stepped = Math.round(y / (scale / (facets * 3))) * (scale / (facets * 3));
            y += (stepped - y) * emberMix * (0.06 + drive * 0.18);
          }

          if (artifact) {
            y += Math.sin(t * (0.8 + wow * 2) + u * 18 + lineIndex) * scale * artifactMix * (0.0015 + wear * 0.006);
          }

          if (grain && chaos > 0.01) {
            y += Math.sin(pointIndex * 2.73 + lineIndex * 5.1 + t * 3.2) * scale * chaos * grainMix * 0.003;
          }

          if (pointIndex === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        const lineAlpha = 0.11 + activeEnergy * 0.08 + patchEnergy * 0.06;
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.strokeStyle = rgba(color, lineAlpha * (0.32 + diffusion * atmosMix * 0.28));
        context.lineWidth = 3 + diffusion * atmosMix * 3.5;
        context.stroke();
        context.restore();

        context.strokeStyle = rgba(color, lineAlpha + 0.08);
        context.lineWidth = 0.9 + atmosMix * 0.45;
        context.stroke();

        // Halo creates restrained temporal echoes rather than more moving objects.
        if (halo && haloMix > 0.03) {
          const echoes = 1 + Math.round(feedback * 2);
          for (let echo = 1; echo <= echoes; echo += 1) {
            context.save();
            context.translate((echo * (2 + haloTime * 7)) * (lineIndex % 2 ? -1 : 1), 0);
            context.strokeStyle = rgba(color, lineAlpha * haloMix * (0.28 / echo));
            context.lineWidth = 0.8;
            context.stroke();
            context.restore();
          }
        }
      }

      // Fine grain appears as restrained phosphor dust around the field.
      if (grain && grainMix > 0.02) {
        const count = Math.round(8 + density * grainMix * 24);
        for (let i = 0; i < count; i += 1) {
          const seed = i * 17.17;
          const px = width * (0.08 + ((Math.sin(seed) + 1) * 0.5) * 0.84);
          const py = height * (0.08 + ((Math.cos(seed * 1.37) + 1) * 0.5) * 0.84);
          const shimmer = 0.5 + 0.5 * Math.sin(t * 0.55 + seed);
          context.fillStyle = rgba(moduleColor('bitcrusher'), (0.025 + shimmer * 0.05) * grainMix);
          context.fillRect(px, py, 1, 1);
        }
      }

      // Cursor field: clean, precise, obviously interactive.
      context.save();
      context.globalCompositeOperation = 'lighter';
      for (let ring = 0; ring < 2; ring += 1) {
        const pulse = (t * 0.24 + ring * 0.5) % 1;
        context.strokeStyle = `rgba(165,255,194,${(1 - pulse) * (0.035 + motion * 0.08)})`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.arc(cx, cy, 8 + pulse * (18 + motion * 16), 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();

      if (draggingRef.current) {
        context.setLineDash([2, 7]);
        context.strokeStyle = 'rgba(215,245,225,0.09)';
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(cx, height * 0.05);
        context.lineTo(cx, height * 0.95);
        context.moveTo(width * 0.05, cy);
        context.lineTo(width * 0.95, cy);
        context.stroke();
        context.setLineDash([]);
      }

      context.strokeStyle = 'rgba(236,255,243,0.92)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cx, cy, 4.4 + motion * 1.2, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(cx - 11, cy); context.lineTo(cx - 6, cy);
      context.moveTo(cx + 6, cy); context.lineTo(cx + 11, cy);
      context.moveTo(cx, cy - 11); context.lineTo(cx, cy - 6);
      context.moveTo(cx, cy + 6); context.lineTo(cx, cy + 11);
      context.stroke();
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="xy-signal-field" aria-hidden="true" />;
}
