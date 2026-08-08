import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const compact = (source) => source.replace(/\s+/g, '');
const manifest = JSON.parse(read('contracts/calcotone-core-manifest.json'));
const app = read('src/App.tsx');
const nativeRack = read('native/src/native_rack.cpp');
const railC = read('src/components/effects/RailCModules.tsx');
const stackSource = read('src/audio/effects/StackAmp.ts');
const loopSource = read('src/components/signal/loopStore.ts');
const loopHeader = read('native/include/calcotone/loop_processor.hpp');
const loopNative = read('native/src/loop_processor.cpp');
const pressureNative = read('native/src/pressure_parity_processor.cpp');
const artifactNative = read('native/src/artifact_parity_processor.cpp');
const stompNative = read('native/src/stomp_parity_processor.cpp');
const stompHeader = read('native/include/calcotone/stomp_parity_processor.hpp');
const stackNative = read('native/src/stack_amp.cpp');

const sourceByModule = {
  saturation: read('src/audio/effects/Saturation.ts'),
  chorus: read('src/audio/effects/Chorus.ts'),
  delay: read('src/audio/effects/Delay.ts'),
  reverb: read('src/audio/effects/Reverb.ts'),
  bitcrusher: read('src/audio/effects/Bitcrusher.ts'),
  media: read('src/audio/effects/Media.ts'),
  stomp: railC,
  chaos: stackSource,
  // The legacy manifest/layout id remains pressure, but its canonical visible
  // module is now LOOP in RailCModules.tsx.
  pressure: railC,
};

const modelFieldByModule = {
  saturation: 'emberMode', chorus: 'driftMode', delay: 'delayAlgorithm',
  reverb: 'algorithm', bitcrusher: 'grainMode', media: 'mediaMode',
};
const nativeStructByModule = {
  saturation: 'Ember', chorus: 'Drift', delay: 'Halo', reverb: 'Atmos',
  bitcrusher: 'Grain', media: 'Artifact',
};

const failures = [];
const pass = [];
const check = (condition, label) => (condition ? pass : failures).push(label);
const quotedValues = (source) => [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
function extractOrder(source, symbol, seen = new Set()) {
  if (seen.has(symbol)) return [];
  seen.add(symbol);
  const pattern = new RegExp(`export const ${symbol}[^=]*=\\s*\\[([\\s\\S]*?)\\]`);
  const match = source.match(pattern);
  if (!match) return null;
  const values = [];
  for (const chunk of match[1].split(',')) {
    const token = chunk.trim();
    const quoted = token.match(/^'([^']+)'$/);
    if (quoted) {
      values.push(quoted[1]);
      continue;
    }
    const spread = token.match(/^\.\.\.([A-Za-z0-9_]+)$/);
    if (spread) {
      const expanded = extractOrder(source, spread[1], seen);
      if (!expanded) return null;
      values.push(...expanded);
    }
  }
  return values;
}
function extractModuleBlock(moduleId) {
  const marker = `id: '${moduleId}',`;
  const start = app.indexOf(marker);
  if (start < 0) return null;
  const next = app.indexOf("\n  {\n    id: '", start + marker.length);
  return app.slice(start, next < 0 ? app.length : next);
}
const arraysEqual = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

const manifestById = new Map(manifest.modules.map((module) => [module.id, module]));
const railMembers = [];
for (const [rail, expected] of Object.entries(manifest.rails)) {
  const symbol = `DEFAULT_RAIL_${rail}_ORDER`;
  const match = app.match(new RegExp(`const ${symbol} = \\[([^\\]]+)\\] as const;`));
  const actual = match ? quotedValues(match[1]) : [];
  check(arraysEqual(actual, expected), `${symbol} matches canonical manifest`);
  for (const moduleId of expected) {
    railMembers.push(moduleId);
    const module = manifestById.get(moduleId);
    check(Boolean(module), `rail ${rail} module ${moduleId} is defined`);
    if (module) check(module.rail === rail, `${moduleId} declares rail ${rail}`);
  }
}
check(new Set(railMembers).size === railMembers.length, 'each module occupies one rail slot');
check(manifest.modules.every((module) => railMembers.includes(module.id)), 'every manifest module occupies a rail slot');

for (const module of manifest.modules) {
  const source = sourceByModule[module.id];
  check(Boolean(source), `${module.name} canonical source exists`);
  const order = source ? extractOrder(source, module.modelOrderSymbol) : null;
  check(Array.isArray(order), `${module.name} exports ${module.modelOrderSymbol}`);
  if (order) check(arraysEqual(order, module.models), `${module.name} model order and stable indices`);

  if (module.rail !== 'C') {
    const block = extractModuleBlock(module.id);
    check(Boolean(block), `${module.name} exists in INITIAL_MODULES`);
    if (block) {
      const field = modelFieldByModule[module.id];
      check(block.includes(`${field}: '${module.defaultModel}'`), `${module.name} default model`);
      check(block.includes(`name: '${module.name}'`), `${module.name} product label`);
      for (const control of module.controls) {
        const escaped = String(control.defaultUi).replace('.', '\\.');
        const pattern = new RegExp(`id: '${control.id}'[\\s\\S]{0,90}?value: ${escaped}(?:[,}])`);
        check(pattern.test(block), `${module.name}.${control.id} UI default ${control.defaultUi}`);
      }
    }
    const nativeStruct = nativeStructByModule[module.id];
    check(nativeRack.includes(`struct ${nativeStruct}`), `${module.name} native processor exists`);
    check(nativeRack.includes(`std::min(${module.models.length - 1}U`)
      || nativeRack.includes(`std::min(${module.models.length - 1}u`),
      `${module.name} native model-index ceiling ${module.models.length - 1}`);
    continue;
  }

  if (module.id === 'stomp') {
    check(railC.includes('name="Stomp"'), 'Stomp product label');
    check(compact(railC).includes("mode:0,inputSource:'input-2'asStackInputSource,presetId:'classic',values:[.38,.54,.68,.42,.52,1]"), 'Stomp UI defaults');
    check(module.defaultModel === module.models[0], 'Stomp default model index 0');
    check(stompHeader.includes('kStompModeCount = 14U'), 'Stomp native model count 14');
    check(stompNative.includes('std::clamp(std::round(value), 0.F, 13.F)'), 'Stomp native model-index ceiling 13');
    check(stompNative.includes("target{0.F,.38F,.54F,.68F,.42F,.52F,1.F}"), 'Stomp native control defaults');
  } else if (module.id === 'chaos') {
    check(railC.includes('name="Stack"'), 'Stack product label');
    check(compact(railC).includes("model:'calcotone'asStackAmpModel,cabinet:'4x12'asStackCabinet,inputSource:'input-2'asStackInputSource,values:[0.36,0.52,0.34,0.62]"), 'Stack UI defaults');
    check(stackNative.includes('std::min(static_cast<unsigned>(value), 5U)'), 'Stack native model-index ceiling 5');
    check(stackNative.includes('std::min(static_cast<unsigned>(value), 4U)'), 'Stack native cabinet-index ceiling 4');
    check(stackNative.includes('std::copy(kModels[5]') && stackNative.includes('std::copy(kCabs[2]'), 'Stack native model and cabinet defaults');
  } else if (module.id === 'pressure') {
    check(railC.includes('name="Loop"'), 'Loop product label');
    check(loopSource.includes('export const LOOP_TRACK_COUNT = 8'), 'Loop exposes eight fixed tracks');
    check(compact(loopSource).includes('enabled:false,selectedTrack:0,masterLevel:0.78,') && compact(loopSource).includes('overdub:0,') && compact(loopSource).includes('fade:0.18,'), 'Loop UI defaults');
    check(loopHeader.includes('kLoopTrackCount = 8U') && loopHeader.includes('kLoopMaxSeconds = 60.F'), 'Loop native capacity contract');
    check(loopNative.includes('LoopProcessor::process') && loopNative.includes('LoopCommand::Overdub'), 'Loop dedicated native processor exists');
    check(app.includes("LOOP_CHANGE_EVENT") && app.includes("LOOP_COMMAND_EVENT"), 'Loop native control bridge is synchronized from App');
    check(!read('src/features/random/railCRandomRegistry.ts').includes("'pressure'"), 'Loop is excluded from Rail C RANDOM');
    check(read('src/routing/serialRouting.ts').includes("LOOP_MODULE_ID = 'pressure'"), 'Loop remains standalone from serial routing');
    check(artifactNative.includes('PressureParityProcessor dynamics') && pressureNative.includes('PressureParityProcessor::set_parameter'), 'Pressure compressor DSP moved behind Artifact dynamics modes');
  }
}

check(!app.includes("moduleId === 'synth'"), 'retired Synth module branch absent from checked-in App');
check(!app.includes('SynthModule'), 'retired Synth component absent from checked-in App');
check(!app.includes('onSynthEnabledChange'), 'retired Synth callback contract absent from checked-in App');
check(app.includes("DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure']"), 'Rail C is Stomp → Stack → Loop (legacy pressure layout key)');

for (const label of pass) console.log(`PASS: ${label}`);
if (failures.length) {
  for (const label of failures) console.error(`FAIL: ${label}`);
  console.error(`Core contract parity audit failed: ${failures.length} mismatch(es).`);
  process.exit(1);
}
console.log(`Core contract parity audit passed (${pass.length} contracts).`);