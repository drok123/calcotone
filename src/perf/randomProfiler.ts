import { AudioEngine } from '../audio/AudioEngine';
import { AudioGraph } from '../audio/AudioGraph';

export type RandomProfileKind = 'musical' | 'signal';

interface ModuleTiming {
  modeMs: number;
  parameterMs: number;
  bypassMs: number;
  writes: number;
}

export interface RandomProfileSnapshot {
  kind: RandomProfileKind;
  totalMs: number;
  mutationWallMs: number;
  uiPlanMs: number;
  dspWriteMs: number;
  modeWriteMs: number;
  parameterWriteMs: number;
  bypassMs: number;
  routeCpuMs: number;
  routeTotalMs: number;
  maxFrameGapMs: number;
  writeCount: number;
  hottestLabel: string;
  hottestMs: number;
  modules: Array<{ id: string; totalMs: number; modeMs: number; parameterMs: number; bypassMs: number; writes: number }>;
}

interface ActiveProfile {
  kind: RandomProfileKind;
  startedAt: number;
  mutationWallMs: number;
  dspWriteMs: number;
  modeWriteMs: number;
  parameterWriteMs: number;
  bypassMs: number;
  routeCpuMs: number;
  routeTotalMs: number;
  maxFrameGapMs: number;
  lastFrameAt: number;
  writeCount: number;
  hottestLabel: string;
  hottestMs: number;
  modules: Map<string, ModuleTiming>;
  rafId: number | null;
}

let active: ActiveProfile | null = null;
let lastSnapshot: RandomProfileSnapshot | null = null;
let hud: HTMLDivElement | null = null;
let hudStyleInstalled = false;

const MODULE_NAMES: Record<string, string> = {
  saturation: 'Ember',
  chorus: 'Drift',
  delay: 'Halo',
  reverb: 'Atmos',
  bitcrusher: 'Grain',
  media: 'Artifact',
};

function now(): number {
  return performance.now();
}

function ensureHud(): HTMLDivElement {
  if (!hudStyleInstalled) {
    const style = document.createElement('style');
    style.textContent = `
      .calcotone-random-profiler {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        width: 286px;
        padding: 11px 12px 10px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 8px;
        background: rgba(5,8,12,.94);
        box-shadow: 0 14px 38px rgba(0,0,0,.52), inset 0 1px rgba(255,255,255,.035);
        color: rgba(238,244,247,.88);
        font: 600 10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        letter-spacing: .045em;
        pointer-events: none;
        backdrop-filter: blur(12px);
      }
      .calcotone-random-profiler strong { color: #fff; letter-spacing: .12em; }
      .calcotone-random-profiler .rp-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
      .calcotone-random-profiler .rp-kind { color: #d9b765; }
      .calcotone-random-profiler .rp-grid { display:grid; grid-template-columns: 1fr auto; gap:3px 12px; }
      .calcotone-random-profiler .rp-grid span:nth-child(odd) { color: rgba(210,221,226,.48); }
      .calcotone-random-profiler .rp-grid b { color: rgba(245,249,250,.88); font-weight:700; font-variant-numeric:tabular-nums; }
      .calcotone-random-profiler .rp-modules { margin-top:8px; padding-top:7px; border-top:1px solid rgba(255,255,255,.07); color:rgba(216,225,229,.56); }
      .calcotone-random-profiler .rp-hot { color:#ffd582; }
      .calcotone-random-profiler .rp-good { color:#8fe0b1 !important; }
      .calcotone-random-profiler .rp-warn { color:#ffd582 !important; }
      .calcotone-random-profiler .rp-bad { color:#ff967f !important; }
    `;
    document.head.append(style);
    hudStyleInstalled = true;
  }

  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'calcotone-random-profiler';
    hud.setAttribute('role', 'status');
    hud.setAttribute('aria-live', 'polite');
    document.body.append(hud);
  }
  return hud;
}

function metricClass(frameGapMs: number): string {
  if (frameGapMs >= 40) return 'rp-bad';
  if (frameGapMs >= 24) return 'rp-warn';
  return 'rp-good';
}

function renderMeasuring(kind: RandomProfileKind): void {
  const node = ensureHud();
  node.innerHTML = `<div class="rp-head"><strong>RANDOM PERF</strong><span class="rp-kind">${kind === 'signal' ? 'SIGNAL' : 'MUSICAL'} · MEASURING</span></div><div class="rp-grid"><span>STATUS</span><b>CAPTURING FRAME + DSP COST</b></div>`;
}

function renderSnapshot(snapshot: RandomProfileSnapshot): void {
  const node = ensureHud();
  const topModules = snapshot.modules.slice(0, 3).map((module) => `${MODULE_NAMES[module.id] ?? module.id} ${module.totalMs.toFixed(2)}ms`).join(' · ');
  const signalRows = snapshot.kind === 'signal'
    ? `<span>GRAPH CPU</span><b>${snapshot.routeCpuMs.toFixed(2)} ms</b><span>TRANSFER WALL</span><b>${snapshot.routeTotalMs.toFixed(1)} ms</b>`
    : `<span>MUTATION</span><b>${snapshot.mutationWallMs.toFixed(2)} ms</b><span>UI / PLAN</span><b>${snapshot.uiPlanMs.toFixed(2)} ms</b><span>DSP WRITES</span><b>${snapshot.dspWriteMs.toFixed(2)} ms</b><span>MODE WRITES</span><b>${snapshot.modeWriteMs.toFixed(2)} ms</b><span>PARAM WRITES</span><b>${snapshot.parameterWriteMs.toFixed(2)} ms</b><span>BYPASS XFADE CPU</span><b>${snapshot.bypassMs.toFixed(2)} ms</b>`;
  const hot = snapshot.hottestLabel ? `${snapshot.hottestLabel} · ${snapshot.hottestMs.toFixed(2)} ms` : '—';
  node.innerHTML = `
    <div class="rp-head"><strong>RANDOM PERF</strong><span class="rp-kind">${snapshot.kind === 'signal' ? 'SIGNAL' : 'MUSICAL'}</span></div>
    <div class="rp-grid">
      <span>TOTAL WINDOW</span><b>${snapshot.totalMs.toFixed(1)} ms</b>
      ${signalRows}
      <span>FRAME GAP</span><b class="${metricClass(snapshot.maxFrameGapMs)}">${snapshot.maxFrameGapMs.toFixed(1)} ms</b>
      <span>WRITES</span><b>${snapshot.writeCount}</b>
      <span>HOTTEST</span><b class="rp-hot">${hot}</b>
    </div>
    ${topModules ? `<div class="rp-modules">${topModules}</div>` : ''}
  `;
}

function trackFrames(profile: ActiveProfile): void {
  profile.rafId = window.requestAnimationFrame((stamp) => {
    if (active !== profile) return;
    const gap = Math.max(0, stamp - profile.lastFrameAt);
    profile.maxFrameGapMs = Math.max(profile.maxFrameGapMs, gap);
    profile.lastFrameAt = stamp;
    trackFrames(profile);
  });
}

function moduleTiming(profile: ActiveProfile, id: string): ModuleTiming {
  const current = profile.modules.get(id);
  if (current) return current;
  const created: ModuleTiming = { modeMs: 0, parameterMs: 0, bypassMs: 0, writes: 0 };
  profile.modules.set(id, created);
  return created;
}

function recordHottest(profile: ActiveProfile, label: string, elapsedMs: number): void {
  if (elapsedMs <= profile.hottestMs) return;
  profile.hottestMs = elapsedMs;
  profile.hottestLabel = label;
}

export function beginRandomProfile(kind: RandomProfileKind): void {
  if (active?.rafId !== null && active?.rafId !== undefined) window.cancelAnimationFrame(active.rafId);
  const startedAt = now();
  active = {
    kind,
    startedAt,
    mutationWallMs: 0,
    dspWriteMs: 0,
    modeWriteMs: 0,
    parameterWriteMs: 0,
    bypassMs: 0,
    routeCpuMs: 0,
    routeTotalMs: 0,
    maxFrameGapMs: 0,
    lastFrameAt: startedAt,
    writeCount: 0,
    hottestLabel: '',
    hottestMs: 0,
    modules: new Map(),
    rafId: null,
  };
  renderMeasuring(kind);
  trackFrames(active);
}

export function noteRandomMutationWall(elapsedMs: number): void {
  if (active?.kind === 'musical') active.mutationWallMs = Math.max(active.mutationWallMs, elapsedMs);
}

export function abortRandomProfile(): void {
  if (active?.rafId !== null && active?.rafId !== undefined) window.cancelAnimationFrame(active.rafId);
  active = null;
}

function finalize(profile: ActiveProfile): RandomProfileSnapshot {
  if (profile.rafId !== null) window.cancelAnimationFrame(profile.rafId);
  const modules = [...profile.modules.entries()]
    .map(([id, timing]) => ({
      id,
      totalMs: timing.modeMs + timing.parameterMs + timing.bypassMs,
      ...timing,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
  const snapshot: RandomProfileSnapshot = {
    kind: profile.kind,
    totalMs: now() - profile.startedAt,
    mutationWallMs: profile.mutationWallMs,
    uiPlanMs: Math.max(0, profile.mutationWallMs - profile.dspWriteMs),
    dspWriteMs: profile.dspWriteMs,
    modeWriteMs: profile.modeWriteMs,
    parameterWriteMs: profile.parameterWriteMs,
    bypassMs: profile.bypassMs,
    routeCpuMs: profile.routeCpuMs,
    routeTotalMs: profile.routeTotalMs,
    maxFrameGapMs: profile.maxFrameGapMs,
    writeCount: profile.writeCount,
    hottestLabel: profile.hottestLabel,
    hottestMs: profile.hottestMs,
    modules,
  };
  lastSnapshot = snapshot;
  active = null;
  renderSnapshot(snapshot);
  console.groupCollapsed(`[CALCOTONE] ${snapshot.kind.toUpperCase()} random profile · frame ${snapshot.maxFrameGapMs.toFixed(1)} ms`);
  console.table(snapshot.modules);
  console.log(snapshot);
  console.groupEnd();
  return snapshot;
}

export function finishMusicalRandomProfile(): void {
  const profile = active;
  if (!profile || profile.kind !== 'musical') return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (active === profile) finalize(profile);
    });
  });
}

export function getLastRandomProfile(): RandomProfileSnapshot | null {
  return lastSnapshot;
}

interface ProfilerPatchGlobal extends Window {
  __calcotoneRandomProfilerPatched?: boolean;
}

const patchGlobal = window as ProfilerPatchGlobal;
if (!patchGlobal.__calcotoneRandomProfilerPatched) {
  patchGlobal.__calcotoneRandomProfilerPatched = true;

  const originalSetEffectParameter = AudioEngine.prototype.setEffectParameter;
  AudioEngine.prototype.setEffectParameter = function (
    this: AudioEngine,
    effectId: string,
    parameterId: string,
    value: number,
  ): void {
    const started = now();
    try {
      return originalSetEffectParameter.call(this, effectId, parameterId, value);
    } finally {
      const profile = active;
      if (!profile || profile.kind !== 'musical') return;
      const elapsed = now() - started;
      const isModeWrite = parameterId === 'mode' || parameterId === 'algorithm';
      const timing = moduleTiming(profile, effectId);
      if (isModeWrite) {
        timing.modeMs += elapsed;
        profile.modeWriteMs += elapsed;
      } else {
        timing.parameterMs += elapsed;
        profile.parameterWriteMs += elapsed;
      }
      timing.writes += 1;
      profile.dspWriteMs += elapsed;
      profile.writeCount += 1;
      recordHottest(profile, `${MODULE_NAMES[effectId] ?? effectId}.${parameterId}`, elapsed);
    }
  };

  const originalSetEffectBypassed = AudioEngine.prototype.setEffectBypassed;
  AudioEngine.prototype.setEffectBypassed = function (this: AudioEngine, effectId: string, bypassed: boolean): void {
    const started = now();
    try {
      return originalSetEffectBypassed.call(this, effectId, bypassed);
    } finally {
      const profile = active;
      if (!profile || profile.kind !== 'musical') return;
      const elapsed = now() - started;
      const timing = moduleTiming(profile, effectId);
      timing.bypassMs += elapsed;
      profile.bypassMs += elapsed;
      recordHottest(profile, `${MODULE_NAMES[effectId] ?? effectId}.bypass`, elapsed);
    }
  };

  const originalGraphReorder = AudioGraph.prototype.reorderEffects;
  AudioGraph.prototype.reorderEffects = function (this: AudioGraph, effectIds: string[]): void {
    const started = now();
    try {
      return originalGraphReorder.call(this, effectIds);
    } finally {
      const profile = active;
      if (!profile || profile.kind !== 'signal') return;
      const elapsed = now() - started;
      profile.routeCpuMs += elapsed;
      profile.writeCount += 1;
      recordHottest(profile, 'AudioGraph.reorderEffects', elapsed);
    }
  };

  const originalClickSafeReorder = AudioEngine.prototype.reorderEffectsClickSafe;
  AudioEngine.prototype.reorderEffectsClickSafe = function (this: AudioEngine, effectIds: string[]): Promise<void> {
    const profile = active;
    const started = now();
    const result = originalClickSafeReorder.call(this, effectIds);
    if (!profile || profile.kind !== 'signal') return result;
    return result.finally(() => {
      if (active !== profile) return;
      profile.routeTotalMs += now() - started;
      window.requestAnimationFrame(() => {
        if (active === profile) finalize(profile);
      });
    });
  };
}
