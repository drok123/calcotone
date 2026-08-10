import { loopTrackProgress } from './components/signal/loopStore';
import './loopSurfaceV3.css';

let refreshFrame = 0;
let animationFrame = 0;
let cachedPads: HTMLButtonElement[] = [];
let lastHeaderRefresh = Number.NEGATIVE_INFINITY;

function loopModule(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.module-pressure');
}

function loopPads(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.module-pressure .loop-track-pad'));
}

function makeButton(className: string, text: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `loop-header-action ${className}`;
  button.textContent = text;
  button.setAttribute('aria-label', ariaLabel);
  return button;
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
  bank.setAttribute('aria-label', 'Loop transport and edit actions');

  const all = makeButton('loop-all-toggle loop-header-all', 'ALL', 'Play or stop all Loop tracks');
  const undo = makeButton('loop-505-action loop-505-undo', 'UNDO', 'Undo selected Loop track overdub');
  undo.dataset.loop505Action = 'undo';
  const redo = makeButton('loop-505-action loop-505-redo', 'REDO', 'Redo selected Loop track overdub');
  redo.dataset.loop505Action = 'redo';
  const rec = makeButton('loop-header-track-action', 'REC', 'Record selected Loop track');
  const bounce = makeButton('loop-505-action loop-505-bounce', 'BNC', 'Bounce active Loop mix to an empty track');
  bounce.dataset.loop505Action = 'bounce';

  bank.append(all, undo, redo, rec, bounce);
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

function animateRings(stamp: number): void {
  if (stamp - lastHeaderRefresh > 180) {
    lastHeaderRefresh = stamp;
    refreshHeader();
  }

  if (cachedPads.length === 0) cachedPads = loopPads();
  for (const [track, pad] of cachedPads.entries()) {
    const active = pad.classList.contains('is-playing')
      || pad.classList.contains('is-recording')
      || pad.classList.contains('is-overdubbing');
    const progress = active ? loopTrackProgress(track, stamp) : 0;
    pad.style.setProperty('--loop-phase-angle', `${(progress * 360).toFixed(3)}deg`);
    pad.classList.toggle('is-loop-boundary', active && (progress <= 0.025 || progress >= 0.995));
  }
  animationFrame = window.requestAnimationFrame(animateRings);
}

document.addEventListener('click', handleClick, true);

const observer = new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.type === 'childList' || mutation.type === 'characterData')) scheduleRefresh();
});
if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true });

scheduleRefresh();
animationFrame = window.requestAnimationFrame(animateRings);

function uninstall(): void {
  document.removeEventListener('click', handleClick, true);
  observer.disconnect();
  if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  refreshFrame = 0;
  animationFrame = 0;
  cachedPads = [];
}

if (import.meta.hot) import.meta.hot.dispose(uninstall);
