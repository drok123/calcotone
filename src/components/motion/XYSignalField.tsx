import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import { DreamFieldEngine } from './DreamFieldEngine';

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
  const engineRef = useRef<DreamFieldEngine | null>(null);

  modulesRef.current = modules;
  assignmentsRef.current = assignments;
  positionRef.current = position;
  draggingRef.current = dragging;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const engine = new DreamFieldEngine();
    engineRef.current = engine;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);

      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      engine.resize(width, height);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render: ViewportRenderCallback = (stamp) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      engine.render(context, {
        modules: modulesRef.current,
        assignments: assignmentsRef.current,
        x: positionRef.current.x / 100,
        y: 1 - positionRef.current.y / 100,
        dragging: draggingRef.current,
        time: stamp / 1000,
      });
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
      engineRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} className="xy-signal-field" aria-hidden="true" />;
}
