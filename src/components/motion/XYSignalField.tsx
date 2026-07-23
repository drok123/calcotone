import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';

type FieldBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  radius: number;
  speed: number;
  trail: { x: number; y: number }[];
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

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let lastTime = performance.now();
    let attractX = 0.5;
    let attractY = 0.5;
    let disturbance = 0;
    let initialized = false;

    const BODY_COUNT = 8;
    const bodies: FieldBody[] = Array.from({ length: BODY_COUNT }, (_, index) => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      phase: (index / BODY_COUNT) * Math.PI * 2 + Math.sin(index * 2.31) * 0.12,
      radius: 0.16 + (index % 4) * 0.055,
      speed: 0.12 + index * 0.018,
      trail: [],
    }));

    const seedBodies = () => {
      const scale = Math.min(width, height);
      bodies.forEach((body) => {
        body.x = width * 0.5 + Math.cos(body.phase) * scale * body.radius;
        body.y = height * 0.5 + Math.sin(body.phase) * scale * body.radius * 0.62;
        body.vx = 0;
        body.vy = 0;
        body.trail = [{ x: body.x, y: body.y }];
      });
      initialized = true;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const previousWidth = width;
      const previousHeight = height;
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);

      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      if (!initialized) {
        seedBodies();
      } else if (previousWidth > 1 && previousHeight > 1) {
        const sx = width / previousWidth;
        const sy = height / previousHeight;
        bodies.forEach((body) => {
          body.x *= sx;
          body.y *= sy;
          body.trail = body.trail.map((point) => ({ x: point.x * sx, y: point.y * sy }));
        });
      }
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

    const rgba = (rgb: [number, number, number], alpha: number) =>
      `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, alpha))})`;

    const render: ViewportRenderCallback = (stamp) => {
      if (!initialized) return;

      const dt = Math.min(0.033, Math.max(0.001, (stamp - lastTime) / 1000));
      lastTime = stamp;
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
      const driftRate = valueOf(drift, 'rate');
      const driftDepth = valueOf(drift, 'depth');
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
      const wear = valueOf(artifact, 'wear');
      const wow = valueOf(artifact, 'wow');
      const artifactMix = valueOf(artifact, 'mix');

      const activeMixes = [emberMix, driftMix, haloMix, atmosMix, grainMix, artifactMix].filter((value) => value > 0);
      const mixEnergy = activeMixes.length
        ? activeMixes.reduce((sum, value) => sum + value, 0) / activeMixes.length
        : 0;

      const targetX = positionRef.current.x / 100;
      const targetY = 1 - positionRef.current.y / 100;
      const follow = draggingRef.current ? 0.24 : 0.075;
      attractX += (targetX - attractX) * follow;
      attractY += (targetY - attractY) * follow;
      disturbance += ((draggingRef.current ? 1 : 0) - disturbance) * (draggingRef.current ? 0.14 : 0.035);

      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const cursorX = attractX * width;
      const cursorY = attractY * height;
      const scale = Math.min(width, height);
      const expansion = 1 + atmosMix * size * 0.42;
      const driftSpin = drift ? (0.08 + driftRate * 0.3) * driftMix : 0;
      const trailLength = Math.round(32 + haloMix * (24 + haloTime * 56 + feedback * 34));
      const owners = active.length ? active : modulesRef.current.slice(0, 1);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Soft CRT-like chamber illumination.
      const chamber = context.createRadialGradient(cursorX, cursorY, 0, centerX, centerY, scale * 0.72);
      chamber.addColorStop(0, `rgba(101,255,154,${0.025 + disturbance * 0.035})`);
      chamber.addColorStop(0.42, 'rgba(10,28,18,0.018)');
      chamber.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = chamber;
      context.fillRect(0, 0, width, height);

      // Sparse instrument geometry instead of a busy grid.
      context.strokeStyle = 'rgba(185,205,193,0.032)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(centerX, height * 0.08);
      context.lineTo(centerX, height * 0.92);
      context.moveTo(width * 0.08, centerY);
      context.lineTo(width * 0.92, centerY);
      context.stroke();

      for (let ring = 1; ring <= 3; ring += 1) {
        context.strokeStyle = `rgba(101,255,154,${0.012 + ring * 0.006})`;
        context.beginPath();
        context.ellipse(centerX, centerY, scale * ring * 0.105, scale * ring * 0.072, 0, 0, Math.PI * 2);
        context.stroke();
      }

      bodies.forEach((body, index) => {
        const owner = owners[index % Math.max(1, owners.length)];
        const ownerId = owner?.id ?? 'saturation';
        const color = moduleColor(ownerId);
        const direction = index % 2 ? -1 : 1;
        const phase = body.phase + t * body.speed * (1 + driftSpin * 1.8) * direction;
        const radius = body.radius * scale * (1.02 + mixEnergy * 0.16) * expansion;
        const widthBias = 1 + spread * driftMix * (index % 2 ? 0.11 : -0.05);

        let homeX = centerX + Math.cos(phase) * radius * widthBias;
        let homeY = centerY + Math.sin(phase * (1 + driftDepth * driftMix * 0.08)) * radius * 0.62;

        if (ember) {
          const facets = 7 + Math.round(heat * 5);
          const step = Math.PI * 2 / facets;
          const snapped = Math.round(phase / step) * step;
          const amount = emberMix * (0.045 + drive * 0.16);
          homeX += (centerX + Math.cos(snapped) * radius - homeX) * amount;
          homeY += (centerY + Math.sin(snapped) * radius * 0.62 - homeY) * amount;
        }

        if (artifact) {
          const wobble = artifactMix * (0.003 + wow * 0.013 + wear * 0.006);
          homeX += Math.sin(t * (0.42 + wow) + index * 1.7) * scale * wobble;
          homeY += Math.cos(t * (0.31 + wear * 0.7) + index * 1.1) * scale * wobble * 0.65;
        }

        const dx = cursorX - body.x;
        const dy = cursorY - body.y;
        const distance = Math.max(18, Math.hypot(dx, dy));
        const cursorGravity = (0.004 + disturbance * 0.052) / (1 + distance / (scale * 0.34));
        const spring = 0.025 + diffusion * atmosMix * 0.012;

        let fx = (homeX - body.x) * spring + dx * cursorGravity;
        let fy = (homeY - body.y) * spring + dy * cursorGravity;

        if (drift) {
          const ox = body.x - centerX;
          const oy = body.y - centerY;
          const orbitalDistance = Math.max(24, Math.hypot(ox, oy));
          fx += (-oy / orbitalDistance) * driftDepth * driftMix * 2.5;
          fy += (ox / orbitalDistance) * driftDepth * driftMix * 2.5;
        }

        if (grain) {
          const jitter = chaos * grainMix * 0.22;
          fx += Math.sin(t * 2.1 + index * 3.7) * jitter;
          fy += Math.cos(t * 1.7 + index * 2.9) * jitter;
        }

        const damping = draggingRef.current ? 0.84 : 0.89;
        body.vx = (body.vx + fx * dt * 60) * damping;
        body.vy = (body.vy + fy * dt * 60) * damping;
        body.x += body.vx * dt * 60;
        body.y += body.vy * dt * 60;

        body.trail.unshift({ x: body.x, y: body.y });
        if (body.trail.length > trailLength) body.trail.length = trailLength;

        if (body.trail.length > 2) {
          context.beginPath();
          body.trail.forEach((point, pointIndex) => {
            if (pointIndex === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          });

          const alpha = 0.16 + mixEnergy * 0.18 + haloMix * 0.14;
          context.save();
          context.globalCompositeOperation = 'lighter';
          context.strokeStyle = rgba(color, alpha * (0.3 + diffusion * atmosMix * 0.35));
          context.lineWidth = 3.2 + atmosMix * diffusion * 3.2;
          context.stroke();
          context.restore();

          context.strokeStyle = rgba(color, alpha + 0.12);
          context.lineWidth = 1.1 + mixEnergy * 0.45;
          context.stroke();
        }
      });

      // Grain is a fine phosphor dust, not a second competing animation.
      if (grain && grainMix > 0.01) {
        const particleCount = Math.round(10 + density * grainMix * 28);
        for (let particle = 0; particle < particleCount; particle += 1) {
          const seed = particle * 12.9898;
          const orbit = t * 0.12 + seed;
          const ring = 0.11 + ((particle % 7) / 7) * 0.25;
          const px = centerX + Math.cos(orbit) * scale * ring;
          const py = centerY + Math.sin(orbit * 0.83 + particle * 0.2) * scale * ring * 0.62;
          const pull = disturbance * 0.09 / (1 + Math.hypot(cursorX - px, cursorY - py) / (scale * 0.28));
          const gx = px + (cursorX - px) * pull;
          const gy = py + (cursorY - py) * pull;
          const sparkle = 0.5 + Math.sin(t * 0.7 + seed) * 0.5;
          context.fillStyle = rgba(moduleColor('bitcrusher'), 0.09 + sparkle * 0.08 * grainMix);
          context.fillRect(gx, gy, 1 + grainMix * 0.7, 1 + grainMix * 0.7);
        }
      }

      // Magnetic influence rings make the XY gesture readable without dominating the field.
      context.save();
      context.globalCompositeOperation = 'lighter';
      for (let ring = 0; ring < 3; ring += 1) {
        const pulse = (t * 0.18 + ring / 3) % 1;
        const radius = 8 + pulse * (18 + disturbance * 22);
        context.strokeStyle = `rgba(101,255,154,${(1 - pulse) * (0.045 + disturbance * 0.08)})`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.arc(cursorX, cursorY, radius, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();

      if (draggingRef.current) {
        context.setLineDash([3, 7]);
        context.strokeStyle = 'rgba(220,245,230,0.11)';
        context.lineWidth = 0.75;
        context.beginPath();
        context.moveTo(cursorX, height * 0.04);
        context.lineTo(cursorX, height * 0.96);
        context.moveTo(width * 0.04, cursorY);
        context.lineTo(width * 0.96, cursorY);
        context.stroke();
        context.setLineDash([]);
      }

      context.strokeStyle = 'rgba(235,255,243,0.88)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cursorX, cursorY, 4.5 + disturbance * 1.8, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(cursorX - 10, cursorY); context.lineTo(cursorX - 6, cursorY);
      context.moveTo(cursorX + 6, cursorY); context.lineTo(cursorX + 10, cursorY);
      context.moveTo(cursorX, cursorY - 10); context.lineTo(cursorX, cursorY - 6);
      context.moveTo(cursorX, cursorY + 6); context.lineTo(cursorX, cursorY + 10);
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
