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
const loopDeck = read('src/audio/LoopDeck.ts');
const nativeBridge = read('src/audio/NativeAudioBridge.ts');
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

// Control-rate UI updates must stay cheap: no deep waveform snapshot on every fader
// event, no synchronous localStorage write for every tick, and no no-op publications.
for (const token of [
  'const PERSIST_INTERVAL_MS = 180',
  'function settingsSnapshot(): LoopSettings',
  'export function getLoopSettings(): LoopSettings',
  'function schedulePersist(): void',
  'if (typeof window === \'undefined\' || persistTimer) return',
  'if (!changed) return',
  'detail: settingsSnapshot()',
  'if (state.trackLevels[state.selectedTrack] === next) return',
  'setLoopState({ quantize: next })',
]) requireText(store, token, 'Loop settings control-rate contract');
forbidText(store, 'detail: getLoopState()', 'Loop settings event deep waveform snapshot');
forbidText(store, 'setLoopState({ bpm: state.bpm, quantize: next })', 'Loop quantize unrelated BPM write');

// Scalar render/timing readers must not eagerly clone the selected 256-bin waveform
// plus all eight cached track waveforms merely to read BPM, masks or transport state.
// getLoopState remains a defensive public snapshot: array copies are materialized only
// if that array property is actually read. Accessor descriptors preserve the old
// snapshot's enumerable/configurable/locally writable semantics without mutating state.
for (const token of [
  'const source = state',
  'Object.defineProperties(snapshot, {',
  'get: () => (trackLevels ??= [...source.trackLevels])',
  'get: () => (waveform ??= [...source.waveform])',
  'trackRuntime ??= source.trackRuntime.map((track) => ({ ...track, waveform: [...track.waveform] }))',
  'configurable: true',
  'set: (value: number[]) => { trackLevels = value; }',
  'set: (value: number[]) => { waveform = value; }',
  'set: (value: LoopTrackRuntime[]) => { trackRuntime = value; }',
]) requireText(store, token, 'Loop allocation-light read contract');
forbidText(store, 'export function peekLoopState', 'Unused Loop render snapshot scaffolding');
forbidText(store, 'export function getLoopBpm', 'Unused Loop BPM hot-read scaffolding');
const getStateStart = store.indexOf('export function getLoopState(): LoopState');
const setStateStart = store.indexOf('export function setLoopState(', getStateStart);
if (getStateStart < 0 || setStateStart < 0) failures.push('Loop defensive snapshot boundaries missing');
else {
  const getStateBody = store.slice(getStateStart, setStateStart);
  forbidText(getStateBody, 'trackLevels: [...state.trackLevels]', 'Loop eager track-level snapshot');
  forbidText(getStateBody, 'waveform: [...state.waveform]', 'Loop eager selected-waveform snapshot');
  forbidText(getStateBody, 'state.trackRuntime.map((track)', 'Loop eager cached-waveform snapshot');
}

// Native health packets arrive faster than the visual layer needs new envelopes. Reuse
// the selected waveform when bins are unchanged and suppress identical idle/stopped
// runtime packets before they can wake React subscribers.
for (const token of [
  'function normalizeWaveform(values: readonly number[] | undefined, current?: number[]): number[]',
  'if (unchanged) return current',
  'const waveform = patch.waveform ? normalizeWaveform(patch.waveform, state.waveform) : state.waveform',
  'const unchanged = transport === state.transport',
  '&& waveform === state.waveform',
  'if (unchanged) return;',
]) requireText(store, token, 'Loop runtime telemetry suppression contract');

// Browser bridge only posts fields that changed. The worklet already accepts partial
// settings packets, so unchanged controls must never be structured-cloned every tick.
for (const token of [
  'private lastSettings: LoopSettings | null = null',
  "const message: { type: 'settings' } & Partial<LoopSettings> = { type: 'settings' }",
  'if (!changed) return',
  'const levelsChanged = !previous',
  'this.node.port.postMessage(message)',
]) requireText(loopDeck, token, 'Browser Loop settings diff contract');
forbidText(loopDeck, "this.node.port.postMessage({ type: 'settings', ...settings })", 'Browser whole-snapshot settings spam');

// Native App still publishes a complete Loop settings snapshot for simple ownership,
// but NativeAudioBridge dedupes each idempotent setter in strict queue order. Failed
// requests clear their key so a later identical value remains retryable. Classification
// must take the cheap prefix path because commandLine is shared by every native knob.
for (const token of [
  'private readonly loopCommandState = new Map<string, string>()',
  'private loopStateKey(line: string): string | null',
  "const paramPrefix = 'loopParam '",
  'line.startsWith(paramPrefix)',
  'return `loopParam:${line.slice(paramPrefix.length, end)}`',
  "const levelPrefix = 'loopTrackLevel '",
  'line.startsWith(levelPrefix)',
  'return `loopTrackLevel:${line.slice(levelPrefix.length, end)}`',
  'if (loopKey && this.loopCommandState.get(loopKey) === trimmed) return true',
  'if (loopKey) this.loopCommandState.set(loopKey, trimmed)',
  'this.loopCommandState.delete(loopKey)',
  'this.loopCommandState.clear()',
]) requireText(nativeBridge, token, 'Native Loop command dedupe contract');
const loopKeyStart = nativeBridge.indexOf('private loopStateKey(');
const loopKeyEnd = nativeBridge.indexOf('private rememberDesiredState(', loopKeyStart);
if (loopKeyStart < 0 || loopKeyEnd < 0) failures.push('Native Loop command classifier: function boundaries missing');
else forbidText(nativeBridge.slice(loopKeyStart, loopKeyEnd), '.split(', 'Native Loop command classifier allocation path');

// Browser fallback must keep the render path fixed-capacity. Commands may arrive via
// MessagePort, but quantized scheduling itself must never grow/shrink JS arrays. Masks
// are expanded to compact preallocated track lists only when state changes, never once
// per track per rendered sample.
for (const token of [
  'this.rawFrames = new Uint32Array(TRACKS)',
  'this.lengths = new Uint32Array(TRACKS)',
  'this.fadeFrames = new Uint32Array(TRACKS)',
  'this.occupiedMask = 0',
  'this.activeMask = 0',
  'this.muteMask = 0',
  'this.soloMask = 0',
  'this.playbackMask = 0',
  'this.advanceMask = 0',
  'this.playbackTracks = new Uint8Array(TRACKS)',
  'this.advanceTracks = new Uint8Array(TRACKS)',
  'this.playbackTrackCount = 0',
  'this.advanceTrackCount = 0',
  'this.playbackTracks[this.playbackTrackCount++] = track',
  'this.advanceTracks[this.advanceTrackCount++] = track',
  'for (let active = 0; active < this.playbackTrackCount; active += 1)',
  'const track = this.playbackTracks[active]',
  'for (let active = 0; active < this.advanceTrackCount; active += 1)',
  'const track = this.advanceTracks[active]',
  'this.scheduledActive = new Uint8Array(SCHEDULED_SLOTS)',
  'this.scheduledDue = new Float64Array(SCHEDULED_SLOTS)',
  'this.scheduledCode = new Uint8Array(SCHEDULED_SLOTS)',
  'this.nextScheduledDue = NO_DUE',
  'if (this.nextScheduledDue <= this.clockFrame) this.runScheduledCommands()',
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
  'if (!(this.playbackMask & this.bit(track))) continue',
  'if (!(this.advanceMask & this.bit(track))) continue',
]) forbidText(worklet, token, 'Browser Loop retired render-path scan');
forbidText(worklet, 'masterFrames', 'Browser retired shared master length');

// Native Loop uses cached lengths/masks, a fixed SPSC control queue, a fixed quantize
// scheduler and segment processing between due sample-clock boundaries. Each segment
// compacts the active masks once, so the inner sample loop touches only working tracks.
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
  'std::array<unsigned, kLoopTrackCount> playback_tracks{}',
  'std::array<unsigned, kLoopTrackCount> advance_tracks{}',
  'std::size_t playback_count = 0U',
  'std::size_t advance_count = 0U',
  'playback_tracks[playback_count++] = track',
  'advance_tracks[advance_count++] = track',
  'for (std::size_t active = 0U; active < playback_count; ++active)',
  'const unsigned track = playback_tracks[active]',
  'for (std::size_t active = 0U; active < advance_count; ++active)',
  'advance_track(advance_tracks[active])',
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
  'if ((playback_mask & bit(track)) == 0U) continue',
  'if ((advance_mask & bit(track)) != 0U) advance_track(track)',
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
  'function presentationProgress(track: number, stamp: number)',
  'const progress = active ? presentationProgress(track, stamp) : 0',
  'const state = getLoopSettings()',
]) requireText(surface, token, 'Loop V3 performance surface');
forbidText(surface, 'const state = getLoopState()', 'Loop header deep runtime snapshot');

for (const token of [
  '.loop-header-action-bank',
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

console.log('Loop audit passed · compact realtime track iteration, lazy defensive snapshots, diffed settings transport, allocation-light native controls, suppressed idle telemetry, bounded undo, decimated waveform and direct V3 controls are intact');
