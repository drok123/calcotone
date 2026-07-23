import type { CSSProperties, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ReverbAlgorithm } from '../../audio/effects/Reverb';
import { MEDIA_MODE_ORDER, type MediaMode } from '../../audio/effects/Media';
import { EMBER_MODE_ORDER, type EmberMode } from '../../audio/effects/Saturation';
import { DRIFT_MODE_ORDER, type DriftMode } from '../../audio/effects/Chorus';
import { GRAIN_MODE_ORDER, type GrainMode } from '../../audio/effects/Bitcrusher';
import { DELAY_ALGORITHM_ORDER, type DelayAlgorithm } from '../../audio/effects/Delay';
import type { VisualAudioState } from '../../visual/VisualEngine';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { formatAlgorithmName } from '../../ui/formatting';
import { getEffectiveMotionValue } from '../../ui/motion';
import { Knob } from '../controls/Knob';
import { ModuleViewport } from './ModuleViewport';
const DELAY_ALGORITHMS: DelayAlgorithm[] = [...DELAY_ALGORITHM_ORDER];
const REVERB_ALGORITHMS: ReverbAlgorithm[] = ['room','plate','hall','cinema','cloud','freeze','celestial','aurora','nebula','abyss'];

export function EffectModule({
  module,
  slotLabel,
  onToggle,
  onParameterChange,
  onParameterReset,
  onDelayAlgorithmChange,
  onAlgorithmChange,
  onMediaModeChange,
  onEmberModeChange,
  onDriftModeChange,
  onGrainModeChange,
  visualState,
  assignments,
  xyPosition,
  onPatchStart,
  onPatchMove,
  onPatchEnd,
  onPatchDisconnect,
  routingDragging,
  routingDropTarget,
  onRoutingDragStart,
  onRoutingDragOver,
  onRoutingDrop,
  onRoutingDragEnd,
  onRoutingNudge,
}: {
  module: ModuleState;
  slotLabel: string;
  onToggle: () => void;
  onParameterChange: (parameterId: string, value: number) => void;
  onParameterReset: (parameterId: string) => void;
  onDelayAlgorithmChange: (algorithm: DelayAlgorithm) => void;
  onAlgorithmChange: (algorithm: ReverbAlgorithm) => void;
  onMediaModeChange: (mode: MediaMode) => void;
  onEmberModeChange: (mode: EmberMode) => void;
  onDriftModeChange: (mode: DriftMode) => void;
  onGrainModeChange: (mode: GrainMode) => void;
  visualState: VisualAudioState;
  assignments: XYAssignment[];
  xyPosition: { x: number; y: number };
  onPatchStart: (
    target: string,
    label: string,
    startX: number,
    startY: number,
    pointerX: number,
    pointerY: number
  ) => void;
  onPatchMove: (pointerX: number, pointerY: number) => void;
  onPatchEnd: (pointerX: number, pointerY: number) => void;
  onPatchDisconnect: (target: string) => void;
  routingDragging: boolean;
  routingDropTarget: boolean;
  onRoutingDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onRoutingDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onRoutingDrop: (event: ReactDragEvent<HTMLElement>) => void;
  onRoutingDragEnd: () => void;
  onRoutingNudge: (direction: -1 | 1) => void;
}) {
  const moduleStyle = {
    '--module-activity': module.enabled ? 1 : 0,
    '--module-low': visualState.low,
    '--module-mid': visualState.mid,
    '--module-high': visualState.high,
    '--module-delay': `${(Number(slotLabel.slice(1)) - 1) * 65}ms`,
  } as CSSProperties;

  return (
    <article
      className={`effect-module module-${module.id} ${
        module.enabled ? 'enabled' : ''
      } ${!module.available ? 'unavailable' : ''} ${
        routingDragging ? 'routing-dragging' : ''
      } ${routingDropTarget ? 'routing-drop-target' : ''}`}
      style={moduleStyle}
      onDragOver={onRoutingDragOver}
      onDrop={onRoutingDrop}
    >
      <header className="module-header">
        <div
          className="module-title module-drag-handle"
          draggable={module.available}
          role="button"
          tabIndex={module.available ? 0 : -1}
          aria-label={`${module.name}, signal slot ${slotLabel}. Drag or use left and right arrow keys to reorder.`}
          onDragStart={onRoutingDragStart}
          onDragEnd={onRoutingDragEnd}
          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (!module.available) return;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              onRoutingNudge(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              onRoutingNudge(1);
            }
          }}
          title="Drag horizontally · or focus and use ← / → to reorder"
        >
          <span className="module-number" aria-hidden="true">{slotLabel}</span>
          <span className="module-jewel" aria-hidden="true" />
          <h3>{module.name}</h3>
          <span className="module-route-cue" aria-hidden="true">↔</span>
        </div>

        <div className="module-header-control">
          {module.id === 'delay' && (
            <label className="algorithm-selector halo-algorithm-selector">
              <span className="sr-only">Mode</span>
              <select
                aria-label="Halo mode"
                value={module.delayAlgorithm ?? 'tape'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>
                  onDelayAlgorithmChange(event.target.value as DelayAlgorithm)
                }
              >
                {DELAY_ALGORITHMS.map((algorithm) => (
                  <option key={algorithm} value={algorithm}>
                    {formatAlgorithmName(algorithm)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'saturation' && (
            <label className="algorithm-selector"><span className="sr-only">Ember mode</span><select aria-label="Ember mode" value={module.emberMode ?? 'velvet'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onEmberModeChange(event.target.value as EmberMode)}>{EMBER_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>)}</select></label>
          )}
          {module.id === 'chorus' && (
            <label className="algorithm-selector"><span className="sr-only">Drift mode</span><select aria-label="Drift mode" value={module.driftMode ?? 'chorus'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onDriftModeChange(event.target.value as DriftMode)}>{DRIFT_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>)}</select></label>
          )}

          {module.id === 'bitcrusher' && (
            <label className="algorithm-selector grain-mode-selector">
              <span className="sr-only">Grain mode</span>
              <select
                aria-label="Grain mode"
                value={module.grainMode ?? 'reconstruct'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onGrainModeChange(event.target.value as GrainMode)}
              >
                {GRAIN_MODE_ORDER.map((mode) => (
                  <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'reverb' && (
            <label className="algorithm-selector">
              <span className="sr-only">Space</span>
              <select
                aria-label="Atmos space"
                value={module.algorithm ?? 'hall'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>
                  onAlgorithmChange(event.target.value as ReverbAlgorithm)
                }
              >
                {REVERB_ALGORITHMS.map((algorithm) => (
                  <option key={algorithm} value={algorithm}>
                    {algorithm.charAt(0).toUpperCase() + algorithm.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'media' && (
            <label className="algorithm-selector media-mode-selector">
              <span className="sr-only">Format</span>
              <select
                aria-label="Artifact format"
                value={module.mediaMode ?? 'cassette'}
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}
              >
                {MEDIA_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</option>)}
              </select>
            </label>
          )}
        </div>

        <button
          type="button"
          className="module-toggle"
          disabled={!module.available}
          onClick={onToggle}
          aria-label={`${module.enabled ? 'Bypass' : 'Enable'} ${module.name}`}
          aria-pressed={module.enabled}
        >
          <span />
        </button>
      </header>

      <ModuleViewport module={module} visualState={visualState} />

      <div className="knob-row">
        {module.parameters.map((parameter) => {
          const assignment = assignments.find(
            (candidate) => candidate.target === `${module.id}.${parameter.id}`
          );
          const effectiveValue = assignment
            ? getEffectiveMotionValue(parameter.value, assignment, xyPosition)
            : parameter.value;
          return (
          <Knob
            key={parameter.id}
            label={parameter.label}
            value={parameter.value}
            effectiveValue={effectiveValue}
            display={parameter.display}
            disabled={!module.available}
            patchTarget={`${module.id}.${parameter.id}`}
            assignment={assignment}
            onReset={() => onParameterReset(parameter.id)}
            onChange={(value) => onParameterChange(parameter.id, value)}
            onPatchStart={(startX, startY, pointerX, pointerY) =>
              onPatchStart(
                `${module.id}.${parameter.id}`,
                `${module.name} ${parameter.label}`,
                startX,
                startY,
                pointerX,
                pointerY
              )
            }
            onPatchMove={onPatchMove}
            onPatchEnd={onPatchEnd}
            onPatchDisconnect={() =>
              onPatchDisconnect(`${module.id}.${parameter.id}`)
            }
          />
          );
        })}
      </div>

      {!module.available && (
        <div className="coming-soon">DSP not connected</div>
      )}
    </article>
  );
}


type ViewportRenderCallback = (time: number) => void;

const viewportRenderCallbacks = new Set<ViewportRenderCallback>();
let viewportAnimationFrame = 0;

