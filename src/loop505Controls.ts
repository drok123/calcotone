import { isNativeBackendEngaged } from './audio/NativeAudioBridge';
import {
  LOOP_VISIBLE_TRACK_COUNT,
  getLoopState,
  LOOP_CHANGE_EVENT,
  LOOP_PERFORMANCE_COMMAND_EVENT,
  cycleLoopQuantize,
  sendLoopCommand,
  setLoopBpm,
  setLoopRuntime,
  setLoopState,
  toggleLoopTrackMute,
  toggleLoopTrackPlayback,
  toggleLoopTrackSolo,
  type LoopPerformanceCommand,
  type LoopPerformanceCommandName,
  type LoopUtilityCommand,
} from './components/signal/loopStore';
import './loop505Controls.css';

const NATIVE_COMMAND_URL = 'http://127.0.0.1:48157/command';
const NATIVE_SENTINELS: Record<LoopPerformanceCommandName, number> = {
  trackPlay: 2,
  trackStop: 3,
  mute: 4,
  solo: 5,
};
const NATIVE_UTILITY_SENTINELS: Record<LoopUtilityCommand, number> = {
  undo: 6,
  redo: 7,
  bounce: 8,
};
const QUANTIZE_CODES = { off: 0, beat: 1, bar: 2 } as const;
let nativeQueue: Promise<void> = Promise.resolve();
let nativeClockSignature = '';
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
    refreshFaceplate();
  });
}

function queueNativeLine(line: string): void {
  nativeQueue = nativeQueue.then(async () => {
    try {
      await fetch(NATIVE_COMMAND_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' },
        body: line,
      });
    } catch {
      // Native health/reconnect owns reporting when the desktop host disappears.
    }
  });
}

function sendNativeControl(track: number, value: number): void {
  queueNativeLine(`loopTrackLevel ${track} ${value}`);
}

function syncNativeClock(): void {
  if (!isNativeBackendEngaged()) {
    nativeClockSignature = '';
    return;
  }
  const state = getLoopState();
  const signature = `${state.bpm}:${state.quantize}`;
  if (signature === nativeClockSignature) return;
  nativeClockSignature = signature;
  // Track 8 is reserved on the four-strip faceplate. Values >=1000 are private
  // native Loop control frames and never touch its physical fader level.
  sendNativeControl(LOOP_VISIBLE_TRACK_COUNT + 3, 1000 + state.bpm);
  sendNativeControl(LOOP_VISIBLE_TRACK_COUNT + 3, 2000 + QUANTIZE_CODES[state.quantize]);
}

function ensureTools(): HTMLDivElement | null {
  const bank = document.querySelector<HTMLElement>('.module-pressure .loop-utility-bank');
  if (!bank) return null;
  const existing = bank.querySelector<HTMLDivElement>('.loop-505-tools');
  if (existing) return existing;
  const tools = document.createElement('div');
  tools.className = 'loop-505-tools';
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-label', 'Loop 505 edit and bounce tools');
  for (const [action, label] of [['undo', 'UNDO'], ['redo', 'REDO'], ['bounce', 'BNC']] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `loop-utility-button loop-505-action loop-505-${action}`;
    button.dataset.loop505Action = action;
    button.textContent = label;
    tools.append(button);
  }
  bank.append(tools);
  return tools;
}

function refreshClock(): void {
  const state = getLoopState();
  const clock = document.querySelector<HTMLElement>('.module-pressure .loop-track-bank');
  if (!clock) return;
  clock.classList.add('loop-clock-bank');
  const quantizeLabel = state.quantize === 'off' ? 'OFF' : state.quantize === 'beat' ? 'BEAT' : 'BAR';
  const text = `T${state.selectedTrack + 1} · ${state.bpm} · ${quantizeLabel}`;
  if (clock.textContent !== text) clock.textContent = text;
  clock.setAttribute('role', 'button');
  clock.setAttribute('tabindex', '0');
  clock.setAttribute('aria-label', `Loop clock ${state.bpm} BPM, quantize ${quantizeLabel}. Scroll to change BPM, click to cycle quantize.`);
  clock.title = 'Wheel: BPM · Click: quantize OFF / BEAT / BAR · Shift-wheel: ±5 BPM';
}

function refreshTools(): void {
  const tools = ensureTools();
  if (!tools) return;
  const state = getLoopState();
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  const selectedFilled = (state.trackMask & (1 << state.selectedTrack)) !== 0;
  const activeSources = (state.trackActiveMask & state.trackMask) !== 0;
  let emptyVisible = false;
  for (let track = 0; track < LOOP_VISIBLE_TRACK_COUNT; track += 1) {
    if ((state.trackMask & (1 << track)) === 0) { emptyVisible = true; break; }
  }
  for (const button of tools.querySelectorAll<HTMLButtonElement>('.loop-505-action')) {
    const action = button.dataset.loop505Action as LoopUtilityCommand | undefined;
    if (action === 'bounce') {
      button.disabled = writing || !activeSources || !emptyVisible;
      button.title = emptyVisible ? 'Bounce the audible active loop mix into the first empty track' : 'Clear a visible track before bouncing';
    } else {
      button.disabled = writing || !selectedFilled;
      button.title = action === 'undo'
        ? 'Undo the selected track’s latest overdub session'
        : 'Redo the selected track after undo';
    }
  }
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

function refreshFaceplate(): void {
  refreshPads();
  refreshClock();
  refreshTools();
  syncNativeClock();
}

function issueUtility(action: LoopUtilityCommand): void {
  const state = getLoopState();
  const writing = state.transport === 'recording' || state.transport === 'overdubbing';
  if (writing) return;

  if (action === 'bounce') {
    let destination = -1;
    for (let track = 0; track < LOOP_VISIBLE_TRACK_COUNT; track += 1) {
      if ((state.trackMask & (1 << track)) === 0) { destination = track; break; }
    }
    if (destination < 0 || (state.trackActiveMask & state.trackMask) === 0) return;
    setLoopState({ selectedTrack: destination });
    if (isNativeBackendEngaged()) sendNativeControl(destination, NATIVE_UTILITY_SENTINELS.bounce);
    else sendLoopCommand('bounce');
    scheduleRefresh();
    return;
  }

  if ((state.trackMask & (1 << state.selectedTrack)) === 0) return;
  if (isNativeBackendEngaged()) sendNativeControl(state.selectedTrack, NATIVE_UTILITY_SENTINELS[action]);
  else sendLoopCommand(action);
  scheduleRefresh();
}

function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element) {
    const clock = target.closest<HTMLElement>('.module-pressure .loop-track-bank');
    if (clock && !clock.closest('.faceplate-layout-editing') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cycleLoopQuantize();
      scheduleRefresh();
      return;
    }

    const tool = target.closest<HTMLButtonElement>('.module-pressure .loop-505-action');
    if (tool && !tool.closest('.faceplate-layout-editing')) {
      const action = tool.dataset.loop505Action as LoopUtilityCommand | undefined;
      if (action) {
        event.preventDefault();
        event.stopImmediatePropagation();
        issueUtility(action);
      }
      return;
    }

    const allToggle = target.closest<HTMLButtonElement>('.module-pressure .loop-all-toggle');
    if (allToggle && !allToggle.closest('.faceplate-layout-editing') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const before = getLoopState();
      const writing = before.transport === 'recording' || before.transport === 'overdubbing';
      if (writing || before.trackMask === 0) return;
      const stopAll = (before.trackActiveMask & before.trackMask) !== 0;
      event.preventDefault();
      event.stopImmediatePropagation();
      sendLoopCommand('play');
      // Quantized engines will commit at the next boundary. Keep optimistic state
      // conservative in quantized modes so the display does not claim an early stop.
      if (before.quantize === 'off') {
        setLoopRuntime({
          trackActiveMask: stopAll ? 0 : before.trackMask,
          transport: stopAll ? 'stopped' : 'playing',
          position: 0,
        });
      }
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

function handleWheel(event: WheelEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const clock = target.closest<HTMLElement>('.module-pressure .loop-track-bank');
  if (!clock || clock.closest('.faceplate-layout-editing')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const state = getLoopState();
  const direction = event.deltaY < 0 ? 1 : -1;
  setLoopBpm(state.bpm + direction * (event.shiftKey ? 5 : 1));
  scheduleRefresh();
}

function handleKeyDown(event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const clock = target.closest<HTMLElement>('.module-pressure .loop-track-bank');
  if (!clock || clock.closest('.faceplate-layout-editing')) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    cycleLoopQuantize();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
    event.preventDefault();
    setLoopBpm(getLoopState().bpm + (event.shiftKey ? 5 : 1));
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
    event.preventDefault();
    setLoopBpm(getLoopState().bpm - (event.shiftKey ? 5 : 1));
  } else return;
  scheduleRefresh();
}

function sendNativePerformance(detail: LoopPerformanceCommand): void {
  if (!isNativeBackendEngaged()) return;
  const sentinel = NATIVE_SENTINELS[detail.command];
  if (!Number.isFinite(sentinel)) return;
  sendNativeControl(detail.track, sentinel);
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
document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
document.addEventListener('keydown', handleKeyDown, true);
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
  document.removeEventListener('wheel', handleWheel, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  window.removeEventListener(LOOP_PERFORMANCE_COMMAND_EVENT, handlePerformanceCommand);
  window.removeEventListener(LOOP_CHANGE_EVENT, handleLoopChange);
  observer.disconnect();
  if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
  refreshFrame = 0;
}

if (import.meta.hot) import.meta.hot.dispose(uninstall);
