from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, content: str) -> None:
    target = Path(path)
    text = target.read_text()
    if marker in text:
        raise SystemExit(f"{path}: marker already present: {marker}")
    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n")


# App: expose one small Layout button in the existing top control strip.
replace_once(
    'src/App.tsx',
    "import { RecorderPanel, type RecordedTake } from './components/recorder/RecorderPanel';",
    "import { RecorderPanel, type RecordedTake } from './components/recorder/RecorderPanel';\nimport { FaceplateLayoutEditor } from './components/layout/FaceplateLayoutEditor';",
)
replace_once(
    'src/App.tsx',
    """          <button type="button" className={`profiler-toggle ${explainMode ? 'active' : ''}`} aria-pressed={explainMode} onClick={() => setExplainMode((value) => !value)}>EXPLAIN</button>
          <button type="button" className={`profiler-toggle ${profilerOpen ? 'active' : ''}`} aria-pressed={profilerOpen} onClick={() => setProfilerOpen((open) => !open)}>DSP</button>""",
    """          <button type="button" className={`profiler-toggle ${explainMode ? 'active' : ''}`} aria-pressed={explainMode} onClick={() => setExplainMode((value) => !value)}>EXPLAIN</button>
          <FaceplateLayoutEditor />
          <button type="button" className={`profiler-toggle ${profilerOpen ? 'active' : ''}`} aria-pressed={profilerOpen} onClick={() => setProfilerOpen((open) => !open)}>DSP</button>""",
)

# EffectModule: consume the one shared faceplate layout and turn knobs/screens into editor handles.
replace_once(
    'src/components/effects/EffectModule.tsx',
    "import type { CSSProperties, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';",
    "import type { CSSProperties, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
    "import type { ModuleState, XYAssignment } from '../../ui/types';",
    "import type { ModuleParameter, ModuleState, XYAssignment } from '../../ui/types';",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
    "import { getEffectiveMotionValue } from '../../ui/motion';",
    """import { getEffectiveMotionValue } from '../../ui/motion';
import {
  beginFaceplateGesture,
  endFaceplateGesture,
  setFaceplateGuides,
  setFaceplateKnob,
  setFaceplateViewportHeight,
  snapFaceplatePoint,
  useFaceplateLayoutEditor,
} from '../../ui/faceplateLayout';""",
)

replace_once(
    'src/components/effects/EffectModule.tsx',
    """  const moduleStyle = {
    '--module-activity': module.enabled ? 1 : 0,
    '--module-low': visualState.low,
    '--module-mid': visualState.mid,
    '--module-high': visualState.high,
    '--module-delay': `${(Number(slotLabel.slice(1)) - 1) * 65}ms`,
  } as CSSProperties;

  return (""",
    """  const faceplateEditor = useFaceplateLayoutEditor();
  const customFaceplate = faceplateEditor.layout.custom;
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
      const snapped = snapFaceplatePoint(index, raw, surface.offsetWidth, pointerEvent.altKey);
      setFaceplateKnob(index, snapped.point);
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
    const startHeight = faceplateEditor.layout.viewportHeight;
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
      setFaceplateViewportHeight(height);
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

  function renderKnob(parameter: ModuleParameter, index: number) {
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

  return (""",
)

replace_once(
    'src/components/effects/EffectModule.tsx',
    """      className={`effect-module module-${module.id} ${module.enabled ? 'enabled' : ''} ${!module.available ? 'unavailable' : ''} ${routingDragging ? 'routing-dragging' : ''} ${routingDropTarget ? 'routing-drop-target' : ''}`}""",
    """      className={`effect-module module-${module.id} ${module.enabled ? 'enabled' : ''} ${!module.available ? 'unavailable' : ''} ${routingDragging ? 'routing-dragging' : ''} ${routingDropTarget ? 'routing-drop-target' : ''} ${customFaceplate ? 'faceplate-layout-custom' : ''} ${faceplateEditor.editing ? 'faceplate-layout-editing' : ''}`}""",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
    "draggable={module.available}",
    "draggable={module.available && !faceplateEditor.editing}",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
    "tabIndex={module.available ? 0 : -1}",
    "tabIndex={module.available && !faceplateEditor.editing ? 0 : -1}",
)

replace_once(
    'src/components/effects/EffectModule.tsx',
    """      <ModuleViewport module={module} visualState={visualState} />

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
      </div>""",
    """      {customFaceplate ? (
        <div
          className={`faceplate-viewport-shell ${faceplateEditor.editing ? 'is-editing' : ''}`}
          style={{ height: `${faceplateEditor.layout.viewportHeight}px` }}
        >
          <ModuleViewport module={module} visualState={visualState} />
          {faceplateEditor.editing && (
            <button
              type="button"
              className="faceplate-viewport-resize"
              onPointerDown={beginViewportResize}
              aria-label="Resize module animation viewport"
              title="Drag to resize viewport · hold Alt to bypass snapping"
            >
              <span aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <ModuleViewport module={module} visualState={visualState} />
      )}

      <div
        className={`knob-row ${customFaceplate ? 'faceplate-control-surface' : ''} ${faceplateEditor.editing ? 'is-editing' : ''}`}
        style={customFaceplate ? { height: `${faceplateEditor.layout.controlAreaHeight}px` } : undefined}
      >
        {customFaceplate && faceplateEditor.editing && faceplateEditor.guides.x !== null && (
          <span className="faceplate-guide faceplate-guide-x" style={{ left: `${faceplateEditor.guides.x * 100}%` }} aria-hidden="true" />
        )}
        {customFaceplate && faceplateEditor.editing && faceplateEditor.guides.y !== null && (
          <span className="faceplate-guide faceplate-guide-y" style={{ top: `${faceplateEditor.guides.y}px` }} aria-hidden="true" />
        )}
        {module.parameters.map((parameter, index) => {
          if (!customFaceplate) return renderKnob(parameter, index);
          const point = faceplateEditor.layout.knobs[index] ?? { x: ((index % 3) + 0.5) / 3, y: index < 3 ? 54 : 154 };
          return (
            <div
              key={parameter.id}
              className="faceplate-knob-slot"
              style={{ '--faceplate-x': `${point.x * 100}%`, '--faceplate-y': `${point.y}px` } as CSSProperties}
              onPointerDownCapture={faceplateEditor.editing ? (event) => beginKnobLayoutDrag(index, event) : undefined}
              title={faceplateEditor.editing ? 'Drag control to reposition · hold Alt to bypass snapping' : undefined}
            >
              {renderKnob(parameter, index)}
            </div>
          );
        })}
      </div>""",
)

append_once(
    'src/components/motion/UiPolish.css',
    'FACEPLATE LAYOUT EDITOR V1',
    r'''/* --------------------------------------------------------------------------
   FACEPLATE LAYOUT EDITOR V1
   One saved master geometry is shared by all six modules.
   -------------------------------------------------------------------------- */

.control-strip {
  position: relative;
  overflow: visible;
  z-index: 80;
}

.control-strip .layout-editor-toggle {
  color: #b9e9ee;
  border-color: rgba(104, 198, 207, .48);
}

.control-strip .layout-editor-toggle.active {
  color: #e8fcff;
  border-color: rgba(103, 224, 232, .72);
  background:
    linear-gradient(180deg, rgba(255,255,255,.08), transparent 34%),
    linear-gradient(180deg, #173239, #0b181c);
  box-shadow: inset 0 0 14px rgba(91, 222, 231, .08), 0 0 12px rgba(91, 222, 231, .08), 0 3px 7px rgba(0,0,0,.4);
}

.faceplate-editor-panel {
  position: absolute;
  z-index: 300;
  top: calc(100% + 8px);
  right: 18px;
  width: min(760px, calc(100vw - 44px));
  padding: 12px;
  border: 1px solid rgba(96, 112, 117, .88);
  border-radius: 9px;
  color: #dce5e4;
  background:
    linear-gradient(180deg, rgba(255,255,255,.045), transparent 24%),
    #111619;
  box-shadow: 0 16px 34px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.055), inset 0 -1px rgba(0,0,0,.9);
}

.faceplate-editor-panel header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
  padding-bottom: 9px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}

.faceplate-editor-panel header div {
  display: grid;
  gap: 4px;
}

.faceplate-editor-panel strong {
  color: #f0f7f7;
  font: 900 .68rem/1 var(--mono);
  letter-spacing: .13em;
}

.faceplate-editor-panel header span,
.faceplate-editor-panel p {
  color: #8fa3a4;
  font: 800 .50rem/1.35 var(--mono);
  letter-spacing: .055em;
}

.faceplate-editor-readout {
  color: #9de6eb !important;
  white-space: nowrap;
}

.faceplate-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.faceplate-editor-actions button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(90, 102, 107, .72);
  border-radius: 5px;
  color: #cbd5d4;
  background: linear-gradient(180deg, #2d3337, #171b1e);
  box-shadow: inset 0 1px rgba(255,255,255,.08), 0 2px 5px rgba(0,0,0,.34);
  font: 900 .52rem/1 var(--mono);
  letter-spacing: .08em;
}

.faceplate-editor-actions button:hover:not(:disabled) { color: #fff; filter: brightness(1.09); }
.faceplate-editor-actions button:disabled { opacity: .34; cursor: default; }
.faceplate-editor-actions button.active { color: #dffcff; border-color: rgba(91,222,231,.58); background: linear-gradient(#18343a,#0d1c20); }
.faceplate-editor-actions button.cancel { margin-left: auto; }
.faceplate-editor-actions button.save { color: #dfffe9; border-color: rgba(101,255,154,.48); background: linear-gradient(#1b3927,#0d1d14); }
.faceplate-editor-panel p { margin: 9px 2px 0; }
.faceplate-editor-panel p b { color: #cbe5e5; }

.faceplate-layout-custom .faceplate-viewport-shell {
  position: relative;
  width: 100%;
  margin: 0 0 12px;
}

.faceplate-layout-custom .faceplate-viewport-shell .dsp-viewport {
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
}

.faceplate-viewport-resize {
  position: absolute;
  z-index: 30;
  left: 12%;
  right: 12%;
  bottom: -7px;
  height: 15px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ns-resize;
  touch-action: none;
}

.faceplate-viewport-resize::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 6px;
  height: 2px;
  border-radius: 99px;
  background: rgba(91, 222, 231, .68);
  box-shadow: 0 0 8px rgba(91, 222, 231, .34);
}

.faceplate-viewport-resize span {
  position: absolute;
  left: 50%;
  top: 2px;
  width: 36px;
  height: 10px;
  border: 1px solid rgba(120, 223, 230, .62);
  border-radius: 4px;
  background: #10181b;
  transform: translateX(-50%);
}

.knob-row.faceplate-control-surface {
  position: relative;
  display: block;
  width: 100%;
  min-height: 150px;
  margin-top: 0;
  padding: 0;
  overflow: visible;
  border-top: 1px solid rgba(255,255,255,.045);
  background: linear-gradient(180deg, rgba(255,255,255,.012), transparent 68%);
}

.faceplate-knob-slot {
  position: absolute;
  z-index: 3;
  left: var(--faceplate-x);
  top: var(--faceplate-y);
  width: 92px;
  transform: translate(-50%, -50%);
  touch-action: none;
}

.faceplate-knob-slot > .knob-control { width: 100%; }

.faceplate-layout-editing {
  outline: 1px solid rgba(91, 222, 231, .20);
  outline-offset: -3px;
}

.faceplate-layout-editing .module-header {
  pointer-events: none;
  opacity: .72;
}

.faceplate-layout-editing .faceplate-knob-slot {
  z-index: 20;
  cursor: move;
}

.faceplate-layout-editing .faceplate-knob-slot::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -4px 2px -4px;
  border: 1px dashed rgba(91, 222, 231, .26);
  border-radius: 8px;
  background: rgba(8, 24, 27, .08);
  opacity: .72;
}

.faceplate-layout-editing .faceplate-knob-slot:hover::before {
  border-color: rgba(91, 222, 231, .72);
  background: rgba(31, 91, 96, .10);
  box-shadow: 0 0 12px rgba(91, 222, 231, .08);
}

.faceplate-layout-editing .knob-shell,
.faceplate-layout-editing .knob-patch-jack {
  pointer-events: none;
}

.faceplate-guide {
  position: absolute;
  z-index: 60;
  pointer-events: none;
  background: rgba(79, 222, 235, .86);
  box-shadow: 0 0 7px rgba(79, 222, 235, .42);
}

.faceplate-guide-x {
  top: -6px;
  bottom: -6px;
  width: 1px;
}

.faceplate-guide-y {
  left: -6px;
  right: -6px;
  height: 1px;
}

body.faceplate-layout-dragging,
body.faceplate-layout-dragging * { cursor: move !important; user-select: none !important; }
body.faceplate-layout-resizing,
body.faceplate-layout-resizing * { cursor: ns-resize !important; user-select: none !important; }

@media (max-width: 900px) {
  .faceplate-editor-panel { right: 8px; width: calc(100vw - 24px); }
  .faceplate-editor-actions button.cancel { margin-left: 0; }
}
'''
)
