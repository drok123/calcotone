import {
  getLoopState,
  loopTrackProgress,
  setLoopState,
} from './components/signal/loopStore';
import './loopSurfaceV3.css';

const NATIVE_HEALTH_URL = 'http://127.0.0.1:48157/health';
// App owns native Loop runtime telemetry. This slow poll exists only to learn the
// listener-facing output-path delay used by the phase ring; it never writes Loop state.
const NATIVE_LATENCY_POLL_MS = 1_000;

let refreshFrame = 0;
let animationFrame = 0;
let nativeLatencyTimer = 0;
let nativeLatencyPending = false;
let nativePathLatencyMs = 0;
let cachedPads: HTMLButtonElement[] = [];
let lastHeaderRefresh = Number.NEGATIVE_INFINITY;

function loopModule(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.module-pressure');
}

function loopPads(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.module-pressure .loop-track-pad'));
}

function nativeShellActive(): boolean {
  return window.location.hostname === '127.0.0.1' && window.location.port === '48157';
}

function makeButton(className: string, text: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `loop-header-action ${className}`;
  button.textContent = text;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

function makeParameterControl(
  className: string,
  labelText: string,
  parameter: 'masterLevel' | 'overdub',
  ariaLabel: string,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = `loop-header-param ${className}`;
  label.setAttribute('aria-label', ariaLabel);

  const caption = document.createElement('span');
  caption.className = 'loop-header-param-label';
  caption.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.dataset.loopParameter = parameter;
  input.setAttribute('aria-label', ariaLabel);

  const value = document.createElement('span');
  value.className = 'loop-header-param-value';
  value.setAttribute('aria-hidden', 'true');

  label.append(caption, input, value);
  return label;
}

function ensureHeaderActions(): HTMLElement | null {
  const module = loopModule();
  const title = module?.querySelector<HTMLElement>('.module-title');
  if (!module || !title) return null;
  const existing = title.querySelector<HTMLElement>('.loop-header-action-bank');
  if (existing) return existing;

  const bank = document.createElement('div');
  bank.className = 'loop-header-action-bank';
  bank.setAttribute('role', 'group');
  bank.setAttribute('aria-label', 'Loop transport, edit, master and retain controls');

  const all = makeButton('loop-all-toggle loop-header-all', 'ALL', 'Play or stop all Loop tracks');
  const undo = makeButton('loop-505-action loop-505-undo', 'UNDO', 'Undo selected Loop track overdub');
  undo.dataset.loop505Action = 'undo';
  const redo = makeButton('loop-505-action loop-505-redo', 'REDO', 'Redo selected Loop track overdub');
  redo.dataset.loop505Action = 'redo';
  const rec = makeButton('loop-header-track-action', 'REC', 'Record selected Loop track');
  const bounce = makeButton('loop-505-action loop-505-bounce', 'BNC', 'Bounce active Loop mix to an empty track');
  bounce.dataset.loop505Action = 'bounce';
  const master = makeParameterControl('loop-header-master', 'MSTR', 'masterLevel', 'Loop master level');
  const retain = makeParameterControl('loop-header-retain', 'RET', 'overdub', 'Loop overdub retain amount');

  bank.append(all, undo, redo, rec, bounce, master, retain);
  const heading = title.querySelector('h3');
  if (heading?.nextSibling) title.insertBefore(bank, heading.nextSibling);
  else title.append(bank);
  return bank;
}

function mirrorButtonState(target: HTMLButtonElement | null, source: HTMLButtonElement | null): void {
  if (!target || !source) return;
  target.disabled = source.disabled;
  target.title = source.title;
}

function refreshParameter(
  bank: HTMLElement,
  parameter: 'masterLevel' | 'overdub',
  value: number,
): void {
  const input = bank.querySelector<HTMLInputElement>(`input[data-loop-parameter="${parameter}"]`);
  if (input && document.activeElement !== input) input.value = value.toFixed(2);
  const readout = input?.parentElement?.querySelector<HTMLElement>('.loop-header-param-value');
  if (readout) readout.textContent = `${Math.round(value * 100)}`;
}

function refreshHeader(): void {
  const module = loopModule();
  const bank = ensureHeaderActions();
  if (!module || !bank) return;

  const headerAll = bank.querySelector<HTMLButtonElement>('.loop-header-all');
  const hiddenAll = module.querySelector<HTMLButtonElement>('.loop-utility-bank .loop-all-toggle');
  mirrorButtonState(headerAll, hiddenAll);

  for (const action of ['undo', 'redo', 'bounce'] as const) {
    const header = bank.querySelector<HTMLButtonElement>(`.loop-505-${action}`);
    const hidden = module.querySelector<HTMLButtonElement>(`.loop-utility-bank .loop-505-${action}`);
    mirrorButtonState(header, hidden);
  }

  const selected = module.querySelector<HTMLButtonElement>('.loop-track-pad.is-selected-track')
    ?? module.querySelector<HTMLButtonElement>('.loop-track-pad');
  const trackAction = bank.querySelector<HTMLButtonElement>('.loop-header-track-action');
  if (trackAction && selected) {
    trackAction.disabled = selected.disabled;
    if (selected.classList.contains('is-recording') || selected.classList.contains('is-overdubbing')) {
      trackAction.textContent = 'END';
      trackAction.title = 'Finish the selected Loop write pass';
    } else if (selected.classList.contains('is-empty')) {
      trackAction.textContent = 'REC';
      trackAction.title = 'Record the selected Loop track';
    } else if (selected.classList.contains('is-track-stopped') || selected.classList.contains('is-stopped')) {
      trackAction.textContent = 'PLAY';
      trackAction.title = 'Start the selected Loop track from its beginning';
    } else {
      trackAction.textContent = 'DUB';
      trackAction.title = 'Overdub the selected Loop track';
    }
    trackAction.setAttribute('aria-label', trackAction.title);
  }

  // Header refresh is low frequency; the defensive snapshot is appropriate here.
  // The per-frame phase path below never calls getLoopState().
  const state = getLoopState();
  refreshParameter(bank, 'masterLevel', state.masterLevel);
  refreshParameter(bank, 'overdub', state.overdub);
  cachedPads = loopPads();
}

function scheduleRefresh(): void {
  if (refreshFrame) return;
  refreshFrame = window.requestAnimationFrame(() => {
    refreshFrame = 0;
    refreshHeader();
  });
}

function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest<HTMLButtonElement>('.module-pressure .loop-header-track-action');
  if (!action || action.disabled) return;
  const module = action.closest<HTMLElement>('.module-pressure');
  const selected = module?.querySelector<HTMLButtonElement>('.loop-track-pad.is-selected-track')
    ?? module?.querySelector<HTMLButtonElement>('.loop-track-pad');
  if (!selected || selected.disabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  selected.click();
  scheduleRefresh();
}

function handleInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const parameter = target.dataset.loopParameter;
  if (parameter !== 'masterLevel' && parameter !== 'overdub') return;
  const value = Math.max(0, Math.min(1, Number(target.value) || 0));
  setLoopState(parameter === 'masterLevel' ? { masterLevel: value } : { overdub: value });
  const readout = target.parentElement?.querySelector<HTMLElement>('.loop-header-param-value');
  if (readout) readout.textContent = `${Math.round(value * 100)}`;
}

function presentationProgress(track: number, stamp: number): number {
  // loopTrackProgress reads the store's internal runtime directly and allocates
  // nothing. Passing listener time minus the measured output path aligns the
  // visual restart to the sample that is reaching the speakers now.
  return loopTrackProgress(track, stamp - nativePathLatencyMs);
}

function animateRings(stamp: number): void {
  if (stamp - lastHeaderRefresh > 120) {
    lastHeaderRefresh = stamp;
    refreshHeader();
  }

  if (cachedPads.length === 0) cachedPads = loopPads();
  for (const [track, pad] of cachedPads.entries()) {
    const active = pad.classList.contains('is-playing')
      || pad.classList.contains('is-recording')
      || pad.classList.contains('is-overdubbing');
    const progress = active ? presentationProgress(track, stamp) : 0;
    pad.style.setProperty('--loop-phase-angle', `${(progress * 360).toFixed(3)}deg`);
    pad.classList.toggle('is-loop-boundary', active && (progress <= 0.025 || progress >= 0.995));
  }
  animationFrame = window.requestAnimationFrame(animateRings);
}

type NativeLatencyHealth = {
  engine?: string;
  estimatedPathMs?: number;
};

async function pollNativePathLatency(): Promise<void> {
  if (!nativeShellActive() || nativeLatencyPending || document.hidden) return;
  nativeLatencyPending = true;
  try {
    const response = await fetch(NATIVE_HEALTH_URL, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return;
    const health = await response.json() as NativeLatencyHealth;
    if (health.engine !== 'calcotone-native') return;
    nativePathLatencyMs = Math.max(0, Math.min(250, Number(health.estimatedPathMs) || 0));
  } catch {
    // Native bridge may be restarting. Retain the last stable path estimate.
  } finally {
    nativeLatencyPending = false;
  }
}

document.addEventListener('click', handleClick, true);
document.addEventListener('input', handleInput, true);

const observer = new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.type === 'childList' || mutation.type === 'characterData')) scheduleRefresh();
});
if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true });

scheduleRefresh();
animationFrame = window.requestAnimationFrame(animateRings);
if (nativeShellActive()) {
  void pollNativePathLatency();
  nativeLatencyTimer = window.setInterval(() => { void pollNativePathLatency(); }, NATIVE_LATENCY_POLL_MS);
}

function uninstall(): void {
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  observer.disconnect();
  if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  if (nativeLatencyTimer) window.clearInterval(nativeLatencyTimer);
  refreshFrame = 0;
  animationFrame = 0;
  nativeLatencyTimer = 0;
  nativeLatencyPending = false;
  nativePathLatencyMs = 0;
  cachedPads = [];
}

if (import.meta.hot) import.meta.hot.dispose(uninstall);
