import { useState } from 'react';
import {
  cancelFaceplateEditing,
  copyFaceplateLayoutJson,
  redoFaceplateLayout,
  resetFaceplateDraft,
  saveFaceplateLayout,
  startFaceplateEditing,
  toggleFaceplateSnap,
  undoFaceplateLayout,
  useFaceplateLayoutEditor,
} from '../../ui/faceplateLayout';

export function FaceplateLayoutEditor() {
  const editor = useFaceplateLayoutEditor();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyLayout = async (): Promise<void> => {
    const copied = await copyFaceplateLayoutJson();
    setCopyState(copied ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1400);
  };

  return (
    <>
      <button
        type="button"
        className={`profiler-toggle layout-editor-toggle ${editor.editing ? 'active' : ''}`}
        aria-pressed={editor.editing}
        onClick={editor.editing ? cancelFaceplateEditing : startFaceplateEditing}
        title={editor.editing ? 'Cancel faceplate editing' : 'Move module controls and resize the animation viewport'}
      >
        {editor.editing ? 'EXIT LAYOUT' : 'LAYOUT'}
      </button>

      {editor.editing && (
        <aside className="faceplate-editor-panel" aria-label="Module layout editor">
          <header>
            <div>
              <strong>FACEPLATE EDITOR</strong>
              <span>MASTER MODULE · DRAG KNOBS · DRAG SCREEN EDGE</span>
            </div>
            <span className="faceplate-editor-readout">
              VIEW {Math.round(editor.layout.viewportHeight)} · GRID {editor.layout.snap}px
            </span>
          </header>

          <div className="faceplate-editor-actions">
            <button
              type="button"
              className={editor.snapEnabled ? 'active' : ''}
              aria-pressed={editor.snapEnabled}
              onClick={toggleFaceplateSnap}
              title="Snap to the grid, module center, and other control rows/columns. Hold Alt while dragging to bypass snapping."
            >
              SNAP {editor.snapEnabled ? 'ON' : 'OFF'}
            </button>
            <button type="button" disabled={!editor.canUndo} onClick={undoFaceplateLayout}>UNDO</button>
            <button type="button" disabled={!editor.canRedo} onClick={redoFaceplateLayout}>REDO</button>
            <button type="button" onClick={resetFaceplateDraft}>RESET</button>
            <button type="button" onClick={() => void copyLayout()}>
              {copyState === 'copied' ? 'COPIED' : copyState === 'failed' ? 'COPY FAILED' : 'COPY JSON'}
            </button>
            <button type="button" className="cancel" onClick={cancelFaceplateEditing}>CANCEL</button>
            <button type="button" className="save" onClick={saveFaceplateLayout}>SAVE LAYOUT</button>
          </div>

          <p>Hold <b>ALT</b> for free movement. Saving stores the layout in this browser and applies it to every module.</p>
        </aside>
      )}
    </>
  );
}
