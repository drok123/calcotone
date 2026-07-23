import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';

type OrbitalBody = {
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
    let attractX = .5;
    let attractY = .5;
    let disturbance = 0;

    const BODY_COUNT = 11;
    const bodies: OrbitalBody[] = Array.from({ length: BODY_COUNT }, (_, i) => ({
      x: .5,
      y: .5,
      vx: 0,
      vy: 0,
      phase: (i / BODY_COUNT) * Math.PI * 2 + Math.sin(i * 2.31) * .18,
      radius: .22 + (i % 4) * .064,
      speed: .26 + i * .034,
      trail: [],
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const valueOf = (module: ModuleState | undefined, id: string, fallback = 0) =>
      module?.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

    const render: ViewportRenderCallback = (stamp) => {
      const dt = Math.min(.033, Math.max(.001, (stamp - lastTime) / 1000));
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
      const drive = valueOf(ember, 'drive');
      const heat = valueOf(ember, 'heat');
      const driftMix = valueOf(drift, 'mix');
      const driftRate = valueOf(drift, 'rate');
      const driftDepth = valueOf(drift, 'depth');
      const spread = valueOf(drift, 'spread');
      const haloMix = valueOf(halo, 'mix');
      const haloTime = valueOf(halo, 'time');
      const feedback = valueOf(halo, 'feedback');
      const haloWidth = valueOf(halo, 'width');
      const atmosMix = valueOf(atmos, 'mix');
      const size = valueOf(atmos, 'size');
      const decay = valueOf(atmos, 'decay');
      const diffusion = valueOf(atmos, 'diffusion');
      const grainMix = valueOf(grain, 'mix');
      const density = valueOf(grain, 'density');
      const grainPitch = valueOf(grain, 'pitch');
      const chaos = valueOf(grain, 'chaos');
      const wear = valueOf(artifact, 'wear');
      const wow = valueOf(artifact, 'wow');
      const noise = valueOf(artifact, 'noise');
      const artifactMix = valueOf(artifact, 'mix');
      const activeMixes = [emberMix, driftMix, haloMix, atmosMix, grainMix, artifactMix].filter((value) => value > 0);
      const mixEnergy = activeMixes.length
        ? activeMixes.reduce((sum, value) => sum + value, 0) / activeMixes.length
        : 0;

      const targetX = positionRef.current.x / 100;
      const targetY = 1 - positionRef.current.y / 100;
      const follow = draggingRef.current ? .18 : .055;
      attractX += (targetX - attractX) * follow;
      attractY += (targetY - attractY) * follow;
      disturbance += ((draggingRef.current ? 1 : 0) - disturbance) * (draggingRef.current ? .12 : .025);

      const centerX = width * .5;
      const centerY = height * .5;
      const cursorX = attractX * width;
      const cursorY = attractY * height;
      const baseScale = Math.min(width, height);
      const sculptureScale = 1.10 + mixEnergy * .34;
      const atmosExpansion = atmos ? 1 + size * atmosMix * 1.05 : 1;
      const driftSpin = drift ? (.10 + driftRate * .42) * driftMix : 0;
      const trailLength = Math.round(62 + (halo ? (36 + haloTime * 108 + feedback * 94) * haloMix : 0) + decay * atmosMix * 42);
      const trailAlpha = .32 + haloMix * .34 + atmosMix * .14;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Quiet instrument field. The sculpture, not a grid, owns the visual hierarchy.
      context.strokeStyle = 'rgba(185,205,193,.025)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(width * .5, 0); context.lineTo(width * .5, height);
      context.moveTo(0, height * .5); context.lineTo(width, height * .5);
      context.stroke();

      const moduleColor = (moduleId: string): [number, number, number] =>
        moduleId === 'saturation' ? [241,153,66] :
        moduleId === 'chorus' ? [68,214,232] :
        moduleId === 'delay' ? [166,112,255] :
        moduleId === 'reverb' ? [72,133,255] :
        moduleId === 'bitcrusher' ? [236,88,207] :
        moduleId === 'media' ? [214,139,72] :
        [128,160,142];

      const visualOwners = active.length ? active : modulesRef.current.slice(0, 1);
      const ownerForBody = (bodyIndex: number) =>
        visualOwners[bodyIndex % Math.max(1, visualOwners.length)];

      const moduleLineColor = (
        moduleId: string,
        alpha: number,
        variation = 0
      ) => {
        const [baseR, baseG, baseB] = moduleColor(moduleId);
        const scale = 1 + Math.sin(variation) * 0.05;
        const r = Math.round(Math.max(0, Math.min(255, baseR * scale)));
        const g = Math.round(Math.max(0, Math.min(255, baseG * scale)));
        const b = Math.round(Math.max(0, Math.min(255, baseB * scale)));
        return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,alpha))})`;
      };

      bodies.forEach((body, i) => {
        const owner = ownerForBody(i);
        const ownerId = owner?.id ?? 'saturation';
        const direction = i % 2 ? -1 : 1;
        const phase = body.phase + t * body.speed * (1 + driftSpin * 1.7) * direction;
        const eccentric = 1 + Math.sin(t * .13 + i * 1.7) * .055;
        const radius = body.radius * baseScale * sculptureScale * atmosExpansion * eccentric;
        const wide = 1 + spread * driftMix * (i % 2 ? .18 : -.08);

        let homeX = centerX + Math.cos(phase) * radius * wide;
        let homeY = centerY + Math.sin(phase * (1 + driftDepth * driftMix * .09)) * radius * .56;

        // Ember changes trajectory material: tension and harmonic faceting.
        if (ember) {
          const facets = 7 + Math.round(heat * 5);
          const snap = Math.round(phase / (Math.PI * 2 / facets)) * (Math.PI * 2 / facets);
          const amount = emberMix * (.08 + drive * .30);
          homeX += (centerX + Math.cos(snap) * radius - homeX) * amount;
          homeY += (centerY + Math.sin(snap) * radius * .56 - homeY) * amount;
        }

        // Artifact damages the continuity rather than drawing an Artifact object.
        if (artifact) {
          const mode = artifact.mediaMode ?? 'cassette';
          const modeScale = mode === 'vinyl' ? .65 : mode === 'vhs' ? 1.15 : mode === 'broken' ? 1.45 : 1;
          homeX += Math.sin(t * (.7 + wow * 1.2) + i * 2.1) * baseScale * .018 * artifactMix * modeScale;
          homeY += Math.cos(t * (.46 + wear) + i * 1.3) * baseScale * .012 * artifactMix * modeScale;
          if (mode === 'vinyl') homeX += Math.sin(t * 1.9 + i) * baseScale * .004 * wear;
          if (mode === 'vhs') homeX += Math.sin(t * 3.1 + i * .4) * baseScale * .012 * artifactMix;
        }

        // XY is an external gravitational disturbance, not the sculpture's permanent center.
        const dx = cursorX - body.x;
        const dy = cursorY - body.y;
        const dist = Math.max(18, Math.hypot(dx, dy));
        const gravity = (.010 + disturbance * .082) * (1 / (1 + dist / (baseScale * .40)));
        let fx = (homeX - body.x) * (.040 + diffusion * atmosMix * .018);
        let fy = (homeY - body.y) * (.040 + diffusion * atmosMix * .018);
        fx += dx * gravity;
        fy += dy * gravity;

        // Drift bends the entire orbital system.
        if (drift) {
          const ox = body.x - centerX;
          const oy = body.y - centerY;
          const od = Math.max(20, Math.hypot(ox, oy));
          fx += (-oy / od) * driftDepth * driftMix * 5.2;
          fy += (ox / od) * driftDepth * driftMix * 5.2;
        }

        // Grain creates tiny physical emissions from existing bodies.
        if (grain) {
          const jitter = chaos * grainMix * .58;
          fx += Math.sin(t * (2.1 + grainPitch * 2.8) + i * 4.1) * jitter;
          fy += Math.cos(t * (1.7 + grainPitch * 2.2) + i * 3.3) * jitter;
        }

        body.vx = (body.vx + fx * dt * 60) * (.885 - disturbance * .025);
        body.vy = (body.vy + fy * dt * 60) * (.885 - disturbance * .025);
        body.x += body.vx * dt * 60;
        body.y += body.vy * dt * 60;

        body.trail.unshift({ x: body.x, y: body.y });
        if (body.trail.length > trailLength) body.trail.length = trailLength;

        // Halo turns motion history into separated ghost reflections.
        const ghostStride = halo ? Math.max(4, Math.round(5 + haloTime * 13)) : 9999;
        const ghostCount = halo ? 1 + Math.round(feedback * haloMix * 4) : 0;

        for (let ghost = ghostCount; ghost >= 0; ghost--) {
          const offset = ghost * ghostStride;
          if (offset >= body.trail.length - 2) continue;
          const points = body.trail.slice(offset);
          const ghostOffset = ghost && halo ? (i % 2 ? -1 : 1) * haloWidth * haloMix * ghost * (3.4 + diffusion * atmosMix * 2.8) : 0;
          context.beginPath();
          points.forEach((point, index) => {
            if (index === 0) context.moveTo(point.x + ghostOffset, point.y);
            else context.lineTo(point.x + ghostOffset, point.y);
          });
          const fade = ghost === 0 ? 1 : Math.max(.12, .52 - ghost * .09);
          const vinylLoss = artifact?.mediaMode === 'vinyl' ? 1 - artifactMix * (.18 + wear * .30) : 1;
          const staticLoss = artifact ? 1 - noise * artifactMix * .22 : 1;
          const alpha = (trailAlpha + mixEnergy * .20) * fade * vinylLoss * staticLoss;
          const phaseShift = ghost * .9 + haloTime * 2.1;

          // Wide diffused under-stroke creates the psychedelic light-volume without audio flashing.
          context.save();
          context.strokeStyle = moduleLineColor(ownerId, alpha * (.20 + diffusion * atmosMix * .28), i + phaseShift);
          context.lineWidth = ghost === 0 ? 4.4 + diffusion * atmosMix * 5.6 : 2.8 + diffusion * atmosMix * 3.2;
          context.globalCompositeOperation = 'lighter';
          context.globalAlpha = .72;
          context.stroke();
          context.restore();

          // Brighter filament core.
          context.strokeStyle = moduleLineColor(ownerId, alpha, i + phaseShift);
          context.lineWidth = ghost === 0 ? 1.65 + diffusion * atmosMix * 1.35 : 1.05;
          context.stroke();
        }

      });

      // Grain contributes a dedicated particle field instead of cutting holes into the light trails.
      if (grain && grainMix > .01) {
        const particleCount = Math.round(18 + density * grainMix * 54);
        for (let p = 0; p < particleCount; p++) {
          const seed = p * 12.9898;
          const orbit = t * (.16 + grainPitch * .42) + seed;
          const ring = .12 + ((p % 9) / 9) * (.30 + density * .18);
          const chaosPush = chaos * grainMix * .09;
          const px =
            centerX +
            Math.cos(orbit * (1 + (p % 3) * .06)) * baseScale * ring * sculptureScale +
            Math.sin(seed * 1.7 + t * 1.1) * baseScale * chaosPush;
          const py =
            centerY +
            Math.sin(orbit * .83 + p * .31) * baseScale * ring * .62 * sculptureScale +
            Math.cos(seed * 1.13 - t * .9) * baseScale * chaosPush * .7;

          // XY disturbance gently bends the particle cloud too.
          const pdx = cursorX - px;
          const pdy = cursorY - py;
          const pd = Math.max(18, Math.hypot(pdx, pdy));
          const particleGravity = disturbance * grainMix * .14 * (1 / (1 + pd / (baseScale * .3)));
          const gx = px + pdx * particleGravity;
          const gy = py + pdy * particleGravity;

          const sparkle = .45 + .55 * Math.sin(t * (.34 + (p % 5) * .03) + seed);
          const sizePx = .8 + (p % 4) * .32 + grainMix * .7;
          context.fillStyle = moduleLineColor('bitcrusher', .10 + grainMix * (.16 + sparkle * .10), seed * .03);
          context.fillRect(gx - sizePx * .5, gy - sizePx * .5, sizePx, sizePx);
        }
      }

      // The XY control remains unmistakable, but visually secondary to the sculpture.
      context.save();
      if (draggingRef.current) {
        context.setLineDash([3, 6]);
        context.strokeStyle = 'rgba(235,248,240,.13)';
        context.lineWidth = .75;
        context.beginPath(); context.moveTo(cursorX, 0); context.lineTo(cursorX, height); context.stroke();
        context.beginPath(); context.moveTo(0, cursorY); context.lineTo(width, cursorY); context.stroke();
        context.setLineDash([]);
      }
      context.strokeStyle = 'rgba(248,255,251,.92)';
      context.lineWidth = 1;
      context.beginPath(); context.arc(cursorX, cursorY, 4.5 + disturbance * 2.5, 0, Math.PI * 2); context.stroke();
      context.beginPath();
      context.moveTo(cursorX - 10, cursorY); context.lineTo(cursorX - 6, cursorY);
      context.moveTo(cursorX + 6, cursorY); context.lineTo(cursorX + 10, cursorY);
      context.moveTo(cursorX, cursorY - 10); context.lineTo(cursorX, cursorY - 6);
      context.moveTo(cursorX, cursorY + 6); context.lineTo(cursorX, cursorY + 10);
      context.stroke();
      context.restore();
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="xy-signal-field" aria-hidden="true" />;
}

