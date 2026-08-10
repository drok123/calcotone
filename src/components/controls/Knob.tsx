import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp } from '../../ui/math';

/** Shared hardware knob. */
export function Knob({
  label,
  value,
  controlTarget,
  display,
  disabled = false,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  controlTarget?: string;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const rotation = -135 + value * 270;
  const valueRef = useRef(value);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, startValue: 0, moved: false });
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number; fine: boolean } | null>(null);
  const lastClickAtRef = useRef(0);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => {
    cleanupDragRef.current?.();
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupDragRef.current?.();

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: valueRef.current,
      moved: false,
    };
    pendingDragRef.current = null;
    document.body.classList.add('knob-is-dragging');
    setIsAdjusting(true);

    const applyPending = (): void => {
      dragFrameRef.current = null;
      const pending = pendingDragRef.current;
      if (!pending) return;
      pendingDragRef.current = null;

      const vertical = dragRef.current.startY - pending.y;
      const horizontal = pending.x - dragRef.current.startX;
      const travel = vertical + horizontal * 0.10;
      const sensitivity = pending.fine ? 0.00115 : 0.00315;
      const next = clamp(dragRef.current.startValue + travel * sensitivity, 0, 1);

      dragRef.current.moved = dragRef.current.moved || Math.abs(travel) > 1.5;
      if (Math.abs(next - valueRef.current) >= 0.00008) {
        valueRef.current = next;
        onChange(next);
      }
    };

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== dragRef.current.pointerId) return;
      pointerEvent.preventDefault();
      pendingDragRef.current = {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        fine: pointerEvent.shiftKey,
      };
      if (dragFrameRef.current === null) dragFrameRef.current = requestAnimationFrame(applyPending);
    };

    const finish = (pointerEvent: PointerEvent, cancelled = false): void => {
      if (pointerEvent.pointerId !== dragRef.current.pointerId) return;
      pointerEvent.preventDefault();

      if (!cancelled) {
        pendingDragRef.current = {
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          fine: pointerEvent.shiftKey,
        };
        if (dragFrameRef.current !== null) {
          cancelAnimationFrame(dragFrameRef.current);
          dragFrameRef.current = null;
        }
        applyPending();

        if (!dragRef.current.moved) {
          const now = performance.now();
          if (now - lastClickAtRef.current <= 360) {
            onReset();
            lastClickAtRef.current = 0;
          } else {
            lastClickAtRef.current = now;
          }
        } else {
          lastClickAtRef.current = 0;
        }
      } else {
        lastClickAtRef.current = 0;
      }

      cleanupDragRef.current?.();
    };

    const release = (pointerEvent: PointerEvent): void => finish(pointerEvent, false);
    const cancel = (pointerEvent: PointerEvent): void => finish(pointerEvent, true);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', release, { passive: false });
    window.addEventListener('pointercancel', cancel, { passive: false });
    cleanupDragRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      pendingDragRef.current = null;
      cleanupDragRef.current = null;
      document.body.classList.remove('knob-is-dragging');
      setIsAdjusting(false);
    };
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>): void {
    if (disabled) return;
    const step = event.shiftKey ? 0.005 : 0.025;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(Math.min(1, value + step));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(Math.max(0, value - step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(1);
    } else if (event.key === '0' || event.key === 'Enter') {
      event.preventDefault();
      onReset();
    }
  }

  const faceStyle = {
    transform: `rotate(${rotation}deg)`,
    transition: isAdjusting ? 'none' : 'transform 350ms cubic-bezier(0.2, 0.82, 0.22, 1)',
    willChange: 'transform',
  } as CSSProperties;

  return (
    <div className={`knob-control ${isAdjusting ? 'is-adjusting' : ''}`}>
      <span className="knob-value" aria-hidden={!isAdjusting}>{display}</span>
      <span
        className="knob-shell"
        data-control-target={controlTarget}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={display}
        aria-disabled={disabled}
        title="Drag vertically · Shift for fine control · Double-click to reset"
      >
        <span className="knob-face" style={faceStyle} aria-hidden="true">
          <span className="knob-indicator" />
        </span>
      </span>
      <span className="knob-label">{label}</span>
    </div>
  );
}
