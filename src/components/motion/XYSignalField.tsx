import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { getEffectiveMotionValue } from '../../ui/motion';
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

  return clamp01(Math.sqrt(mix) * (0.52 + clamp01(character) * 0.48));
}

function modulesForDreamEngine(
  modules: ModuleState[],
  assignments: XYAssignment[],
  position: { x: number; y: number }
): ModuleState[] {
  const assignmentByTarget = new Map(assignments.map((assignment) => [assignment.target, assignment]));

  return modules.map((module) => {
    const effectiveParameters = module.parameters.map((parameter) => {
      const assignment = assignmentByTarget.get(`${module.id}.${parameter.id}`);
      if (!assignment) return parameter;

      return {
        ...parameter,
        value: getEffectiveMotionValue(parameter.value, assignment, position),
      };
    });

    const effectiveModule: ModuleState = {
      ...module,
      parameters: effectiveParameters,
    };

    if (!module.enabled || !module.available) return effectiveModule;

    const energy = visualEnergy(effectiveModule);
    return {
      ...effectiveModule,
      parameters: effectiveParameters.map((parameter) =>
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
    let visualAssignmentSource: XYAssignment[] | null = null;
    let visualX = Number.NaN;
    let visualY = Number.NaN;
    let visualModules: ModuleState[] = modulesForDreamEngine(
      modulesRef.current,
      assignmentsRef.current,
      positionRef.current
    );

    const getVisualModules = () => {
      const nextPosition = positionRef.current;
      if (
        visualModuleSource !== modulesRef.current ||
        visualAssignmentSource !== assignmentsRef.current ||
        visualX !== nextPosition.x ||
        visualY !== nextPosition.y
      ) {
        visualModuleSource = modulesRef.current;
        visualAssignmentSource = assignmentsRef.current;
        visualX = nextPosition.x;
        visualY = nextPosition.y;
        visualModules = modulesForDreamEngine(
          modulesRef.current,
          assignmentsRef.current,
          nextPosition
        );
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
