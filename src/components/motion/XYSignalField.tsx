import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import { DreamFieldEngine } from './DreamFieldEngine';
import './DreamField.css';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function visualEnergy(module: ModuleState): number {
  const value = (id: string, fallback = 0) =>
    module.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;
  const mix = value('mix', 0);
  if (mix <= 0) return 0;

  let character = 0.5;
  switch (module.id) {
    case 'saturation':
      character = value('drive') * 0.55 + value('heat') * 0.30 + value('character') * 0.15;
      break;
    case 'chorus':
      character = value('depth') * 0.42 + value('motion') * 0.33 + value('spread') * 0.25;
      break;
    case 'delay':
      character = value('feedback') * 0.46 + value('time') * 0.24 + value('character') * 0.18 + value('width') * 0.12;
      break;
    case 'reverb':
      character = value('size') * 0.34 + value('diffusion') * 0.28 + value('decay') * 0.24 + value('motion') * 0.14;
      break;
    case 'bitcrusher':
      character = value('chaos') * 0.40 + value('density') * 0.25 + value('bloom') * 0.22 + (1 - value('bits', 1)) * 0.13;
      break;
    case 'media':
      character = value('wear') * 0.40 + value('wow') * 0.28 + value('noise') * 0.18 + (1 - value('tone', 0.5)) * 0.14;
      break;
  }

  // Wet level gates the visual contribution, while meaningful module controls decide
  // how expressive it becomes. sqrt keeps low-but-audible mixes visually readable.
  return clamp01(Math.sqrt(mix) * (0.52 + clamp01(character) * 0.48));
}

function modulesForDreamEngine(modules: ModuleState[]): ModuleState[] {
  return modules.map((module) => {
    if (!module.enabled || !module.available) return module;
    const energy = visualEnergy(module);
    return {
      ...module,
      parameters: module.parameters.map((parameter) =>
        parameter.id === 'mix' ? { ...parameter, value: energy } : parameter
      ),
    };
  });
}

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
    let visualModuleSource: ModuleState[] | null = null;
    let visualModules: ModuleState[] = modulesForDreamEngine(modulesRef.current);

    const getVisualModules = () => {
      if (visualModuleSource !== modulesRef.current) {
        visualModuleSource = modulesRef.current;
        visualModules = modulesForDreamEngine(modulesRef.current);
      }
      return visualModules;
    };

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
          modules: getVisualModules(),
          assignments: assignmentsRef.current,
          x: positionRef.current.x / 100,
          // Keep the engine contract conventional: bottom = 0, top = 1.
          y: positionRef.current.y / 100,
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
