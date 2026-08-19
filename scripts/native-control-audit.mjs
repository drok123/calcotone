import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const source = read('src/audio/NativeAudioBridge.ts');
const transport = read('src/audio/NativeDesktopTransport.ts');
const finish = read('src/nativeFinishPass.ts');
const spectrum = read('src/visual/NativeVisualSpectrum.ts');
const shell = read('native/src/desktop_shell.cpp');
const controlServer = read('native/src/control_server.cpp');
const failures = [];
const requireText = (text, needle, label) => { if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (text, needle, label) => { if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

for (const token of [
  "const parameterPrefix = 'param '",
  'line.startsWith(parameterPrefix)',
  'const moduleEnd = line.indexOf(',
  'const parameterEnd = line.indexOf(',
  'const separator = line.indexOf(\' \')',
  'STACK_PROFILE_PARAMETERS.has(name)',
  'STACK_PROFILE_SELECTORS.has(name)',
  'this.rememberDesiredState(line)',
  'this.commandQueue.then(async () =>',
  'this.commandCoalesceKey(line)',
  'this.commandGenerations.get(coalesceKey) !== generation',
  "nativeDesktopRequest<{ ok?: boolean }>('command'",
  "nativeDesktopRequest<NativeAudioHealth>('health'",
  'this.startHealthMonitor()',
  'export const NATIVE_HEALTH_EVENT',
]) requireText(source, token, 'Native control responsiveness contract');

for (const [startNeedle, endNeedle, label] of [
  ['  private rememberDesiredState(', '  private profileReplayLines(', 'Native desired-state parser'],
  ['  private profileReplayLines(', '  private acceptHealth(', 'Native replay parser'],
  ['  private commandCoalesceKey(', '  private rememberDesiredState(', 'Native coalescing parser'],
]) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start < 0 || end < 0) {
    failures.push(`${label}: function boundaries missing`);
    continue;
  }
  const body = source.slice(start, end);
  forbidText(body, '.split(', `${label} array split`);
  forbidText(body, 'RegExp', `${label} regex construction`);
  forbidText(body, 'match(', `${label} regex matching`);
}

for (const token of [
  "const REQUEST_PREFIX = 'calcotone'",
  'port.postMessage(line)',
  "installedPort.addEventListener('message', onMessage)",
  "message.type !== RESPONSE_TYPE",
]) requireText(transport, token, 'WebView2 TypeScript transport');

for (const token of [
  'add_WebMessageReceived(',
  'TryGetWebMessageAsString(',
  'PostWebMessageAsJson(',
  'dispatch_embedded_control(payload)',
  'native_visual_spectrum().json()',
]) requireText(shell, token, 'WebView2 C++ transport');

for (const token of [
  'std::string dispatch_embedded_control',
  'embedded_handler = &handler_',
  'dispatch_embedded_control("health")',
  'dispatch_embedded_control(command)',
]) requireText(controlServer, token, 'Shared native dispatcher');

requireText(spectrum, "nativeDesktopRequest<NativeSpectrumPayload>('spectrum'", 'Direct native spectrum');
requireText(finish, 'window.addEventListener(NATIVE_HEALTH_EVENT, onNativeHealth)', 'Centralized native health consumer');
forbidText(finish, 'NATIVE_HEALTH_URL', 'Duplicate native health URL');
forbidText(finish, 'pollNativePeak', 'Duplicate native health poller');
forbidText(finish, 'setInterval(() => void pollNativePeak()', 'Duplicate native health timer');

if (failures.length) {
  console.error(`Native control audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Native control audit passed · direct WebView2 transport, stale gesture coalescing, centralized telemetry, and prefix/index parsing are locked');
