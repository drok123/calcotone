import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ModuleState } from '../../ui/types';
import type { SignalLabState } from '../../audio/SignalLab';
import './VideoLandscapeEngine.css';

export type VideoWorld = 'base' | 'cyber' | 'storm' | 'solar' | 'dream' | 'night';
type Grade = { hue: number; saturation: number; tint: string; tintOpacity: number };
const WORLD_VIDEO: Record<VideoWorld, string> = { base: '/xy-worlds/cyber-mountain/base.mp4', cyber: '/xy-worlds/cyber-mountain/cyber.mp4', storm: '/xy-worlds/cyber-mountain/storm.mp4', solar: '/xy-worlds/cyber-mountain/solar.mp4', dream: '/xy-worlds/cyber-mountain/dream.mp4', night: '/xy-worlds/cyber-mountain/night.mp4' };
const GRADES: Record<string, Grade> = {
  neutral: { hue: 0, saturation: 1, tint: 'rgb(110 150 170)', tintOpacity: 0 }, ember: { hue: -7, saturation: 1.08, tint: 'rgb(205 116 62)', tintOpacity: 0.055 }, tube: { hue: -11, saturation: 1.04, tint: 'rgb(188 103 67)', tintOpacity: 0.06 }, gold: { hue: -18, saturation: 1.10, tint: 'rgb(211 160 72)', tintOpacity: 0.065 },
  drift: { hue: 7, saturation: 1.02, tint: 'rgb(82 151 174)', tintOpacity: 0.045 }, halo: { hue: 12, saturation: 1.04, tint: 'rgb(104 130 190)', tintOpacity: 0.05 }, atmos: { hue: 5, saturation: 0.98, tint: 'rgb(115 139 160)', tintOpacity: 0.045 }, grain: { hue: -3, saturation: 0.96, tint: 'rgb(158 144 119)', tintOpacity: 0.04 }, artifact: { hue: 18, saturation: 1.08, tint: 'rgb(105 104 188)', tintOpacity: 0.05 },
};
function modeName(module: ModuleState): string { return String(module.emberMode ?? module.driftMode ?? module.delayAlgorithm ?? module.algorithm ?? module.grainMode ?? module.mediaMode ?? '').toLowerCase(); }
function chooseWorld(modules: ModuleState[]): VideoWorld {
  const active = modules.filter((module) => module.enabled && module.available); if (!active.length) return 'base'; const ids = new Set(active.map((module) => module.id)); const modes = active.map(modeName).join(' ');
  if (ids.has('media') || /broken|digital|glitch|vhs|cyber/.test(modes)) return 'cyber'; if (ids.has('reverb') || /storm|shimmer|cloud|space/.test(modes)) return 'storm'; if (ids.has('saturation') || /tube|furnace|goldlion|mullard|transformer/.test(modes)) return 'solar'; if (ids.has('chorus') || /liquid|orbit|doppler/.test(modes)) return 'dream'; if (ids.has('bitcrusher')) return 'night'; return 'base';
}
function chooseGrade(modules: ModuleState[]): Grade {
  const active = modules.filter((module) => module.enabled && module.available); if (!active.length) return GRADES.neutral; const module = active[active.length - 1]; const mode = modeName(module);
  if (module.id === 'saturation') { if (/goldlion|telefunken|exciter/.test(mode)) return GRADES.gold; if (/tube|mullard|bugleboy|rcablack/.test(mode)) return GRADES.tube; return GRADES.ember; }
  if (module.id === 'chorus') return GRADES.drift; if (module.id === 'delay') return GRADES.halo; if (module.id === 'reverb') return GRADES.atmos; if (module.id === 'bitcrusher') return GRADES.grain; if (module.id === 'media') return GRADES.artifact; return GRADES.neutral;
}
function syncVideo(video: HTMLVideoElement, phase: number) { if (!Number.isFinite(video.duration) || video.duration <= 0) return; const target = phase * video.duration; if (Math.abs(video.currentTime - target) > 0.22) video.currentTime = target; }

export function VideoLandscapeEngine({ modules, position, dragging, signalLab, onAvailabilityChange }: { modules: ModuleState[]; position: { x: number; y: number }; dragging: boolean; signalLab?: SignalLabState; onAvailabilityChange?: (available: boolean) => void; }) {
  const desiredWorld = useMemo(() => chooseWorld(modules), [modules]); const grade = useMemo(() => chooseGrade(modules), [modules]); const [worldA, setWorldA] = useState<VideoWorld>(desiredWorld); const [worldB, setWorldB] = useState<VideoWorld>(desiredWorld); const [frontIsA, setFrontIsA] = useState(true); const [ready, setReady] = useState(false); const aRef = useRef<HTMLVideoElement | null>(null); const bRef = useRef<HTMLVideoElement | null>(null); const phaseRef = useRef(0);
  const currentWorld = frontIsA ? worldA : worldB;
  useEffect(() => { onAvailabilityChange?.(ready); }, [ready, onAvailabilityChange]);
  useEffect(() => {
    if (desiredWorld === currentWorld) return; const incoming = frontIsA ? bRef.current : aRef.current; const outgoing = frontIsA ? aRef.current : bRef.current; if (!incoming || !outgoing) return;
    if (frontIsA) setWorldB(desiredWorld); else setWorldA(desiredWorld);
    const apply = () => { const duration = outgoing.duration; phaseRef.current = Number.isFinite(duration) && duration > 0 ? (outgoing.currentTime / duration) % 1 : phaseRef.current; syncVideo(incoming, phaseRef.current); void incoming.play().catch(() => undefined); requestAnimationFrame(() => setFrontIsA((value) => !value)); };
    if (incoming.readyState >= 2) apply(); else incoming.addEventListener('loadeddata', apply, { once: true });
  }, [desiredWorld, currentWorld, frontIsA]);
  useEffect(() => { for (const video of [aRef.current, bRef.current].filter(Boolean) as HTMLVideoElement[]) { video.playbackRate = dragging ? 0.34 : 0.18; void video.play().catch(() => undefined); } }, [dragging, worldA, worldB]);
  const x = position.x / 100; const y = position.y / 100; const signalDepth = signalLab?.enabled ? 0.004 + signalLab.mix * 0.008 : 0;
  const style = { '--video-pan-x': `${(x - 0.5) * 1.4}%`, '--video-pan-y': `${(0.5 - y) * 0.8}%`, '--video-scale': 1.025 + Math.abs(y - 0.5) * 0.018, '--grade-hue': `${grade.hue}deg`, '--grade-sat': grade.saturation, '--grade-tint': grade.tint, '--grade-tint-opacity': grade.tintOpacity + signalDepth } as CSSProperties;
  return <div className="xy-video-world" style={style} aria-hidden="true"><video ref={aRef} className={`xy-world-video ${frontIsA ? 'is-front' : 'is-back'}`} src={WORLD_VIDEO[worldA]} muted loop playsInline preload="auto" onLoadedData={() => setReady(true)} onError={() => setReady(false)} /><video ref={bRef} className={`xy-world-video ${frontIsA ? 'is-back' : 'is-front'}`} src={WORLD_VIDEO[worldB]} muted loop playsInline preload="auto" onLoadedData={() => setReady(true)} /><div className="xy-world-grade" /><div className="xy-world-vignette" /></div>;
}