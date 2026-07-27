import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ModuleState } from '../../ui/types';
import type { SignalLabState } from '../../audio/SignalLab';
import { TemporalVideo } from '../video/TemporalVideo';
import { landscapeIdentity, videoUrl, type VideoWorld } from './VideoLandscapeCatalog';
import './VideoLandscapeEngine.css';

type Slot = 'a' | 'b';
const CROSSFADE_SETTLE_MS = 760;
const IDLE_PLAYBACK_RATE = 0.40;
const DRAG_PLAYBACK_RATE = 0.40;

function syncVideo(incoming: HTMLVideoElement, outgoing: HTMLVideoElement): void {
  if (!Number.isFinite(incoming.duration) || incoming.duration <= 0) return;
  const phase = Number.isFinite(outgoing.duration) && outgoing.duration > 0 ? (outgoing.currentTime / outgoing.duration) % 1 : 0;
  const target = phase * incoming.duration;
  if (Math.abs(incoming.currentTime - target) > 0.18) incoming.currentTime = target;
}

export function VideoLandscapeEngine({ modules, position, dragging, signalLab, onAvailabilityChange }: {
  modules: ModuleState[];
  position: { x: number; y: number };
  dragging: boolean;
  signalLab?: SignalLabState;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const identity = useMemo(() => landscapeIdentity(modules), [modules]);
  const [worldA, setWorldA] = useState<VideoWorld>(identity.world);
  const [worldB, setWorldB] = useState<VideoWorld>(identity.world);
  const [activeSlot, setActiveSlot] = useState<Slot>('a');
  const [activeReady, setActiveReady] = useState(false);
  const [failedWorlds, setFailedWorlds] = useState<ReadonlySet<VideoWorld>>(() => new Set());
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  const requestedWorldRef = useRef<VideoWorld>(identity.world);
  const activeSlotRef = useRef<Slot>('a');
  const pauseTimerRef = useRef<number | null>(null);

  activeSlotRef.current = activeSlot;
  requestedWorldRef.current = identity.world;
  const currentWorld = activeSlot === 'a' ? worldA : worldB;

  const clearPauseTimer = (): void => {
    if (pauseTimerRef.current === null) return;
    window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
  };

  useEffect(() => () => clearPauseTimer(), []);
  useEffect(() => { onAvailabilityChange?.(activeReady); }, [activeReady, onAvailabilityChange]);
  useEffect(() => {
    if (identity.world === currentWorld || failedWorlds.has(identity.world)) return;
    if (activeSlot === 'a') setWorldB(identity.world); else setWorldA(identity.world);
  }, [identity.world, currentWorld, activeSlot, failedWorlds]);

  const activate = (slot: Slot, world: VideoWorld): void => {
    if (world !== requestedWorldRef.current) return;
    const incoming = slot === 'a' ? aRef.current : bRef.current;
    const outgoing = activeSlotRef.current === 'a' ? aRef.current : bRef.current;
    if (!incoming) return;
    clearPauseTimer();
    if (outgoing && incoming !== outgoing) syncVideo(incoming, outgoing);
    incoming.playbackRate = dragging ? DRAG_PLAYBACK_RATE : IDLE_PLAYBACK_RATE;
    void incoming.play().catch(() => undefined);
    setActiveReady(true);
    setActiveSlot(slot);
    if (outgoing && incoming !== outgoing) {
      pauseTimerRef.current = window.setTimeout(() => {
        pauseTimerRef.current = null;
        if (outgoing !== (activeSlotRef.current === 'a' ? aRef.current : bRef.current)) outgoing.pause();
      }, CROSSFADE_SETTLE_MS);
    }
  };

  const markError = (slot: Slot, world: VideoWorld): void => {
    setFailedWorlds((previous) => {
      if (previous.has(world)) return previous;
      const next = new Set(previous); next.add(world); return next;
    });
    if (slot === activeSlotRef.current) setActiveReady(false);
  };

  useEffect(() => {
    const active = activeSlot === 'a' ? aRef.current : bRef.current;
    if (!active) return;
    active.playbackRate = dragging ? DRAG_PLAYBACK_RATE : IDLE_PLAYBACK_RATE;
    if (activeReady) void active.play().catch(() => undefined);
  }, [dragging, activeReady, activeSlot]);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      const active = activeSlotRef.current === 'a' ? aRef.current : bRef.current;
      if (activeReady && active) void active.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [activeReady]);

  const x = position.x / 100;
  const y = position.y / 100;
  const signalDepth = signalLab?.enabled ? Math.min(0.012, 0.003 + signalLab.mix * 0.008) : 0;
  const style = {
    '--video-pan-x': `${(x - 0.5) * 1.15}%`, '--video-pan-y': `${(0.5 - y) * 0.68}%`,
    '--video-scale': 1.022 + Math.abs(y - 0.5) * 0.016, '--grade-hue': `${identity.grade.hue}deg`,
    '--grade-sat': identity.grade.saturation, '--grade-tint': identity.grade.tint,
    '--grade-tint-opacity': identity.grade.tintOpacity + signalDepth,
  } as CSSProperties;

  const playbackRate = dragging ? DRAG_PLAYBACK_RATE : IDLE_PLAYBACK_RATE;

  return (
    <div className="xy-video-world" style={style} aria-hidden="true" data-world={currentWorld} data-module={identity.moduleId ?? 'raw'} data-mode={identity.mode}>
      <TemporalVideo
        ref={aRef}
        className={`xy-world-video ${activeSlot === 'a' ? 'is-front' : 'is-back'}`}
        src={videoUrl(worldA)}
        playbackRate={playbackRate}
        loop
        preload="auto"
        onCanPlay={(video) => {
          if (activeSlotRef.current === 'a') { if (!activeReady) { setActiveReady(true); void video.play().catch(() => undefined); } return; }
          if (worldA !== currentWorld) activate('a', worldA);
        }}
        onError={() => markError('a', worldA)}
      />
      <TemporalVideo
        ref={bRef}
        className={`xy-world-video ${activeSlot === 'b' ? 'is-front' : 'is-back'}`}
        src={videoUrl(worldB)}
        playbackRate={playbackRate}
        loop
        preload="auto"
        onCanPlay={(video) => {
          if (activeSlotRef.current === 'b') { if (!activeReady) { setActiveReady(true); void video.play().catch(() => undefined); } return; }
          if (worldB !== currentWorld) activate('b', worldB);
        }}
        onError={() => markError('b', worldB)}
      />
      <div className="xy-world-grade" /><div className="xy-world-vignette" />
    </div>
  );
}
