import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { canvasPixelRatio, getDisplayProfile, subscribeDisplayProfile } from '../../ui/displayProfile';
import {
  cycleLoopQuantize,
  loopTrackProgress,
  sendLoopCommand,
  setLoopBpm,
  setLoopState,
  useLoopState,
  type LoopState,
  type LoopTrackRuntime,
} from '../signal/loopStore';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';
import './PressureStyleDisplay.css';

interface LoopTrackMatrixDisplayProps {
  enabled: boolean;
  visualState: VisualAudioState;
  trimEditing?: boolean;
}

type DragHandle = 'start' | 'end' | 'fadeIn' | 'fadeOut';

const OFF_WHITE = '#f2ead8';
const OFF_WHITE_DIM = 'rgba(242, 234, 216, .34)';
const LOOP_PURPLE = '#d7c8ff';
const PLAYHEAD = '#ffbe72';
const PLOT_INSET_X = 12;
const PLOT_TOP = 25;
const PLOT_BOTTOM = 9;
const FADE_HANDLE_MIN = 7;
const FADE_HANDLE_MAX = 36;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function selectedRuntime(state: LoopState): LoopTrackRuntime | undefined {
  return state.trackRuntime[state.selectedTrack];
}

function minimumTrim(state: LoopState): number {
  const rawFrames = selectedRuntime(state)?.rawFrames ?? state.rawFrames;
  return rawFrames > 0 ? Math.min(0.25, 64 / rawFrames) : 0.001;
}

function plotBounds(width: number, height: number): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  mid: number;
} {
  const left = PLOT_INSET_X;
  const right = Math.max(left + 1, width - PLOT_INSET_X);
  const top = PLOT_TOP;
  const bottom = Math.max(top + 1, height - PLOT_BOTTOM);
  const plotWidth = Math.max(1, right - left);
  const plotHeight = Math.max(1, bottom - top);
  return { left, right, top, bottom, width: plotWidth, height: plotHeight, mid: top + plotHeight * 0.5 };
}

function clockBounds(width: number): { left: number; right: number; top: number; bottom: number } {
  const right = width - PLOT_INSET_X;
  return { left: Math.max(PLOT_INSET_X + 108, right - 108), right, top: 4, bottom: 21 };
}

function autoBounds(): { left: number; right: number; top: number; bottom: number } {
  return { left: 35, right: 66, top: 4, bottom: 21 };
}

function resetBounds(): { left: number; right: number; top: number; bottom: number } {
  return { left: 69, right: 105, top: 4, bottom: 21 };
}

function inside(x: number, y: number, bounds: { left: number; right: number; top: number; bottom: number }): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function fadeTravel(startX: number, endX: number): number {
  return Math.max(FADE_HANDLE_MIN, Math.min(FADE_HANDLE_MAX, Math.max(FADE_HANDLE_MIN, (endX - startX) * 0.28)));
}

function fadeHandlePositions(startX: number, endX: number, fade: number): { fadeInX: number; fadeOutX: number; travel: number } {
  const travel = fadeTravel(startX, endX);
  const offset = FADE_HANDLE_MIN + clamp01(fade) * Math.max(1, travel - FADE_HANDLE_MIN);
  return {
    fadeInX: Math.min(endX - 4, startX + offset),
    fadeOutX: Math.max(startX + 4, endX - offset),
    travel,
  };
}

function drawTrimBar(
  context: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  label: string,
  active: boolean,
): void {
  context.save();
  context.strokeStyle = active ? LOOP_PURPLE : 'rgba(242, 234, 216, .78)';
  context.fillStyle = active ? '#fffaf0' : OFF_WHITE;
  context.lineWidth = active ? 2 : 1.2;
  context.shadowColor = active ? LOOP_PURPLE : OFF_WHITE;
  context.shadowBlur = active ? 6 : 2;
  context.beginPath();
  context.moveTo(Math.round(x) + 0.5, top);
  context.lineTo(Math.round(x) + 0.5, bottom);
  context.stroke();
  context.shadowBlur = 0;
  context.fillRect(Math.round(x - 4), Math.round(top), 9, 8);
  context.fillStyle = '#100c08';
  context.font = '900 7px "IBM Plex Mono", Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x + 0.5, top + 3.6);
  context.restore();
}

function drawFadePoint(
  context: CanvasRenderingContext2D,
  edgeX: number,
  x: number,
  y: number,
  active: boolean,
): void {
  context.save();
  context.strokeStyle = active ? LOOP_PURPLE : 'rgba(215, 200, 255, .46)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(edgeX, y);
  context.lineTo(x, y);
  context.stroke();
  context.fillStyle = active ? '#fffaf0' : LOOP_PURPLE;
  context.shadowColor = LOOP_PURPLE;
  context.shadowBlur = active ? 6 : 2;
  context.beginPath();
  context.arc(x, y, active ? 4.2 : 3.4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawTopControl(
  context: CanvasRenderingContext2D,
  bounds: { left: number; right: number; top: number; bottom: number },
  text: string,
  strong = false,
): void {
  context.save();
  context.fillStyle = strong ? 'rgba(242, 234, 216, .10)' : 'rgba(242, 234, 216, .035)';
  context.strokeStyle = strong ? 'rgba(242, 234, 216, .30)' : 'rgba(242, 234, 216, .13)';
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top, 3);
  context.fill();
  context.stroke();
  context.fillStyle = strong ? '#fffdf6' : 'rgba(242, 234, 216, .68)';
  context.font = '900 7px "IBM Plex Mono", Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, (bounds.left + bounds.right) * 0.5, (bounds.top + bounds.bottom) * 0.5 + 0.4);
  context.restore();
}

function drawTransientEditor(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  enabled: boolean,
  visualState: VisualAudioState,
  state: LoopState,
  activeHandle: DragHandle | null,
  stamp: number,
): void {
  const runtime = selectedRuntime(state);
  const bit = 1 << state.selectedTrack;
  const occupied = (state.trackMask & bit) !== 0;
  const waveform = runtime?.waveform ?? state.waveform;
  const bounds = plotBounds(width, height);
  const activity = enabled ? clamp01(visualState.level * 0.35 + visualState.transient * 0.65) : 0;
  const trimStart = clamp01(runtime?.trimStart ?? state.trimStart);
  const trimEnd = clamp01(runtime?.trimEnd ?? state.trimEnd);
  const startX = bounds.left + bounds.width * trimStart;
  const endX = bounds.left + bounds.width * trimEnd;
  const fadePoints = fadeHandlePositions(startX, endX, state.fade);
  const fadeY = bounds.top + 15;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#090806';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(242, 234, 216, .07)';
  context.lineWidth = 1;
  for (let division = 0; division <= 8; division += 1) {
    const x = bounds.left + bounds.width * division / 8;
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, bounds.top);
    context.lineTo(Math.round(x) + 0.5, bounds.bottom);
    context.stroke();
  }
  context.strokeStyle = 'rgba(242, 234, 216, .10)';
  context.beginPath();
  context.moveTo(bounds.left, Math.round(bounds.mid) + 0.5);
  context.lineTo(bounds.right, Math.round(bounds.mid) + 0.5);
  context.stroke();

  if (occupied && waveform.length > 0) {
    const halfHeight = bounds.height * 0.42;
    const step = Math.max(1, Math.floor(bounds.width / Math.max(1, waveform.length)));
    context.beginPath();
    context.moveTo(bounds.left, bounds.mid);
    for (let x = 0; x <= bounds.width; x += step) {
      const t = clamp01(x / bounds.width);
      const index = Math.min(waveform.length - 1, Math.floor(t * waveform.length));
      const amplitude = clamp01(waveform[index] ?? 0);
      context.lineTo(bounds.left + x, bounds.mid - amplitude * halfHeight);
    }
    for (let x = bounds.width; x >= 0; x -= step) {
      const t = clamp01(x / bounds.width);
      const index = Math.min(waveform.length - 1, Math.floor(t * waveform.length));
      const amplitude = clamp01(waveform[index] ?? 0);
      context.lineTo(bounds.left + x, bounds.mid + amplitude * halfHeight);
    }
    context.closePath();
    context.fillStyle = `rgba(242, 234, 216, ${0.11 + activity * 0.06})`;
    context.fill();
    context.strokeStyle = `rgba(242, 234, 216, ${0.58 + activity * 0.20})`;
    context.lineWidth = 1.15;
    context.stroke();

    context.strokeStyle = `rgba(242, 234, 216, ${0.18 + activity * 0.12})`;
    context.lineWidth = 1;
    for (let index = 0; index < waveform.length; index += 1) {
      const amplitude = clamp01(waveform[index] ?? 0);
      if (amplitude < 0.16) continue;
      const x = bounds.left + bounds.width * index / Math.max(1, waveform.length - 1);
      const span = amplitude * halfHeight;
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, bounds.mid - span);
      context.lineTo(Math.round(x) + 0.5, bounds.mid + span);
      context.stroke();
    }
  } else {
    context.fillStyle = 'rgba(242, 234, 216, .36)';
    context.font = '800 9px "IBM Plex Mono", Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('RECORD TRACK TO EDIT TRANSIENT', width * 0.5, bounds.mid);
  }

  context.fillStyle = 'rgba(0, 0, 0, .48)';
  if (startX > bounds.left) context.fillRect(bounds.left, bounds.top, startX - bounds.left, bounds.height);
  if (endX < bounds.right) context.fillRect(endX, bounds.top, bounds.right - endX, bounds.height);

  const rawFrames = runtime?.rawFrames ?? state.rawFrames;
  const durationSeconds = rawFrames > 0 ? rawFrames / Math.max(8_000, state.sampleRate) : 0;
  const actualFadeFraction = durationSeconds > 0 ? Math.min(0.12, (state.fade * 0.020) / durationSeconds) : 0;
  if (actualFadeFraction > 0 && endX > startX) {
    const fadeWidth = Math.max(1, bounds.width * actualFadeFraction);
    const inGradient = context.createLinearGradient(startX, 0, startX + fadeWidth, 0);
    inGradient.addColorStop(0, 'rgba(215, 200, 255, .22)');
    inGradient.addColorStop(1, 'rgba(215, 200, 255, 0)');
    context.fillStyle = inGradient;
    context.fillRect(startX, bounds.top, Math.min(fadeWidth, endX - startX), bounds.height);
    const outGradient = context.createLinearGradient(endX - fadeWidth, 0, endX, 0);
    outGradient.addColorStop(0, 'rgba(215, 200, 255, 0)');
    outGradient.addColorStop(1, 'rgba(215, 200, 255, .22)');
    context.fillStyle = outGradient;
    context.fillRect(Math.max(startX, endX - fadeWidth), bounds.top, Math.min(fadeWidth, endX - startX), bounds.height);
  }

  if (occupied) {
    drawTrimBar(context, startX, bounds.top, bounds.bottom, 'I', activeHandle === 'start');
    drawTrimBar(context, endX, bounds.top, bounds.bottom, 'O', activeHandle === 'end');
    drawFadePoint(context, startX, fadePoints.fadeInX, fadeY, activeHandle === 'fadeIn');
    drawFadePoint(context, endX, fadePoints.fadeOutX, fadeY, activeHandle === 'fadeOut');
  }

  const progress = occupied ? loopTrackProgress(state.selectedTrack, stamp) : 0;
  if (occupied) {
    const playheadX = bounds.left + bounds.width * progress;
    context.strokeStyle = PLAYHEAD;
    context.globalAlpha = 0.70;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(Math.round(playheadX) + 0.5, bounds.top + 9);
    context.lineTo(Math.round(playheadX) + 0.5, bounds.bottom);
    context.stroke();
    context.globalAlpha = 1;
  }

  context.fillStyle = enabled ? OFF_WHITE : OFF_WHITE_DIM;
  context.font = '900 9px "IBM Plex Mono", Consolas, monospace';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText(`T${state.selectedTrack + 1}`, bounds.left, 7);

  drawTopControl(context, autoBounds(), 'AUTO', occupied);
  drawTopControl(context, resetBounds(), 'RESET', occupied);
  const quantizeLabel = state.quantize === 'off' ? 'OFF' : state.quantize === 'beat' ? 'BEAT' : 'BAR';
  drawTopControl(context, clockBounds(width), `${state.bpm} BPM · ${quantizeLabel}`, true);

  if (occupied) {
    context.fillStyle = 'rgba(215, 200, 255, .52)';
    context.font = '800 7px "IBM Plex Mono", Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'bottom';
    context.fillText('DRAG I / O · • FADE', bounds.left, height - 1);

    const info = `IN ${(trimStart * 100).toFixed(1)}   OUT ${(trimEnd * 100).toFixed(1)}   XFD ${Math.round(state.fade * 20)}ms`;
    context.fillStyle = 'rgba(242, 234, 216, .55)';
    context.textAlign = 'right';
    context.fillText(info, bounds.right, height - 1);
  }
}

export function LoopTrackMatrixDisplay({ enabled, visualState }: LoopTrackMatrixDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragHandleRef = useRef<DragHandle | null>(null);
  const state = useLoopState();
  const stateRef = useRef(state);
  const propsRef = useRef({ enabled, visualState });
  stateRef.current = state;
  propsRef.current = { enabled, visualState };

  function pointerCoordinates(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    const bounds = canvas.getBoundingClientRect();
    return { x: clientX - bounds.left, y: clientY - bounds.top };
  }

  function currentEditorGeometry(canvas: HTMLCanvasElement) {
    const current = stateRef.current;
    const rect = canvas.getBoundingClientRect();
    const plot = plotBounds(rect.width, rect.height);
    const startX = plot.left + plot.width * current.trimStart;
    const endX = plot.left + plot.width * current.trimEnd;
    return { rect, plot, startX, endX, ...fadeHandlePositions(startX, endX, current.fade) };
  }

  function updateDrag(handle: DragHandle, clientX: number, canvas: HTMLCanvasElement): void {
    const current = stateRef.current;
    const { rect, plot, startX, endX, travel } = currentEditorGeometry(canvas);
    const pointerX = clientX - rect.left;
    if (handle === 'start' || handle === 'end') {
      const value = clamp01((pointerX - plot.left) / plot.width);
      const minimum = minimumTrim(current);
      if (handle === 'start') {
        sendLoopCommand({ type: 'trim', start: Math.min(value, current.trimEnd - minimum), end: current.trimEnd });
      } else {
        sendLoopCommand({ type: 'trim', start: current.trimStart, end: Math.max(value, current.trimStart + minimum) });
      }
      return;
    }

    const denominator = Math.max(1, travel - FADE_HANDLE_MIN);
    const fade = handle === 'fadeIn'
      ? (pointerX - startX - FADE_HANDLE_MIN) / denominator
      : (endX - pointerX - FADE_HANDLE_MIN) / denominator;
    setLoopState({ fade: clamp01(fade) });
  }

  function beginTrimDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.button !== 0) return;
    const current = stateRef.current;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const point = pointerCoordinates(canvas, event.clientX, event.clientY);

    if (inside(point.x, point.y, clockBounds(rect.width))) {
      event.preventDefault();
      cycleLoopQuantize();
      return;
    }

    const occupied = (current.trackMask & (1 << current.selectedTrack)) !== 0;
    const writing = current.transport === 'recording' || current.transport === 'overdubbing';
    if (!occupied || writing) return;

    if (inside(point.x, point.y, autoBounds())) {
      event.preventDefault();
      sendLoopCommand({ type: 'autoTrim' });
      return;
    }
    if (inside(point.x, point.y, resetBounds())) {
      event.preventDefault();
      sendLoopCommand({ type: 'resetTrim' });
      return;
    }

    const geometry = currentEditorGeometry(canvas);
    const fadeY = geometry.plot.top + 15;
    const fadeInDistance = Math.hypot(point.x - geometry.fadeInX, point.y - fadeY);
    const fadeOutDistance = Math.hypot(point.x - geometry.fadeOutX, point.y - fadeY);
    const startDistance = Math.abs(point.x - geometry.startX);
    const endDistance = Math.abs(point.x - geometry.endX);

    let handle: DragHandle | null = null;
    if (fadeInDistance <= 10 || fadeOutDistance <= 10) {
      handle = fadeInDistance <= fadeOutDistance ? 'fadeIn' : 'fadeOut';
    } else if (startDistance <= 11 || endDistance <= 11) {
      handle = startDistance <= endDistance ? 'start' : 'end';
    }
    if (!handle) return;

    event.preventDefault();
    dragHandleRef.current = handle;
    canvas.setPointerCapture(event.pointerId);
    updateDrag(handle, event.clientX, canvas);
  }

  function moveTrimDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const handle = dragHandleRef.current;
    if (!handle) return;
    event.preventDefault();
    updateDrag(handle, event.clientX, event.currentTarget);
  }

  function finishPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!dragHandleRef.current) return;
    dragHandleRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const point = pointerCoordinates(canvas, event.clientX, event.clientY);
    if (!inside(point.x, point.y, clockBounds(rect.width))) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setLoopBpm(stateRef.current.bpm + direction * (event.shiftKey ? 5 : 1));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      setLoopBpm(stateRef.current.bpm + (event.shiftKey ? 5 : 1));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setLoopBpm(stateRef.current.bpm - (event.shiftKey ? 5 : 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cycleLoopQuantize();
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = canvasPixelRatio(1, 1, 2_400_000);
    let visible = true;
    let lastDraw = Number.NEGATIVE_INFINITY;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = canvasPixelRatio(width, height, 2_400_000);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      lastDraw = Number.NEGATIVE_INFINITY;
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const visibilityObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible) lastDraw = Number.NEGATIVE_INFINITY;
        }, { rootMargin: '80px' })
      : null;
    visibilityObserver?.observe(canvas);
    const unsubscribeProfile = subscribeDisplayProfile(resize);

    const render: ViewportRenderCallback = (stamp) => {
      if (!visible) return;
      const current = propsRef.current;
      const display = getDisplayProfile();
      const interval = current.enabled ? 1000 / (display.reference1440p ? 30 : 24) : 250;
      if (stamp - lastDraw < interval) return;
      lastDraw = stamp;
      drawTransientEditor(
        context,
        width,
        height,
        dpr,
        current.enabled,
        current.visualState,
        stateRef.current,
        dragHandleRef.current,
        stamp,
      );
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      unsubscribeProfile();
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pressure-style-display rail-c-hardware-art loop-track-matrix loop-transient-trim is-editing ${enabled ? 'is-active' : 'is-standby'}`}
      data-pressure-variant="loop-trim"
      role="application"
      tabIndex={0}
      aria-label={`Loop track ${state.selectedTrack + 1} transient editor. Drag IN and OUT bars, drag either fade point for seam crossfade, wheel the BPM readout to change tempo, click it to cycle quantize.`}
      onPointerDown={beginTrimDrag}
      onPointerMove={moveTrimDrag}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    />
  );
}
