import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const bridge = read('src/audio/NativeAudioBridge.ts');
const railC = read('src/components/effects/RailCModules.tsx');
const spectrum = read('src/visual/NativeVisualSpectrum.ts');
const host = read('native/src/wasapi_host.cpp');
const nativeProcessor = read('native/include/calcotone/native_processor.hpp');
const routing = read('src/routing/serialRouting.ts');
const faceplate = read('src/ui/faceplateLayout.ts');

const checks = [];
const check = (ok, category, label, severity = 'error') => checks.push({ ok, category, label, severity });

// Native lifecycle and complete rack synchronization.
check(app.includes("nativeBridgeRef.current.command('active', 1)"), 'engine', 'native engine activation');
check(app.includes('moduleBypass ${module.id}'), 'engine', 'module bypass startup sync');
check(app.includes('toDspParameterValue(module.id, parameter.id, parameter.value)'), 'engine', 'parameter startup sync');
check(app.includes('serialOrderFromRack'), 'routing', 'serialized rack order startup sync');
check(host.includes('name == "order"'), 'routing', 'native order command');
check(routing.includes('serialOrderFromRack'), 'routing', 'frontend serial routing contract');

// Recording and downloadable take behavior.
check(app.includes("commandLine('recordStart')"), 'recording', 'native record start');
check(app.includes("commandLine('recordStop')"), 'recording', 'native record stop');
check(app.includes('fetchRecording()'), 'recording', 'native WAV retrieval');
check(host.includes('recordStart') && host.includes('recordStop') && host.includes('recordCancel'), 'recording', 'native recorder commands');

// Spectrum and visual feedback.
check(spectrum.includes('class NativeVisualSpectrum'), 'visuals', 'native spectrum source');
check(bridge.includes('fetchSpectrum'), 'visuals', 'native spectrum bridge request');
check(host.includes('spectrum_json') || host.includes('/spectrum') || host.includes('spectrum'), 'visuals', 'native spectrum endpoint/provider');
check(!app.includes('setAnalyser(null);\n        setEngineState(\'running\')'), 'visuals', 'native startup does not null the analyser');

// Fullscreen sequencer behavior.
check(railC.includes('sequencerExpanded'), 'synth-ui', 'sequencer expanded state');
check(railC.includes("event.key !== 'Escape'"), 'synth-ui', 'Escape restores compact view');
check(railC.includes('document.body.classList'), 'synth-ui', 'fullscreen body state/scroll lock');
check(railC.includes('sequencer-expand-button'), 'synth-ui', 'fullscreen control');

// Layout editor and persistent faceplate controls.
check(faceplate.includes('localStorage'), 'layout', 'faceplate persistence');
check(faceplate.includes('setFaceplateKnob'), 'layout', 'independent core knob movement');
check(faceplate.includes('setRailCFaceplateControl'), 'layout', 'independent rail-C controls');
check(faceplate.includes('viewportHeight'), 'layout', 'viewport resizing persistence');

// Native device and gain controls.
for (const command of ['inputGain', 'outputGain', 'stackInput', 'stompInput']) {
  check(app.includes(command), 'device-controls', `${command} frontend command`);
  check(host.includes(`name == \"${command}\"`), 'device-controls', `${command} native command`);
}

// Randomization and state propagation.
check(app.includes('randomizeActiveModules'), 'randomization', 'active-module randomization');
check(app.includes('randomizeRailCModule'), 'randomization', 'rail-C randomization');
check(app.includes('RANDOM_MUTATION_AMOUNT'), 'randomization', 'guarded mutate mode');

// Artifact matrix functionality.
for (const parameter of ['console', 'tube', 'chainOrder']) {
  check(app.includes(`id: '${parameter}'`), 'artifact', `${parameter} state`);
  check(host.includes(parameter) || read('native/tools/apply_atmos_parity.py').includes(parameter), 'artifact', `${parameter} native route`);
}

// Native synth parity. These intentionally block release until the Windows host
// can perform the same actions as the visible Synth UI rather than silently no-op.
const nativeSynthSurface = `${host}\n${nativeProcessor}`;
for (const command of ['synthEnabled', 'synthMachine', 'synthParameters', 'synthNote', 'synthSequencer']) {
  check(nativeSynthSurface.includes(command), 'native-synth', `${command} native command/processor path`);
}
check(app.includes("backendRef.current === 'native'") && app.includes('setSynthMachine'), 'native-synth', 'Synth callbacks branch to native backend');

const failed = checks.filter((item) => !item.ok && item.severity === 'error');
for (const category of [...new Set(checks.map((item) => item.category))]) {
  const group = checks.filter((item) => item.category === category);
  const passed = group.filter((item) => item.ok).length;
  console.log(`${category}: ${passed}/${group.length}`);
  for (const item of group.filter((entry) => !entry.ok)) console.error(`  FAIL: ${item.label}`);
}

if (failed.length) {
  console.error(`Windows UI parity audit failed: ${failed.length} blocking contract(s) missing.`);
  process.exit(1);
}
console.log(`Windows UI parity audit passed (${checks.length} contracts).`);
