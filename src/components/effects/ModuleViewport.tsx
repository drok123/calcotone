import { useEffect, useRef, type CSSProperties } from 'react';
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
  | 'artifact';

type ColorProfile =
  | 'neutral'
  | 'ember'
  | 'amber'
  | 'gold'
  | 'cyan'
  | 'ice'
  | 'teal'
  | 'violet'
  | 'magenta'
  | 'blue'
  | 'green'
  | 'red'
  | 'sepia'
  | 'mono';

const VIDEO_FILES: Record<ModuleVideoKey, string> = {
  ember: 'visuals/ember.mp4',
  drift: 'visuals/drift.mp4',
  'drift-alt': 'visuals/drift-alt.mp4',
  halo: 'visuals/halo.mp4',
  artifact: 'visuals/artifact.mp4',
  atmos: 'visuals/atmos.mp4',
  grain: 'visuals/grain.mp4',
};

const BREATH_CROSSFADE_SECONDS = 2.8;
const BREATH_INCOMING_OFFSET_SECONDS = 0.12;
const BREATH_EASING = 'cubic-bezier(0.45, 0, 0.55, 1)';

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

  return 'artifact';
}

function colorProfileFor(module: ModuleState): ColorProfile {
  if (module.id === 'saturation') {
    const mode = module.emberMode ?? 'velvet';
    if (mode === 'velvet') return 'ember';
    if (mode === 'tube') return 'amber';
    if (mode === 'console') return 'gold';
    if (mode === 'transformer') return 'red';
    if (mode === 'furnace') return 'amber';
    if (mode === 'exciter') return 'magenta';
    if (mode === 'broken') return 'red';
    if (mode === 'goldlion') return 'gold';
    if (mode === 'mullard') return 'sepia';
    if (mode === 'telefunken') return 'cyan';
    if (mode === 'bugleboy') return 'violet';
    return 'mono';
  }

  if (module.id === 'chorus') {
    const mode = module.driftMode ?? 'chorus';
    if (mode === 'chorus') return 'cyan';
    if (mode === 'ensemble') return 'teal';
    if (mode === 'dimension') return 'blue';
    if (mode === 'vibrato') return 'violet';
    if (mode === 'rotary') return 'magenta';
    if (mode === 'doppler') return 'ice';
    if (mode === 'liquid') return 'teal';
    if (mode === 'orbit') return 'violet';
    if (mode === 'ce1') return 'green';
    return 'blue';
  }

  if (module.id === 'delay') {
    const mode = module.delayAlgorithm ?? 'tape';
    if (mode === 'clean') return 'ice';
    if (mode === 'tape') return 'amber';
    if (mode === 'bbd') return 'green';
    if (mode === 'pingpong') return 'cyan';
    if (mode === 'diffuse') return 'violet';
    if (mode === 'scatter') return 'magenta';
    if (mode === 'constellation') return 'blue';
    if (mode === 're201') return 'gold';
    if (mode === 'EP-3 Echoplex') return 'sepia';
    if (mode === 'Binson Echorec') return 'teal';
    if (mode === 'Deluxe Memory Man') return 'green';
    return 'cyan';
  }

  if (module.id === 'reverb') {
    const mode = module.algorithm ?? 'hall';
    if (mode === 'room') return 'amber';
    if (mode === 'plate') return 'ice';
    if (mode === 'hall') return 'blue';
    if (mode === 'cinema') return 'gold';
    if (mode === 'cloud') return 'cyan';
    if (mode === 'freeze') return 'ice';
    if (mode === 'celestial') return 'violet';
    if (mode === 'aurora') return 'magenta';
    if (mode === 'nebula') return 'violet';
    if (mode === 'abyss') return 'teal';
    if (mode === 'emt140') return 'sepia';
    return 'green';
  }

  if (module.id === 'bitcrusher') {
    const mode = module.grainMode ?? 'reconstruct';
    if (mode === 'reconstruct') return 'ice';
    if (mode === 'shatter') return 'red';
    if (mode === 'smear') return 'violet';
    if (mode === 'prism') return 'magenta';
    if (mode === 'stutter') return 'cyan';
    if (mode === 'ruin') return 'amber';
    if (mode === 'sp1200') return 'sepia';
    if (mode === 'mpc60') return 'gold';
    return 'green';
  }

  const mode = module.mediaMode ?? 'cassette';
  if (mode === 'cassette') return 'amber';
  if (mode === 'reel') return 'gold';
  if (mode === 'vinyl') return 'violet';
  if (mode === 'vhs') return 'magenta';
  if (mode === 'radio') return 'green';
  if (mode === 'wax') return 'sepia';
  if (mode === 'broken') return 'red';
  if (mode === 'archive') return 'cyan';
  if (mode === 'tascam424') return 'teal';
  if (mode === 'Neve 1073') return 'amber';
  if (mode === 'SSL 4000E') return 'blue';
  if (mode === 'API 1608') return 'red';
  return 'gold';
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

function BreathingLoopLayer({ src, className }: { src: string; className: string }) {
  const frontRef = useRef<HTMLVideoElement | null>(null);
  const backRef = useRef<HTMLVideoElement | null>(null);
  const frontActiveRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const front = frontRef.current;
    const back = backRef.current;
    if (!front || !back) return;

    const videos = [front, back];
    videos.forEach((video) => {
      video.muted = true;
      video.loop = false;
      video.playbackRate = 1;
    });

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const syncOpacity = () => {
      front.style.opacity = frontActiveRef.current ? '1' : '0';
      back.style.opacity = frontActiveRef.current ? '0' : '1';
    };

    const schedule = () => {
      clearTimer();
      const active = frontActiveRef.current ? front : back;
      if (!Number.isFinite(active.duration) || active.duration <= BREATH_CROSSFADE_SECONDS + 0.4) return;
      const delaySeconds = Math.max(0.1, active.duration - active.currentTime - BREATH_CROSSFADE_SECONDS);
      timerRef.current = window.setTimeout(startBreathTurnaround, delaySeconds * 1000);
    };

    const startBreathTurnaround = () => {
      const active = frontActiveRef.current ? front : back;
      const incoming = frontActiveRef.current ? back : front;
      if (!Number.isFinite(active.duration) || active.duration <= 0) return;

      incoming.currentTime = Math.min(BREATH_INCOMING_OFFSET_SECONDS, Math.max(0, incoming.duration - 0.05));
      incoming.style.transition = 'none';
      incoming.style.opacity = '0';
      active.style.transition = 'none';
      active.style.opacity = '1';

      void incoming.play().then(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            incoming.style.transition = `opacity ${BREATH_CROSSFADE_SECONDS}s ${BREATH_EASING}`;
            active.style.transition = `opacity ${BREATH_CROSSFADE_SECONDS}s ${BREATH_EASING}`;
            incoming.style.opacity = '1';
            active.style.opacity = '0';
          });
        });
      }).catch(() => undefined);

      timerRef.current = window.setTimeout(() => {
        active.pause();
        active.currentTime = BREATH_INCOMING_OFFSET_SECONDS;
        active.style.transition = 'none';
        frontActiveRef.current = !frontActiveRef.current;
        syncOpacity();
        schedule();
      }, BREATH_CROSSFADE_SECONDS * 1000 + 100);
    };

    const onMetadata = () => {
      syncOpacity();
      const active = frontActiveRef.current ? front : back;
      if (active.currentTime < BREATH_INCOMING_OFFSET_SECONDS) active.currentTime = BREATH_INCOMING_OFFSET_SECONDS;
      void active.play().catch(() => undefined);
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
        videos.forEach((video) => video.pause());
      } else {
        const active = frontActiveRef.current ? front : back;
        void active.play().catch(() => undefined);
        schedule();
      }
    };

    front.addEventListener('loadedmetadata', onMetadata);
    back.addEventListener('loadedmetadata', onMetadata);
    document.addEventListener('visibilitychange', onVisibility);

    if (front.readyState >= 1 && back.readyState >= 1) onMetadata();

    return () => {
      clearTimer();
      front.removeEventListener('loadedmetadata', onMetadata);
      back.removeEventListener('loadedmetadata', onMetadata);
      document.removeEventListener('visibilitychange', onVisibility);
      videos.forEach((video) => video.pause());
    };
  }, [src]);

  return (
    <span className={`${className} breathing-loop-layer`} aria-hidden="true">
      <video ref={frontRef} className="breathing-loop-video breathing-loop-front" src={src} muted playsInline preload="auto" />
      <video ref={backRef} className="breathing-loop-video breathing-loop-back" src={src} muted playsInline preload="auto" />
    </span>
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
  const colorProfile = colorProfileFor(module);

  return (
    <div
      className={`dsp-viewport module-video-viewport viewport-${module.id} ${module.enabled ? 'active' : 'is-off'}`}
      data-audio-level={feedback.toFixed(3)}
      data-visual-mode={visualMode}
      data-visual-recipe={visualRecipe}
      data-color-profile={colorProfile}
      style={{ '--module-feedback': feedback } as CSSProperties}
    >
      {module.enabled && videoUrl ? (
        <div className="module-video-stage" aria-hidden="true">
          <BreathingLoopLayer src={videoUrl} className="module-video module-video-base" />
          <BreathingLoopLayer src={videoUrl} className="module-video module-video-fx module-video-fx-a" />
          <BreathingLoopLayer src={videoUrl} className="module-video module-video-fx module-video-fx-b" />
          <BreathingLoopLayer src={videoUrl} className="module-video module-video-fx module-video-fx-c" />
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
