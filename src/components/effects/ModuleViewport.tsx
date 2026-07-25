import type { CSSProperties } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import './ModuleViewportVideo.css';

type ModuleVideoKey = 'ember' | 'drift' | 'drift-alt' | 'halo' | 'artifact' | 'atmos' | 'grain';

type VisualRecipe =
  | 'mirror'
  | 'columns'
  | 'quad'
  | 'rotary'
  | 'recursive'
  | 'slices'
  | 'portal'
  | 'cross'
  | 'shatter'
  | 'prism'
  | 'smear'
  | 'hardware'
  | 'abyss'
  | 'freeze'
  | 'cinema';

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

function visualRecipeFor(module: ModuleState): VisualRecipe {
  if (module.id === 'saturation') {
    const mode = module.emberMode ?? 'velvet';
    if (['velvet', 'tube'].includes(mode)) return 'mirror';
    if (['console', 'transformer'].includes(mode)) return 'columns';
    if (mode === 'furnace') return 'recursive';
    if (mode === 'exciter') return 'prism';
    if (mode === 'broken') return 'shatter';
    return 'hardware';
  }

  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    if (mode === 'chorus') return 'mirror';
    if (mode === 'ensemble') return 'columns';
    if (['dimension', 'dimensiond'].includes(mode)) return 'quad';
    if (mode === 'vibrato') return 'slices';
    if (['rotary', 'doppler', 'orbit'].includes(mode)) return 'rotary';
    if (mode === 'liquid') return 'recursive';
    return 'portal';
  }

  if (module.id === 'delay') {
    const mode = module.delayAlgorithm ?? 'tape';
    if (mode === 'clean') return 'mirror';
    if (['tape', 'bbd', 're201'].includes(mode)) return 'slices';
    if (mode === 'pingpong') return 'columns';
    if (mode === 'diffuse') return 'recursive';
    if (mode === 'scatter') return 'shatter';
    if (mode === 'constellation') return 'quad';
    if (mode === 'Binson Echorec') return 'rotary';
    if (mode === 'AMS DMX 15-80 S') return 'prism';
    return 'hardware';
  }

  if (module.id === 'reverb') {
    const mode = module.algorithm ?? 'hall';
    if (mode === 'room') return 'columns';
    if (mode === 'plate') return 'quad';
    if (mode === 'hall') return 'mirror';
    if (mode === 'cinema') return 'cinema';
    if (mode === 'cloud') return 'recursive';
    if (mode === 'freeze') return 'freeze';
    if (mode === 'celestial') return 'quad';
    if (mode === 'aurora') return 'prism';
    if (mode === 'nebula') return 'portal';
    if (mode === 'abyss') return 'abyss';
    return 'hardware';
  }

  if (module.id === 'bitcrusher') {
    const mode = module.grainMode ?? 'reconstruct';
    if (mode === 'reconstruct') return 'slices';
    if (mode === 'shatter') return 'shatter';
    if (mode === 'smear') return 'smear';
    if (mode === 'prism') return 'prism';
    if (mode === 'stutter') return 'cross';
    if (mode === 'ruin') return 'recursive';
    return 'hardware';
  }

  const mode = module.mediaMode ?? 'cassette';
  if (mode === 'cassette') return 'mirror';
  if (mode === 'reel') return 'rotary';
  if (mode === 'vinyl') return 'columns';
  if (mode === 'vhs') return 'slices';
  if (mode === 'radio') return 'cross';
  if (mode === 'wax') return 'smear';
  if (mode === 'broken') return 'shatter';
  if (mode === 'archive') return 'recursive';
  return 'hardware';
}

function visualModeFor(module: ModuleState): string {
  if (module.id === 'saturation') return `ember-${module.emberMode ?? 'velvet'}`;
  if (module.id === 'chorus') return `drift-${module.driftMode ?? 'chorus'}`;
  if (module.id === 'delay') return `halo-${String(module.delayAlgorithm ?? 'tape').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
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

function VideoLayer({ src, className }: { src: string; className: string }) {
  return (
    <video
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
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
  const visualRecipe = visualRecipeFor(module);

  return (
    <div
      className={`dsp-viewport module-video-viewport viewport-${module.id} ${module.enabled ? 'active' : 'is-off'}`}
      data-audio-level={feedback.toFixed(3)}
      data-visual-mode={visualMode}
      data-visual-recipe={visualRecipe}
      style={{ '--module-feedback': feedback } as CSSProperties}
    >
      {module.enabled && videoUrl ? (
        <div className="module-video-stage" aria-hidden="true">
          <VideoLayer src={videoUrl} className="module-video module-video-base" />
          <VideoLayer src={videoUrl} className="module-video module-video-fx module-video-fx-a" />
          <VideoLayer src={videoUrl} className="module-video module-video-fx module-video-fx-b" />
          <VideoLayer src={videoUrl} className="module-video module-video-fx module-video-fx-c" />
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
