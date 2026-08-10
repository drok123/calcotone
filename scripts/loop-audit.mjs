import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const failures = [];
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const store = read('src/components/signal/loopStore.ts');
const worklet = read('public/loop-processor.js');
const native = read('native/src/loop_processor.cpp');
const nativeHeader = read('native/include/calcotone/loop_processor.hpp');
const rail = read('src/components/effects/RailCModules.tsx');
const display = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');
const random = read('src/features/random/railCRandomRegistry.ts');

// Loop keeps the proven eight-buffer backend as its storage/capacity contract while
// exposing the first four tracks as a deliberate RC-style performance faceplate.
// Each visible track owns cached runtime/waveform state so the four mechanical ASCII
// clocks stay truthful at once. REC/DUB targets remain latched in the realtime engine.
requireText(store, 'export const LOOP_TRACK_COUNT = 8', 'Loop backend hard track limit');
requireText(store, 'export const LOOP_VISIBLE_TRACK_COUNT = 4', 'Loop four-track performance faceplate');
requireText(worklet, 'this.rawFrames = new Uint32Array(TRACKS)', 'browser independent track lengths');
requireText(worklet, 'this.positions = new Uint32Array(TRACKS)', 'browser independent playheads');
forbidText(worklet, 'masterFrames', 'browser retired shared master length');
requireText(native, 'std::array<std::size_t, kLoopTrackCount> raw_frames{}', 'native independent track lengths');
requireText(native, 'std::array<std::size_t, kLoopTrackCount> positions{}', 'native independent playheads');
forbidText(native, 'master_frames', 'native retired shared master length');
requireText(nativeHeader, 'kLoopEnvelopeBins = 16\'384U', 'native transient envelope resolution');
requireText(nativeHeader, 'kLoopWaveformBins = 256U', 'native high-resolution transient preview');
requireText(store, 'LOOP_WAVEFORM_BINS = 256', 'UI high-resolution transient preview');
requireText(worklet, 'const ENVELOPE_BINS = 16384', 'browser transient envelope resolution');
requireText(worklet, 'autoTrim(track)', 'browser auto trim');
requireText(worklet, 'this.buffers = Array.from({ length: TRACKS }, () => null)', 'browser lazy Loop audio allocation');
requireText(worklet, 'this.recordTrack = 0', 'browser REC target latch');
requireText(native, 'ensure_track_buffer(unsigned track)', 'native lazy Loop audio allocation');
requireText(native, 'pending_track{0U}', 'native command target latch');
requireText(store, 'overdub: 0', 'Loop live-replace default');
requireText(rail, "['Track', 'Loop', 'RETAIN', 'Fade']", 'Loop RETAIN hardware label');
requireText(worklet, 'rolling tape-style replacement pass', 'browser continuous live replace');
requireText(native, 'previous performance is completely gone after one full orbit', 'native continuous live replace');
requireText(native, 'auto_trim_window(unsigned track)', 'native auto trim');
requireText(rail, 'className={`loop-trim-toggle ${trimEditing ? \'active\' : \'\'}`}', 'Loop trim mode control');
requireText(store, "{ type: 'autoTrim' }", 'Loop auto-trim command retained');
requireText(store, "{ type: 'resetTrim' }", 'Loop reset-trim command retained');
requireText(store, 'export interface LoopTrackRuntime', 'Per-track UI runtime cache');
requireText(store, 'trackRuntime: LoopTrackRuntime[]', 'Loop state owns per-track runtime');
requireText(store, 'export function pressLoopTrack(track: number): boolean', 'One-button track transport');
requireText(store, "if (state.transport === 'recording') sendLoopCommand('record')", 'REC closes into playback');
requireText(store, "else if (!occupied) sendLoopCommand('record')", 'Empty track starts REC');
requireText(store, "else sendLoopCommand('overdub')", 'Occupied playing track enters DUB');
requireText(store, 'writing && target !== state.selectedTrack', 'Write-target theft guard');
requireText(store, 'export function clearLoopTrack(track: number): boolean', 'Per-track clear path');
requireText(store, 'export function loopTrackProgress(track: number', 'Independent display orbit extrapolation');
requireText(rail, 'Array.from({ length: LOOP_VISIBLE_TRACK_COUNT }', 'Four physical track pads');
requireText(rail, 'button.action(event.shiftKey)', 'Track-pad shift clear gesture');
requireText(rail, '<LoopTrackMatrixDisplay', 'Four-clock Loop display wired');
forbidText(rail, 'aria-label="Loop track"', 'Retired selected-track dropdown');
requireText(display, 'L O O P  //  4 TRACK MEMORY', 'Four-track display identity');
requireText(display, 'REC > PLAY > DUB  //  SHIFT + TRACK = CLEAR', 'Faceplate transport legend');
requireText(display, 'const cellWidth = Math.floor(columns / 2)', '2x2 track matrix');
requireText(display, 'const cellHeight = Math.floor(graphRows / 2)', '2x2 track matrix rows');
requireText(display, 'const outerRim = clamp01', 'Loop layered spectacle outer rim');
requireText(display, 'const innerGroove = clamp01', 'Loop layered spectacle inner groove');
requireText(display, 'const indexTick = Math.max', 'Loop clock index detail');
requireText(display, 'const trailDelta = (progress - orbitPosition + 1) % 1', 'Loop truthful purple motion trail');
requireText(display, "accents[row]![column] = trailDelta < 0.025 || wiperDelta < 0.018 ? '*' : '+'", 'Loop purple rotating wiper/trail');
requireText(display, 'const waveIntensity = clamp01', 'Loop fine transient density');
requireText(display, "accents[row]![column] = '['", 'ASCII trim IN marker');
requireText(display, "accents[row]![column] = ']'", 'ASCII trim OUT marker');
requireText(display, 'loopTrackProgress(track, stamp)', 'Every track gets its own orbit');
forbidText(display, "glyphs: ' ·◦○●█'", 'retired alien Loop glyph palette');
requireText(random, "RAIL_C_RANDOM_ORDER = ['stomp', 'chaos']", 'Loop excluded from RANDOM registry');

if (failures.length) {
  console.error(`Loop usability audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('CALCOTONE Loop audit passed · 8-buffer backend, 4-track performance faceplate, live-replace DUB, trim, and four orbital ASCII clocks locked');
