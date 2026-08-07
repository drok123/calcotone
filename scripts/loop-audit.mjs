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
const display = read('src/components/ascii/RailCHardwareDisplay.tsx');
const random = read('src/features/random/railCRandomRegistry.ts');

// Loop is an eight-timeline performance recorder: track duration and trim are
// selected-track properties, never a hidden master length inherited from T1.
requireText(store, 'export const LOOP_TRACK_COUNT = 8', 'Loop hard track limit');
requireText(worklet, 'this.rawFrames = new Uint32Array(TRACKS)', 'browser independent track lengths');
requireText(worklet, 'this.positions = new Uint32Array(TRACKS)', 'browser independent playheads');
forbidText(worklet, 'masterFrames', 'browser retired shared master length');
requireText(native, 'std::array<std::size_t, kLoopTrackCount> raw_frames{}', 'native independent track lengths');
requireText(native, 'std::array<std::size_t, kLoopTrackCount> positions{}', 'native independent playheads');
forbidText(native, 'master_frames', 'native retired shared master length');
requireText(nativeHeader, 'kLoopEnvelopeBins = 16\'384U', 'native transient envelope resolution');
requireText(worklet, 'const ENVELOPE_BINS = 16384', 'browser transient envelope resolution');
requireText(worklet, 'autoTrim(track)', 'browser auto trim');
requireText(store, 'overdub: 0', 'Loop live-replace default');
requireText(rail, "['Track', 'Loop', 'RETAIN', 'Fade']", 'Loop RETAIN hardware label');
requireText(rail, "'LIVE REPLACE'", 'Loop live-replace transport display');
requireText(worklet, 'rolling tape-style replacement pass', 'browser continuous live replace');
requireText(native, 'previous performance is completely gone after one full orbit', 'native continuous live replace');
requireText(native, 'auto_trim_window(unsigned track)', 'native auto trim');
requireText(rail, 'className={`loop-trim-toggle ${trimEditing ? \'active\' : \'\'}`}', 'Loop trim mode control');
requireText(rail, "{ key: 'auto', label: 'AUTO'", 'Loop auto-trim button');
requireText(rail, "{ key: 'reset', label: 'RESET'", 'Loop reset-trim button');
requireText(display, 'TRANSIENT MEMORY // NON-DESTRUCTIVE TRIM', 'ASCII transient trim view');
requireText(display, 'Loopy-inspired motion language', 'Loop circular clip-orbit motion language');
requireText(display, 'CLIP ORBITS // 8 TRACK MEMORY', 'Loop eight-orbit memory bank footer');
requireText(display, "accents[column] = '●'", 'Loop selected-track ASCII wiper');
requireText(display, "accents[column] = '┃'", 'ASCII trim markers');
requireText(random, "RAIL_C_RANDOM_ORDER = ['stomp', 'chaos']", 'Loop excluded from RANDOM registry');

if (failures.length) {
  console.error(`Loop usability audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('CALCOTONE Loop audit passed · 8 independent timelines, live-replace DUB, trim/auto-trim, and orbital ASCII editor locked');
