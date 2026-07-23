import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import { DreamFieldEngine } from './DreamFieldEngine';
import './DreamField.css';

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
    let faulted = false;

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

    const drawFault = () => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(10, 3, 3, 0.96)';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(220, 118, 90, 0.85)';
      context.lineWidth = 1;
      context.strokeRect(8.5, 8.5, Math.max(1, width - 17), Math.max(1, height - 17));
      context.fillStyle = 'rgba(238, 188, 166, 0.92)';
      context.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.fillText('DREAM ENGINE FAULT', 18, 28);
    };

    const render: ViewportRenderCallback = (stamp) => {
      if (faulted) {
        drawFault();
        return;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        engine.render(context, {
          modules: modulesRef.current,
          assignments: assignmentsRef.current,
          x: positionRef.current.x / 100,
          y: 1 - positionRef.current.y / 100,
          dragging: draggingRef.current,
          time: stamp / 1000,
        });
      } catch (error) {
        faulted = true;
        console.error('CALCOTONE Dream Engine render failed', error);
        drawFault();
      }
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
