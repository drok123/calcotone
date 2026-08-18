import { readFileSync } from 'node:fs';

const editor = readFileSync('src/components/layout/FaceplateLayoutEditor.tsx', 'utf8');
const state = readFileSync('src/ui/faceplateLayout.ts', 'utf8');
const effect = readFileSync('src/components/effects/EffectModule.tsx', 'utf8');
const railC = readFileSync('src/components/effects/RailCModules.tsx', 'utf8');
const failures = [];

const requireText = (source, token, label) => {
  if (!source.includes(token)) failures.push(`${label}: missing ${JSON.stringify(token)}`);
};

for (const [token, label] of [
  ['startFaceplateEditing', 'enter edit mode'],
  ['cancelFaceplateEditing', 'cancel edits'],
  ['saveFaceplateLayout', 'save edits'],
  ['resetFaceplateDraft', 'factory reset'],
  ['undoFaceplateLayout', 'undo'],
  ['redoFaceplateLayout', 'redo'],
  ['toggleFaceplateSnap', 'snap toggle'],
  ['toggleFaceplateModuleLink', 'linked/independent toggle'],
]) requireText(editor, token, `Architect ${label}`);

requireText(editor, "editor.linkedModules ? 'MODULES LINKED' : 'INDEPENDENT'", 'Architect linked-state UI');
requireText(editor, 'disabled={!editor.canUndo}', 'Architect undo availability');
requireText(editor, 'disabled={!editor.canRedo}', 'Architect redo availability');
requireText(editor, 'SAVE LAYOUT', 'Architect save control');
requireText(editor, 'COPY JSON', 'Architect layout export');

for (const [token, label] of [
  ['beginFaceplateGesture', 'gesture begin boundary'],
  ['endFaceplateGesture', 'gesture end boundary'],
  ['setFaceplateKnob(', 'core knob editing'],
  ['setFaceplateViewportHeight(', 'core viewport resizing'],
  ['setRailCFaceplateControl(', 'Rail C control editing'],
  ['setRailCFaceplateViewportHeight(', 'Rail C viewport resizing'],
  ['undo: changed ? [...state.undo, before] : state.undo', 'gesture-level undo capture'],
  ['redo: changed ? [] : state.redo', 'redo invalidation after edit'],
  ['window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))', 'saved-layout persistence'],
  ['window.localStorage.setItem(FACTORY_LAYOUT_REVISION_KEY, FACTORY_LAYOUT_STORAGE_REVISION)', 'layout revision persistence'],
  ['window.localStorage.getItem(FACTORY_LAYOUT_REVISION_KEY) !== FACTORY_LAYOUT_STORAGE_REVISION', 'stale-layout migration'],
  ['linkedModules: !state.linkedModules', 'independent module state'],
]) requireText(state, token, `Architect ${label}`);

// The editor must be mounted into both the six core effect faceplates and the
// three Rail-C faceplates. These checks catch a common regression where the
// Architect panel still opens but dragging a visible control no longer writes state.
for (const token of ['beginFaceplateGesture', 'endFaceplateGesture', 'setFaceplateKnob', 'setFaceplateViewportHeight']) {
  requireText(effect, token, `Core module Architect wiring ${token}`);
}
for (const token of ['beginFaceplateGesture', 'endFaceplateGesture', 'setRailCFaceplateControl', 'setRailCFaceplateViewportHeight']) {
  requireText(railC, token, `Rail C Architect wiring ${token}`);
}

if (failures.length) {
  console.error(`\nArchitect functionality audit failed:\n${failures.map((failure) => ` - ${failure}`).join('\n')}\n`);
  process.exit(1);
}

console.log('Architect functionality audit passed: edit, gesture, linked/independent, undo/redo, save/cancel and core/Rail-C wiring are present.');
