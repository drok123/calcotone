import type { CSSProperties, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { REVERB_ALGORITHM_ORDER, type ReverbAlgorithm } from '../../audio/effects/Reverb';
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
const REVERB_ALGORITHMS: ReverbAlgorithm[] = [...REVERB_ALGORITHM_ORDER];

type ParameterPresentation = {
  label: string;
  display: string;
  disabled?: boolean;
};

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
      className={`effect-module module-${module.id} ${module.enabled ? 'enabled' : ''} ${!module.available ? 'unavailable' : ''} ${routingDragging ? 'routing-dragging' : ''} ${routingDropTarget ? 'routing-drop-target' : ''}`}
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
                onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onDelayAlgorithmChange(event.target.value as DelayAlgorithm)}
              >
                {DELAY_ALGORITHMS.map((algorithm) => (
                  <option key={algorithm} value={algorithm}>{formatAlgorithmName(algorithm)}</option>
                ))}
              </select>
            </label>
          )}

          {module.id === 'saturation' && (
            <label className="algorithm-selector ember-mode-selector">
              <span className="sr-only">Ember mode</span>
              <select aria-label="Ember mode" value={module.emberMode ?? 'velvet'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onEmberModeChange(event.target.value as EmberMode)}>
                {EMBER_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{formatEmberMode(mode)}</option>)}
              </select>
            </label>
          )}

          {module.id === 'chorus' && (
            <label className="algorithm-selector drift-mode-selector">
              <span className="sr-only">Drift mode</span>
              <select aria-label="Drift mode" value={module.driftMode ?? 'chorus'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onDriftModeChange(event.target.value as DriftMode)}>
                {DRIFT_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{formatDriftMode(mode)}</option>)}
              </select>
            </label>
          )}

          {module.id === 'bitcrusher' && (
            <label className="algorithm-selector grain-mode-selector">
              <span className="sr-only">Grain mode</span>
              <select aria-label="Grain mode" value={module.grainMode ?? 'reconstruct'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onGrainModeChange(event.target.value as GrainMode)}>
                {GRAIN_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{formatGrainMode(mode)}</option>)}
              </select>
            </label>
          )}

          {module.id === 'reverb' && (
            <label className="algorithm-selector atmos-mode-selector">
              <span className="sr-only">Space</span>
              <select aria-label="Atmos space" value={module.algorithm ?? 'hall'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onAlgorithmChange(event.target.value as ReverbAlgorithm)}>
                {REVERB_ALGORITHMS.map((algorithm) => <option key={algorithm} value={algorithm}>{formatReverbMode(algorithm)}</option>)}
              </select>
            </label>
          )}

          {module.id === 'media' && (
            <label className="algorithm-selector media-mode-selector">
              <span className="sr-only">Format</span>
              <select aria-label="Artifact format" value={module.mediaMode ?? 'cassette'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onMediaModeChange(event.target.value as MediaMode)}>
                {MEDIA_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{formatMediaMode(mode)}</option>)}
              </select>
            </label>
          )}
        </div>

        <button type="button" className="module-toggle" disabled={!module.available} onClick={onToggle} aria-label={`${module.enabled ? 'Bypass' : 'Enable'} ${module.name}`} aria-pressed={module.enabled}>
          <span />
        </button>
      </header>

      <ModuleViewport module={module} visualState={visualState} />

      <div className="knob-row">
        {module.parameters.map((parameter) => {
          const assignment = assignments.find((candidate) => candidate.target === `${module.id}.${parameter.id}`);
          const effectiveValue = assignment ? getEffectiveMotionValue(parameter.value, assignment, xyPosition) : parameter.value;
          const presentation = parameterPresentation(module, parameter.id, parameter.label, parameter.display, parameter.value);
          return (
            <Knob
              key={parameter.id}
              label={presentation.label}
              value={parameter.value}
              effectiveValue={effectiveValue}
              display={presentation.display}
              disabled={!module.available || presentation.disabled === true}
              patchTarget={`${module.id}.${parameter.id}`}
              assignment={assignment}
              onReset={() => onParameterReset(parameter.id)}
              onChange={(value: number) => onParameterChange(parameter.id, value)}
              onPatchStart={(startX: number, startY: number, pointerX: number, pointerY: number) => onPatchStart(`${module.id}.${parameter.id}`, `${module.name} ${presentation.label}`, startX, startY, pointerX, pointerY)}
              onPatchMove={onPatchMove}
              onPatchEnd={onPatchEnd}
              onPatchDisconnect={() => onPatchDisconnect(`${module.id}.${parameter.id}`)}
            />
          );
        })}
      </div>

      {!module.available && <div className="coming-soon">DSP not connected</div>}
    </article>
  );
}

function formatEmberMode(mode: EmberMode): string {
  if (mode === 'goldlion') return 'Gold Lion B759';
  if (mode === 'mullard') return 'Mullard ECC83';
  if (mode === 'telefunken') return 'Telefunken ECC83';
  if (mode === 'bugleboy') return 'Amperex Bugle Boy';
  if (mode === 'rcablack') return 'RCA 12AX7 Black Plate';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatDriftMode(mode: DriftMode): string {
  if (mode === 'ce1') return 'BOSS CE-1';
  if (mode === 'dimensiond') return 'Roland Dimension D';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatGrainMode(mode: GrainMode): string {
  if (mode === 'sp1200') return 'E-mu SP-1200';
  if (mode === 'mpc60') return 'Akai MPC60';
  if (mode === 'mirage') return 'Ensoniq Mirage';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatReverbMode(mode: ReverbAlgorithm): string {
  if (mode === 'emt140') return 'EMT 140';
  if (mode === 'lexicon224') return 'Lexicon 224';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatMediaMode(mode: MediaMode): string {
  if (mode === 'tascam424') return 'TASCAM 424 MKI';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function parameterPresentation(module: ModuleState, parameterId: string, label: string, display: string, value: number): ParameterPresentation {
  if (module.id === 'media' && module.mediaMode === 'tascam424') {
    if (parameterId === 'wear') return { label: 'Trim', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'wow') return { label: 'Low', display: `${format424Eq(value, 0.16)} dB` };
    if (parameterId === 'noise') return { label: 'High', display: `${format424Eq(value, 0.10)} dB` };
    if (parameterId === 'tone') return { label: 'Drive', display: `${Math.round(value * 100)}%` };
  }

  if (module.id === 'delay' && module.delayAlgorithm === 're201') {
    if (parameterId === 'time') return { label: 'Repeat Rate', display };
    if (parameterId === 'feedback') return { label: 'Intensity', display };
    if (parameterId === 'color') return { label: 'Tone', display };
    if (parameterId === 'character') return { label: 'Tape Age', display };
    if (parameterId === 'width') return { label: 'Head Mix', display };
  }

  if (module.id === 'chorus' && module.driftMode === 'ce1') {
    if (parameterId === 'shape') return { label: 'Intensity', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'motion') return { label: 'Preamp', display: `${Math.round(value * 100)}%` };
  }

  if (module.id === 'chorus' && module.driftMode === 'dimensiond') {
    if (parameterId === 'shape') return { label: 'Mode', display: `${Math.max(1, Math.min(4, 1 + Math.floor(value * 3.999)))}` };
    if (parameterId === 'motion') return { label: 'Circuit', display: `${Math.round(value * 100)}%` };
  }

  if (module.id === 'reverb' && module.algorithm === 'emt140') {
    if (parameterId === 'size') return { label: 'Plate', display };
    if (parameterId === 'color') return { label: 'Damping', display };
    if (parameterId === 'diffusion') return { label: 'Tension', display };
    if (parameterId === 'motion') return { label: 'Pickup', display };
  }

  if (module.id === 'reverb' && module.algorithm === 'lexicon224') {
    if (parameterId === 'size') return { label: 'Depth', display };
    if (parameterId === 'color') return { label: 'Treble Decay', display };
    if (parameterId === 'diffusion') return { label: 'Diffusion', display };
    if (parameterId === 'motion') return { label: 'Mod', display };
  }

  if (module.id === 'bitcrusher' && module.grainMode === 'sp1200') {
    if (parameterId === 'bits') return { label: 'Output', display: sp1200OutputPair(value) };
    if (parameterId === 'density') return { label: 'Input', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'pitch') return { label: 'Clock', display: `${sp1200ClockKhz(value).toFixed(2)} kHz` };
    if (parameterId === 'chaos') return { label: 'Filter Env', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'bloom') return { label: 'Tone', display: `${Math.round(value * 100)}%` };
  }

  if (module.id === 'bitcrusher' && module.grainMode === 'mpc60') {
    if (parameterId === 'bits') return { label: 'Headroom', display: `${Math.round((1 - value) * 12)} dB` };
    if (parameterId === 'density') return { label: 'Input', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'pitch') return { label: 'Clock', display: '40 kHz FIXED', disabled: true };
    if (parameterId === 'chaos') return { label: 'Converter', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'bloom') return { label: 'Filter', display: `${Math.round(value * 100)}%` };
  }

  if (module.id === 'bitcrusher' && module.grainMode === 'mirage') {
    if (parameterId === 'bits') return { label: 'Depth', display: '8 BIT FIXED', disabled: true };
    if (parameterId === 'density') return { label: 'Drive', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'pitch') return { label: 'Sample Rate', display: `${mirageRateKhz(value).toFixed(1)} kHz` };
    if (parameterId === 'chaos') return { label: 'Resonance', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'bloom') return { label: 'Cutoff', display: `${Math.round(value * 100)}%` };
  }

  return { label, display };
}

function format424Eq(value: number, center: number): string {
  const normalized = value >= center ? (value - center) / Math.max(1e-6, 1 - center) : (value - center) / Math.max(1e-6, center);
  const db = normalized * 10;
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}

function sp1200OutputPair(value: number): string {
  const pair = Math.max(0, Math.min(3, Math.floor(value * 4)));
  return ['1 / 2', '3 / 4', '5 / 6', '7 / 8'][pair] ?? '1 / 2';
}

function sp1200ClockKhz(value: number): number {
  return value <= 0.005 ? 26.04 : 26.04 * (0.72 + value * 0.56);
}

function mirageRateKhz(value: number): number {
  return value <= 0.005 ? 32 : 10 + value * 23;
}
