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

const env = read('.env.desktop');
const vite = read('vite.config.ts');
const stub = read('src/audio/DesktopAudioEngineStub.ts');
const app = read('src/App.tsx');
const windows = read('.github/workflows/native-windows.yml');

requireText(env, 'VITE_CALCOTONE_TARGET=desktop', 'Desktop build target');
requireText(vite, "mode === 'desktop'", 'Desktop-only Vite resolver gate');
requireText(vite, 'calcotone-desktop-native-only-audio-engine', 'Desktop native-only resolver');
requireText(vite, 'audio\\/AudioEngine', 'AudioEngine runtime import interception');
requireText(vite, 'DesktopAudioEngineStub.ts', 'Desktop AudioEngine fence target');
requireText(vite, "publicDir: desktop ? false : 'public'", 'Legacy worklets excluded from desktop output');
requireText(vite, 'transformIndexHtml(html)', 'Desktop favicon cleanup');

requireText(stub, 'CALCOTONE desktop is native-only', 'Desktop fence error');
requireText(stub, 'public async start(): Promise<void>', 'Desktop fence start method');
requireText(stub, 'throw new Error(DESKTOP_NATIVE_ONLY_MESSAGE)', 'Desktop WebAudio hard fail');
requireText(stub, 'public setEffectParameter(', 'Random-capture prototype compatibility');
requireText(stub, 'public setEffectBypassed(', 'Random-capture bypass compatibility');
forbidText(stub, 'AudioContext', 'Desktop fence must not create AudioContext');
forbidText(stub, 'AudioWorkletNode', 'Desktop fence must not create AudioWorkletNode');
forbidText(stub, 'getUserMedia', 'Desktop fence must not request browser media');

requireText(app, "import.meta.env.VITE_CALCOTONE_TARGET === 'desktop'", 'App desktop-shell detection');
requireText(app, 'if (nativeShell) {', 'Desktop native failure gate');
requireText(app, 'Native desktop connection failed:', 'Desktop must fail before browser fallback');
requireText(windows, 'npm ci && npm run build:desktop', 'Windows package uses desktop Vite mode');

if (failures.length) {
  console.error(`CALCOTONE desktop native-only audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CALCOTONE desktop native-only audit passed · desktop runtime AudioEngine imports resolve to the native-only fence, legacy public AudioWorklets are excluded, and native bridge failure cannot fall through to Web Audio.');
