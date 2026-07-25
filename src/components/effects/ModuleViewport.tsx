import { useEffect, useMemo, useState } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import './ModuleViewportVideo.css';

type ModuleVideoKey = 'ember' | 'drift' | 'drift-alt' | 'halo' | 'artifact';

const VIDEO_FILES: Record<ModuleVideoKey, string> = {
  ember: 'visuals/ember.b64',
  drift: 'visuals/drift.b64',
  'drift-alt': 'visuals/drift-alt.b64',
  halo: 'visuals/halo.b64',
  artifact: 'visuals/artifact.b64',
};

const videoPromises = new Map<ModuleVideoKey, Promise<string>>();

function assetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}${path}`;
}

function decodeVideo(encoded: string): string {
  const binary = window.atob(encoded.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
}

function loadVideo(key: ModuleVideoKey): Promise<string> {
  const cached = videoPromises.get(key);
  if (cached) return cached;

  const request = fetch(assetUrl(VIDEO_FILES[key]), { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load ${key} module video (${response.status})`);
      return response.text();
    })
    .then(decodeVideo)
    .catch((error) => {
      videoPromises.delete(key);
      throw error;
    });

  videoPromises.set(key, request);
  return request;
}

function videoFor(module: ModuleState): ModuleVideoKey | null {
  if (module.id === 'saturation') return 'ember';
  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    return ['liquid', 'orbit', 'doppler', 'rotary'].includes(mode) ? 'drift-alt' : 'drift';
  }
  if (module.id === 'delay') return 'halo';
  if (module.id === 'media') return 'artifact';
  return null;
}

function captionFor(module: ModuleState): string {
  if (module.id === 'saturation') return `EMBER · ${(module.emberMode ?? 'velvet').toUpperCase()}`;
  if (module.id === 'chorus') return `DRIFT · ${(module.driftMode ?? 'chorus').toUpperCase()}`;
  if (module.id === 'delay') return `HALO · ${formatAlgorithmName(module.delayAlgorithm ?? 'tape').toUpperCase()}`;
  if (module.id === 'reverb') return `ATMOS · ${(module.algorithm ?? 'hall').toUpperCase()}`;
  if (module.id === 'bitcrusher') return `GRAIN · ${(module.grainMode ?? 'reconstruct').toUpperCase()}`;
  const mode = module.mediaMode ?? 'cassette';
  return mode === 'Neve 1073' || mode === 'SSL 4000E' || mode === 'API 1608'
    ? 'ARTIFACT · SUMMING BUS'
    : `ARTIFACT · ${mode.toUpperCase()}`;
}

export function ModuleViewport({
  module,
  visualState,
}: {
  module: ModuleState;
  visualState: VisualAudioState;
}) {
  const key = useMemo(() => videoFor(module), [module.id, module.driftMode]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVideoUrl(null);
    setFailed(false);

    if (!key) return () => { cancelled = true; };

    loadVideo(key)
      .then((url) => {
        if (!cancelled) setVideoUrl(url);
      })
      .catch((error) => {
        console.warn(`CALCOTONE ${module.name} module video unavailable`, error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [key, module.name]);

  return (
    <div
      className={`dsp-viewport module-video-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}
      data-audio-level={visualState.level.toFixed(3)}
    >
      {videoUrl && (
        <video
          className="module-video"
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={(event) => {
            void event.currentTarget.play().catch(() => undefined);
          }}
          aria-hidden="true"
        />
      )}

      {!videoUrl && (
        <div className={`module-video-empty ${failed ? 'is-error' : ''}`} aria-hidden="true">
          <span>{key ? (failed ? 'VIDEO LOAD ERROR' : 'LOADING VIDEO') : 'VIDEO SOURCE NEEDED'}</span>
        </div>
      )}

      <span className="viewport-caption">{captionFor(module)}</span>
    </div>
  );
}
