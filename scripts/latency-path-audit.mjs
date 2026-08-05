import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const engine = readFileSync(resolve(root, 'src/audio/AudioEngine.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const nativeHost = readFileSync(resolve(root, 'native/src/wasapi_host.cpp'), 'utf8');
const nativeRackHeader = readFileSync(resolve(root, 'native/include/calcotone/native_rack.hpp'), 'utf8');
const nativeRack = readFileSync(resolve(root, 'native/src/native_rack.cpp'), 'utf8');
const nativeProcessor = readFileSync(resolve(root, 'native/src/native_processor.cpp'), 'utf8');
const nativeDreamHeader = readFileSync(resolve(root, 'native/include/calcotone/native_dream_engine.hpp'), 'utf8');
const nativeDreamCoreHeader = readFileSync(resolve(root, 'native/include/calcotone/dream_buffer_parity_processor.hpp'), 'utf8');
const nativeDream = readFileSync(resolve(root, 'native/src/native_dream_engine.cpp'), 'utf8');
const nativeDreamCore = readFileSync(resolve(root, 'native/src/dream_buffer_parity_processor.cpp'), 'utf8');
const audioConfig = readFileSync(resolve(root, 'native/src/audio_device_config.cpp'), 'utf8');
const elasticFifo = readFileSync(resolve(root, 'native/src/elastic_stereo_fifo.cpp'), 'utf8');
const ksProbe = readFileSync(resolve(root, 'native/src/ks_wavert_probe.cpp'), 'utf8');
const nativeBridge = readFileSync(resolve(root, 'src/audio/NativeAudioBridge.ts'), 'utf8');
const controlServer = readFileSync(resolve(root, 'native/src/control_server.cpp'), 'utf8');
const launcher = readFileSync(resolve(root, 'native/START-CALCOTONE-NATIVE.bat'), 'utf8');
const failures = [];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
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
requireText(nativeHost, "requested_frames * 10'000'000.0", 'Runtime native buffer-frame request');
requireText(nativeHost, 'GetSharedModeEnginePeriod', 'Native minimum shared-period fallback');
requireText(nativeHost, 'endpoint.client = activate()', 'Clean client reactivation after exclusive rejection');
requireText(nativeHost, '2U * std::max(capture.period_frames, render.buffer_frames)', 'Native two-period FIFO safety target');
requireText(nativeHost, 'while (ring->available() < fifo_target_frames', 'Capture-first FIFO priming');
requireText(nativeHost, 'last_left *= .995F', 'Click-safe capture-underrun decay');
requireText(nativeHost, 'ringFrames', 'Live native FIFO telemetry');
requireText(nativeHost, 'ring->trim_to_target()', 'Exact native FIFO startup trim');
requireText(elasticFifo, 'ratio_ += (desired - ratio_) * 0.001', 'Smooth capture/render clock-drift correction');
requireText(elasticFifo, 'filtered_depth_ +=', 'Device-period FIFO ripple rejection');
requireText(elasticFifo, 'hermite(prior_left', 'Four-point drift interpolation');
requireText(nativeHost, 'renderDeadlineMisses', 'Native render deadline telemetry');
requireText(nativeHost, 'maxRenderMicros', 'Native render workload telemetry');
for (const module of ['Grain', 'Artifact']) requireText(nativeRackHeader, module, `Native ${module} rack ownership`);
requireText(nativeRackHeader, 'class NativePressure final', 'Native Pressure processor');
requireText(nativeDreamHeader, 'class NativeDreamEngine final', 'Shared native Dream engine');
requireText(nativeDreamCoreHeader, 'class DreamBufferParityProcessor final', 'Native Dream tagged-memory ownership');
requireText(nativeDreamCore, 'kHistorySeconds = 8.F', 'Native Dream bounded history');
requireText(nativeDream, 'std::array<std::vector<float>, 3> raw_heads', 'Native Dream preallocated moving heads');
requireText(nativeDream, 'send_smoothing = 1.F - std::exp', 'Native Dream smoothed capture sends');
requireText(nativeDream, 'route_smoothing = 1.F - std::exp', 'Native Dream smoothed feedback routes');
requireText(nativeDream, 'master_smoothing = 1.F - std::exp', 'Native Dream click-safe master return');
requireText(nativeProcessor, 'NativeDreamEngine dream;', 'Transport-independent shared Dream instance');
requireText(nativeProcessor, 'dream.begin_block(frames)', 'Transport-independent Dream block render');
requireText(nativeProcessor, 'dream.inject_route(rack_module', 'Transport-independent Dream route injection');
requireText(nativeProcessor, 'dream.capture_module(rack_module', 'Transport-independent Dream capture send');
requireText(nativeProcessor, 'any_rack_active || !stack_off || pressure_active', 'Native true-RAW Dream isolation gate');
forbidText(nativeRackHeader, 'class NativeDreamBuffer final', 'Retired fixed-tap Dream declaration');
forbidText(nativeProcessor, 'dream_one', 'Retired lane-one Dream insert');
forbidText(nativeProcessor, 'dream_two', 'Retired lane-two Dream insert');
requireText(nativeRack, 'std::array<std::array<Voice, 8>, 2>', 'Native fixed Grain voices');
requireText(nativeRack, 'mode == 13 ? .91F', 'Native BCM10 output trim');
requireText(nativeProcessor, 'packed_order.store(pack_order(next)', 'Transport-independent atomic topology snapshot');
requireText(nativeProcessor, 'pressure_one.process', 'Transport-independent post-STACK Pressure placement');
requireText(nativeProcessor, 'mix_dual_mono', 'Transport-independent final stereo mix');
requireText(nativeHost, 'processor.process(process->capture_input.data()', 'WASAPI transport uses shared native processor');
requireText(audioConfig, 'CALCOTONE_CAPTURE_DEVICE', 'Runtime capture-device selection');
requireText(audioConfig, 'CALCOTONE_BUFFER_FRAMES', 'Runtime buffer selection');
requireText(audioConfig, 'CALCOTONE_INPUT_1_CHANNEL', 'Runtime input-channel selection');
requireText(ksProbe, 'KSPROPERTY_PIN_CTYPES', 'Read-only KS/WaveRT capability probe');
requireText(nativeHost, 'class NativeRecorder', 'Native final-output recorder');
requireText(nativeHost, 'recorder.capture(process->mixed_output.data()', 'Native recorder render tap');
requireText(nativeHost, 'recordStop', 'Native recorder control protocol');
requireText(app, 'param bitcrusher mode', 'Native Grain mode synchronization');
requireText(app, 'param media mode', 'Native Artifact mode synchronization');
requireText(app, 'param pressure style', 'Native Pressure synchronization');
requireText(app, 'nativeWaveToRecordedWav', 'Native recorder faceplate integration');
requireText(nativeBridge, 'private commandQueue: Promise<boolean>', 'Serialized browser/native control commands');
requireText(nativeBridge, 'this.commandQueue.then(() => this.sendCommand(line))', 'Native command queue sequencing');
requireText(controlServer, 'listen(listener, SOMAXCONN)', 'Native control burst backlog');
requireText(controlServer, 'request_content_length(request_storage)', 'Complete native HTTP request reads');
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
