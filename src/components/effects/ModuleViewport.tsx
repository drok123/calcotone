import type { CSSProperties } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import './ModuleViewportVideo.css';

type ModuleVideoKey = 'ember' | 'drift' | 'drift-alt' | 'halo' | 'artifact' | 'atmos' | 'grain';

const VIDEO_PLAYBACK_RATE = 0.08;

const VIDEO_FILES: Record<ModuleVideoKey, string> = {
  ember: 'visuals/ember.mp4',
  drift: 'visuals/drift.mp4',
  'drift-alt': 'visuals/drift-alt.mp4',
  halo: 'visuals/halo.mp4',
  artifact: 'visuals/artifact.mp4',
  atmos: 'visuals/atmos.mp4',
  grain: 'visuals/grain.mp4',
};

function assetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}${path}`;
}

function videoFor(module: ModuleState): ModuleVideoKey | null {
  if (module.id === 'saturation') return 'ember';
  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    return ['liquid', 'orbit', 'doppler', 'rotary'].includes(mode) ? 'drift-alt' : 'drift';
  }
  if (module.id === 'delay') return 'halo';
  if (module.id === 'reverb') return 'atmos';
  if (module.id === 'bitcrusher') return 'grain';
  if (module.id === 'media') return 'artifact';
  return null;
}

function visualModeFor(module: ModuleState): string {
  if (module.id === 'saturation') return `ember-${module.emberMode ?? 'velvet'}`;
  if (module.id === 'chorus') return `drift-${module.driftMode ?? 'chorus'}`;
  if (module.id === 'delay') return `halo-${module.delayAlgorithm ?? 'tape'}`;
  if (module.id === 'reverb') return `atmos-${module.algorithm ?? 'hall'}`;
  if (module.id === 'bitcrusher') return `grain-${module.grainMode ?? 'reconstruct'}`;
  if (module.id === 'media') return `artifact-${String(module.mediaMode ?? 'cassette').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return 'default';
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

function VideoLayer({ src, className, phase = 0 }: { src: string; className: string; phase?: number }) {
  return (
    <video
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        video.playbackRate = VIDEO_PLAYBACK_RATE;
        if (video.duration > 0 && phase > 0) video.currentTime = Math.min(video.duration - 0.01, video.duration * phase);
      }}
      onCanPlay={(event) => {
        const video = event.currentTarget;
        video.playbackRate = VIDEO_PLAYBACK_RATE;
        void video.play().catch(() => undefined);
      }}
      aria-hidden="true"
    />
  );
}

export function ModuleViewport({
  module,
  visualState,
}: {
  module: ModuleState;
  visualState: VisualAudioState;
}) {
  const key = videoFor(module);
  const videoUrl = key ? assetUrl(VIDEO_FILES[key]) : null;
  const feedback = Math.max(0, Math.min(1, visualState.level));
  const visualMode = visualModeFor(module);

  return (
    <div
      className={`dsp-viewport module-video-viewport viewport-${module.id} ${module.enabled ? 'active' : 'is-off'}`}
      data-audio-level={feedback.toFixed(3)}
      data-visual-mode={visualMode}
      style={{ '--module-feedback': feedback } as CSSProperties}
    >
      {module.enabled && videoUrl ? (
        <div className="module-video-stage" aria-hidden="true">
          <VideoLayer src={videoUrl} className="module-video module-video-base" phase={0} />
          <VideoLayer src={videoUrl} className="module-video module-video-fx module-video-fx-a" phase={0.11} />
          <VideoLayer src={videoUrl} className="module-video module-video-fx module-video-fx-b" phase={0.23} />
          <VideoLayer src={videoUrl} className="module-video module-video-fx module-video-fx-c" phase={0.37} />
        </div>
      ) : module.enabled ? (
        <div className="module-video-empty" aria-hidden="true">
          <span>VIDEO SOURCE NEEDED</span>
        </div>
      ) : null}

      {module.enabled && <span className="viewport-caption">{captionFor(module)}</span>}
    </div>
  );
}
