import type { CSSProperties, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { REVERB_ALGORITHM_ORDER, type ReverbAlgorithm } from '../../audio/effects/Reverb';
import { ARTIFACT_CONSOLE_MODES, MEDIA_MODE_GROUPS, type MediaMode } from '../../audio/effects/Media';
import { EMBER_DIGITAL_CAPTURE_MODES, EMBER_MODE_GROUPS, type EmberMode } from '../../audio/effects/Saturation';
import { DRIFT_MODE_ORDER, type DriftMode } from '../../audio/effects/Chorus';
import { GRAIN_MODE_GROUPS, type GrainMode } from '../../audio/effects/Bitcrusher';
import { DELAY_ALGORITHM_ORDER, type DelayAlgorithm } from '../../audio/effects/Delay';
import type { VisualAudioState } from '../../visual/VisualEngine';
import type { ModuleParameter, ModuleState, XYAssignment } from '../../ui/types';
import { formatAlgorithmName } from '../../ui/formatting';
import { getEffectiveMotionValue } from '../../ui/motion';
import {
  beginFaceplateGesture,
  endFaceplateGesture,
  setFaceplateGuides,
  setFaceplateKnob,
  setFaceplateViewportHeight,
  snapFaceplatePoint,
  useFaceplateLayoutEditor,
  type CoreFaceplateId,
} from '../../ui/faceplateLayout';
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
  const faceplateEditor = useFaceplateLayoutEditor();
  const customFaceplate = faceplateEditor.layout.custom;
  const faceplateModuleId = module.id as CoreFaceplateId;
  const faceplateLayout = faceplateEditor.layout.core[faceplateModuleId];
  const moduleStyle = {
    '--module-activity': module.enabled ? 1 : 0,
    '--module-low': visualState.low,
    '--module-mid': visualState.mid,
    '--module-high': visualState.high,
    '--module-delay': `${(Number(slotLabel.slice(1)) - 1) * 65}ms`,
  } as CSSProperties;

  function beginKnobLayoutDrag(index: number, event: ReactPointerEvent<HTMLDivElement>): void {
    if (!faceplateEditor.editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const surface = event.currentTarget.parentElement;
    if (!surface) return;

    const pointerId = event.pointerId;
    const bounds = surface.getBoundingClientRect();
    const scale = bounds.width / Math.max(1, surface.offsetWidth);
    beginFaceplateGesture();
    document.body.classList.add('faceplate-layout-dragging');

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      const raw = {
        x: (pointerEvent.clientX - bounds.left) / Math.max(1, bounds.width),
        y: (pointerEvent.clientY - bounds.top) / Math.max(0.01, scale),
      };
      const snapped = snapFaceplatePoint(faceplateModuleId, index, raw, surface.offsetWidth, pointerEvent.altKey);
      setFaceplateKnob(faceplateModuleId, index, snapped.point);
      setFaceplateGuides(snapped.guides);
    };

    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('faceplate-layout-dragging');
      setFaceplateGuides({ x: null, y: null });
      endFaceplateGesture();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
  }

  function beginViewportResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!faceplateEditor.editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const shell = event.currentTarget.parentElement;
    if (!shell) return;

    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = faceplateLayout.viewportHeight;
    const bounds = shell.getBoundingClientRect();
    const scale = bounds.height / Math.max(1, shell.offsetHeight);
    beginFaceplateGesture();
    document.body.classList.add('faceplate-layout-resizing');

    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      let height = startHeight + (pointerEvent.clientY - startY) / Math.max(0.01, scale);
      if (faceplateEditor.snapEnabled && !pointerEvent.altKey) {
        height = Math.round(height / faceplateEditor.layout.snap) * faceplateEditor.layout.snap;
      }
      setFaceplateViewportHeight(faceplateModuleId, height);
    };

    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('faceplate-layout-resizing');
      endFaceplateGesture();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
  }

  function renderKnob(parameter: ModuleParameter) {
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
  }

  return (
    <article
      className={`effect-module module-${module.id} ${module.enabled ? 'enabled' : ''} ${!module.available ? 'unavailable' : ''} ${routingDragging ? 'routing-dragging' : ''} ${routingDropTarget ? 'routing-drop-target' : ''} ${customFaceplate ? 'faceplate-layout-custom' : ''} ${faceplateEditor.editing ? 'faceplate-layout-editing' : ''}`}
      style={moduleStyle}
      onDragOver={onRoutingDragOver}
      onDrop={onRoutingDrop}
    >
      <header className="module-header">
        <div
          className="module-title module-drag-handle"
          draggable={module.available && !faceplateEditor.editing}
          role="button"
          tabIndex={module.available && !faceplateEditor.editing ? 0 : -1}
          aria-label={`${module.name}, signal slot ${slotLabel}. Drag to reorder or exchange rack rails; use left and right arrow keys within this rail.`}
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
          title="Drag to any rack slot · or focus and use ← / → within this rail"
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
                {EMBER_MODE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.modes.map((mode) => <option key={mode} value={mode}>{formatEmberMode(mode)}</option>)}
                  </optgroup>
                ))}
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
              <select aria-label="Grain mode" value={module.grainMode ?? 'smear'} onChange={(event: ReactChangeEvent<HTMLSelectElement>) => onGrainModeChange(event.target.value as GrainMode)}>
                {GRAIN_MODE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.modes.map((mode) => <option key={mode} value={mode}>{formatGrainMode(mode)}</option>)}
                  </optgroup>
                ))}
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
                {MEDIA_MODE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.modes.map((mode) => <option key={mode} value={mode}>{formatMediaMode(mode)}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
        </div>

        <button type="button" className="module-toggle" disabled={!module.available} onClick={onToggle} aria-label={`${module.enabled ? 'Bypass' : 'Enable'} ${module.name}`} aria-pressed={module.enabled}>
          <span />
        </button>
      </header>

      {customFaceplate ? (
        <div
          className="faceplate-layout-stage"
          style={{ height: `${faceplateLayout.stageHeight}px` }}
        >
          <div
            className={`faceplate-viewport-shell ${faceplateEditor.editing ? 'is-editing' : ''}`}
            style={{ height: `${faceplateLayout.viewportHeight}px` }}
          >
            <ModuleViewport module={module} visualState={visualState} />
            {faceplateEditor.editing && (
              <button
                type="button"
                className="faceplate-viewport-resize"
                onPointerDown={beginViewportResize}
                aria-label="Resize module animation viewport"
                title="Drag only the screen edge · controls stay fixed · hold Alt to bypass snapping"
              >
                <span aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            className={`knob-row faceplate-control-surface ${faceplateEditor.editing ? 'is-editing' : ''}`}
            style={{ top: 0, height: `${faceplateLayout.stageHeight}px` }}
          >
            {faceplateEditor.editing && faceplateEditor.guides.x !== null && (
              <span className="faceplate-guide faceplate-guide-x" style={{ left: `${faceplateEditor.guides.x * 100}%` }} aria-hidden="true" />
            )}
            {faceplateEditor.editing && faceplateEditor.guides.y !== null && (
              <span className="faceplate-guide faceplate-guide-y" style={{ top: `${faceplateEditor.guides.y}px` }} aria-hidden="true" />
            )}
            {module.parameters.map((parameter, index) => {
              const point = faceplateLayout.knobs[index] ?? { x: ((index % 3) + 0.5) / 3, y: index < 3 ? 364 : 468 };
              return (
                <div
                  key={parameter.id}
                  className="faceplate-knob-slot"
                  style={{ '--faceplate-x': `${point.x * 100}%`, '--faceplate-y': `${point.y}px` } as CSSProperties}
                  onPointerDownCapture={faceplateEditor.editing ? (event) => beginKnobLayoutDrag(index, event) : undefined}
                  title={faceplateEditor.editing ? 'Drag control to reposition · hold Alt to bypass snapping' : undefined}
                >
                  {renderKnob(parameter)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <ModuleViewport module={module} visualState={visualState} />
          <div className="knob-row">
            {module.parameters.map((parameter) => renderKnob(parameter))}
          </div>
        </>
      )}

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
  if (mode === 'sp1200') return 'E-mu SP-1200';
  if (mode === 'mpc60') return 'Akai MPC60';
  if (mode === 'mirage') return 'Ensoniq Mirage';
  if (mode === 's950') return 'Akai S950';
  if (mode === 'emulator2') return 'E-mu Emulator II';
  if (mode === 'fairlightiix') return 'Fairlight CMI IIx';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatDriftMode(mode: DriftMode): string {
  if (mode === 'ce1') return 'BOSS CE-1';
  if (mode === 'dimensiond') return 'Roland Dimension D';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatGrainMode(mode: GrainMode): string {
  if (mode === 'clouds') return 'Mutable Instruments Clouds';
  if (mode === 'beads') return 'Mutable Instruments Beads';
  if (mode === 'morphagene') return 'Make Noise Morphagene';
  if (mode === 'arbhar') return 'Instruō arbhar';
  if (mode === 'particle2') return 'Red Panda Particle 2';
  if (mode === 'microcosm') return 'Hologram Microcosm';
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
  if (module.id === 'saturation' && module.emberMode && EMBER_DIGITAL_CAPTURE_MODES.some((mode) => mode === module.emberMode)) {
    const mode = module.emberMode;
    if (parameterId === 'drive') return { label: 'Input', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'tone') {
      if (mode === 'sp1200') return { label: 'Output Pair', display: sp1200OutputPair(value) };
      if (mode === 'mpc60') return { label: 'Clock', display: '40.0 kHz FIXED', disabled: true };
      if (mode === 'emulator2') return { label: 'Clock', display: '27.0 kHz FIXED', disabled: true };
      return { label: 'Sample Rate', display: `${digitalCaptureSampleRateKhz(mode, value).toFixed(1)} kHz` };
    }
    if (parameterId === 'heat') return { label: mode === 'mirage' || mode === 'emulator2' ? 'Resonance' : 'Converter', display };
    if (parameterId === 'character') return { label: 'Filter', display };
    if (parameterId === 'dynamics') return { label: 'Contour', display };
  }

  if (module.id === 'delay' && module.delayAlgorithm === 're201') {
    if (parameterId === 'time') return { label: 'Repeat Rate', display };
    if (parameterId === 'feedback') return { label: 'Intensity', display };
    if (parameterId === 'color') return { label: 'Tone', display };
    if (parameterId === 'character') return { label: 'Tape Age', display };
    if (parameterId === 'width') return { label: 'Mode', display: `MODE ${re201Mode(value)}` };
  }

  if (module.id === 'chorus' && module.driftMode === 'ce1') {
    if (parameterId === 'rate') return { label: 'Rate', display: 'INTENSITY', disabled: true };
    if (parameterId === 'depth') return { label: 'Depth', display: 'INTENSITY', disabled: true };
    if (parameterId === 'shape') return { label: 'Intensity', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'spread') return { label: 'Stereo', display: 'CLASSIC', disabled: true };
    if (parameterId === 'motion') return { label: 'Preamp', display: `${Math.round(value * 100)}%` };
  }

  if (module.id === 'chorus' && module.driftMode === 'dimensiond') {
    if (parameterId === 'rate') return { label: 'Rate', display: 'FIXED', disabled: true };
    if (parameterId === 'depth') return { label: 'Depth', display: 'FIXED', disabled: true };
    if (parameterId === 'shape') return { label: 'Mode', display: dimensionDMode(value) };
    if (parameterId === 'spread') return { label: 'Stereo', display: 'FIXED', disabled: true };
    if (parameterId === 'motion') return { label: 'Circuit', display: 'FIXED', disabled: true };
  }

  if (module.id === 'reverb' && module.algorithm === 'emt140') {
    if (parameterId === 'decay') return { label: 'Damper', display: `${emt140Decay(value).toFixed(1)} s` };
    if (parameterId === 'size') return { label: 'Plate', display: '140', disabled: true };
    if (parameterId === 'color') return { label: 'Damping', display };
    if (parameterId === 'diffusion') return { label: 'Tension', display };
    if (parameterId === 'motion') return { label: 'Mod', display: 'NONE', disabled: true };
  }

  if (module.id === 'reverb' && module.algorithm === 'lexicon224') {
    if (parameterId === 'size') return { label: 'Depth', display };
    if (parameterId === 'color') return { label: 'Treble Decay', display };
    if (parameterId === 'diffusion') return { label: 'Diffusion', display };
    if (parameterId === 'motion') return { label: 'Mod', display };
  }

  if (module.id === 'bitcrusher' && module.grainMode) {
    const mode = module.grainMode;
    if (parameterId === 'bits') {
      const labelByMode: Record<GrainMode, string> = {
        smear:'Window', scatter:'Fragment', slice:'Slice', prism:'Window', freeze:'Capture', mosaic:'Fragment',
        clouds:'Size', beads:'Size', morphagene:'Gene Size', arbhar:'Length', particle2:'Chop', microcosm:'Subdivision',
      };
      return { label: labelByMode[mode], display: grainWindowDisplay(mode, value) };
    }
    if (parameterId === 'density') {
      const labelByMode: Record<GrainMode, string> = {
        smear:'Overlap', scatter:'Activity', slice:'Tightness', prism:'Voices', freeze:'Texture', mosaic:'Pieces',
        clouds:'Density', beads:'Rate', morphagene:'Morph', arbhar:'Intensity', particle2:'Density', microcosm:'Activity',
      };
      return { label: labelByMode[mode], display };
    }
    if (parameterId === 'pitch') {
      const labelByMode: Record<GrainMode, string> = {
        smear:'Pitch Drift', scatter:'Pitch Range', slice:'Pitch', prism:'Harmony', freeze:'Transpose', mosaic:'Pitch Range',
        clouds:'Pitch', beads:'Pitch', morphagene:'Vari-Speed', arbhar:'Pitch', particle2:'Shift', microcosm:'Shape',
      };
      return { label: labelByMode[mode], display: grainPitchDisplay(mode, value) };
    }
    if (parameterId === 'chaos') {
      const labelByMode: Record<GrainMode, string> = {
        smear:'Motion', scatter:'Spread', slice:'Offset', prism:'Detune', freeze:'Refresh', mosaic:'Order',
        clouds:'Position', beads:'Random', morphagene:'Slide', arbhar:'Spray', particle2:'Random', microcosm:'Variation',
      };
      return { label: labelByMode[mode], display };
    }
    if (parameterId === 'bloom') {
      const labelByMode: Record<GrainMode, string> = {
        smear:'Memory', scatter:'History', slice:'Repeats', prism:'Body', freeze:'Hold', mosaic:'Cohesion',
        clouds:'Texture', beads:'Feedback', morphagene:'Organize', arbhar:'Layer', particle2:'Feedback', microcosm:'Repeats',
      };
      return { label: labelByMode[mode], display };
    }
  }

  if (module.id === 'media' && module.mediaMode && ARTIFACT_CONSOLE_MODES.some((mode) => mode === module.mediaMode)) {
    const mode = module.mediaMode;
    if (parameterId === 'wear') {
      const consoleLabel = mode === 'tascam424' ? 'Trim' : mode === 'Neve 1073' ? 'Cohesion' : mode === 'SSL 4000E' ? 'Glue' : 'Punch';
      return { label: consoleLabel, display };
    }
    if (parameterId === 'wow') return { label: mode === 'tascam424' ? 'Low' : 'Weight', display: mode === 'tascam424' ? consoleEqDb(value, 0.16) : display };
    if (parameterId === 'noise') return { label: mode === 'tascam424' ? 'High' : mode === 'Neve 1073' ? 'Air' : 'Presence', display: mode === 'tascam424' ? consoleEqDb(value, 0.1) : display };
    if (parameterId === 'tone') return { label: mode === 'SSL 4000E' ? 'Punch' : mode === 'tascam424' ? 'Drive' : 'Iron', display };
  }

  return { label, display };
}

function sp1200OutputPair(value: number): string {
  const pair = Math.max(0, Math.min(3, Math.floor(value * 4)));
  return ['1 / 2', '3 / 4', '5 / 6', '7 / 8'][pair] ?? '1 / 2';
}

function grainWindowDisplay(mode: GrainMode, value: number): string {
  if (mode === 'microcosm') {
    const divisions = ['1/32', '1/24', '1/16', '1/12', '1/8', '1/6', '1/4', '1/2'];
    return divisions[Math.min(divisions.length - 1, Math.floor(value * divisions.length))] ?? '1/16';
  }
  const milliseconds = mode === 'smear' ? 150 + value * 520
    : mode === 'scatter' ? 18 + value * 66
    : mode === 'mosaic' ? 36 + value * 150
    : mode === 'prism' ? 58 + value * 120
    : mode === 'slice' ? 24 + value * 210
    : mode === 'freeze' ? 120 + value * 640
    : mode === 'clouds' ? 16 + value * 984
    : mode === 'beads' ? 30 + value * 1970
    : mode === 'morphagene' ? 40 + value * 960
    : mode === 'arbhar' ? 20 + value * 2980
    : 15 + value * 235;
  return `${Math.round(milliseconds)} ms`;
}

function grainPitchDisplay(mode: GrainMode, value: number): string {
  if (mode === 'prism' || mode === 'microcosm') return `SET ${1 + Math.min(4, Math.floor(value * 5))}`;
  const semitones = mode === 'smear' ? value * 1.8
    : mode === 'scatter' ? value * 9
    : mode === 'mosaic' ? value * 7
    : mode === 'clouds' || mode === 'beads' || mode === 'morphagene' ? value * 24
    : value * 12;
  const precision = mode === 'smear' ? 1 : 0;
  return `±${semitones.toFixed(precision)} st`;
}

function re201Mode(value: number): number {
  return Math.max(1, Math.min(7, 1 + Math.floor(value * 7)));
}

function dimensionDMode(value: number): string {
  const index = Math.max(0, Math.min(6, Math.floor(value * 7)));
  return ['1', '2', '3', '4', '1+4', '2+4', '3+4'][index] ?? '1';
}

function emt140Decay(value: number): number {
  return 0.5 + Math.max(0, Math.min(1, value)) * 5;
}

function digitalCaptureSampleRateKhz(mode: EmberMode, value: number): number {
  if (mode === 'mirage') return value <= 0.005 ? 32 : 10 + value * 23;
  if (mode === 's950') return 7.5 + value * 40.5;
  if (mode === 'fairlightiix') return 24 + value * 8;
  return mode === 'sp1200' ? 26.04 : mode === 'mpc60' ? 40 : 27;
}

function consoleEqDb(value: number, center: number): string {
  const bipolar = value >= center
    ? (value - center) / Math.max(1e-6, 1 - center)
    : (value - center) / Math.max(1e-6, center);
  const decibels = bipolar * 10;
  return `${decibels >= 0 ? '+' : ''}${decibels.toFixed(1)} dB`;
}
