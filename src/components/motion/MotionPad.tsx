import type {
  ChangeEvent as ReactChangeEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import type {
  ModuleState,
  MotionCurve,
  MotionSmoothing,
  XYAssignment,
} from '../../ui/types';
import { getEffectiveMotionValue } from '../../ui/motion';
import { XYSignalField } from './XYSignalField';

export interface MotionPadProps {
  padRef: RefObject<HTMLDivElement | null>;
  modules: ModuleState[];
  assignments: XYAssignment[];
  position: { x: number; y: number };
  dragging: boolean;
  patchActive: boolean;
  hoverAxis: 'x' | 'y' | null;
  onDraggingChange: (dragging: boolean) => void;
  onPadPointer: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDisconnect: (target: string) => void;
  onRouteChange: (
    id: string,
    patch: Partial<Omit<XYAssignment, 'id' | 'target'>>
  ) => void;
}

export function MotionPad({
  padRef,
  modules,
  assignments,
  position,
  dragging,
  patchActive,
  hoverAxis,
  onDraggingChange,
  onPadPointer,
  onDisconnect,
  onRouteChange,
}: MotionPadProps) {
  return (
    <>
      <div
        ref={padRef}
        className={`xy-pad ${dragging ? 'is-dragging' : ''} ${patchActive ? 'patch-target-active' : ''} ${
          hoverAxis ? `hover-axis-${hoverAxis}` : ''
        }`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onDraggingChange(true);
          onPadPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) onPadPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          onDraggingChange(false);
        }}
        onPointerCancel={() => onDraggingChange(false)}
      >
        <XYSignalField
          modules={modules}
          assignments={assignments}
          position={position}
          dragging={dragging || patchActive}
        />
        <div className="xy-grid horizontal" />
        <div className="xy-grid vertical" />
        <span className="xy-axis-mark x" aria-hidden="true">X</span>
        <span className="xy-axis-mark y" aria-hidden="true">Y</span>
        <div
          className="xy-cursor"
          style={{ '--x': `${position.x}%`, '--y': `${100 - position.y}%` } as React.CSSProperties}
        />
      </div>

      <div className="xy-values" aria-label="Motion coordinates">
        <div><span>X</span><strong>{Math.round(position.x)}</strong></div>
        <div><span>Y</span><strong>{Math.round(position.y)}</strong></div>
      </div>

      <section className="motion-route-inspector" aria-label="Motion patches">
        <div className="route-inspector-heading">
          <strong>PATCHES</strong>
          <span className="route-count"><i />{assignments.length}</span>
        </div>
        {assignments.length === 0 ? (
          <p className="empty-routes">Drag any knob jack to the pad.</p>
        ) : (
          <div className="motion-route-list">
            {assignments.map((assignment) => {
              const [moduleId, parameterId] = assignment.target.split('.');
              const module = modules.find((item) => item.id === moduleId);
              const parameter = module?.parameters.find((item) => item.id === parameterId);
              const effective = parameter
                ? getEffectiveMotionValue(parameter.value, assignment, position)
                : 0;
              return (
                <article className={`motion-route axis-${assignment.axis}`} key={assignment.id}>
                  <header>
                    <b>{assignment.axis.toUpperCase()}</b>
                    <div>
                      <strong>{module?.name ?? moduleId} · {parameter?.label ?? parameterId}</strong>
                      <span>{Math.round((parameter?.value ?? 0) * 100)} → {Math.round(effective * 100)}</span>
                    </div>
                    <button type="button" onClick={() => onDisconnect(assignment.target)} aria-label="Disconnect patch">×</button>
                  </header>
                  <label className="route-depth">
                    <span>DEPTH</span>
                    <input type="range" min="0" max="1" step="0.01" value={assignment.depth} onChange={(event: ReactChangeEvent<HTMLInputElement>) => onRouteChange(assignment.id, { depth: Number(event.target.value) })} />
                    <strong>{Math.round(assignment.depth * 100)}</strong>
                  </label>
                  <div className="route-axis" role="group" aria-label="Motion axis">
                    <button type="button" className={assignment.axis === 'x' ? 'active' : ''} aria-pressed={assignment.axis === 'x'} onClick={() => onRouteChange(assignment.id, { axis: 'x' })}>X</button>
                    <button type="button" className={assignment.axis === 'y' ? 'active' : ''} aria-pressed={assignment.axis === 'y'} onClick={() => onRouteChange(assignment.id, { axis: 'y' })}>Y</button>
                  </div>
                  <details>
                    <summary>MORE</summary>
                    <div className="route-controls">
                      <label><span>MIN {Math.round((assignment.min ?? 0) * 100)}</span><input type="range" min="0" max="1" step="0.01" value={assignment.min ?? 0} onChange={(event: ReactChangeEvent<HTMLInputElement>) => onRouteChange(assignment.id, { min: Number(event.target.value) })} /></label>
                      <label><span>MAX {Math.round((assignment.max ?? 1) * 100)}</span><input type="range" min="0" max="1" step="0.01" value={assignment.max ?? 1} onChange={(event: ReactChangeEvent<HTMLInputElement>) => onRouteChange(assignment.id, { max: Number(event.target.value) })} /></label>
                    </div>
                    <div className="route-options">
                      <select aria-label="Motion curve" value={assignment.curve ?? 'soft'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onRouteChange(assignment.id, { curve: event.target.value as MotionCurve })}><option value="linear">Linear</option><option value="soft">Soft</option><option value="exponential">Expo</option><option value="stepped">Steps</option></select>
                      <select aria-label="Motion response" value={assignment.smoothing ?? 'medium'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onRouteChange(assignment.id, { smoothing: event.target.value as MotionSmoothing })}><option value="fast">Fast</option><option value="medium">Medium</option><option value="slow">Slow</option></select>
                      <button type="button" className={assignment.inverted ? 'active' : ''} aria-pressed={assignment.inverted} title="Invert this motion source" onClick={() => onRouteChange(assignment.id, { inverted: !assignment.inverted })}>INV</button>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
