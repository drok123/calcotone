import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (relative) => {
  const path = resolve(root, relative);
  if (!existsSync(path)) { failures.push(`Missing required file: ${relative}`); return ''; }
  return readFileSync(path, 'utf8');
};
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const worklet = read('public/dream-buffer-processor.js');
const owner = read('src/audio/DreamBuffer.ts');
const engine = read('src/audio/AudioEngine.ts');

// V12 is one bounded shared stereo memory, not per-module buffers.
requireText(worklet, 'this.historySeconds = 8', 'Dream V12 bounded history');
requireText(worklet, 'this.left = new Float32Array(this.length)', 'Dream V12 shared left ring');
requireText(worklet, 'this.right = new Float32Array(this.length)', 'Dream V12 shared right ring');
requireText(owner, 'CAPTURE -> MEMORY -> AGE HEADS (NOW / ECHO / GHOST) -> RECALL -> SAFETY', 'Dream V12 architecture contract');

// The memory ages must be genuinely different, and GHOST must use deep history.
requireText(worklet, 'baseL: 0.061', 'Dream NOW age');
requireText(worklet, 'baseL: 0.43', 'Dream ECHO age');
requireText(worklet, 'baseL: 3.85', 'Dream GHOST deep history');
requireText(worklet, 'baseR: 4.55', 'Dream GHOST stereo age');
requireText(owner, "export type DreamHead = 'now' | 'echo' | 'ghost'", 'Dream V12 named ages');

// Moving heads are block-rate targets with interpolated reads; no abrupt integer tap jumps.
requireText(worklet, 'updateHeadTargets(frames)', 'Dream moving head targets');
requireText(worklet, 'readInterpolated', 'Dream interpolated recall');
requireText(worklet, 'const fraction = position - index0', 'Dream fractional interpolation');
requireText(worklet, 'const blockSeconds = frames / sampleRate', 'Dream block-rate motion');
forbidText(worklet, 'const offsetsL = [', 'Dream per-sample left offset allocation');
forbidText(worklet, 'const offsetsR = [', 'Dream per-sample right offset allocation');

// V12 capture intelligence travels with the remembered audio. Keep the metadata compact,
// deterministic and cheap enough to stay permanently inside the realtime worklet.
requireText(worklet, 'this.intentNow = new Uint8Array(this.length)', 'Dream compact NOW memory tags');
requireText(worklet, 'this.intentEcho = new Uint8Array(this.length)', 'Dream compact ECHO memory tags');
requireText(worklet, 'this.intentGhost = new Uint8Array(this.length)', 'Dream compact GHOST memory tags');
requireText(worklet, 'this.fastEnvelope', 'Dream transient envelope state');
requireText(worklet, 'this.slowEnvelope', 'Dream sustained envelope state');
requireText(worklet, 'this.detailEnvelope', 'Dream smoothed brightness/detail state');
requireText(worklet, 'this.detailEnvelope += (Math.abs(mono - this.previousMono) - this.detailEnvelope) * 0.018', 'Dream smoothed brightness proxy');
requireText(worklet, 'const nowTarget =', 'Dream NOW capture target');
requireText(worklet, 'const echoTarget =', 'Dream ECHO capture target');
requireText(worklet, 'const ghostTarget =', 'Dream GHOST capture target');
requireText(worklet, 'this.nowIntentState += (nowTarget - this.nowIntentState) * 0.0045', 'Dream fast NOW phrase envelope');
requireText(worklet, 'this.echoIntentState += (echoTarget - this.echoIntentState) * 0.0022', 'Dream medium ECHO phrase envelope');
requireText(worklet, 'this.ghostIntentState += (ghostTarget - this.ghostIntentState) * 0.0009', 'Dream slow GHOST phrase envelope');
requireText(worklet, 'this.intentGhost[this.writeIndex]', 'Dream historical Ghost tagging');
requireText(worklet, 'this.readIntent(this.intentGhost', 'Dream historical Ghost recall weighting');
requireText(worklet, 'const intent = 0.28 +', 'Dream Ghost minimum recall floor');
requireText(worklet, 'memoryIntent: [this.profileIntent[0]', 'Dream intent profile publication');
requireText(owner, 'memoryIntent?: [number, number, number]', 'Dream intent diagnostic type');
requireText(owner, 'const nextIntent = event.data.memoryIntent', 'Dream intent profile ingestion');
requireText(owner, 'memoryIntent: intent ? [...intent]', 'Dream intent diagnostic snapshot');
forbidText(worklet, 'Math.random()', 'Dream nondeterministic memory selection');
forbidText(worklet, 'getFloatFrequencyData', 'Dream FFT inside realtime memory core');
forbidText(worklet, 'new Array(', 'Dream realtime Array allocation');

// Capture / recall safety and idle retirement remain hard invariants.
requireText(worklet, 'if (Math.abs(l) > 1.25) l = Math.tanh(l)', 'Dream capture poison guard');
requireText(worklet, 'if (!hasInput && this.samplesWritten === 0)', 'Dream idle fast path');
requireText(worklet, 'this.maxRecallSamples', 'Dream silence retirement horizon');
requireText(owner, 'Math.min(0.06, value)', 'Dream bounded recall amount');
requireText(owner, 'setTargetAtTime(route.amount', 'Dream smoothed recall gain');
requireText(owner, 'setTargetAtTime(safeAmount', 'Dream smoothed capture send');

// Legacy names may translate internally, but the engine must remain isolated from the migration.
requireText(owner, "if (head === 'short') return 'now'", 'Dream legacy short translation');
requireText(owner, "if (head === 'medium') return 'echo'", 'Dream legacy medium translation');
requireText(owner, "if (head === 'long') return 'ghost'", 'Dream legacy long translation');

// All-off must remain truly raw: Dream return never becomes an always-on hidden processor.
requireText(engine, 'if (!this.hasActiveProcessing())', 'Dream RAW isolation branch');
requireText(engine, 'this.graph.output.connect(this.analyser)', 'Dream RAW direct graph route');
requireText(engine, 'this.dreamBuffer.connectReturn(this.dcBlock)', 'Dream return stays processed-only');

if (failures.length) {
  console.error('\nCALCOTONE Dream Buffer V12 audit failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('CALCOTONE Dream Buffer V12 audit passed.');
