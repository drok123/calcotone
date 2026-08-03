import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const engine = readFileSync(resolve(root, 'src/audio/AudioEngine.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const nativeHost = readFileSync(resolve(root, 'native/src/wasapi_host.cpp'), 'utf8');
const launcher = readFileSync(resolve(root, 'native/START-CALCOTONE-NATIVE.bat'), 'utf8');
const failures = [];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};

requireText(engine, "return 128;", 'Live 128-frame render request');
requireText(engine, "return 'interactive';", 'Live interactive context request');
requireText(engine, "return 'balanced';", 'Balanced context request');
requireText(engine, "return 'playback';", 'Studio playback context request');
requireText(engine, 'latency: { ideal: 0 }', 'Capture latency constraint');
requireText(engine, 'sampleRate: { ideal: this.context.sampleRate }', 'Capture sample-rate constraint');
requireText(engine, 'settings?.latency', 'Actual capture latency telemetry');
requireText(engine, 'settings?.sampleRate', 'Actual capture sample-rate telemetry');
requireText(engine, 'renderQuantumLatency', 'Render quantum included in estimate');
requireText(engine, "if (seconds <= 0.015) return 'tight'", 'Tight latency threshold');
requireText(engine, "if (seconds <= 0.03) return 'playable'", 'Playable latency threshold');
requireText(app, 'EST. RTT', 'Round-trip estimate surfaced in UI');
requireText(app, "Restart audio to apply its device-buffer policy.", 'Runtime mode-change disclosure');
requireText(nativeHost, 'AUDCLNT_SHAREMODE_EXCLUSIVE', 'Native exclusive-WASAPI fast path');
requireText(nativeHost, '64.0 * 10\'000\'000.0', 'Native 64-frame latency request');
requireText(nativeHost, 'GetSharedModeEnginePeriod', 'Native minimum shared-period fallback');
requireText(nativeHost, 'endpoint.client = activate()', 'Clean client reactivation after exclusive rejection');
requireText(launcher, 'CALCOTONE_AUDIO_MODE=exclusive', 'Launcher exclusive-mode request');

const estimateMs = ({ input, base, output, frames, rate }) =>
  (input + base + output + frames / rate) * 1000;
const tight = estimateMs({ input: 0.003, base: 0.003, output: 0.003, frames: 128, rate: 48000 });
const playable = estimateMs({ input: 0.007, base: 0.006, output: 0.006, frames: 128, rate: 48000 });
const slow = estimateMs({ input: 0.015, base: 0.012, output: 0.012, frames: 128, rate: 48000 });
if (!(tight <= 15 && playable > 15 && playable <= 30 && slow > 30)) {
  failures.push(`Latency classification fixtures invalid: ${tight.toFixed(2)}, ${playable.toFixed(2)}, ${slow.toFixed(2)} ms`);
}

if (failures.length) {
  console.error(`Latency path audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Latency path audit passed · fixtures ${tight.toFixed(2)} / ${playable.toFixed(2)} / ${slow.toFixed(2)} ms`);
