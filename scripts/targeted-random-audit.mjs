import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const registry = read('src/features/random/coreRandomRegistry.ts');
const railCRegistry = read('src/features/random/railCRandomRegistry.ts');
const bridge = read('src/randomTransferBridge.ts');
const effectModule = read('src/components/effects/EffectModule.tsx');
const css = read('src/components/controls/RandomPerformance.css');

for (const moduleId of ['saturation', 'chorus', 'delay', 'reverb', 'bitcrusher', 'media']) {
  requireText(registry, `'${moduleId}'`, `Core targeted RANDOM ${moduleId}`);
}
forbidText(registry, "'pressure'", 'Loop must remain outside core targeted RANDOM');
forbidText(registry, "'loop'", 'Loop must remain outside core targeted RANDOM');
requireText(registry, 'RANDOM_MUTATION_AMOUNT', 'Targeted MUTATE 10% contract');
requireText(registry, 'buildTargetedCoreRandom(', 'Targeted core recipe builder');
requireText(registry, "profile === 'mutate'", 'Targeted mode-preserving mutate path');
requireText(registry, 'if (parameterId === \'mix\') safe = Math.min(safe, .52)', 'Targeted wet-mix safety cap');
requireText(registry, "module.mediaMode === 'Neve BCM10'", 'Targeted BCM10 safety guard');

requireText(railCRegistry, "RAIL_C_RANDOM_ORDER = ['stomp', 'chaos']", 'Rail C targeted RANDOM scope');
forbidText(railCRegistry, "'pressure'", 'Loop must remain outside Rail C RANDOM registry');

requireText(effectModule, 'registerCoreRandomController(', 'Core modules register targeted RANDOM controller');
requireText(effectModule, 'buildTargetedCoreRandom(current, profile)', 'Core targeted RANDOM uses real state recipe');
requireText(effectModule, 'onParameterChange(parameter.id, parameter.value)', 'Targeted RANDOM applies real parameter callbacks');
requireText(effectModule, 'onMicrocosmHoldChange(false)', 'Targeted Grain RANDOM releases held memory safely');

requireText(bridge, "const RANDOM_DRAG_MIME = 'application/x-calcotone-random-profile'", 'Dedicated RANDOM drag MIME');
requireText(bridge, "button.randomizer-toggle:not(.signal-randomizer-toggle)", 'RANDOM drag source selection');
requireText(bridge, 'button.draggable = true', 'RANDOM buttons are draggable');
requireText(bridge, 'event.stopImmediatePropagation()', 'RANDOM drop is isolated from routing drag/drop');
requireText(bridge, 'randomizeCoreModule(moduleId, profile)', 'Core module drop target');
requireText(bridge, 'randomizeRailCModule(moduleId as RailCRandomModuleId, profile)', 'Rail C module drop target');
requireText(bridge, 'RANDOM_DRAG_CLICK_SUPPRESS_MS', 'Post-drag global-click suppression');
forbidText(bridge, 'randomizeActiveModules(', 'Targeted drag must not call global RANDOM');

requireText(css, '.random-drop-target', 'RANDOM target affordance');
requireText(css, '.random-drop-hit', 'RANDOM accepted-drop feedback');
requireText(css, '.random-drop-rejected', 'RANDOM rejected-drop feedback');

if (failures.length) {
  console.error(`CALCOTONE targeted RANDOM audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CALCOTONE targeted RANDOM audit passed · RANDOM/MUTATE drop affects one eligible module and Loop remains isolated.');
