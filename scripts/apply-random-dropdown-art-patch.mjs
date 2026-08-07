import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, oldText, newText) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one patch target, found ${count}\n${oldText.slice(0, 180)}`);
  writeFileSync(path, source.replace(oldText, newText));
}

replaceOnce(
  'src/App.tsx',
  `function chooseMusical<T>(values: readonly T[]): T {\n  return values[Math.floor(Math.random() * values.length)]!;\n}\n`,
  `function chooseMusical<T>(values: readonly T[]): T {\n  return values[Math.floor(Math.random() * values.length)]!;\n}\n\nfunction chooseMusicalDifferent<T>(values: readonly T[], current: T | undefined): T {\n  const alternatives = values.filter((value) => value !== current);\n  return chooseMusical(alternatives.length ? alternatives : values);\n}\n`,
);

replaceOnce(
  'src/App.tsx',
  `function withMusicalRandomMode(module: ModuleState): ModuleState {\n  if (module.id === 'saturation') return { ...module, emberMode: chooseMusical(MUSICAL_EMBER_MODES) };\n  if (module.id === 'chorus') return { ...module, driftMode: chooseMusical(MUSICAL_DRIFT_MODES) };\n  if (module.id === 'delay') return { ...module, delayAlgorithm: chooseMusical(MUSICAL_HALO_MODES) };\n  if (module.id === 'reverb') return { ...module, algorithm: chooseMusical(MUSICAL_ATMOS_MODES) };\n  if (module.id === 'bitcrusher') return { ...module, grainMode: chooseMusical(MUSICAL_GRAIN_MODES) };\n  if (module.id === 'media') return { ...module, mediaMode: chooseMusical(MUSICAL_MEDIA_MODES) };\n  return module;\n}\n`,
  `function withMusicalRandomMode(module: ModuleState): ModuleState {\n  if (module.id === 'saturation') return { ...module, emberMode: chooseMusicalDifferent(MUSICAL_EMBER_MODES, module.emberMode) };\n  if (module.id === 'chorus') return { ...module, driftMode: chooseMusicalDifferent(MUSICAL_DRIFT_MODES, module.driftMode) };\n  if (module.id === 'delay') return { ...module, delayAlgorithm: chooseMusicalDifferent(MUSICAL_HALO_MODES, module.delayAlgorithm) };\n  if (module.id === 'reverb') return { ...module, algorithm: chooseMusicalDifferent(MUSICAL_ATMOS_MODES, module.algorithm) };\n  if (module.id === 'bitcrusher') return { ...module, grainMode: chooseMusicalDifferent(MUSICAL_GRAIN_MODES, module.grainMode) };\n  if (module.id === 'media') return { ...module, mediaMode: chooseMusicalDifferent(MUSICAL_MEDIA_MODES, module.mediaMode) };\n  return module;\n}\n`,
);

replaceOnce(
  'src/App.tsx',
  `          for (const parameter of module.parameters)\n            void nativeBridgeRef.current.commandLine(\`param \${module.id} \${parameter.id} \${toDspParameterValue(module.id, parameter.id, parameter.value)}\`);\n        }\n        return;\n      }\n`,
  `          for (const parameter of module.parameters)\n            void nativeBridgeRef.current.commandLine(\`param \${module.id} \${parameter.id} \${toDspParameterValue(module.id, parameter.id, parameter.value)}\`);\n        }\n\n        // Native DSP receives the new values immediately, but it does not emit the\n        // browser transfer scheduler's RANDOM reveal events. Drive the same serial UI\n        // packet flow locally so every controlled select and Rail C controller lands\n        // on the exact state that is actually sounding.\n        const orderedTargets = [\n          ...RANDOM_UI_EFFECT_ORDER.filter((effectId) => targets.has(effectId)),\n          ...activeRailC,\n        ];\n        for (const [index, effectId] of orderedTargets.entries()) {\n          offlineRandomTimersRef.current.push(\n            window.setTimeout(() => revealRandomUiModule(effectId), 48 + index * 96)\n          );\n        }\n        offlineRandomTimersRef.current.push(\n          window.setTimeout(() => completeRandomUiFlow(), 72 + orderedTargets.length * 96)\n        );\n        return;\n      }\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `import { Knob } from '../controls/Knob';\n`,
  `import { Knob } from '../controls/Knob';\nimport { RailCHardwareDisplay } from '../ascii/RailCHardwareDisplay';\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `function centeredRandom(minimum: number, maximum: number): number {\n  const centerBiased = (Math.random() + Math.random()) * 0.5;\n  return minimum + (maximum - minimum) * centerBiased;\n}\n`,
  `function centeredRandom(minimum: number, maximum: number): number {\n  const centerBiased = (Math.random() + Math.random()) * 0.5;\n  return minimum + (maximum - minimum) * centerBiased;\n}\n\nfunction chooseDifferent<T>(values: readonly T[], current: T): T {\n  const alternatives = values.filter((value) => value !== current);\n  const pool = alternatives.length ? alternatives : values;\n  return pool[Math.floor(Math.random() * pool.length)]!;\n}\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `type StompModuleProps = RailInteractionProps & {\n  engineRunning: boolean;\n`,
  `type StompModuleProps = RailInteractionProps & {\n  engineRunning: boolean;\n  visualState: VisualAudioState;\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `function StompModule({ engineRunning, onEnabledChange, onModeChange, onInputSourceChange, onParametersChange, ...props }: StompModuleProps) {\n`,
  `function StompModule({ engineRunning, visualState, onEnabledChange, onModeChange, onInputSourceChange, onParametersChange, ...props }: StompModuleProps) {\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `    const nextMode = profile === 'mutate' ? mode : pool[Math.floor(Math.random()*pool.length)]!;\n`,
  `    const nextMode = profile === 'mutate' ? mode : chooseDifferent(pool, mode);\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `        viewport={<div className={\`stomp-display dsp-viewport \${enabled?'active':'is-off'}\`}><span className="stomp-led"/><strong>STOMP</strong><small>{STOMP_MODE_LABELS[mode]}</small><div className="stomp-circuit-lines" aria-hidden="true"/></div>}\n`,
  `        viewport={(\n          <div className={\`stomp-display dsp-viewport \${enabled ? 'active' : 'is-off'}\`}>\n            <RailCHardwareDisplay\n              kind="stomp"\n              enabled={enabled}\n              visualState={visualState}\n              modeLabel={STOMP_MODE_LABELS[mode]}\n              detailLabel={presetId === 'custom' ? 'CUSTOM SIGNAL PATH' : STOMP_PRESETS[mode]?.find((preset) => preset.id === presetId)?.label ?? 'PEDAL PATH'}\n            />\n          </div>\n        )}\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `    const nextModel = modelPool[Math.floor(Math.random() * modelPool.length)] ?? 'calcotone';\n`,
  `    const nextModel = chooseDifferent(modelPool, model);\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `    const nextCabinet = cabinetPool[Math.floor(Math.random() * cabinetPool.length)] ?? '4x12';\n`,
  `    const nextCabinet = chooseDifferent(cabinetPool, cabinet);\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `          <div className={\`chaos-pad-shell dsp-viewport \${enabled ? 'active' : 'is-off'}\`}>\n            <div className="stack-amp-readout" aria-hidden="true">\n              <strong>{STACK_MODEL_LABELS[model]}</strong>\n              <pre>{\`┌─ PRE ─┬─ POWER ─┬─ \${cabinet.toUpperCase()} ─┐\\n│  ▸▸▸  │  ≋ SAG  │  ◉  ◉  ◉  ◉ │\\n└───────┴─────────┴────────────┘\`}</pre>\n              <i style={{ '--stack-level': \`\${Math.round((enabled ? visualState.level : 0) * 100)}%\` } as CSSProperties} />\n            </div>\n          </div>\n`,
  `          <div className={\`chaos-pad-shell dsp-viewport \${enabled ? 'active' : 'is-off'}\`}>\n            <RailCHardwareDisplay\n              kind="stack"\n              enabled={enabled}\n              visualState={visualState}\n              modeLabel={STACK_MODEL_LABELS[model]}\n              detailLabel={STACK_CABINET_LABELS[cabinet]}\n            />\n          </div>\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `  const state = usePressureState();\n  const meter = Math.max(0, Math.round((state.enabled ? visualState.level : 0) * 18));\n  const meterText = \`\${'█'.repeat(meter)}\${'░'.repeat(18 - meter)}\`;\n`,
  `  const state = usePressureState();\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `          <div className={\`pressure-ascii dsp-viewport \${state.enabled ? 'active' : 'is-off'}\`} aria-label="Pressure compressor display">\n            <pre aria-hidden="true">{\`╔══════════════════════════╗\n║      P R E S S U R E     ║\n║    HARDWARE DYNAMICS     ║\n╠══════════════════════════╣\n║ IN  \${meterText} ║\n║ GR  \${state.enabled && running ? '▾▾▾▾' : '····'}  \${state.style.toUpperCase().padEnd(9, ' ')} ║\n╚══════════════════════════╝\`}</pre>\n            <div className="pressure-scanline" aria-hidden="true" />\n          </div>\n`,
  `          <div className={\`pressure-ascii dsp-viewport \${state.enabled ? 'active' : 'is-off'}\`} aria-label="Pressure compressor display">\n            <RailCHardwareDisplay\n              kind="pressure"\n              enabled={state.enabled}\n              visualState={visualState}\n              modeLabel={SIGNAL_LAB_LABELS[state.mode]}\n              detailLabel={\`\${state.style.toUpperCase()} · \${running ? 'LIVE' : 'READY'}\`}\n            />\n          </div>\n`,
);

replaceOnce(
  'src/components/effects/RailCModules.tsx',
  `    return <StompModule {...interaction} engineRunning={running} onEnabledChange={onStompEnabledChange} onModeChange={onStompModeChange} onInputSourceChange={onStompInputSourceChange} onParametersChange={onStompParametersChange} />;\n`,
  `    return <StompModule {...interaction} engineRunning={running} visualState={visualState} onEnabledChange={onStompEnabledChange} onModeChange={onStompModeChange} onInputSourceChange={onStompInputSourceChange} onParametersChange={onStompParametersChange} />;\n`,
);

replaceOnce(
  'src/components/signal/pressureStore.ts',
  `  const recipe = SIGNAL_LAB_SWEET_SPOTS[Math.floor(Math.random() * SIGNAL_LAB_SWEET_SPOTS.length)];\n  if (!recipe) return null;\n`,
  `  const alternatives = SIGNAL_LAB_SWEET_SPOTS.filter((recipe) => recipe.mode !== state.mode || recipe.style !== state.style);\n  const pool = alternatives.length ? alternatives : SIGNAL_LAB_SWEET_SPOTS;\n  const recipe = pool[Math.floor(Math.random() * pool.length)];\n  if (!recipe) return null;\n`,
);

replaceOnce(
  'scripts/dropdown-audit.mjs',
  `const emberDigitalCapture = read('public/ember-digital-capture-processor.js');\n`,
  `const emberDigitalCapture = read('public/ember-digital-capture-processor.js');\nconst app = read('src/App.tsx');\nconst railC = read('src/components/effects/RailCModules.tsx');\nconst pressureStore = read('src/components/signal/pressureStore.ts');\nconst railCArtwork = read('src/components/ascii/RailCHardwareDisplay.tsx');\n`,
);

replaceOnce(
  'scripts/dropdown-audit.mjs',
  `if (failures.length) {\n`,
  `// RANDOM must keep controlled dropdown state synchronized with native DSP and visibly move when alternatives exist.\nrequireText(app, 'chooseMusicalDifferent(MUSICAL_EMBER_MODES, module.emberMode)', 'Core random mode changes');\nrequireText(app, 'Native DSP receives the new values immediately', 'Native RANDOM UI synchronization');\nrequireText(app, 'window.setTimeout(() => revealRandomUiModule(effectId), 48 + index * 96)', 'Native RANDOM serial reveal');\nrequireText(railC, 'chooseDifferent(pool, mode)', 'Stomp random mode changes');\nrequireText(railC, 'chooseDifferent(modelPool, model)', 'Stack random model changes');\nrequireText(pressureStore, 'recipe.mode !== state.mode || recipe.style !== state.style', 'Pressure random mode/style changes');\n\n// Stomp, Stack, and Pressure share the same high-DPI animated hardware-art language as the core rack.\nfor (const kind of ['stomp', 'stack', 'pressure']) requireText(railCArtwork, \`\${kind}: {\`, \`Rail C \${kind} artwork profile\`);\nfor (const kind of ['stomp', 'stack', 'pressure']) requireText(railC, \`kind="\${kind}"\`, \`Rail C \${kind} artwork mount\`);\nrequireText(railCArtwork, 'subscribeViewportAnimation(render)', 'Rail C artwork shared scheduler');\nrequireText(railCArtwork, 'canvasPixelRatio(width, height, 5_400_000)', 'Rail C artwork high-DPI backing');\n\nif (failures.length) {\n`,
);

console.log('Random dropdown/UI/artwork source patch applied.');
