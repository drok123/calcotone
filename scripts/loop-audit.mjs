import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const store = read('src/components/signal/loopStore.ts');
const worklet = read('public/loop-processor.js');
const native = read('native/src/loop_processor.cpp');
const nativeHeader = read('native/include/calcotone/loop_processor.hpp');
const nativeProcessorHeader = read('native/include/calcotone/native_processor.hpp');
const nativeTest = read('native/tests/loop_processor_test.cpp');
const display = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');
const controls505 = read('src/loop505Controls.ts');
const surface = read('src/loopSurfaceV3.ts');
const surfaceCss = read('src/loopSurfaceV3.css');

// Public/state contract: eight backend tracks, four performance controls, independent
// run/mute/solo state, 30-300 BPM clock and non-destructive trim runtime.
for (const token of [
  'export const LOOP_TRACK_COUNT = 8',
  'export const LOOP_VISIBLE_TRACK_COUNT = 4',
  'export const LOOP_MIN_BPM = 30',
  'export const LOOP_MAX_BPM = 300',
  "export type LoopQuantize = 'off' | 'beat' | 'bar'",
  "quantize: 'bar'",
  'trackActiveMask: number',
  'trackMuteMask: number',
  'trackSoloMask: number',
  'export function pressLoopTrack(track: number): boolean',
  'export function toggleLoopTrackPlayback(track: number): boolean',
  'export function toggleLoopTrackMute(track: number): boolean',
  'export function toggleLoopTrackSolo(track: number): boolean',
  'export function loopTrackProgress(track: number',
]) requireText(store, token, 'Loop state contract');

// Browser fallback must keep the render path fixed-capacity. Commands may arrive via
// MessagePort, but quantized scheduling itself must never grow/shrink JS arrays.
for (const token of [
  'this.rawFrames = new Uint32Array(TRACKS)',
  'this.lengths = new Uint32Array(TRACKS)',
  'this.fadeFrames = new Uint32Array(TRACKS)',
  'this.occupiedMask = 0',
  'this.activeMask = 0',
  'this.muteMask = 0',
  'this.soloMask = 0',
  'this.scheduledActive = new Uint8Array(SCHEDULED_SLOTS)',
  'this.scheduledDue = new Float64Array(SCHEDULED_SLOTS)',
  'this.scheduledCode = new Uint8Array(SCHEDULED_SLOTS)',
  'this.nextScheduledDue = NO_DUE',
  'if (this.nextScheduledDue <= this.clockFrame) this.runScheduledCommands()',
  'this.playbackMask',
  'this.advanceMask',
  'this.waveformCache = new Float32Array(WAVEFORM_BINS)',
  'this.runtimePeriod = Math.max(1024, Math.floor(sampleRate / 10))',
  'this.applyJournalSwaps(leftOut.length)',
  'UNDO_SCAN_PER_AUDIO_FRAME = 64',
  'this.updateEnvelope(track, absolute, nextL, nextR, this.overdub <= 0.001)',
  'target[write] = loopL',
  "command === 'record' && !this.anyOccupied() && !this.recording",
  "this.quantize === 'bar' ? beat * 4 : beat",
]) requireText(worklet, token, 'Browser Loop realtime contract');

for (const token of [
  'this.scheduledCommands = []',
  'this.scheduledCommands.filter(',
  'this.scheduledCommands.splice(',
]) forbidText(worklet, token, 'Browser Loop dynamic scheduler');
forbidText(worklet, 'masterFrames', 'Browser retired shared master length');

// Native Loop uses cached lengths/masks, a fixed SPSC control queue, a fixed quantize
// scheduler and segment processing between due sample-clock boundaries.
for (const token of [
  'std::array<std::size_t, kLoopTrackCount> raw_frames{}',
  'std::array<std::size_t, kLoopTrackCount> lengths{}',
  'std::array<std::size_t, kLoopTrackCount> fade_frames{}',
  'std::uint32_t occupied_mask{}',
  'std::uint32_t active_mask{}',
  'std::uint32_t mute_mask{}',
  'std::uint32_t solo_mask{}',
  'std::array<PendingAction, kCommandQueueSlots> command_queue{}',
  'std::atomic<unsigned> command_write{}',
  'std::atomic<unsigned> command_read{}',
  'std::array<ScheduledCommand, kScheduledSlots> scheduled{}',
  'std::uint64_t next_scheduled_due{kNoDue}',
  'void process_segment(float* data, std::size_t frames',
  'const auto until_due = next_scheduled_due - clock_frame',
  'apply_journal_swaps(frames)',
  'frames * kUndoScanPerAudioFrame',
  "static_cast<std::size_t>(rate / 10.F)",
  'published_active_mask.store(active_mask & occupied_mask',
  'published_mute_mask.store(mute_mask & occupied_mask',
  'published_solo_mask.store(solo_mask & occupied_mask',
  'clock_frame = 0U',
  'begin_overdub_journal(unsigned track)',
  'journal_before_write(overdub_track, absolute, write, buffer)',
  'start_bounce(unsigned track)',
  'target[write] = loop_left',
  "value >= 2'000.F",
  "value >= 1'000.F",
  'sentinel == 6L',
  'sentinel == 7L',
  'sentinel == 8L',
]) requireText(native, token, 'Native Loop realtime contract');

for (const token of [
  'pending_command',
  'pending_performance',
  'std::array<bool, kLoopTrackCount> active',
  'std::array<bool, kLoopTrackCount> muted',
  'std::array<bool, kLoopTrackCount> soloed',
  'master_frames',
]) forbidText(native, token, 'Native Loop retired hot-path state');

for (const token of [
  'TrackPlay = 7U',
  'TrackStop = 8U',
  'Mute = 9U',
  'Solo = 10U',
  'Undo = 11U',
  'Redo = 12U',
  'Bounce = 13U',
  "kLoopEnvelopeBins = 16'384U",
  'kLoopWaveformBins = 256U',
  'track_active_mask() const noexcept',
  'track_mute_mask() const noexcept',
  'track_solo_mask() const noexcept',
]) requireText(nativeHeader, token, 'Native Loop public contract');

for (const token of [
  'loop_track_active_mask() const noexcept',
  'loop_track_mute_mask() const noexcept',
  'loop_track_solo_mask() const noexcept',
]) requireText(nativeProcessorHeader, token, 'Native processor Loop telemetry contract');

// Keep the audible/native regressions: independent lengths, replace DUB, trim,
// undo/redo, bounce and sample-accurate beat quantization.
for (const token of [
  "quantized_loop.set_track_level(7U, 1120.F)",
  "quantized_loop.set_track_level(7U, 2001.F)",
  "quantized_loop.raw_frames() == 24'000U",
  'private UNDO sentinel',
  'private REDO sentinel',
  'private BOUNCE sentinel',
  'loop.set_overdub(0.F)',
  'loop.set_trim(.25F, .75F)',
]) requireText(nativeTest, token, 'Native Loop audible regression');

// V3 faceplate stays direct-manipulation: transient trim/fade + audio-clocked phase
// rings and readable header controls. These are UI contracts, not transport clocks.
for (const token of [
  "type DragHandle = 'start' | 'end' | 'fadeIn' | 'fadeOut'",
  "sendLoopCommand({ type: 'trim'",
  "sendLoopCommand({ type: 'autoTrim' })",
  "sendLoopCommand({ type: 'resetTrim' })",
  "context.fillText('DRAG I / O · • FADE'",
]) requireText(display, token, 'Loop transient editor');

for (const token of [
  "makeButton('loop-all-toggle loop-header-all', 'ALL'",
  "makeButton('loop-505-action loop-505-undo', 'UNDO'",
  "makeButton('loop-505-action loop-505-redo', 'REDO'",
  "makeButton('loop-505-action loop-505-bounce', 'BNC'",
  'loopTrackProgress(track, stamp)',
]) requireText(surface, token, 'Loop V3 performance surface');

for (const token of [
  '.loop-header-actions',
  '.loop-track-pad::before',
  '.loop-track-pad::after',
  '--loop-phase-angle',
]) requireText(surfaceCss, token, 'Loop V3 styling');

for (const token of [
  'sendNativeControl(detail.track, sentinel)',
  '1000 + state.bpm',
  '2000 + QUANTIZE_CODES[state.quantize]',
]) requireText(controls505, token, 'Native Loop control bridge');

if (failures.length) {
  console.error(`Loop audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Loop audit passed · fixed-capacity scheduling, cached realtime state, bounded undo, decimated telemetry and direct V3 controls are intact');
