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
const launcher = read('native/START-CALCOTONE-NATIVE.bat');

const checks = [];
const check = (ok, category, label, severity = 'error') => checks.push({ ok, category, label, severity });

check(app.includes("nativeBridgeRef.current.command('active', 1)"), 'engine', 'native engine activation');
check(app.includes('moduleBypass ${module.id}'), 'engine', 'module bypass startup sync');
check(app.includes('toDspParameterValue(module.id, parameter.id, parameter.value)'), 'engine', 'parameter startup sync');
check(app.includes('serialOrderFromRack'), 'routing', 'serialized rack order startup sync');
check(host.includes('name == "order"'), 'routing', 'native order command');
check(routing.includes('serialOrderFromRack'), 'routing', 'frontend serial routing contract');

check(app.includes("commandLine('recordStart')"), 'recording', 'native record start');
check(app.includes("commandLine('recordStop')"), 'recording', 'native record stop');
check(app.includes('fetchRecording()'), 'recording', 'native WAV retrieval');
check(host.includes('recordStart') && host.includes('recordStop') && host.includes('recordCancel'), 'recording', 'native recorder commands');

check(spectrum.includes('class NativeVisualSpectrum'), 'visuals', 'native spectrum source');
check(bridge.includes('fetchSpectrum'), 'visuals', 'native spectrum bridge request');
check(host.includes('spectrum_json') || host.includes('/spectrum') || host.includes('spectrum'), 'visuals', 'native spectrum endpoint/provider');
check(!app.includes("setAnalyser(null);\n        setEngineState('running')"), 'visuals', 'native startup does not null the analyser');

const stackSurface = `${app}\n${railC}\n${host}\n${nativeProcessor}`;
check(railC.includes('name="Stack"') || railC.includes("name='Stack'"), 'stack', 'Stack module rendered');
check(app.includes("DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure']"), 'stack', 'Stack occupies chaos Rail C slot');
for (const command of ['stackInput', 'model', 'cab', 'drive', 'tone', 'sag', 'mix']) {
  check(stackSurface.includes(command), 'stack', `${command} Stack control path`);
}
check(app.includes('setStackEnabled'), 'stack', 'Stack enable/bypass callback');
check(app.includes('setStackModel'), 'stack', 'Stack model callback');
check(app.includes('setStackCabinet'), 'stack', 'Stack cabinet callback');
check(app.includes('setStackInputSource'), 'stack', 'Stack input-source callback');
check(app.includes('setStackParameters'), 'stack', 'Stack parameter callback');
check(host.includes('set_stack_model') && host.includes('set_stack_cabinet'), 'stack', 'native Stack model/cabinet DSP route');
check(nativeProcessor.includes('set_stack_drive') && nativeProcessor.includes('set_stack_tone') && nativeProcessor.includes('set_stack_sag') && nativeProcessor.includes('set_stack_mix'), 'stack', 'native Stack parameter DSP route');
check(!railC.includes('<MotionPad {...motionPadProps} />'), 'stack', 'Stack XY input panel removed');
check(!railC.includes('motionPadProps: MotionPadProps'), 'stack', 'Stack MotionPad prop contract removed');
check(!app.includes('motionPadProps={{'), 'stack', 'Stack MotionPad App wiring removed');

for (const retired of [
  "moduleId === 'synth'",
  'SynthModule',
  'onSynthEnabledChange',
  'onSynthMachineChange',
  'onSynthParametersChange',
  'SYNTH_MACHINES',
  'sequencerExpanded',
]) {
  check(!app.includes(retired) && !railC.includes(retired), 'retired-synth', `${retired} removed`);
}

check(faceplate.includes('localStorage'), 'layout', 'faceplate persistence');
check(faceplate.includes('setFaceplateKnob'), 'layout', 'independent core knob movement');
check(faceplate.includes('setRailCFaceplateControl'), 'layout', 'independent rail-C controls');
check(faceplate.includes('viewportHeight'), 'layout', 'viewport resizing persistence');

for (const command of ['inputGain', 'outputGain', 'stackInput', 'stompInput']) {
  check(app.includes(command), 'device-controls', `${command} frontend command`);
  check(host.includes(`name == \"${command}\"`), 'device-controls', `${command} native command`);
}
check(launcher.includes('CALCOTONE_AUDIO_MODE=exclusive'), 'device-controls', 'launcher exclusive-mode default');
check(launcher.includes('if exist "CALCOTONE-AUDIO-CONFIG.bat" call'), 'device-controls', 'launcher configuration override');

check(app.includes('randomizeActiveModules'), 'randomization', 'active-module randomization');
check(app.includes('randomizeRailCModule'), 'randomization', 'rail-C randomization');
check(app.includes('RANDOM_MUTATION_AMOUNT'), 'randomization', 'guarded mutate mode');
check(railC.includes("registerRailCRandomController('chaos'") || railC.includes('registerRailCRandomController(moduleId'), 'randomization', 'Stack randomization registration');

check(app.includes('applyXYAssignments'), 'xy', 'global XY assignment engine');
check(app.includes("backendRef.current === 'native'") && app.includes('modulatedValue'), 'xy', 'global XY native backend branch');
check(app.includes('commandLine(`param ${moduleId} ${parameterId}'), 'xy', 'global XY native parameter command');

for (const parameter of ['console', 'tube', 'chainOrder']) {
  check(app.includes(`id: '${parameter}'`), 'artifact', `${parameter} state`);
  check(host.includes(parameter) || read('native/tools/apply_atmos_parity.py').includes(parameter), 'artifact', `${parameter} native route`);
}

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
