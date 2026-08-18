import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const failures = [];
const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
const compact = (source) => source.replace(/\s+/g, '');

class MockAudioWorkletProcessor {
  constructor() {
    this.port = { onmessage: null, postMessage() {}, close() {} };
  }
}

let Processor = null;
const source = read('public/stack-amp-processor.js');
const nativeSource = read('native/src/stack_amp.cpp');
const nativeHeader = read('native/include/calcotone/stack_amp.hpp');
const nativeProcessor = read('native/src/native_processor.cpp');
const host = read('native/src/wasapi_host.cpp');
const app = read('src/App.tsx');
const stackEffect = read('src/audio/effects/StackAmp.ts');
const railC = read('src/components/effects/RailCModules.tsx');

runInNewContext(source, {
  sampleRate: SAMPLE_RATE,
  Float32Array,
  Math,
  Number,
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(name, value) {
    if (name === 'calcotone-stack-amp-processor') Processor = value;
  },
});

if (!Processor) {
  console.error('STACK amp audit failed: processor did not register');
  process.exit(1);
}

const parameter = (value) => new Float32Array([value]);

function render(model, cabinet, quality, drive = 0.58) {
  const processor = new Processor();
  processor.port.onmessage?.({ data: { type: 'quality', quality } });
  const parameters = {
    model: parameter(model), cabinet: parameter(cabinet), drive: parameter(drive),
    tone: parameter(0.53), sag: parameter(0.42),
  };
  let energy = 0;
  let peak = 0;
  let samples = 0;
  const fingerprint = new Float64Array(4);
  for (let block = 0; block < 56; block += 1) {
    const input = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    const output = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const absoluteFrame = block * BLOCK_SIZE + frame;
      const time = absoluteFrame / SAMPLE_RATE;
      const transient = absoluteFrame % 6000 < 80 ? Math.exp(-(absoluteFrame % 6000) / 22) * 0.22 : 0;
      const value = Math.sin(time * Math.PI * 2 * 193) * 0.24
        + Math.sin(time * Math.PI * 2 * 1319) * 0.09 + transient;
      input[0][frame] = value;
      input[1][frame] = value * 0.97;
    }
    processor.process([input], [output], parameters);
    for (let channel = 0; channel < 2; channel += 1) {
      for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
        const value = output[channel][frame];
        if (!Number.isFinite(value)) failures.push(`model ${model}/cab ${cabinet}/${quality}x produced non-finite output`);
        peak = Math.max(peak, Math.abs(value));
        if (block >= 12) {
          energy += value * value;
          fingerprint[(frame >> 5) & 3] += Math.abs(value);
          samples += 1;
        }
      }
    }
  }
  return { rms: Math.sqrt(energy / Math.max(1, samples)), peak, fingerprint };
}

const modelReports = [];
for (const quality of [1, 2, 4]) {
  for (let model = 0; model < 6; model += 1) {
    const cabinets = quality === 2 ? [0, 1, 2, 3, 4] : [2];
    for (const cabinet of cabinets) {
      const result = render(model, cabinet, quality);
      if (result.peak > 1.151) failures.push(`model ${model}/cab ${cabinet}/${quality}x peak escaped guard (${result.peak.toFixed(4)})`);
      if (result.rms < 0.004) failures.push(`model ${model}/cab ${cabinet}/${quality}x collapsed toward silence (${result.rms.toFixed(5)})`);
      if (quality === 2 && cabinet === 2) modelReports.push(result.rms);
    }
  }
}

const quiet = render(5, 2, 2, 0.08);
const driven = render(5, 2, 2, 0.82);
if (driven.rms < quiet.rms * 0.72) failures.push(`drive compensation collapsed level (${quiet.rms.toFixed(4)} → ${driven.rms.toFixed(4)})`);
const modelSpread = Math.max(...modelReports) - Math.min(...modelReports);
if (modelSpread < 0.004) failures.push(`amp studies are insufficiently distinct (RMS spread ${modelSpread.toFixed(5)})`);
if (modelSpread > 0.16) failures.push(`amp study makeup is poorly matched (RMS spread ${modelSpread.toFixed(5)})`);

for (const token of ['SHAPER_LUT', 'hermite(', 'tptLowpass(', 'sagEnvelope', 'transformerMemory', 'coefficientGlide', 'driveMakeup']) {
  if (!source.includes(token)) failures.push(`web processor missing ${token}`);
}

const expectedModels = [
  '{3.15F,.68F,.018F,.24F,.12F,.22F,.92F}',
  '{3.75F,.78F,-.012F,.36F,.08F,.32F,.88F}',
  '{4.85F,.61F,.028F,.48F,.16F,.44F,.82F}',
  '{3.55F,.39F,-.018F,.40F,.22F,.38F,.91F}',
  '{5.35F,.31F,.036F,.64F,.26F,.56F,.76F}',
  '{4.30F,.55F,-.008F,.46F,.18F,.48F,.84F}',
];
const expectedCabs = [
  '{78.F,7200.F,118.F,.16F,1.03F}',
  '{70.F,6500.F,104.F,.20F,1.04F}',
  '{66.F,5600.F,92.F,.26F,1.08F}',
  '{42.F,4800.F,68.F,.24F,1.08F}',
  '{24.F,18000.F,85.F,0.F,.94F}',
];
const compactNative = compact(nativeSource);
for (const profile of [...expectedModels, ...expectedCabs]) {
  if (!compactNative.includes(profile)) failures.push(`native Stack missing canonical profile ${profile}`);
}

for (const token of [
  'kLutSize=2048',
  'a0*mu*mu2+a1*mu2+a2*mu+y1',
  'std::pow(drive,1.38F)*c[0]',
  'drive_makeup=1.F/(1.F+drive*.85F)',
  'sag_attack=1.F-std::exp(-1.F/(internal_rate*.004F))',
  'sag_release=1.F-std::exp(-1.F/(internal_rate*.11F))',
  's.transformer_memory+=(power-s.transformer_memory)*(.06F+c[5]*.11F)',
  'cab_two+body*c[10]',
  'wet=wet-s.dc_input+.995F*s.dc_value',
]) {
  if (!compactNative.includes(token)) failures.push(`native Stack missing canonical equation ${token}`);
}

if (!nativeHeader.includes('std::atomic<unsigned> model_{5};')
    || !nativeHeader.includes('std::atomic<unsigned> cabinet_{2};')
    || !nativeHeader.includes('std::atomic<unsigned> quality_{1};')
    || !nativeHeader.includes('std::atomic<float> drive_{0.36F};')
    || !nativeHeader.includes('std::atomic<float> tone_{0.52F};')
    || !nativeHeader.includes('std::atomic<float> sag_{0.34F};')
    || !nativeHeader.includes('std::atomic<float> mix_{0.62F};')) {
  failures.push('native Stack defaults drifted from the UI contract');
}
if (!stackEffect.includes("const MODEL: ParameterDefinition = { id: 'model', label: 'Amp', min: 0, max: STACK_AMP_MODELS.length - 1, defaultValue: 5")
    || !stackEffect.includes("const CABINET: ParameterDefinition = { id: 'cabinet', label: 'Cabinet', min: 0, max: STACK_CABINETS.length - 1, defaultValue: 2")
    || !railC.includes("model: 'calcotone' as StackAmpModel")
    || !railC.includes("cabinet: '4x12' as StackCabinet")) {
  failures.push('web Stack model/cabinet defaults drifted');
}

const startupQuality = "command('quality', performanceMode === 'studio' ? 4 : performanceMode === 'balanced' ? 2 : 1)";
const liveQuality = "command('quality', mode === 'studio' ? 4 : mode === 'balanced' ? 2 : 1)";
if (!app.includes(startupQuality)) failures.push('native startup does not synchronize Stack quality');
if (!app.includes(liveQuality)) failures.push('live quality buttons do not update native Stack quality');
if (!host.includes('name == "quality"') || !host.includes('processor.set_stack_quality')) failures.push('native host quality command is missing');
if (!nativeProcessor.includes('set_stack_quality(unsigned value)')
    || !nativeProcessor.includes('requested_stack_quality.store(requested')
    || !nativeProcessor.includes('stack_one.set_quality(effective)')
    || !nativeProcessor.includes('stack_two.set_quality(effective)')) {
  failures.push('quality command does not reach both Stack lanes');
}

if (failures.length) {
  console.error(`STACK amp audit failed (${failures.length})`);
  for (const failure of new Set(failures)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`STACK amp parity audit passed · 42 web paths + exact native topology/quality route · RMS ${modelReports.map((value) => value.toFixed(4)).join('/')} · drive ${quiet.rms.toFixed(4)}→${driven.rms.toFixed(4)}`);
