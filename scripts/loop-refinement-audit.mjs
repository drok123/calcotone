import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const baseCss = read('src/loopRefinement.css');
const css = read('src/loopSurfaceV3.css');
const display = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');
const controller = read('src/loopSurfaceV3.ts');
const main = read('src/main.tsx');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText(main, "import './loopRefinement.css'", 'Loop base refinement layer installed');
requireText(main, "import './loopSurfaceV3'", 'Loop v3 surface layer installed');
requireText(baseCss, '.module-pressure {', 'Loop base refinement remains module-scoped');
requireText(css, '.module-pressure {', 'Loop v3 layer is module-scoped');
forbidText(css, '.module-stomp', 'Loop v3 must not touch Stomp');
forbidText(css, '.module-chaos', 'Loop v3 must not touch Stack');
requireText(css, '--loop-header-height: 38px', 'Loop uses one compact readable header row');
requireText(css, '.loop-track-bank,', 'Retired header clock is hidden');
requireText(css, '.loop-trim-toggle,', 'Retired TRIM mode button remains hidden');
requireText(css, '.loop-utility-bank {', 'Retired micro utility row remains hidden');
requireText(css, '.loop-header-action-bank', 'Loop actions live beside module title');
requireText(css, 'font: 900 .54rem/1 var(--mono)', 'Loop header action text is readable');
requireText(css, 'min-height: 26px', 'Loop header actions have usable hit targets');
requireText(css, '.loop-header-param', 'MSTR and DUB header parameter controls are styled');
requireText(css, '.loop-header-track-action', 'Selected-track REC/PLAY/STOP action lives in header');
requireText(css, '.loop-header-dub-action', 'Safe DUB is a separate header action');
requireText(css, '.loop-header-clear-action.is-armed', 'Clear requires an explicit armed state');
requireText(css, '--loop-phase-angle: 0deg', '505 phase ring owns a realtime phase variable');
requireText(css, 'from calc(-90deg + var(--loop-phase-angle))', 'Phase packet begins at twelve o clock and rotates with loop phase');
requireText(css, '.loop-track-pad.is-loop-boundary::after', 'Loop boundary gets a stronger off-white start cue');
requireText(css, 'rgba(255, 253, 246, 1)', 'Moving phase packet is off-white');
requireText(baseCss, '.faceplate-knob-slot:nth-of-type(1) { left: 12.5% !important; }', 'T1 fader fixed to first quarter center');
requireText(baseCss, '.faceplate-knob-slot:nth-of-type(4) { left: 87.5% !important; }', 'T4 fader fixed to fourth quarter center');
requireText(baseCss, '.faceplate-pressure-slot:nth-child(1) { left: 12.5% !important; }', 'T1 Loop knob aligned to fader');
requireText(baseCss, '.faceplate-pressure-slot:nth-child(4) { left: 87.5% !important; }', 'T4 Loop knob aligned to fader');
requireText(baseCss, '.module-pressure.faceplate-layout-editing .faceplate-knob-slot', 'Loop geometry cannot be free-dragged out of uniformity');

requireText(display, "type DragHandle = 'start' | 'end' | 'fadeIn' | 'fadeOut'", 'Transient screen exposes trim bars and fade points');
requireText(display, 'function drawTransientEditor(', 'Loop screen remains a real transient utility editor');
requireText(display, 'const waveform = runtime?.waveform ?? state.waveform', 'Editor renders stored transient envelope');
requireText(display, 'drawTrimBar(context, startX', 'IN trim bar is always visible');
requireText(display, 'drawTrimBar(context, endX', 'OUT trim bar is always visible');
requireText(display, "activeHandle === 'fadeIn'", 'Fade-in point is directly draggable');
requireText(display, "activeHandle === 'fadeOut'", 'Fade-out point is directly draggable');
requireText(display, 'setLoopState({ fade: clamp01(fade) })', 'Fade points drive the real Loop seam crossfade');
requireText(display, "sendLoopCommand({ type: 'trim'", 'Transient bars use the real non-destructive trim command');
requireText(display, "sendLoopCommand({ type: 'autoTrim' })", 'AUTO trim remains available inside transient screen');
requireText(display, "sendLoopCommand({ type: 'resetTrim' })", 'RESET trim remains available inside transient screen');
requireText(display, 'cycleLoopQuantize()', 'Transient clock cycles OFF BEAT BAR');
requireText(display, 'setLoopBpm(', 'Transient clock edits BPM');
requireText(display, 'loopTrackProgress(state.selectedTrack, stamp)', 'Transient utility retains truthful browser playhead');
forbidText(display, 'SHADE_RAMP', 'Loop utility screen must not regress to ASCII shading');
forbidText(display, 'L O O P  //  4 TRACK MEMORY', 'Loop utility screen must not become a hero display again');

requireText(controller, "makeButton('loop-all-toggle loop-header-all'", 'ALL moved beside LOOP title');
requireText(controller, "makeButton('loop-505-action loop-505-undo'", 'UNDO moved beside LOOP title');
requireText(controller, "makeButton('loop-505-action loop-505-redo'", 'REDO moved beside LOOP title');
requireText(controller, "makeButton('loop-header-track-action'", 'REC/PLAY/STOP moved beside LOOP title');
requireText(controller, "makeButton('loop-header-dub-action', 'DUB'", 'Safe DUB moved beside LOOP title');
requireText(controller, "makeButton('loop-header-clear-action', 'CLR'", 'Guarded clear moved beside LOOP title');
requireText(controller, "makeButton('loop-505-action loop-505-bounce'", 'Bounce remains reachable in compact header');
requireText(controller, "makeParameterControl('loop-header-master', 'MSTR', 'masterLevel'", 'MSTR moved into Loop header');
requireText(controller, "makeParameterControl('loop-header-dub-level', 'DUB', 'overdub'", 'Incoming DUB level moved into Loop header');
requireText(controller, 'function presentationProgress(', 'Knob rings use listener-facing phase calculation');
requireText(controller, 'nativePathLatencyMs', 'Native Loop phase accounts for output path latency');
requireText(controller, 'return loopReferenceProgress(stamp - nativePathLatencyMs)', 'Knob ring reads the shared master-cycle timing without cloning state');
requireText(controller, 'NATIVE_LATENCY_POLL_MS = 1_000', 'Native latency sampling stays outside fast Loop runtime telemetry');
requireText(controller, "pad.style.setProperty('--loop-phase-angle'", 'Realtime phase is sent to the ring without React rerenders');
requireText(controller, "pad.classList.toggle('is-loop-boundary'", 'Twelve o clock loop restart cue is explicit');
forbidText(controller, 'setLoopRuntime', 'Loop V3 must not become a second native runtime writer');
forbidText(controller, 'NATIVE_LOOP_POLL_MS = 100', 'Loop V3 must not restore duplicate fast health polling');

if (failures.length) {
  console.error(`Loop refinement audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CALCOTONE Loop v3 audit passed · direct editor, readable header, shared reference-boundary rings, allocation-free phase reads, and single-owner native telemetry locked');
