import {
  FACTORY_FACEPLATE_LAYOUT,
  saveFaceplateLayout,
  setRailCFaceplateControl,
  setRailCFaceplateViewportHeight,
  startFaceplateEditing,
  toggleFaceplateModuleLink,
} from './ui/faceplateLayout';

/**
 * Applies the approved compact v2 faceplate delta for Pressure.
 *
 * The core rack, Synth, and Chaos factory coordinates already match the approved
 * export. Pressure is the only changed module: 168px viewport and a 240px knob
 * row, while its button row remains at 278px.
 */
const pressure = FACTORY_FACEPLATE_LAYOUT.railC.pressure;
pressure.viewportHeight = 168;
pressure.stageHeight = 292;
pressure.knobs = [
  { x: 0.14, y: 240 },
  { x: 0.38, y: 240 },
  { x: 0.62, y: 240 },
  { x: 0.86, y: 240 },
];
pressure.buttons = [
  { x: 0.14, y: 278 },
  { x: 0.38, y: 278 },
  { x: 0.62, y: 278 },
  { x: 0.86, y: 278 },
];

if (typeof window !== 'undefined') {
  startFaceplateEditing();
  toggleFaceplateModuleLink();
  setRailCFaceplateViewportHeight('pressure', 168);
  pressure.knobs.forEach((point, index) => {
    setRailCFaceplateControl('pressure', 'knob', index, point);
  });
  pressure.buttons.forEach((point, index) => {
    setRailCFaceplateControl('pressure', 'button', index, point);
  });
  saveFaceplateLayout();
}
