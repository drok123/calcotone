import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { XYAssignment } from '../../ui/types';
import { clamp } from '../../ui/math';

export function Knob({
  label,
  value,
  effectiveValue,
  display,
  disabled = false,
  assignment,
  patchTarget,
  onChange,
  onReset,
  onPatchStart,
  onPatchMove,
  onPatchEnd,
  onPatchDisconnect,
}: {
  label: string;
  value: number;
  effectiveValue: number;
  display: string;
  disabled?: boolean;
  assignment?: XYAssignment;
  patchTarget: string;
  onChange: (value: number) => void;
  onReset: () => void;
  onPatchStart: (startX: number, startY: number, pointerX: number, pointerY: number) => void;
  onPatchMove: (pointerX: number, pointerY: number) => void;
  onPatchEnd: (pointerX: number, pointerY: number) => void;
  onPatchDisconnect: () => void;
}) {
  const rotation = -135 + value * 270;
  const effectiveRotation = -135 + effectiveValue * 270;
  const valueRef = useRef(value);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, startValue: 0, moved: false });
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number; fine: boolean } | null>(null);
  const patchRef = useRef({ pointerId: -1, x: 0, y: 0, moved: false });
  const lastClickAtRef = useRef(0);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const cleanupPatchRef = useRef<(() => void) | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => {
    cleanupDragRef.current?.();
    cleanupPatchRef.current?.();
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

      // Absolute-from-grab-point mapping prevents event-to-event acceleration,
      // magnetic snapping and release momentum from making the knob "bounce".
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
      if (dragFrameRef.current === null) {
        dragFrameRef.current = requestAnimationFrame(applyPending);
      }
    };

    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== dragRef.current.pointerId) return;
      pointerEvent.preventDefault();

      // Commit the last pointer sample before ending the gesture.
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
      cleanupDragRef.current?.();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
    cleanupDragRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      pendingDragRef.current = null;
      cleanupDragRef.current = null;
      document.body.classList.remove('knob-is-dragging');
      setIsAdjusting(false);
    };
  }

  function handlePatchPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupPatchRef.current?.();
    const bounds = event.currentTarget.getBoundingClientRect();
    patchRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    document.body.classList.add('patch-is-dragging');
    onPatchStart(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
      event.clientX,
      event.clientY
    );

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== patchRef.current.pointerId) return;
      pointerEvent.preventDefault();
      const distance = Math.hypot(pointerEvent.clientX - patchRef.current.x, pointerEvent.clientY - patchRef.current.y);
      patchRef.current.moved = patchRef.current.moved || distance > 3;
      onPatchMove(pointerEvent.clientX, pointerEvent.clientY);
    };

    const finish = (pointerEvent: PointerEvent, cancelled = false): void => {
      if (pointerEvent.pointerId !== patchRef.current.pointerId) return;
      pointerEvent.preventDefault();
      if (!cancelled && patchRef.current.moved) {
        onPatchEnd(pointerEvent.clientX, pointerEvent.clientY);
      } else {
        onPatchEnd(-1, -1);
        if (!cancelled && assignment) onPatchDisconnect();
      }
      cleanupPatchRef.current?.();
    };

    const up = (pointerEvent: PointerEvent): void => finish(pointerEvent, false);
    const cancelPatch = (pointerEvent: PointerEvent): void => finish(pointerEvent, true);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up, { passive: false });
    window.addEventListener('pointercancel', cancelPatch, { passive: false });
    cleanupPatchRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPatch);
      cleanupPatchRef.current = null;
      document.body.classList.remove('patch-is-dragging');
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

  return (
    <div className={`knob-control ${assignment ? 'xy-assigned' : ''} ${isAdjusting ? 'is-adjusting' : ''}`}>
      <span className="knob-value" aria-hidden={!isAdjusting}>{display}</span>
      <span
        className="knob-shell"
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
        style={{ '--effective-rotation': `${effectiveRotation}deg`, '--base-rotation': `${rotation}deg` } as CSSProperties}
      >
        <span className="knob-modulation-ring" aria-hidden="true" />
        <span className="knob-effective-marker" aria-hidden="true" />
        <span className="knob-face" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
          <span className="knob-indicator" />
        </span>
      </span>
      <button
        type="button"
        className={`knob-patch-jack ${assignment ? `assigned axis-${assignment.axis}` : ''}`}
        data-patch-target={patchTarget}
        onPointerDown={handlePatchPointerDown}
        disabled={disabled}
        aria-label={assignment ? `${label} patched to ${assignment.axis.toUpperCase()}. Click to disconnect or drag to repatch.` : `Patch ${label} to motion`}
        title={assignment ? `Patched to ${assignment.axis.toUpperCase()} · click to disconnect · drag to repatch` : 'Drag this jack to the motion pad'}
      >
        <span aria-hidden="true" />
        {assignment && <b>{assignment.axis.toUpperCase()}</b>}
      </button>
      <span className="knob-label">{label}</span>
    </div>
  );
}

