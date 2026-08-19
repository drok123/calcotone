type TargetRandomKind = 'random' | 'mutate';

type ParameterRange = readonly [number, number];

const MODULE_IDS = ['saturation', 'chorus', 'delay', 'reverb', 'bitcrusher', 'media', 'stomp', 'chaos'] as const;
const NATIVE_HEALTH_URL = 'http://127.0.0.1:48157/health';
const RANDOM_MIME = 'application/x-calcotone-random';
const PEAK_HOLD_MS = 900;
const IS_NATIVE_SHELL = new URLSearchParams(window.location.search).has('native-shell');

const SAFE_RANGES: Record<string, ParameterRange> = {
  drive: [0.10, 0.68],
  tone: [0.18, 0.82],
  heat: [0.08, 0.66],
  character: [0.08, 0.72],
  dynamics: [0.18, 0.78],
  rate: [0.04, 0.42],
  depth: [0.10, 0.72],
  shape: [0.14, 0.84],
  spread: [0.30, 0.94],
  motion: [0.05, 0.58],
  time: [0.08, 0.72],
  feedback: [0.10, 0.58],
  color: [0.16, 0.84],
  width: [0.30, 0.92],
  decay: [0.18, 0.76],
  size: [0.28, 0.92],
  diffusion: [0.38, 0.94],
  bits: [0.36, 0.90],
  density: [0.18, 0.80],
  pitch: [0.00, 0.56],
  chaos: [0.02, 0.48],
  bloom: [0.12, 0.72],
  wear: [0.06, 0.58],
  wow: [0.04, 0.54],
  noise: [0.00, 0.24],
  sag: [0.08, 0.72],
  level: [0.34, 0.74],
  body: [0.18, 0.80],
  mix: [0.08, 0.46],
};

let draggingRandom: TargetRandomKind | null = null;
let peakHoldUntil = 0;
let heldOverSegments = 0;
let healthTimer: number | null = null;
let observer: MutationObserver | null = null;

function randomCentered(minimum: number, maximum: number): number {
  const centered = (Math.random() + Math.random()) * 0.5;
  return minimum + (maximum - minimum) * centered;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function moduleIdFromElement(module: HTMLElement): string | null {
  for (const id of MODULE_IDS) if (module.classList.contains(`module-${id}`)) return id;
  return null;
}

function parameterIdFromKnob(knob: HTMLElement): string | null {
  const target = knob.dataset.controlTarget;
  if (!target) return null;
  const separator = target.lastIndexOf('.');
  return separator >= 0 ? target.slice(separator + 1) : target;
}

function targetForParameter(parameterId: string, current: number, kind: TargetRandomKind): number {
  if (kind === 'mutate') return clamp01(current + (Math.random() * 2 - 1) * 0.10);
  const range = SAFE_RANGES[parameterId] ?? [0.12, 0.78];
  return clamp01(randomCentered(range[0], range[1]));
}

function setKnobValue(knob: HTMLElement, target: number, pointerId: number): void {
  if (knob.getAttribute('aria-disabled') === 'true') return;
  const current = clamp01(Number(knob.getAttribute('aria-valuenow') ?? 0) / 100);
  const delta = target - current;
  if (Math.abs(delta) < 0.002) return;

  // Knob.tsx exposes its real pointer gesture as the canonical setter. Driving that
  // gesture keeps React state, the native bridge, serialization and the painted knob
  // in one path instead of inventing a second parameter transport for targeted RANDOM.
  const startX = 120;
  const startY = 120;
  const travel = delta / 0.00315;
  const endY = startY - travel;
  const pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const common = { bubbles: true, cancelable: true, clientX: startX, button: 0 };

  knob.dispatchEvent(new pointer('pointerdown', { ...common, clientY: startY, pointerId } as PointerEventInit));
  window.dispatchEvent(new pointer('pointermove', { ...common, clientY: endY, pointerId } as PointerEventInit));
  window.dispatchEvent(new pointer('pointerup', { ...common, clientY: endY, pointerId } as PointerEventInit));
}

function randomizeSelect(select: HTMLSelectElement, kind: TargetRandomKind): void {
  if (kind === 'mutate' || select.disabled) return;
  const options = Array.from(select.options).filter((option) => !option.disabled && option.value !== select.value);
  if (!options.length) return;
  const next = options[Math.floor(Math.random() * options.length)];
  if (!next) return;
  select.value = next.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function randomizeModule(module: HTMLElement, kind: TargetRandomKind): void {
  const moduleId = moduleIdFromElement(module);
  if (!moduleId) return;

  // LOOP/Pressure owns transport and recorder state rather than a musical parameter
  // patch, and is intentionally excluded from global RANDOM for the same reason.
  if (module.classList.contains('module-pressure')) return;

  const selects = Array.from(module.querySelectorAll<HTMLSelectElement>('select'));
  for (const select of selects) randomizeSelect(select, kind);

  const hold = module.querySelector<HTMLButtonElement>('.microcosm-hold.active');
  if (hold) hold.click();

  const knobs = Array.from(module.querySelectorAll<HTMLElement>('.knob-shell[data-control-target]'));
  let pointerId = 4100;
  for (const knob of knobs) {
    const parameterId = parameterIdFromKnob(knob);
    if (!parameterId) continue;
    const current = clamp01(Number(knob.getAttribute('aria-valuenow') ?? 0) / 100);
    let target = targetForParameter(parameterId, current, kind);

    // Keep targeted patches inside the 424's musical operating area; the native DSP
    // still exposes the full pushed range when the user intentionally turns it up.
    const artifactMode = moduleId === 'media'
      ? module.querySelector<HTMLSelectElement>('select[aria-label="Artifact format"]')?.value
      : null;
    if (artifactMode === 'tascam424') {
      if (parameterId === 'wear') target = Math.min(target, 0.36);
      if (parameterId === 'tone') target = Math.min(target, 0.52);
      if (parameterId === 'mix') target = Math.min(target, 0.34);
    }

    setKnobValue(knob, target, pointerId++);
  }

  module.classList.add('targeted-random-committed');
  window.setTimeout(() => module.classList.remove('targeted-random-committed'), 420);
}

function identifyRandomButton(button: HTMLButtonElement): TargetRandomKind | null {
  if (button.classList.contains('signal-randomizer-toggle')) return null;
  return button.classList.contains('mutate-randomizer-toggle') ? 'mutate' : 'random';
}

function armRandomButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button.randomizer-toggle')) {
    const kind = identifyRandomButton(button);
    if (!kind) continue;
    button.draggable = true;
    button.dataset.randomDragKind = kind;
    if (!button.title.includes('Drag onto')) button.title += ' · Drag onto one module to randomize only that module';
  }
}

function onDragStart(event: DragEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('button.randomizer-toggle');
  if (!button) return;
  const kind = identifyRandomButton(button);
  if (!kind) return;
  draggingRandom = kind;
  event.dataTransfer?.setData(RANDOM_MIME, kind);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  document.documentElement.classList.add('targeted-random-dragging');
}

function onDragOver(event: DragEvent): void {
  if (!draggingRandom) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const module = target.closest<HTMLElement>('article.effect-module');
  if (!module || module.classList.contains('module-pressure')) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  for (const other of document.querySelectorAll('.targeted-random-drop-target')) {
    if (other !== module) other.classList.remove('targeted-random-drop-target');
  }
  module.classList.add('targeted-random-drop-target');
}

function onDrop(event: DragEvent): void {
  if (!draggingRandom) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const module = target.closest<HTMLElement>('article.effect-module');
  if (!module || module.classList.contains('module-pressure')) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const kind = (event.dataTransfer?.getData(RANDOM_MIME) as TargetRandomKind) || draggingRandom;
  randomizeModule(module, kind === 'mutate' ? 'mutate' : 'random');
  module.classList.remove('targeted-random-drop-target');
  draggingRandom = null;
  document.documentElement.classList.remove('targeted-random-dragging');
}

function clearRandomDrag(): void {
  draggingRandom = null;
  document.documentElement.classList.remove('targeted-random-dragging');
  for (const module of document.querySelectorAll('.targeted-random-drop-target')) {
    module.classList.remove('targeted-random-drop-target');
  }
}

function applyOverRange(preLimiterPeak: number): void {
  const meter = document.querySelector<HTMLElement>('.output-meter');
  if (!meter) return;
  const spans = Array.from(meter.querySelectorAll<HTMLElement>('span'));
  if (!spans.length) return;

  const peak = Number.isFinite(preLimiterPeak) ? Math.max(0, preLimiterPeak) : 0;
  const overDb = peak > 1 ? 20 * Math.log10(peak) : 0;
  const now = performance.now();
  const currentSegments = overDb <= 0 ? 0 : overDb < 1.5 ? 1 : overDb < 3 ? 2 : overDb < 6 ? 3 : 4;
  if (currentSegments > 0) {
    heldOverSegments = Math.max(heldOverSegments, currentSegments);
    peakHoldUntil = now + PEAK_HOLD_MS;
  } else if (now >= peakHoldUntil) {
    heldOverSegments = 0;
  }

  const overSegments = Math.min(heldOverSegments, spans.length);
  spans.forEach((span, index) => {
    const over = overSegments > 0 && index >= spans.length - overSegments;
    span.classList.toggle('over', over);
    span.classList.toggle('over-lit', over);
  });
  meter.dataset.overDb = overDb.toFixed(1);
  meter.title = overSegments > 0
    ? `Pre-limiter peak +${overDb.toFixed(1)} dBFS · over-range held ${PEAK_HOLD_MS} ms`
    : `Pre-limiter peak ${peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : '-∞'} dBFS`;
  meter.setAttribute(
    'aria-label',
    overSegments > 0
      ? `Output exceeded full scale by ${overDb.toFixed(1)} decibels; peak hold active`
      : `Output pre-limiter peak ${peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : 'minus infinity'} decibels full scale`,
  );
}

async function pollNativePeak(): Promise<void> {
  try {
    const response = await fetch(NATIVE_HEALTH_URL, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return;
    const health = await response.json() as { preLimiterPeak?: number };
    applyOverRange(health.preLimiterPeak ?? 0);
  } catch {
    if (performance.now() >= peakHoldUntil) applyOverRange(0);
  }
}

function install(): void {
  armRandomButtons();
  observer = new MutationObserver(armRandomButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('dragend', clearRandomDrag, true);
  if (IS_NATIVE_SHELL) healthTimer = window.setInterval(() => void pollNativePeak(), 120);
}

function uninstall(): void {
  observer?.disconnect();
  observer = null;
  document.removeEventListener('dragstart', onDragStart, true);
  document.removeEventListener('dragover', onDragOver, true);
  document.removeEventListener('drop', onDrop, true);
  document.removeEventListener('dragend', clearRandomDrag, true);
  if (healthTimer !== null) window.clearInterval(healthTimer);
  healthTimer = null;
  clearRandomDrag();
}

install();
if (import.meta.hot) import.meta.hot.dispose(uninstall);
