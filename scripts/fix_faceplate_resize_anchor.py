from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:140]!r}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/ui/faceplateLayout.ts',
    """  viewportHeight: number;
  controlAreaHeight: number;
  knobs: FaceplatePoint[];""",
    """  viewportHeight: number;
  controlTop: number;
  controlAreaHeight: number;
  knobs: FaceplatePoint[];""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """export const FACTORY_FACEPLATE_LAYOUT: FaceplateLayout = {
  version: 1,
  custom: true,
  viewportHeight: 300,
  controlAreaHeight: 210,
  knobs: [
    { x: 0.17, y: 54 },
    { x: 0.50, y: 54 },
    { x: 0.83, y: 54 },
    { x: 0.17, y: 154 },
    { x: 0.50, y: 154 },
    { x: 0.83, y: 154 },
  ],
  snap: 8,
};""",
    """export const FACTORY_FACEPLATE_LAYOUT: FaceplateLayout = {
  version: 1,
  custom: true,
  viewportHeight: 192,
  controlTop: 204,
  controlAreaHeight: 322,
  knobs: [
    { x: 0.15929910480312698, y: 160 },
    { x: 0.5, y: 160 },
    { x: 0.85451197053407, y: 160 },
    { x: 0.15929910480312698, y: 264 },
    { x: 0.5, y: 264 },
    { x: 0.85451197053407, y: 264 },
  ],
  snap: 8,
};""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """export function setFaceplateViewportHeight(height: number): void {
  if (!state.editing) return;
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      viewportHeight: clamp(height, 160, 520),
    },
  };
  emit();
}""",
    """export function setFaceplateViewportHeight(height: number): void {
  if (!state.editing) return;
  const firstRowY = Math.min(...state.layout.knobs.map((point) => point.y));
  const collisionSafeMaximum = Math.max(160, state.layout.controlTop + firstRowY - 52);
  state = {
    ...state,
    layout: {
      ...state.layout,
      custom: true,
      viewportHeight: clamp(height, 120, Math.min(520, collisionSafeMaximum)),
    },
  };
  emit();
}""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """    viewportHeight: viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
    controlAreaHeight: Math.max(controlSurface.offsetHeight, Math.max(...knobs.map((point) => point.y)) + 54),
    knobs,""",
    """    viewportHeight: viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
    controlTop: (viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight) + 12,
    controlAreaHeight: Math.max(controlSurface.offsetHeight, Math.max(...knobs.map((point) => point.y)) + 54),
    knobs,""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """      viewportHeight: clamp(Number(parsed.viewportHeight) || 300, 160, 520),
      controlAreaHeight: clamp(Number(parsed.controlAreaHeight) || 210, 150, 360),
      knobs:""",
    """      viewportHeight: clamp(Number(parsed.viewportHeight) || 300, 120, 520),
      controlTop: clamp(Number(parsed.controlTop) || (Number(parsed.viewportHeight) || 300) + 12, 120, 560),
      controlAreaHeight: clamp(Number(parsed.controlAreaHeight) || 210, 150, 420),
      knobs:""",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
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
          if (!customFaceplate) return renderKnob(parameter);
          const point = faceplateEditor.layout.knobs[index] ?? { x: ((index % 3) + 0.5) / 3, y: index < 3 ? 54 : 154 };
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
      </div>""",
    """      {customFaceplate ? (
        <div
          className="faceplate-layout-stage"
          style={{ height: `${Math.max(faceplateEditor.layout.viewportHeight + 12, faceplateEditor.layout.controlTop + faceplateEditor.layout.controlAreaHeight)}px` }}
        >
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
                title="Drag only the screen edge · controls stay fixed · hold Alt to bypass snapping"
              >
                <span aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            className={`knob-row faceplate-control-surface ${faceplateEditor.editing ? 'is-editing' : ''}`}
            style={{ top: `${faceplateEditor.layout.controlTop}px`, height: `${faceplateEditor.layout.controlAreaHeight}px` }}
          >
            {faceplateEditor.editing && faceplateEditor.guides.x !== null && (
              <span className="faceplate-guide faceplate-guide-x" style={{ left: `${faceplateEditor.guides.x * 100}%` }} aria-hidden="true" />
            )}
            {faceplateEditor.editing && faceplateEditor.guides.y !== null && (
              <span className="faceplate-guide faceplate-guide-y" style={{ top: `${faceplateEditor.guides.y}px` }} aria-hidden="true" />
            )}
            {module.parameters.map((parameter, index) => {
              const point = faceplateEditor.layout.knobs[index] ?? { x: ((index % 3) + 0.5) / 3, y: index < 3 ? 160 : 264 };
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
      )}""",
)
replace_once(
    'src/components/motion/UiPolish.css',
    """.faceplate-layout-custom .faceplate-viewport-shell {
  position: relative;
  width: 100%;
  margin: 0 0 12px;
}""",
    """.faceplate-layout-stage {
  position: relative;
  width: 100%;
  min-height: 1px;
}

.faceplate-layout-custom .faceplate-viewport-shell {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 0;
  width: 100%;
  margin: 0;
}""",
)
replace_once(
    'src/components/motion/UiPolish.css',
    """.knob-row.faceplate-control-surface {
  position: relative;
  display: block;
  width: 100%;
  min-height: 150px;
  margin-top: 0;
  padding: 0;
  overflow: visible;
  border-top: 1px solid rgba(255,255,255,.045);
  background: linear-gradient(180deg, rgba(255,255,255,.012), transparent 68%);
}""",
    """.knob-row.faceplate-control-surface {
  position: absolute;
  z-index: 5;
  left: 0;
  display: block;
  width: 100%;
  min-height: 150px;
  margin: 0;
  padding: 0;
  overflow: visible;
  border-top: 0;
  background: transparent;
  pointer-events: none;
}""",
)
replace_once(
    'src/components/motion/UiPolish.css',
    ".faceplate-knob-slot > .knob-control { width: 100%; }",
    ".faceplate-knob-slot > .knob-control { width: 100%; pointer-events: auto; }",
)
