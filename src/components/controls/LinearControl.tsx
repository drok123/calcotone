import {
  useEffect,
  useRef,
  type ChangeEvent as ReactChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { beginViewportInteractionPriority } from '../effects/viewportScheduler';

export function LinearControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const pendingValueRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const releaseVisualPriorityRef = useRef<(() => void) | null>(null);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const flushPending = (): void => {
    frameRef.current = null;
    const next = pendingValueRef.current;
    pendingValueRef.current = null;
    if (next === null || next === valueRef.current) return;
    valueRef.current = next;
    onChangeRef.current(next);
  };

  const endInteraction = (): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    flushPending();
    activePointerRef.current = null;
    releaseVisualPriorityRef.current?.();
    releaseVisualPriorityRef.current = null;
    document.body.classList.remove('knob-is-dragging');
  };

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingValueRef.current = null;
    activePointerRef.current = null;
    releaseVisualPriorityRef.current?.();
    releaseVisualPriorityRef.current = null;
    document.body.classList.remove('knob-is-dragging');
  }, []);

  const handleChange = (event: ReactChangeEvent<HTMLInputElement>): void => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    pendingValueRef.current = next;
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(flushPending);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>): void => {
    if (event.button !== 0) return;
    if (activePointerRef.current !== null) endInteraction();
    activePointerRef.current = event.pointerId;
    releaseVisualPriorityRef.current = beginViewportInteractionPriority();
    document.body.classList.add('knob-is-dragging');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLInputElement>): void => {
    if (activePointerRef.current !== event.pointerId) return;
    endInteraction();
  };

  return (
    <label className="linear-control">
      <span className="linear-header">
        <span>{label}</span>
        <strong>{display}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      />
    </label>
  );
}
