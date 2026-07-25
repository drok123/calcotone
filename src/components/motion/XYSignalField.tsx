import { useEffect, useRef, useState } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { getEffectiveMotionValue } from '../../ui/motion';
import { getLatestVisualAudioState } from '../../visual/VisualEngine';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import { DreamFieldEngine } from './DreamFieldEngine';
import { loadVideoWorld, type VideoWorldKey } from './videoWorlds';
import './DreamField.css';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type VideoWorldKind = 'drift' | 'ember' | 'halo' | 'artifact';
type VideoWorldLayer = {
  key: VideoWorldKey;
  kind: VideoWorldKind;
  flavor: string;
  energy: number;
};

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

function describeVideoWorld(module: ModuleState): VideoWorldLayer | null {
  if (!module.enabled || !module.available) return null;
  const energy = visualEnergy(module);
  if (energy <= 0) return null;

  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    const useAlternate = ['liquid', 'orbit', 'doppler', 'rotary'].includes(mode);
    const flavor = useAlternate
      ? 'liquid'
      : ['ensemble', 'dimension', 'dimensiond'].includes(mode)
        ? 'wide'
        : ['ce1', 'vibrato'].includes(mode)
          ? 'vintage'
          : 'abyss';
    return { key: useAlternate ? 'drift-alt' : 'drift', kind: 'drift', flavor, energy };
  }

  if (module.id === 'saturation') {
    const mode = module.emberMode ?? 'velvet';
    const flavor = ['furnace', 'exciter'].includes(mode)
      ? 'furnace'
      : mode === 'broken'
        ? 'overload'
        : ['tube', 'goldlion', 'mullard', 'telefunken', 'bugleboy', 'rcablack'].includes(mode)
          ? 'tube'
          : 'grid';
    return { key: 'ember', kind: 'ember', flavor, energy };
  }

  if (module.id === 'delay') {
    const mode = module.delayAlgorithm ?? 'clean';
    const flavor = ['diffuse', 'constellation', 'pingpong'].includes(mode)
      ? 'prism'
      : ['scatter', 'AMS DMX 15-80 S'].includes(mode)
        ? 'scatter'
        : ['tape', 're201', 'EP-3 Echoplex', 'Binson Echorec', 'Deluxe Memory Man'].includes(mode)
          ? 'echo'
          : 'mirror';
    return { key: 'halo', kind: 'halo', flavor, energy };
  }

  if (module.id === 'media') {
    const mode = module.mediaMode ?? 'cassette';
    const flavor = ['broken', 'vhs', 'radio'].includes(mode)
      ? 'corrupt'
      : ['archive', 'wax', 'vinyl'].includes(mode)
        ? 'archive'
        : ['Neve 1073', 'SSL 4000E', 'API 1608', 'Ampex ATR-102'].includes(mode)
          ? 'machine'
          : 'relic';
    return { key: 'artifact', kind: 'artifact', flavor, energy };
  }

  return null;
}

function videoWorldsForModules(modules: ModuleState[]): Array<VideoWorldLayer & { opacity: number }> {
  const worlds = modules
    .map(describeVideoWorld)
    .filter((world): world is VideoWorldLayer => world !== null);
  const totalEnergy = worlds.reduce((total, world) => total + world.energy, 0);
  const blendGain = totalEnergy > 1.7 ? 1.7 / totalEnergy : 1;

  return worlds.map((world) => ({
    ...world,
    // The source plate should read as the world, not as a faint texture underneath it.
    opacity: clamp01((0.46 + world.energy * 0.50) * blendGain),
  }));
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
  const videoStackRef = useRef<HTMLDivElement | null>(null);
  const modulesRef = useRef(modules);
  const assignmentsRef = useRef(assignments);
  const positionRef = useRef(position);
  const draggingRef = useRef(dragging);
  const engineRef = useRef<DreamFieldEngine | null>(null);
  const [videoUrls, setVideoUrls] = useState<Partial<Record<VideoWorldKey, string>>>({});

  modulesRef.current = modules;
  assignmentsRef.current = assignments;
  positionRef.current = position;
  draggingRef.current = dragging;

  const worlds = videoWorldsForModules(modules);
  const requestedWorldToken = Array.from(new Set(worlds.map((world) => world.key)))
    .sort()
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const keys = requestedWorldToken
      ? (requestedWorldToken.split('|') as VideoWorldKey[])
      : [];

    for (const key of keys) {
      // Load active worlds independently. One missing/corrupt plate must never block the rest.
      loadVideoWorld(key)
        .then((url) => {
          if (cancelled) return;
          setVideoUrls((current) => current[key] === url ? current : { ...current, [key]: url });
        })
        .catch((error) => {
          console.warn(`CALCOTONE Dream Field ${key} plate unavailable`, error);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [requestedWorldToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const engine = new DreamFieldEngine();
    engineRef.current = engine;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.75, window.devicePixelRatio || 1);
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
      dpr = Math.min(1.75, window.devicePixelRatio || 1);

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

      const audio = getLatestVisualAudioState();
      const stack = videoStackRef.current;
      if (stack) {
        const x = (positionRef.current.x - 50) / 50;
        const y = (positionRef.current.y - 50) / 50;
        const idleX = Math.sin(stamp * 0.00031 + audio.mid * 2.7) * (2.2 + audio.mid * 5.4);
        const idleY = Math.cos(stamp * 0.00023 + audio.low * 2.2) * (1.6 + audio.low * 4.0);
        const impulse = audio.transient * 0.025;
        const scale = 1.09 + audio.low * 0.055 + impulse + (draggingRef.current ? 0.012 : 0);
        const translateX = -x * (18 + audio.low * 8) + idleX;
        const translateY = y * (12 + audio.mid * 5) + idleY;
        const brightness = 0.94 + audio.level * 0.22 + audio.transient * 0.18;
        const contrast = 1.04 + audio.low * 0.10 + audio.transient * 0.08;
        const saturation = 1.03 + audio.mid * 0.08 + audio.high * 0.22;

        stack.style.transform = `translate3d(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
        stack.style.setProperty('--dream-bright', brightness.toFixed(3));
        stack.style.setProperty('--dream-contrast', contrast.toFixed(3));
        stack.style.setProperty('--dream-sat', saturation.toFixed(3));
        stack.style.setProperty('--dream-level', audio.level.toFixed(3));
        stack.style.setProperty('--dream-low', audio.low.toFixed(3));
        stack.style.setProperty('--dream-mid', audio.mid.toFixed(3));
        stack.style.setProperty('--dream-high', audio.high.toFixed(3));
        stack.style.setProperty('--dream-transient', audio.transient.toFixed(3));
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
          audio,
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

  const visibleWorlds = worlds.filter((world) => videoUrls[world.key]);

  return (
    <div
      className={`xy-signal-field-shell ${visibleWorlds.length ? 'has-video-world' : ''}`}
      data-video-worlds={visibleWorlds.map((world) => world.key).join(',')}
      aria-hidden="true"
    >
      <div ref={videoStackRef} className="dream-video-stack">
        {visibleWorlds.map((world) => (
          <video
            key={`${world.kind}-${world.key}`}
            className={`dream-video dream-video-${world.kind} flavor-${world.flavor}`}
            src={videoUrls[world.key]}
            style={{ opacity: world.opacity }}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onCanPlay={(event) => {
              void event.currentTarget.play().catch(() => undefined);
            }}
            onError={() => {
              console.warn(`CALCOTONE Dream Field ${world.key} video element failed to play`);
            }}
          />
        ))}
      </div>
      <canvas ref={canvasRef} className="xy-signal-field" />
    </div>
  );
}
