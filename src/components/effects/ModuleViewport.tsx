import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  | 'cinema'
  | 'artifact'
  | 'halo-rings'
  | 'halo-echo'
  | 'halo-star'
  | 'atmos-vault'
  | 'atmos-cloud'
  | 'atmos-aurora'
  | 'grain-grid'
  | 'grain-shards'
  | 'grain-raster'
  | 'grain-checker'
  | 'grain-diamond'
  | 'grain-brick'
  | 'grain-hex';

type ColorProfile =
  | 'neutral'
  | 'ember-dark'
  | 'ember-gold'
  | 'drift-cyan'
  | 'drift-blue'
  | 'drift-teal'
  | 'drift-violet'
  | 'halo-ice'
  | 'halo-blue'
  | 'halo-cyan'
  | 'halo-violet'
  | 'halo-green'
  | 'halo-gold'
  | 'atmos-blue'
  | 'atmos-cyan'
  | 'atmos-violet'
  | 'atmos-aurora'
  | 'atmos-deep'
  | 'atmos-warm'
  | 'grain-ice'
  | 'grain-red'
  | 'grain-violet'
  | 'grain-magenta'
  | 'grain-cyan'
  | 'grain-amber'
  | 'grain-green'
  | 'artifact-amber'
  | 'artifact-gold'
  | 'artifact-violet'
  | 'artifact-magenta'
  | 'artifact-green'
  | 'artifact-sepia'
  | 'artifact-red'
  | 'artifact-cyan'
  | 'artifact-teal'
  | 'artifact-blue';

const VIDEO_FILES: Record<ModuleVideoKey, string> = {
  ember: 'visuals/ember.mp4',
  drift: 'visuals/drift.mp4',
  'drift-alt': 'visuals/drift-alt.mp4',
  halo: 'visuals/halo.mp4',
  artifact: 'visuals/artifact.mp4',
  atmos: 'visuals/atmos.mp4',
  grain: 'visuals/grain.mp4',
};

const PING_PONG_FILES: Record<ModuleVideoKey, string> = {
  ember: 'visuals/ember-pingpong.mp4',
  drift: 'visuals/drift-pingpong.mp4',
  'drift-alt': 'visuals/drift-alt-pingpong.mp4',
  halo: 'visuals/halo-pingpong.mp4',
  artifact: 'visuals/artifact-pingpong.mp4',
  atmos: 'visuals/atmos-pingpong.mp4',
  grain: 'visuals/grain-pingpong.mp4',
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
    if (mode === 'clean') return 'halo-rings';
    if (mode === 'tape') return 'halo-echo';
    if (mode === 'bbd') return 'halo-rings';
    if (mode === 'pingpong') return 'halo-star';
    if (mode === 'diffuse') return 'halo-rings';
    if (mode === 'scatter') return 'halo-star';
    if (mode === 'constellation') return 'halo-star';
    if (mode === 're201') return 'halo-echo';
    if (mode === 'EP-3 Echoplex') return 'halo-echo';
    if (mode === 'Binson Echorec') return 'halo-rings';
    if (mode === 'Deluxe Memory Man') return 'halo-rings';
    return 'halo-star';
  }

  if (module.id === 'reverb') {
    const mode = module.algorithm ?? 'hall';
    if (mode === 'room') return 'atmos-vault';
    if (mode === 'plate') return 'quad';
    if (mode === 'hall') return 'atmos-vault';
    if (mode === 'cinema') return 'cinema';
    if (mode === 'cloud') return 'atmos-cloud';
    if (mode === 'freeze') return 'freeze';
    if (mode === 'celestial') return 'atmos-aurora';
    if (mode === 'aurora') return 'atmos-aurora';
    if (mode === 'nebula') return 'atmos-cloud';
    if (mode === 'abyss') return 'abyss';
    if (mode === 'emt140') return 'atmos-vault';
    return 'atmos-cloud';
  }

  if (module.id === 'bitcrusher') {
    const mode = module.grainMode ?? 'reconstruct';
    if (mode === 'reconstruct') return 'grain-checker';
    if (mode === 'shatter') return 'grain-shards';
    if (mode === 'smear') return 'grain-brick';
    if (mode === 'prism') return 'grain-diamond';
    if (mode === 'stutter') return 'grain-raster';
    if (mode === 'ruin') return 'grain-hex';
    if (mode === 'sp1200') return 'grain-grid';
    if (mode === 'mpc60') return 'grain-brick';
    return 'grain-diamond';
  }

  return 'artifact';
}

function colorProfileFor(module: ModuleState): ColorProfile {
  if (module.id === 'saturation') {
    const mode = module.emberMode ?? 'velvet';
    return mode === 'goldlion' ? 'ember-gold' : 'ember-dark';
  }

  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    if (['chorus', 'doppler'].includes(mode)) return 'drift-cyan';
    if (['dimension', 'dimensiond'].includes(mode)) return 'drift-blue';
    if (['ensemble', 'liquid', 'ce1'].includes(mode)) return 'drift-teal';
    return 'drift-violet';
  }

  if (module.id === 'delay') {
    const mode = module.delayAlgorithm ?? 'tape';
    if (mode === 'clean') return 'halo-ice';
    if (mode === 'tape') return 'halo-gold';
    if (mode === 'bbd') return 'halo-green';
    if (mode === 'pingpong') return 'halo-cyan';
    if (mode === 'diffuse') return 'halo-violet';
    if (mode === 'scatter') return 'halo-violet';
    if (mode === 'constellation') return 'halo-blue';
    if (mode === 're201') return 'halo-gold';
    if (mode === 'EP-3 Echoplex') return 'halo-gold';
    if (mode === 'Binson Echorec') return 'halo-cyan';
    if (mode === 'Deluxe Memory Man') return 'halo-green';
    return 'halo-ice';
  }

  if (module.id === 'reverb') {
    const mode = module.algorithm ?? 'hall';
    if (mode === 'room') return 'atmos-warm';
    if (mode === 'plate') return 'atmos-cyan';
    if (mode === 'hall') return 'atmos-blue';
    if (mode === 'cinema') return 'atmos-warm';
    if (mode === 'cloud') return 'atmos-cyan';
    if (mode === 'freeze') return 'atmos-cyan';
    if (mode === 'celestial') return 'atmos-violet';
    if (mode === 'aurora') return 'atmos-aurora';
    if (mode === 'nebula') return 'atmos-violet';
    if (mode === 'abyss') return 'atmos-deep';
    if (mode === 'emt140') return 'atmos-warm';
    return 'atmos-blue';
  }

  if (module.id === 'bitcrusher') {
    const mode = module.grainMode ?? 'reconstruct';
    if (mode === 'reconstruct') return 'grain-ice';
    if (mode === 'shatter') return 'grain-red';
    if (mode === 'smear') return 'grain-violet';
    if (mode === 'prism') return 'grain-magenta';
    if (mode === 'stutter') return 'grain-cyan';
    if (mode === 'ruin') return 'grain-amber';
    if (mode === 'sp1200') return 'grain-amber';
    if (mode === 'mpc60') return 'grain-green';
    return 'grain-violet';
  }

  const mode = module.mediaMode ?? 'cassette';
  if (mode === 'cassette') return 'artifact-amber';
  if (mode === 'reel') return 'artifact-gold';
  if (mode === 'vinyl') return 'artifact-violet';
  if (mode === 'vhs') return 'artifact-magenta';
  if (mode === 'radio') return 'artifact-green';
  if (mode === 'wax') return 'artifact-sepia';
  if (mode === 'broken') return 'artifact-red';
  if (mode === 'archive') return 'artifact-cyan';
  if (mode === 'tascam424') return 'artifact-teal';
  if (mode === 'Neve 1073') return 'artifact-amber';
  if (mode === 'SSL 4000E') return 'artifact-blue';
  if (mode === 'API 1608') return 'artifact-red';
  return 'artifact-gold';
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

function VideoLayer({ src, fallbackSrc, className }: { src: string; fallbackSrc: string; className: string }) {
  return (
    <video
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      onError={(event) => {
        const video = event.currentTarget;
        if (video.dataset.fallbackApplied === 'true') return;
        video.dataset.fallbackApplied = 'true';
        video.src = fallbackSrc;
        void video.play().catch(() => undefined);
      }}
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
  const videoUrl = key ? assetUrl(PING_PONG_FILES[key]) : null;
  const fallbackVideoUrl = key ? assetUrl(VIDEO_FILES[key]) : null;
  const feedback = Math.max(0, Math.min(1, visualState.level));
  const visualMode = visualModeFor(module);
  const visualRecipe = visualRecipeFor(module);
  const colorProfile = colorProfileFor(module);
  const signature = `${visualMode}|${visualRecipe}|${colorProfile}`;
  const previousSignatureRef = useRef(signature);
  const transitionTimerRef = useRef<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (previousSignatureRef.current === signature) return;
    previousSignatureRef.current = signature;
    setTransitioning(false);
    requestAnimationFrame(() => setTransitioning(true));

    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setTransitioning(false);
      transitionTimerRef.current = null;
    }, 950);

    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [signature]);

  return (
    <div
      className={`dsp-viewport module-video-viewport viewport-${module.id} ${module.enabled ? 'active' : 'is-off'} ${transitioning ? 'is-reconfiguring' : ''}`}
      data-audio-level={feedback.toFixed(3)}
      data-visual-mode={visualMode}
      data-visual-recipe={visualRecipe}
      data-color-profile={colorProfile}
      style={{ '--module-feedback': feedback } as CSSProperties}
    >
      {module.enabled && videoUrl && fallbackVideoUrl ? (
        <div className="module-video-stage" aria-hidden="true">
          <VideoLayer src={videoUrl} fallbackSrc={fallbackVideoUrl} className="module-video module-video-base" />
          <span className="module-video module-video-fx module-video-fx-a" />
          <span className="module-video module-video-fx module-video-fx-b" />
          <span className="module-video module-video-fx module-video-fx-c" />
          <span className="module-video-void-mask" />
          <span className="module-video-transition-veil" />
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
