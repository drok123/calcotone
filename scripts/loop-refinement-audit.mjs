import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const css = read('src/loopRefinement.css');
const display = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');
const main = read('src/main.tsx');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText(main, "import './loopRefinement.css'", 'Loop refinement layer installed');
requireText(css, '.module-pressure {', 'Loop refinement is module-scoped');
forbidText(css, '.module-stomp', 'Loop refinement must not touch Stomp');
forbidText(css, '.module-chaos', 'Loop refinement must not touch Stack');
requireText(css, '--loop-header-height: 68px', 'Loop compact header height');
requireText(css, '--loop-stage-height: 250px', 'Loop compact stage height');
requireText(css, '--loop-trim-height: 88px', 'Loop transient utility screen height');
requireText(css, '--loop-fader-y: 151px', 'Uniform fader row');
requireText(css, '--loop-knob-y: 220px', 'Uniform Loop knob row');
requireText(css, 'grid-template-columns: 92px minmax(0, 1fr) 48px', 'Clock cannot expand into a banner');
requireText(css, 'grid-template-columns: repeat(7, minmax(0, 1fr))', 'Normal utility controls share equal columns');
requireText(css, '.faceplate-knob-slot:nth-of-type(1) { left: 12.5% !important; }', 'T1 fader fixed to first quarter center');
requireText(css, '.faceplate-knob-slot:nth-of-type(4) { left: 87.5% !important; }', 'T4 fader fixed to fourth quarter center');
requireText(css, '.faceplate-pressure-slot:nth-child(1) { left: 12.5% !important; }', 'T1 Loop knob aligned to fader');
requireText(css, '.faceplate-pressure-slot:nth-child(4) { left: 87.5% !important; }', 'T4 Loop knob aligned to fader');
requireText(css, 'width: 52px !important', 'Loop knob diameter locked');
requireText(css, 'repeating-conic-gradient(', '505 segmented Loop indicator ring');
requireText(css, 'rgba(248, 244, 232, .98)', '505 indicator uses off-white illumination');
requireText(css, '@keyframes loop-505-ring-breathe', 'Write-state indicator breathes without color shift');
requireText(css, '.module-pressure.faceplate-layout-editing .faceplate-knob-slot', 'Loop geometry cannot be free-dragged out of uniformity');
requireText(display, 'function drawTransientEditor(', 'Loop display is a transient utility editor');
requireText(display, 'const waveform = runtime?.waveform ?? state.waveform', 'Editor renders real stored transient envelope');
requireText(display, 'sendLoopCommand({', 'Transient editor writes the real trim command path');
requireText(display, "type: 'trim'", 'Transient editor uses non-destructive trim command');
requireText(display, 'onPointerDown={beginTrimDrag}', 'Transient IN/OUT handles are directly draggable');
requireText(display, 'loopTrackProgress(state.selectedTrack, stamp)', 'Transient utility retains truthful playhead');
requireText(display, "context.fillText('DRAG I / O'", 'Trim editor exposes direct manipulation affordance');
forbidText(display, 'SHADE_RAMP', 'Loop utility screen must not regress to ASCII shading');
forbidText(display, 'L O O P  //  4 TRACK MEMORY', 'Loop utility screen must not become a hero display again');

if (failures.length) {
  console.error(`Loop refinement audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CALCOTONE Loop refinement audit passed · compact transient editor, fixed quarter-grid faders/knobs, and off-white 505 indicator rings locked');
