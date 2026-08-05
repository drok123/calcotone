import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const manifest = JSON.parse(read('contracts/calcotone-core-manifest.json'));
const app = read('src/App.tsx');
const nativeRack = read('native/src/native_rack.cpp');

const sourceByModule = {
  saturation: read('src/audio/effects/Saturation.ts'),
  chorus: read('src/audio/effects/Chorus.ts'),
  delay: read('src/audio/effects/Delay.ts'),
  reverb: read('src/audio/effects/Reverb.ts'),
  bitcrusher: read('src/audio/effects/Bitcrusher.ts'),
  media: read('src/audio/effects/Media.ts'),
};

const modelFieldByModule = {
  saturation: 'emberMode',
  chorus: 'driftMode',
  delay: 'delayAlgorithm',
  reverb: 'algorithm',
  bitcrusher: 'grainMode',
  media: 'mediaMode',
};

const nativeStructByModule = {
  saturation: 'Ember',
  chorus: 'Drift',
  delay: 'Halo',
  reverb: 'Atmos',
  bitcrusher: 'Grain',
  media: 'Artifact',
};

const failures = [];
const pass = [];
const check = (condition, label) => {
  (condition ? pass : failures).push(label);
};

function quotedValues(source) {
  return [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function extractOrder(source, symbol) {
  const pattern = new RegExp(`export const ${symbol}[^=]*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = source.match(pattern);
  return match ? quotedValues(match[1]) : null;
}

function extractModuleBlock(moduleId) {
  const marker = `id: '${moduleId}',`;
  const start = app.indexOf(marker);
  if (start < 0) return null;
  const next = app.indexOf("\n  {\n    id: '", start + marker.length);
  return app.slice(start, next < 0 ? app.length : next);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

for (const [rail, expected] of Object.entries(manifest.rails)) {
  const symbol = `DEFAULT_RAIL_${rail}_ORDER`;
  const match = app.match(new RegExp(`const ${symbol} = \\[([^\\]]+)\\] as const;`));
  const actual = match ? quotedValues(match[1]) : [];
  check(arraysEqual(actual, expected), `${symbol} matches canonical manifest`);
}

for (const module of manifest.modules) {
  const source = sourceByModule[module.id];
  const order = extractOrder(source, module.modelOrderSymbol);
  check(Array.isArray(order), `${module.name} exports ${module.modelOrderSymbol}`);
  if (order) check(arraysEqual(order, module.models), `${module.name} model order and stable indices`);

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
  check(
    nativeRack.includes(`std::min(${module.models.length - 1}U`) || nativeRack.includes(`std::min(${module.models.length - 1}u`),
    `${module.name} native model-index ceiling ${module.models.length - 1}`,
  );
}

check(!app.includes("moduleId === 'synth'"), 'retired Synth module branch absent from checked-in App');
check(!app.includes('SynthModule'), 'retired Synth component absent from checked-in App');
check(!app.includes('onSynthEnabledChange'), 'retired Synth callback contract absent from checked-in App');
check(app.includes("DEFAULT_RAIL_C_ORDER = ['stomp', 'chaos', 'pressure']"), 'Rail C is Stomp → Stack → Pressure');

for (const label of pass) console.log(`PASS: ${label}`);
if (failures.length) {
  for (const label of failures) console.error(`FAIL: ${label}`);
  console.error(`Core contract parity audit failed: ${failures.length} mismatch(es).`);
  process.exit(1);
}
console.log(`Core contract parity audit passed (${pass.length} contracts).`);
