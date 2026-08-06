import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const app = read('src/App.tsx');
const css = read('src/App.css');
const effectModule = read('src/components/effects/EffectModule.tsx');
const railC = read('src/components/effects/RailCModules.tsx');
const spectrum = read('src/visual/NativeVisualSpectrum.ts');
const host = read('native/src/wasapi_host.cpp');
const nativeProcessor = read('native/include/calcotone/native_processor.hpp');
const routing = read('src/routing/serialRouting.ts');
const faceplate = read('src/ui/faceplateLayout.ts');
const launcher = read('native/START-CALCOTONE-NATIVE.bat');
const nativeRackPatch = read('native/tools/apply_atmos_parity.py');
const nativeRackTemplate = read('native/src/native_rack.cpp');
const emberNative = `${read('native/src/ember_parity_processor.cpp')}\n${read('native/src/ember_magnetic_core_processor.cpp')}\n${read('native/src/ember_digital_capture_processor.cpp')}`;
const driftNative = `${read('native/src/drift_parity_processor.cpp')}\n${read('native/src/drift_standard_processor.cpp')}\n${read('native/src/drift_classic_processor.cpp')}`;
const haloNative = read('native/src/halo_parity_processor.cpp');
const atmosNative = read('native/src/atmos_parity_processor.cpp');
const grainNative = read('native/src/grain_parity_processor.cpp');
const artifactNative = read('native/src/artifact_parity_processor.cpp');
const stompNative = read('native/src/stomp_parity_processor.cpp');
const pressureNative = read('native/src/pressure_parity_processor.cpp');
const pressureWeb = read('src/audio/SignalLab.ts');

const checks = [];
const check = (ok, category, label, severity = 'error') => checks.push({ ok, category, label, severity });
const count = (source, token) => source.split(token).length - 1;

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
check(spectrum.includes('127.0.0.1:48157/spectrum') && spectrum.includes('fetch(NATIVE_SPECTRUM_URL'), 'visuals', 'native spectrum request path');
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

check(railC.includes("export const STOMP_MODE_LABELS = [\n  '808 Overdrive', 'RAT Distortion', 'Big Muff', 'Fuzz Face', 'DS-1 Distortion',\n  'Blues Driver', 'Gold Horse', 'Swedish Chainsaw', 'Metal Zone', 'Octavia',\n  'Rangemaster', 'Cry Baby Wah', 'Whammy Octave', 'Dyna Comp',\n] as const;"), 'stomp', 'fourteen stable ordered Stomp UI labels');
check(stompNative.includes('kStompModeCount = 14U') || read('native/include/calcotone/stomp_parity_processor.hpp').includes('kStompModeCount = 14U'), 'stomp', 'fourteen stable native Stomp indices');
for (const needle of ['StompParityProcessor::set_parameter', 'process_wah', 'process_whammy', 'process_compressor']) {
  check(stompNative.includes(needle), 'stomp', `${needle} dedicated Stomp route`);
}
check(nativeRackPatch.includes('StompParityProcessor processor') && nativeRackPatch.includes('stomp(sample_rate)'), 'stomp', 'live rack constructs dedicated Stomp processor');

check(pressureWeb.includes("export const SIGNAL_LAB_MODES: readonly SignalLabMode[] = ['fet', 'opto', 'varimu', 'vca'] as const;"), 'pressure', 'four stable Pressure mode indices');
check(pressureWeb.includes("export const SIGNAL_LAB_STYLES: readonly SignalLabStyle[] = ['soft', 'punch', 'glue', 'crush'] as const;"), 'pressure', 'four stable Pressure style indices');
for (const needle of [
  'PressureParityProcessor::set_parameter', 'soft_knee_gain', 'detector[channel].highpass',
  'tone_filter[channel].lowpass', 'constexpr float correlation = .42F',
  'mode.threshold + style.threshold_offset - drive_control * 4.5F',
  'mode.saturation * (.82F + drive_control * 1.9F)',
]) {
  check(pressureNative.includes(needle), 'pressure', `${needle} canonical Pressure topology`);
}
check(nativeRackTemplate.includes('PressureParityProcessor processor')
  && nativeRackTemplate.includes('impl_->processor.set_bypassed(bypassed)')
  && nativeRackTemplate.includes('impl_->processor.set_parameter(name, value)'),
  'pressure', 'live NativePressure wrapper delegates to dedicated processor');

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
check(effectModule.includes('const customFaceplate = faceplateEditor.layout.custom;'), 'layout', 'Windows follows shared web faceplate state');
check(effectModule.includes('faceplate-layout-stage'), 'layout', 'core faceplate stage markup');
check(effectModule.includes('faceplate-viewport-shell'), 'layout', 'core viewport shell markup');
check(effectModule.includes('faceplate-control-surface'), 'layout', 'core control surface markup');
check(effectModule.includes('faceplate-knob-slot'), 'layout', 'core control slot markup');
check(effectModule.includes("'--faceplate-x': `${point.x * 100}%`") && effectModule.includes("'--faceplate-y': `${point.y}px`"), 'layout', 'saved coordinate metadata is preserved');
check(!css.includes('Native faceplate geometry contract'), 'layout', 'native-only faceplate override is absent');
check(!/\.faceplate-layout-stage\s*\{[^}]*overflow:\s*hidden/s.test(css), 'layout', 'faceplate stage does not clip labels');
check(!/\.faceplate-control-surface\s*\{[^}]*position:\s*absolute/s.test(css), 'layout', 'controls remain in canonical web flow');
check(!/\.faceplate-knob-slot\s*>\s*\.knob-control\s*\{[^}]*width:\s*92px/s.test(css), 'layout', 'core knobs inherit canonical web sizing');
check(css.includes('.knob-control {') && css.includes('grid-template-rows:'), 'layout', 'web knob label/value rows remain present');

for (const command of ['inputGain', 'outputGain', 'stackInput', 'stompInput']) {
  check(app.includes(command), 'device-controls', `${command} frontend command`);
  check(host.includes(`name == "${command}"`), 'device-controls', `${command} native command`);
}
check(launcher.includes('CALCOTONE_AUDIO_MODE=exclusive'), 'device-controls', 'launcher exclusive-mode default');
check(launcher.includes('if exist "CALCOTONE-AUDIO-CONFIG.bat" call'), 'device-controls', 'launcher configuration override');

check(app.includes('randomizeActiveModules'), 'randomization', 'active-module randomization');
check(app.includes('randomizeRailCModule'), 'randomization', 'rail-C randomization');
check(app.includes('RANDOM_MUTATION_AMOUNT') || railC.includes('RANDOM_MUTATION_AMOUNT'), 'randomization', 'guarded mutate mode');
check(railC.includes("useRailCRandomController('chaos'"), 'randomization', 'Stack randomization registration');

check(app.includes('applyXYAssignments'), 'xy', 'global XY assignment engine');
check(app.includes("backendRef.current === 'native'") && app.includes('modulatedValue'), 'xy', 'global XY native backend branch');
check(app.includes('commandLine(`param ${moduleId} ${parameterId}'), 'xy', 'global XY native parameter command');

for (const parameter of ['console', 'tube', 'chainOrder']) {
  check(!app.includes(`id: '${parameter}'`), 'artifact', `${parameter} UI state removed`);
}
check(!nativeRackPatch.includes('ArtifactChainProcessor'), 'artifact', 'hidden native Artifact chain removed');
check(count(effectModule, 'aria-label="Artifact format"') === 1, 'artifact', 'exactly one visible Artifact dropdown');
check(!effectModule.includes('<ArtifactMatrixSelectors'), 'artifact', 'Artifact matrix selectors removed');
check(effectModule.includes('const visibleParameters = module.parameters;'), 'artifact', 'all canonical Artifact knobs render directly');

const moduleContracts = [
  { id: 'saturation', name: 'Ember', native: `${nativeRackPatch}\n${emberNative}`, needles: ['EmberParityProcessor', 'processor.set_parameter("mode"'] },
  { id: 'chorus', name: 'Drift', native: `${nativeRackPatch}\n${driftNative}`, needles: ['DriftParityProcessor', 'DriftStandardProcessor', 'DriftClassicProcessor'] },
  { id: 'delay', name: 'Halo', native: `${nativeRackPatch}\n${haloNative}`, needles: ['HaloParityProcessor', 'processor.set_parameter("algorithm"'] },
  { id: 'reverb', name: 'Atmos', native: `${nativeRackPatch}\n${atmosNative}`, needles: ['AtmosParityProcessor', 'processor.set_parameter("algorithm"'] },
  { id: 'bitcrusher', name: 'Grain', native: `${nativeRackPatch}\n${grainNative}`, needles: ['GrainParityProcessor', 'processor.set_parameter("mode"', 'capture_freeze', 'spawn_voice'] },
  { id: 'media', name: 'Artifact', native: `${nativeRackPatch}\n${artifactNative}`, needles: ['ArtifactParityProcessor', 'processor.set_parameter("mode"', 'bcm_capture', 'atr_tape_transfer', 'point.insert'] },
];
for (const contract of moduleContracts) {
  check(app.includes(`id: '${contract.id}'`), 'module-state', `${contract.name} canonical state exists`);
  check(effectModule.includes(`module.id === '${contract.id}'`) || contract.id === 'media', 'module-ui', `${contract.name} module-specific UI route`);
  check(contract.needles.every((needle) => contract.native.includes(needle)), 'module-native', `${contract.name} dedicated native route surface`);
}

const failed = checks.filter((item) => !item.ok && item.severity === 'error');
for (const category of new Set(checks.map((item) => item.category))) {
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
