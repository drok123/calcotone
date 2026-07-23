import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';

const MODULE_ORDER = ['saturation', 'chorus', 'delay', 'reverb', 'bitcrusher', 'media'];

const PALETTE = {
  phosphor: [214, 225, 219] as [number, number, number],
  copper: [201, 145, 91] as [number, number, number],
  cool: [134, 157, 162] as [number, number, number],
  amber: [177, 139, 90] as [number, number, number],
};

type Vec3 = { x: number; y: number; z: number };

type SculpturePoint = Vec3 & {
  alpha: number;
  heat: number;
  broken: boolean;
};

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
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let cursorX = 0.5;
    let cursorY = 0.5;
    let gestureEnergy = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const pw = Math.round(width * dpr);
      const ph = Math.round(height * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const valueOf = (module: ModuleState, id: string, fallback = 0) =>
      module.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

    const rgba = (rgb: [number, number, number], alpha: number) =>
      `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, alpha))})`;

    const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

    const project = (point: Vec3, cx: number, cy: number, scale: number) => {
      const perspective = 1 / (1.8 - point.z * 0.42);
      return {
        x: cx + point.x * scale * perspective,
        y: cy + point.y * scale * perspective,
        depth: perspective,
      };
    };

    const render: ViewportRenderCallback = (stamp) => {
      const t = stamp / 1000;
      const activeModules = MODULE_ORDER
        .map((id) => modulesRef.current.find((module) => module.id === id))
        .filter((module): module is ModuleState => Boolean(module?.enabled && module.available));

      const targetX = positionRef.current.x / 100;
      const targetY = 1 - positionRef.current.y / 100;
      const follow = draggingRef.current ? 0.25 : 0.075;
      cursorX += (targetX - cursorX) * follow;
      cursorY += (targetY - cursorY) * follow;
      gestureEnergy += ((draggingRef.current ? 1 : 0) - gestureEnergy) * (draggingRef.current ? 0.18 : 0.045);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.5;
      const scale = Math.min(width, height) * 0.49;
      const cursorPx = cursorX * width;
      const cursorPy = cursorY * height;
      const assignmentEnergy = Math.min(1, assignmentsRef.current.length / 6);

      // Deep observation chamber rather than a flat XY panel.
      const chamber = ctx.createRadialGradient(cx, cy, scale * 0.04, cx, cy, scale * 1.2);
      chamber.addColorStop(0, 'rgba(24,27,25,0.20)');
      chamber.addColorStop(0.45, 'rgba(8,10,9,0.08)');
      chamber.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = chamber;
      ctx.fillRect(0, 0, width, height);

      // Sparse depth cage: barely visible, enough to sell the 3D space.
      ctx.strokeStyle = 'rgba(210,220,214,0.032)';
      ctx.lineWidth = 0.75;
      for (let ring = 1; ring <= 3; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, scale * ring * 0.21, scale * ring * 0.115, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const pointCount = 88;
      let strands: SculpturePoint[][] = [];

      // Start as a single luminous filament floating in depth.
      const base: SculpturePoint[] = Array.from({ length: pointCount }, (_, index) => {
        const u = index / (pointCount - 1);
        const phase = u * Math.PI * 4.4 - t * 0.7;
        return {
          x: (u - 0.5) * 1.62,
          y: Math.sin(phase) * 0.11 + Math.sin(phase * 0.47 + 1.2) * 0.045,
          z: Math.cos(phase * 0.64) * 0.16,
          alpha: 0.78,
          heat: 0,
          broken: false,
        };
      });
      strands = [base];

      // Apply visual physics in signal-path order.
      for (const module of activeModules) {
        const mix = valueOf(module, 'mix', 0.4);

        if (module.id === 'saturation') {
          const drive = valueOf(module, 'drive', 0.2);
          const heat = valueOf(module, 'heat', 0.2);
          strands = strands.map((strand) => strand.map((point, index) => {
            const molten = Math.sin(index * 0.52 + t * 0.65) * drive * 0.045;
            const flatten = Math.tanh(point.y * (1.5 + drive * 4.5));
            return {
              ...point,
              y: lerp(point.y, flatten * 0.18, mix * 0.72) + molten * mix,
              z: point.z + Math.sin(index * 0.23 - t * 0.4) * heat * mix * 0.035,
              heat: Math.max(point.heat, mix * (0.35 + drive * 0.65)),
            };
          }));
        }

        if (module.id === 'chorus') {
          const depth = valueOf(module, 'depth', 0.3);
          const spread = valueOf(module, 'spread', 0.5);
          const rate = valueOf(module, 'rate', 0.2);
          const copies = 2 + Math.round(spread * 2);
          const next: SculpturePoint[][] = [];
          for (const strand of strands) {
            for (let copy = 0; copy < copies; copy += 1) {
              const offset = copy - (copies - 1) / 2;
              next.push(strand.map((point, index) => {
                const braid = Math.sin(index * 0.16 + t * (0.35 + rate) + copy * 1.7);
                return {
                  ...point,
                  y: point.y + offset * spread * mix * 0.055 + braid * depth * mix * 0.055,
                  z: point.z + Math.cos(index * 0.14 - t * (0.28 + rate) + copy) * depth * mix * 0.13,
                  alpha: point.alpha * (copy === 1 ? 1 : 0.72),
                };
              }));
            }
          }
          strands = next;
        }

        if (module.id === 'delay') {
          const feedback = valueOf(module, 'feedback', 0.2);
          const time = valueOf(module, 'time', 0.2);
          const ghosts = 1 + Math.round(feedback * 3);
          const next = [...strands];
          for (let ghost = 1; ghost <= ghosts; ghost += 1) {
            for (const strand of strands) {
              next.push(strand.map((point) => ({
                ...point,
                x: point.x - ghost * (0.035 + time * 0.075) * mix,
                y: point.y + ghost * 0.018 * mix,
                z: point.z - ghost * 0.07 * mix,
                alpha: point.alpha * Math.max(0.11, 0.42 - ghost * 0.075),
              })));
            }
          }
          strands = next;
        }

        if (module.id === 'reverb') {
          const size = valueOf(module, 'size', 0.5);
          const diffusion = valueOf(module, 'diffusion', 0.6);
          strands = strands.map((strand, strandIndex) => strand.map((point, index) => {
            const bloom = Math.sin(index * 0.11 + strandIndex * 1.7 + t * 0.17);
            return {
              ...point,
              y: point.y * (1 + size * mix * 0.42) + bloom * diffusion * mix * 0.045,
              z: point.z * (1 + size * mix * 0.55) + Math.cos(index * 0.09 + t * 0.13) * diffusion * mix * 0.05,
              alpha: point.alpha * (0.92 + diffusion * 0.05),
            };
          }));
        }

        if (module.id === 'bitcrusher') {
          const bits = valueOf(module, 'bits', 0.7);
          const chaos = valueOf(module, 'chaos', 0.15);
          const steps = 5 + Math.round(bits * 18);
          strands = strands.map((strand, strandIndex) => strand.map((point, index) => ({
            ...point,
            y: Math.round(point.y * steps) / steps,
            z: Math.round(point.z * (steps * 0.75)) / (steps * 0.75),
            broken: point.broken || (chaos * mix > 0.18 && ((index + strandIndex * 7) % Math.max(3, Math.round(10 - chaos * 6)) === 0)),
            alpha: point.alpha * (1 - chaos * mix * 0.16),
          })));
        }

        if (module.id === 'media') {
          const wow = valueOf(module, 'wow', 0.15);
          const wear = valueOf(module, 'wear', 0.15);
          strands = strands.map((strand, strandIndex) => strand.map((point, index) => {
            const wobble = Math.sin(t * 1.15 + index * 0.08 + strandIndex) * wow * mix * 0.05;
            const dropout = wear * mix > 0.22 && ((index + strandIndex * 11) % Math.max(5, Math.round(18 - wear * 10)) === 0);
            return {
              ...point,
              y: point.y + wobble,
              x: point.x + Math.sin(t * 0.42 + index * 0.047) * wow * mix * 0.025,
              broken: point.broken || dropout,
              alpha: dropout ? point.alpha * 0.16 : point.alpha,
            };
          }));
        }
      }

      // XY is a gravity field applied to the finished sculpture.
      const gravityX = (cursorPx - cx) / Math.max(1, width * 0.5);
      const gravityY = (cursorPy - cy) / Math.max(1, height * 0.5);
      const gravity = 0.10 + gestureEnergy * 0.48 + assignmentEnergy * 0.10;
      strands = strands.map((strand) => strand.map((point) => {
        const distance = Math.max(0.15, Math.hypot(point.x - gravityX, point.y - gravityY));
        const influence = gravity / (1 + distance * 2.6);
        return {
          ...point,
          x: point.x + (gravityX - point.x) * influence * 0.12,
          y: point.y + (gravityY - point.y) * influence * 0.18,
          z: point.z + Math.sin(distance * 5 - t * 0.7) * influence * 0.08,
        };
      }));

      // Render back-to-front so depth reads properly.
      const ordered = [...strands].sort((a, b) => {
        const az = a.reduce((sum, point) => sum + point.z, 0) / a.length;
        const bz = b.reduce((sum, point) => sum + point.z, 0) / b.length;
        return az - bz;
      });

      for (const strand of ordered) {
        for (let index = 1; index < strand.length; index += 1) {
          const a = strand[index - 1];
          const b = strand[index];
          if (a.broken || b.broken) continue;
          const pa = project(a, cx, cy, scale);
          const pb = project(b, cx, cy, scale);
          const heat = Math.max(a.heat, b.heat);
          const color = heat > 0.18 ? PALETTE.copper : PALETTE.phosphor;
          const alpha = ((a.alpha + b.alpha) * 0.5) * (0.32 + pa.depth * 0.44);

          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(color, alpha * 0.22);
          ctx.lineWidth = 4.2 * pa.depth;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
          ctx.restore();

          ctx.strokeStyle = rgba(color, alpha);
          ctx.lineWidth = 0.85 + pa.depth * 0.7;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }

      // Floating fragments where Grain/Artifact break continuity.
      let fragmentBudget = 0;
      for (const strand of strands) {
        for (let index = 0; index < strand.length && fragmentBudget < 80; index += 1) {
          const point = strand[index];
          if (!point.broken) continue;
          fragmentBudget += 1;
          const p = project(point, cx, cy, scale);
          const drift = 2 + ((index * 17) % 7);
          ctx.fillStyle = rgba(point.heat > 0.18 ? PALETTE.amber : PALETTE.cool, 0.28 + point.alpha * 0.35);
          ctx.fillRect(p.x + Math.sin(t * 0.7 + index) * drift, p.y + Math.cos(t * 0.55 + index * 0.7) * drift, 1.1 + p.depth, 1.1 + p.depth);
        }
      }

      // Tiny traveling energy knots give the sculpture life without turning it into a waveform display.
      const knots = 4;
      for (let knot = 0; knot < knots; knot += 1) {
        const p = ((t * 0.075 + knot / knots) % 1) * (pointCount - 1);
        const index = Math.floor(p);
        const strand = strands[knot % Math.max(1, strands.length)];
        const point = strand?.[Math.min(index, strand.length - 1)];
        if (!point) continue;
        const screen = project(point, cx, cy, scale);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(point.heat > 0.2 ? PALETTE.copper : PALETTE.phosphor, 0.66);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 1.2 + screen.depth * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // The gravity target is intentionally understated; the sculpture is the control surface.
      if (draggingRef.current || assignmentsRef.current.length > 0) {
        ctx.strokeStyle = rgba(PALETTE.phosphor, 0.10 + gestureEnergy * 0.18);
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.arc(cursorPx, cursorPy, 7 + gestureEnergy * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="xy-signal-field" aria-hidden="true" />;
}
