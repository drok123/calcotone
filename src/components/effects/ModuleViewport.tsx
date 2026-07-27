import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import './ModuleViewportVideo.css';

type ModuleVideoKey = 'ember' | 'drift' | 'drift-alt' | 'halo' | 'artifact' | 'atmos' | 'grain';
type VisualRecipe =
  | 'mirror' | 'columns' | 'quad' | 'rotary' | 'recursive' | 'slices' | 'portal'
  | 'cross' | 'shatter' | 'prism' | 'smear' | 'hardware' | 'abyss' | 'freeze'
  | 'cinema' | 'artifact' | 'halo-rings' | 'halo-echo' | 'halo-star' | 'atmos-vault'
  | 'atmos-cloud' | 'atmos-aurora' | 'grain-grid' | 'grain-shards' | 'grain-raster'
  | 'grain-checker' | 'grain-diamond' | 'grain-brick' | 'grain-hex';

type ColorProfile =
  | 'neutral' | 'ember-dark' | 'ember-gold' | 'drift-cyan' | 'drift-blue' | 'drift-teal'
  | 'drift-violet' | 'halo-ice' | 'halo-blue' | 'halo-cyan' | 'halo-violet' | 'halo-green'
  | 'halo-gold' | 'atmos-blue' | 'atmos-cyan' | 'atmos-violet' | 'atmos-aurora' | 'atmos-deep'
  | 'atmos-warm' | 'grain-ice' | 'grain-red' | 'grain-violet' | 'grain-magenta' | 'grain-cyan'
  | 'grain-amber' | 'grain-green' | 'artifact-amber' | 'artifact-gold' | 'artifact-violet'
  | 'artifact-magenta' | 'artifact-green' | 'artifact-sepia' | 'artifact-red' | 'artifact-cyan'
  | 'artifact-teal' | 'artifact-blue';

const VIDEO_FILES: Record<ModuleVideoKey, string> = {
  ember: 'visuals/ember.mp4',
  drift: 'visuals/drift.mp4',
  'drift-alt': 'visuals/drift-alt.mp4',
  halo: 'visuals/halo.mp4',
  artifact: 'visuals/artifact.mp4',
  atmos: 'visuals/atmos.mp4',
  grain: 'visuals/grain.mp4',
};

const MODULE_PLAYBACK_RATE = 0.20;

function assetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}${path}`;
}

function videoFor(module: ModuleState): ModuleVideoKey | null {
  if (module.id === 'saturation') return 'ember';
  if (module.id === 'chorus') {
    // Doppler/Liquid/Orbit use the known-good Drift decoder source and keep their identity
    // through color/recipe treatment. Rotary intentionally retains the alternate footage.
    return (module.driftMode ?? 'chorus') === 'rotary' ? 'drift-alt' : 'drift';
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
    if (['clean', 'bbd', 'diffuse', 'Binson Echorec', 'Deluxe Memory Man'].includes(mode)) return 'halo-rings';
    if (['tape', 're201', 'EP-3 Echoplex'].includes(mode)) return 'halo-echo';
    return 'halo-star';
  }
  if (module.id === 'reverb') {
    const mode = module.algorithm ?? 'hall';
    if (['room', 'hall', 'emt140'].includes(mode)) return 'atmos-vault';
    if (mode === 'plate') return 'quad';
    if (mode === 'cinema') return 'cinema';
    if (mode === 'freeze') return 'freeze';
    if (['celestial', 'aurora'].includes(mode)) return 'atmos-aurora';
    if (mode === 'abyss') return 'abyss';
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
  if (module.id === 'saturation') return (module.emberMode ?? 'velvet') === 'goldlion' ? 'ember-gold' : 'ember-dark';
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
    if (['tape', 're201', 'EP-3 Echoplex'].includes(mode)) return 'halo-gold';
    if (['bbd', 'Deluxe Memory Man'].includes(mode)) return 'halo-green';
    if (['pingpong', 'Binson Echorec'].includes(mode)) return 'halo-cyan';
    if (['diffuse', 'scatter'].includes(mode)) return 'halo-violet';
    if (mode === 'constellation') return 'halo-blue';
    return 'halo-ice';
  }
  if (module.id === 'reverb') {
    const mode = module.algorithm ?? 'hall';
    if (['room', 'cinema', 'emt140'].includes(mode)) return 'atmos-warm';
    if (['plate', 'cloud', 'freeze'].includes(mode)) return 'atmos-cyan';
    if (mode === 'hall') return 'atmos-blue';
    if (['celestial', 'nebula'].includes(mode)) return 'atmos-violet';
    if (mode === 'aurora') return 'atmos-aurora';
    if (mode === 'abyss') return 'atmos-deep';
    return 'atmos-blue';
  }
  if (module.id === 'bitcrusher') {
    const mode = module.grainMode ?? 'reconstruct';
    if (mode === 'reconstruct') return 'grain-ice';
    if (mode === 'shatter') return 'grain-red';
    if (mode === 'smear') return 'grain-violet';
    if (mode === 'prism') return 'grain-magenta';
    if (mode === 'stutter') return 'grain-cyan';
    if (['ruin', 'sp1200'].includes(mode)) return 'grain-amber';
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

function VideoLayer({ src, className }: { src: string; className: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const clearRecovery = (): void => {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };

    const play = (): void => {
      clearRecovery();
      video.playbackRate = MODULE_PLAYBACK_RATE;
      void video.play().catch(() => undefined);
    };

    const reload = (): void => {
      if (document.hidden || retryCountRef.current >= 2) return;
      retryCountRef.current += 1;
      video.load();
      video.playbackRate = MODULE_PLAYBACK_RATE;
      void video.play().catch(() => undefined);
    };

    const scheduleRecovery = (): void => {
      if (recoveryTimerRef.current !== null) return;
      recoveryTimerRef.current = window.setTimeout(() => {
        recoveryTimerRef.current = null;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) reload();
      }, 1400);
    };

    const loaded = (): void => {
      retryCountRef.current = 0;
      play();
    };

    const bootstrapTimer = window.setTimeout(() => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) reload();
      else play();
    }, 2200);

    const visibilityChange = (): void => {
      if (!document.hidden) {
        retryCountRef.current = 0;
        play();
      }
    };

    video.addEventListener('loadeddata', loaded);
    video.addEventListener('canplay', play);
    video.addEventListener('playing', clearRecovery);
    video.addEventListener('stalled', scheduleRecovery);
    video.addEventListener('waiting', scheduleRecovery);
    video.addEventListener('error', reload);
    document.addEventListener('visibilitychange', visibilityChange);
    play();

    return () => {
      clearRecovery();
      window.clearTimeout(bootstrapTimer);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('canplay', play);
      video.removeEventListener('playing', clearRecovery);
      video.removeEventListener('stalled', scheduleRecovery);
      video.removeEventListener('waiting', scheduleRecovery);
      video.removeEventListener('error', reload);
      document.removeEventListener('visibilitychange', visibilityChange);
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
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

export function ModuleViewport({ module, visualState }: { module: ModuleState; visualState: VisualAudioState }) {
  const key = videoFor(module);
  const videoUrl = key ? assetUrl(VIDEO_FILES[key]) : null;
  const feedback = Math.max(0, Math.min(1, visualState.level));
  const visualMode = visualModeFor(module);
  const visualRecipe = visualRecipeFor(module);
  const colorProfile = colorProfileFor(module);
  const signature = `${visualMode}|${visualRecipe}|${colorProfile}`;
  const previousSignatureRef = useRef(signature);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (previousSignatureRef.current === signature) return;
    previousSignatureRef.current = signature;
    setTransitioning(false);
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current);
    transitionFrameRef.current = requestAnimationFrame(() => {
      transitionFrameRef.current = null;
      setTransitioning(true);
    });

    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setTransitioning(false);
      transitionTimerRef.current = null;
    }, 620);

    return () => {
      if (transitionFrameRef.current !== null) {
        cancelAnimationFrame(transitionFrameRef.current);
        transitionFrameRef.current = null;
      }
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
      {module.enabled && videoUrl ? (
        <div className="module-video-stage" aria-hidden="true">
          <VideoLayer src={videoUrl} className="module-video module-video-base" />
          <span className="module-video-transition-veil" />
        </div>
      ) : module.enabled ? (
        <div className="module-video-empty" aria-hidden="true"><span>VIDEO SOURCE NEEDED</span></div>
      ) : null}
      {module.enabled && <span className="viewport-caption">{captionFor(module)}</span>}
    </div>
  );
}
