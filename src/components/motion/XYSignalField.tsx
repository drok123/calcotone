import { useEffect, useState } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { loadVideoWorld, type VideoWorldKey } from './videoWorlds';
import './DreamField.css';

type VideoWorld = {
  key: VideoWorldKey;
  kind: 'drift' | 'ember' | 'halo' | 'artifact';
  energy: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function parameterValue(module: ModuleState, id: string, fallback = 0): number {
  return module.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;
}

function visualEnergy(module: ModuleState): number {
  if (!module.enabled || !module.available) return 0;

  // During the raw-video baseline every enabled visual module gets a minimum presence,
  // even with MIX at zero. This prevents a silent/black pad from masquerading as a
  // media-loading problem while we validate the source-video path.
  const mix = Math.max(parameterValue(module, 'mix', 0), 0.04);

  let character = 0.5;
  if (module.id === 'saturation') {
    character = parameterValue(module, 'drive') * 0.55
      + parameterValue(module, 'heat') * 0.30
      + parameterValue(module, 'character') * 0.15;
  } else if (module.id === 'chorus') {
    character = parameterValue(module, 'depth') * 0.42
      + parameterValue(module, 'motion') * 0.33
      + parameterValue(module, 'spread') * 0.25;
  } else if (module.id === 'delay') {
    character = parameterValue(module, 'feedback') * 0.46
      + parameterValue(module, 'time') * 0.24
      + parameterValue(module, 'character') * 0.18
      + parameterValue(module, 'width') * 0.12;
  } else if (module.id === 'media') {
    character = parameterValue(module, 'wear') * 0.40
      + parameterValue(module, 'wow') * 0.28
      + parameterValue(module, 'noise') * 0.18
      + (1 - parameterValue(module, 'tone', 0.5)) * 0.14;
  }

  return clamp01(Math.sqrt(mix) * (0.52 + clamp01(character) * 0.48));
}

function worldForModule(module: ModuleState): VideoWorld | null {
  const energy = visualEnergy(module);
  if (energy <= 0) return null;

  if (module.id === 'saturation') return { key: 'ember', kind: 'ember', energy };
  if (module.id === 'delay') return { key: 'halo', kind: 'halo', energy };
  if (module.id === 'media') return { key: 'artifact', kind: 'artifact', energy };
  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    const alternate = ['liquid', 'orbit', 'doppler', 'rotary'].includes(mode);
    return { key: alternate ? 'drift-alt' : 'drift', kind: 'drift', energy };
  }

  return null;
}

function activeVideoWorld(modules: ModuleState[]): VideoWorld {
  const worlds = modules
    .map(worldForModule)
    .filter((world): world is VideoWorld => world !== null)
    .sort((a, b) => b.energy - a.energy);

  // Never allow the pad to become an empty black diagnostic surface. Drift is the
  // baseline source plate when no supported module is currently enabled.
  return worlds[0] ?? { key: 'drift', kind: 'drift', energy: 1 };
}

export function XYSignalField({
  modules,
}: {
  modules: ModuleState[];
  assignments: XYAssignment[];
  position: { x: number; y: number };
  dragging: boolean;
}) {
  const world = activeVideoWorld(modules);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVideoUrl(null);

    loadVideoWorld(world.key)
      .then((url) => {
        if (!cancelled) setVideoUrl(url);
      })
      .catch((error) => {
        console.error(`CALCOTONE ${world.key} source video failed to load`, error);
      });

    return () => {
      cancelled = true;
    };
  }, [world.key]);

  return (
    <div
      className="xy-video-baseline"
      data-video-world={world.key}
      data-video-ready={videoUrl ? 'true' : 'false'}
      aria-hidden="true"
    >
      {videoUrl ? (
        <video
          key={world.key}
          className="xy-video-baseline-media"
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onLoadedData={(event) => {
            event.currentTarget.currentTime = 0;
            void event.currentTarget.play().catch((error) => {
              console.error(`CALCOTONE ${world.key} source video could not autoplay`, error);
            });
          }}
          onError={(event) => {
            console.error(`CALCOTONE ${world.key} video element error`, event.currentTarget.error);
          }}
        />
      ) : null}
    </div>
  );
}
