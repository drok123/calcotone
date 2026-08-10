import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { canvasPixelRatio, getDisplayProfile, subscribeDisplayProfile } from '../../ui/displayProfile';
import {
  loopTrackProgress,
  sendLoopCommand,
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

type TrimHandle = 'start' | 'end';

const OFF_WHITE = '#f2ead8';
const OFF_WHITE_DIM = 'rgba(242, 234, 216, .34)';
const LOOP_PURPLE = '#d7c8ff';
const PLAYHEAD = '#ffbe72';
const PLOT_INSET_X = 12;
const PLOT_TOP = 23;
const PLOT_BOTTOM = 10;

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

function plotBounds(width: number, height: number): { left: number; right: number; top: number; bottom: number; width: number; height: number; mid: number } {
  const left = PLOT_INSET_X;
  const right = Math.max(left + 1, width - PLOT_INSET_X);
  const top = PLOT_TOP;
  const bottom = Math.max(top + 1, height - PLOT_BOTTOM);
  const plotWidth = Math.max(1, right - left);
  const plotHeight = Math.max(1, bottom - top);
  return { left, right, top, bottom, width: plotWidth, height: plotHeight, mid: top + plotHeight * 0.5 };
}

function drawHandle(
  context: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  label: string,
  active: boolean,
): void {
  context.save();
  context.strokeStyle = active ? LOOP_PURPLE : 'rgba(215, 200, 255, .56)';
  context.fillStyle = active ? '#fffaf0' : 'rgba(242, 234, 216, .82)';
  context.lineWidth = active ? 2 : 1;
  context.shadowColor = LOOP_PURPLE;
  context.shadowBlur = active ? 5 : 0;
  context.beginPath();
  context.moveTo(x + 0.5, top);
  context.lineTo(x + 0.5, bottom);
  context.stroke();
  context.shadowBlur = 0;
  context.fillRect(Math.round(x - 4), Math.round(top - 1), 9, 9);
  context.fillStyle = '#100c08';
  context.font = '900 7px "IBM Plex Mono", Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x + 0.5, top + 3.6);
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
  trimEditing: boolean,
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

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#090806';
  context.fillRect(0, 0, width, height);

  // Functional editor grid only: no ASCII scenery and no ornamental display world.
  context.strokeStyle = 'rgba(242, 234, 216, .075)';
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

    // Transient spikes remain visually truthful to the stored high-resolution envelope.
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

  // Darken discarded regions so the active trim window reads immediately.
  context.fillStyle = trimEditing ? 'rgba(0, 0, 0, .50)' : 'rgba(0, 0, 0, .32)';
  if (startX > bounds.left) context.fillRect(bounds.left, bounds.top, startX - bounds.left, bounds.height);
  if (endX < bounds.right) context.fillRect(endX, bounds.top, bounds.right - endX, bounds.height);

  // Seam fade is shown as a small utility gradient inside the selected trim bounds.
  const rawFrames = runtime?.rawFrames ?? state.rawFrames;
  const durationSeconds = rawFrames > 0 ? rawFrames / Math.max(8_000, state.sampleRate) : 0;
  const fadeFraction = durationSeconds > 0 ? Math.min(0.12, (state.fade * 0.020) / durationSeconds) : 0;
  if (fadeFraction > 0 && endX > startX) {
    const fadeWidth = Math.max(1, bounds.width * fadeFraction);
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
    drawHandle(context, startX, bounds.top, bounds.bottom, 'I', trimEditing);
    drawHandle(context, endX, bounds.top, bounds.bottom, 'O', trimEditing);
  }

  const progress = occupied ? loopTrackProgress(state.selectedTrack, stamp) : 0;
  if (occupied) {
    const playheadX = bounds.left + bounds.width * progress;
    context.strokeStyle = 'rgba(255, 190, 114, .72)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(Math.round(playheadX) + 0.5, bounds.top + 9);
    context.lineTo(Math.round(playheadX) + 0.5, bounds.bottom);
    context.stroke();
  }

  context.shadowBlur = 0;
  context.fillStyle = enabled ? OFF_WHITE : OFF_WHITE_DIM;
  context.font = '900 9px "IBM Plex Mono", Consolas, monospace';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText(`T${state.selectedTrack + 1}`, bounds.left, 7);
  context.fillStyle = trimEditing ? LOOP_PURPLE : 'rgba(242, 234, 216, .58)';
  context.fillText(trimEditing ? 'TRIM' : 'TRANSIENT', bounds.left + 24, 7);

  const info = occupied
    ? `IN ${(trimStart * 100).toFixed(1)}   OUT ${(trimEnd * 100).toFixed(1)}`
    : 'EMPTY';
  context.fillStyle = enabled ? 'rgba(242, 234, 216, .72)' : OFF_WHITE_DIM;
  context.textAlign = 'right';
  context.fillText(info, bounds.right, 7);

  if (trimEditing && occupied) {
    context.fillStyle = 'rgba(215, 200, 255, .66)';
    context.font = '800 7px "IBM Plex Mono", Consolas, monospace';
    context.textAlign = 'right';
    context.textBaseline = 'bottom';
    context.fillText('DRAG I / O', bounds.right, height - 2);
  }
}

export function LoopTrackMatrixDisplay({ enabled, visualState, trimEditing = false }: LoopTrackMatrixDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragHandleRef = useRef<TrimHandle | null>(null);
  const state = useLoopState();
  const stateRef = useRef(state);
  const propsRef = useRef({ enabled, visualState, trimEditing });
  stateRef.current = state;
  propsRef.current = { enabled, visualState, trimEditing };

  function updateTrim(handle: TrimHandle, clientX: number, canvas: HTMLCanvasElement): void {
    const current = stateRef.current;
    const bounds = canvas.getBoundingClientRect();
    const plot = plotBounds(bounds.width, bounds.height);
    const value = clamp01((clientX - bounds.left - plot.left) / plot.width);
    const minimum = minimumTrim(current);
    if (handle === 'start') {
      sendLoopCommand({
        type: 'trim',
        start: Math.min(value, current.trimEnd - minimum),
        end: current.trimEnd,
      });
    } else {
      sendLoopCommand({
        type: 'trim',
        start: current.trimStart,
        end: Math.max(value, current.trimStart + minimum),
      });
    }
  }

  function beginTrimDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const current = stateRef.current;
    const occupied = (current.trackMask & (1 << current.selectedTrack)) !== 0;
    const writing = current.transport === 'recording' || current.transport === 'overdubbing';
    if (!propsRef.current.trimEditing || !occupied || writing || event.button !== 0) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const plot = plotBounds(bounds.width, bounds.height);
    const pointerX = event.clientX - bounds.left;
    const startX = plot.left + plot.width * current.trimStart;
    const endX = plot.left + plot.width * current.trimEnd;
    const handle: TrimHandle = Math.abs(pointerX - startX) <= Math.abs(pointerX - endX) ? 'start' : 'end';
    dragHandleRef.current = handle;
    canvas.setPointerCapture(event.pointerId);
    updateTrim(handle, event.clientX, canvas);
  }

  function moveTrimDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const handle = dragHandleRef.current;
    if (!handle) return;
    event.preventDefault();
    updateTrim(handle, event.clientX, event.currentTarget);
  }

  function finishTrimDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!dragHandleRef.current) return;
    dragHandleRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
        current.trimEditing,
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
      className={`pressure-style-display rail-c-hardware-art loop-track-matrix loop-transient-trim ${enabled ? 'is-active' : 'is-standby'} ${trimEditing ? 'is-editing' : ''}`}
      data-pressure-variant="loop-trim"
      aria-label={`Loop track ${state.selectedTrack + 1} transient trim editor. IN ${(state.trimStart * 100).toFixed(1)} percent, OUT ${(state.trimEnd * 100).toFixed(1)} percent.`}
      onPointerDown={beginTrimDrag}
      onPointerMove={moveTrimDrag}
      onPointerUp={finishTrimDrag}
      onPointerCancel={finishTrimDrag}
    />
  );
}
