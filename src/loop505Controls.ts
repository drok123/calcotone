import { isNativeBackendEngaged } from './audio/NativeAudioBridge';
import {
  getLoopState,
  LOOP_CHANGE_EVENT,
  LOOP_PERFORMANCE_COMMAND_EVENT,
  sendLoopCommand,
  setLoopRuntime,
  toggleLoopTrackMute,
  toggleLoopTrackPlayback,
  toggleLoopTrackSolo,
  type LoopPerformanceCommand,
  type LoopPerformanceCommandName,
} from './components/signal/loopStore';
import './loop505Controls.css';

const NATIVE_COMMAND_URL = 'http://127.0.0.1:48157/command';
const NATIVE_SENTINELS: Record<LoopPerformanceCommandName, number> = {
  trackPlay: 2,
  trackStop: 3,
  mute: 4,
  solo: 5,
};
let nativeQueue: Promise<void> = Promise.resolve();
let refreshFrame = 0;

function loopPads(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.module-pressure .loop-track-pad'));
}

function trackForPad(pad: HTMLButtonElement): number {
  return loopPads().indexOf(pad);
}

function padFromEvent(event: Event): HTMLButtonElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const pad = target.closest<HTMLButtonElement>('.module-pressure .loop-track-pad');
  if (!pad || pad.closest('.faceplate-layout-editing')) return null;
  return pad;
}

function scheduleRefresh(): void {
  if (refreshFrame) return;
  refreshFrame = window.requestAnimationFrame(() => {
    refreshFrame = 0;
    refreshPads();
  });
}

function refreshPads(): void {
  const state = getLoopState();
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  for (const [track, pad] of loopPads().entries()) {
    const bit = 1 << track;
    const occupied = (state.trackMask & bit) !== 0;
    const active = (state.trackActiveMask & bit) !== 0;
    const muted = (state.trackMuteMask & bit) !== 0;
    const soloed = (state.trackSoloMask & bit) !== 0;
    const selected = track === state.selectedTrack;
    const recording = selected && state.transport === 'recording';
    const overdubbing = selected && state.transport === 'overdubbing';
    const label = recording ? 'REC'
      : overdubbing ? 'DUB'
      : !occupied ? 'REC'
      : muted ? 'MUTE'
      : soloed ? 'SOLO'
      : active ? 'PLAY'
      : 'STOP';

    const text = `T${track + 1} ${label}`;
    if (pad.textContent !== text) pad.textContent = text;
    pad.classList.toggle('is-recording', recording);
    pad.classList.toggle('is-overdubbing', overdubbing);
    pad.classList.toggle('is-empty', !occupied);
    pad.classList.toggle('is-playing', occupied && active && !recording && !overdubbing);
    pad.classList.toggle('is-stopped', occupied && !active);
    pad.classList.toggle('is-track-stopped', occupied && !active);
    pad.classList.toggle('is-muted', muted);
    pad.classList.toggle('is-solo', soloed);
    pad.classList.toggle('is-selected-track', selected);
    pad.classList.toggle('active', recording || overdubbing || active);
    pad.setAttribute('aria-pressed', String(recording || overdubbing || active));
    pad.setAttribute(
      'aria-label',
      `${text}. Click record, play, or overdub. Right-click stop or restart. Control-click mute. Alt-click solo. Shift-click clear.`,
    );
    pad.title = writing && !selected
      ? 'Finish the active REC/DUB pass before changing tracks'
      : 'Click: REC / PLAY / DUB · Right-click: STOP / START · Ctrl-click: MUTE · Alt-click: SOLO · Shift-click: CLEAR';
  }
}

function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element) {
    const allToggle = target.closest<HTMLButtonElement>('.module-pressure .loop-all-toggle');
    if (allToggle && !allToggle.closest('.faceplate-layout-editing') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const before = getLoopState();
      const writing = before.transport === 'recording' || before.transport === 'overdubbing';
      if (writing || before.trackMask === 0) return;
      const stopAll = (before.trackActiveMask & before.trackMask) !== 0;
      event.preventDefault();
      event.stopImmediatePropagation();
      sendLoopCommand('play');
      // The legacy optimistic ALL state predates independent tracks. Correct it
      // immediately so restarting one track after ALL STOP cannot wake its siblings.
      setLoopRuntime({
        trackActiveMask: stopAll ? 0 : before.trackMask,
        transport: stopAll ? 'stopped' : 'playing',
        position: 0,
      });
      scheduleRefresh();
      return;
    }
  }

  const pad = padFromEvent(event);
  if (!pad || event.shiftKey) return;
  const track = trackForPad(pad);
  if (track < 0) return;

  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleLoopTrackMute(track);
    scheduleRefresh();
    return;
  }
  if (event.altKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleLoopTrackSolo(track);
    scheduleRefresh();
  }
}

function handleContextMenu(event: MouseEvent): void {
  const pad = padFromEvent(event);
  if (!pad) return;
  const track = trackForPad(pad);
  if (track < 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleLoopTrackPlayback(track);
  scheduleRefresh();
}

function sendNativePerformance(detail: LoopPerformanceCommand): void {
  if (!isNativeBackendEngaged()) return;
  const sentinel = NATIVE_SENTINELS[detail.command];
  if (!Number.isFinite(sentinel)) return;
  nativeQueue = nativeQueue.then(async () => {
    try {
      await fetch(NATIVE_COMMAND_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' },
        body: `loopTrackLevel ${detail.track} ${sentinel}`,
      });
    } catch {
      // The native host can disappear while the UI remains open; the ordinary
      // health/reconnect path owns reporting and recovery.
    }
  });
}

function handlePerformanceCommand(event: Event): void {
  const detail = (event as CustomEvent<LoopPerformanceCommand>).detail;
  if (!detail) return;
  sendNativePerformance(detail);
  scheduleRefresh();
}

function handleLoopChange(): void {
  scheduleRefresh();
}

document.addEventListener('click', handleClick, true);
document.addEventListener('contextmenu', handleContextMenu, true);
window.addEventListener(LOOP_PERFORMANCE_COMMAND_EVENT, handlePerformanceCommand);
window.addEventListener(LOOP_CHANGE_EVENT, handleLoopChange);

const observer = new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.type === 'childList' || mutation.type === 'characterData')) scheduleRefresh();
});
if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true });
scheduleRefresh();

function uninstall(): void {
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('contextmenu', handleContextMenu, true);
  window.removeEventListener(LOOP_PERFORMANCE_COMMAND_EVENT, handlePerformanceCommand);
  window.removeEventListener(LOOP_CHANGE_EVENT, handleLoopChange);
  observer.disconnect();
  if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
  refreshFrame = 0;
}

if (import.meta.hot) import.meta.hot.dispose(uninstall);
