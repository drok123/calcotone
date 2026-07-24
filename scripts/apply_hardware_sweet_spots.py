from pathlib import Path

PATH = Path('src/App.tsx')
text = PATH.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)


def replace_between(start: str, end: str, replacement: str) -> None:
    global text
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f'start marker not found: {start!r}')
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f'end marker not found: {end!r}')
    text = text[:start_index] + replacement + text[end_index:]


sweet_spots = r'''interface SweetSpotRecipe {
  name: string;
  parameters: Record<string, MusicalRange>;
}

// Named hardware modes do not use the generic full-module random ranges. Each recipe
// represents a recognizable operating point, then MUSICAL RANDOM adds a small amount
// of variation around that center so the result stays in the machine's useful zone.
const HARDWARE_SWEET_SPOTS: Record<string, readonly SweetSpotRecipe[]> = {
  'saturation:goldlion': [
    { name: 'OPEN COLOR', parameters: { drive:[0.16,0.30], tone:[0.60,0.78], heat:[0.14,0.30], character:[0.46,0.58], dynamics:[0.34,0.50], mix:[0.18,0.30] } },
  ],
  'saturation:mullard': [
    { name: 'WARM MIDRANGE', parameters: { drive:[0.18,0.32], tone:[0.42,0.62], heat:[0.28,0.44], character:[0.50,0.64], dynamics:[0.48,0.64], mix:[0.20,0.34] } },
  ],
  'saturation:telefunken': [
    { name: 'CLEAN DETAIL', parameters: { drive:[0.14,0.26], tone:[0.64,0.82], heat:[0.10,0.22], character:[0.44,0.54], dynamics:[0.30,0.46], mix:[0.16,0.28] } },
  ],
  'saturation:bugleboy': [
    { name: 'AIRY COLOR', parameters: { drive:[0.17,0.30], tone:[0.60,0.80], heat:[0.20,0.34], character:[0.54,0.66], dynamics:[0.38,0.54], mix:[0.18,0.31] } },
  ],
  'saturation:rcablack': [
    { name: 'THICK COLOR', parameters: { drive:[0.18,0.33], tone:[0.38,0.58], heat:[0.30,0.48], character:[0.56,0.70], dynamics:[0.52,0.68], mix:[0.20,0.34] } },
  ],

  'chorus:ce1': [
    { name: 'CLASSIC MID INTENSITY', parameters: { rate:[0.09,0.11], depth:[0.27,0.31], shape:[0.46,0.66], spread:[0.80,0.86], motion:[0.16,0.30], mix:[0.20,0.34] } },
  ],
  'chorus:dimensiond': [
    { name: 'MODE 2 WIDTH', parameters: { rate:[0.08,0.10], depth:[0.24,0.28], shape:[0.18,0.25], spread:[0.88,0.94], motion:[0.16,0.20], mix:[0.16,0.29] } },
    { name: 'MODE 3 MOTION', parameters: { rate:[0.18,0.20], depth:[0.22,0.26], shape:[0.31,0.39], spread:[0.88,0.94], motion:[0.16,0.20], mix:[0.16,0.29] } },
  ],

  'delay:re201': [
    { name: 'MODE 3 SYNCOPATED', parameters: { time:[0.20,0.36], feedback:[0.24,0.40], color:[0.45,0.62], character:[0.14,0.30], width:[0.31,0.39], mix:[0.18,0.30] } },
    { name: 'MODE 6 DUB', parameters: { time:[0.14,0.28], feedback:[0.38,0.56], color:[0.38,0.55], character:[0.22,0.38], width:[0.74,0.82], mix:[0.20,0.34] } },
  ],

  'reverb:emt140': [
    { name: 'PLATE A · 3.0 S', parameters: { decay:[0.48,0.52], size:[0.49,0.51], color:[0.52,0.68], diffusion:[0.68,0.84], motion:[0.00,0.00], mix:[0.18,0.30] } },
  ],
  'reverb:lexicon224': [
    { name: 'ROOM A STYLE', parameters: { decay:[0.60,0.68], size:[0.48,0.64], color:[0.36,0.54], diffusion:[0.68,0.86], motion:[0.14,0.28], mix:[0.16,0.30] } },
    { name: 'VOCAL PLATE STYLE', parameters: { decay:[0.46,0.58], size:[0.18,0.34], color:[0.55,0.74], diffusion:[0.42,0.62], motion:[0.08,0.20], mix:[0.18,0.32] } },
  ],

  'bitcrusher:sp1200': [
    { name: 'FILTERED DRUM BUS', parameters: { bits:[0.05,0.20], density:[0.42,0.62], pitch:[0.00,0.00], chaos:[0.12,0.28], bloom:[0.46,0.66], mix:[0.18,0.32] } },
  ],
  'bitcrusher:mpc60': [
    { name: 'CLASSIC 40K', parameters: { bits:[0.52,0.72], density:[0.40,0.58], pitch:[0.00,0.00], chaos:[0.28,0.46], bloom:[0.54,0.72], mix:[0.18,0.30] } },
  ],
  'bitcrusher:mirage': [
    { name: 'CLASSIC 29K', parameters: { bits:[0.32,0.34], density:[0.38,0.58], pitch:[0.80,0.88], chaos:[0.18,0.34], bloom:[0.48,0.68], mix:[0.18,0.30] } },
  ],

  'media:tascam424': [
    { name: 'ELASTIC DI', parameters: { wear:[0.54,0.70], wow:[0.14,0.19], noise:[0.09,0.13], tone:[0.52,0.68], mix:[0.22,0.36] } },
    { name: 'PUSHED PREAMP', parameters: { wear:[0.68,0.82], wow:[0.13,0.18], noise:[0.08,0.13], tone:[0.68,0.82], mix:[0.24,0.38] } },
  ],
};

function withMusicalRandomMode(module: ModuleState): ModuleState {
  if (module.id === 'saturation') return { ...module, emberMode: chooseMusical(MUSICAL_EMBER_MODES) };
  if (module.id === 'chorus') return { ...module, driftMode: chooseMusical(MUSICAL_DRIFT_MODES) };
  if (module.id === 'delay') return { ...module, delayAlgorithm: chooseMusical(MUSICAL_HALO_MODES) };
  if (module.id === 'reverb') return { ...module, algorithm: chooseMusical(MUSICAL_ATMOS_MODES) };
  if (module.id === 'bitcrusher') return { ...module, grainMode: chooseMusical(MUSICAL_GRAIN_MODES) };
  if (module.id === 'media') return { ...module, mediaMode: chooseMusical(MUSICAL_MEDIA_MODES) };
  return module;
}

function hardwareSweetSpotKey(module: ModuleState): string | null {
  const mode = module.id === 'saturation' ? module.emberMode
    : module.id === 'chorus' ? module.driftMode
    : module.id === 'delay' ? module.delayAlgorithm
    : module.id === 'reverb' ? module.algorithm
    : module.id === 'bitcrusher' ? module.grainMode
    : module.id === 'media' ? module.mediaMode
    : undefined;
  return mode ? `${module.id}:${mode}` : null;
}

function chooseHardwareSweetSpot(module: ModuleState): SweetSpotRecipe | null {
  const key = hardwareSweetSpotKey(module);
  const recipes = key ? HARDWARE_SWEET_SPOTS[key] : undefined;
  return recipes?.length ? chooseMusical(recipes) : null;
}

'''

marker = "const MUSICAL_EMBER_MODES: readonly EmberMode[] ="
index = text.find(marker)
if index < 0:
    raise SystemExit('mode-array marker not found')
text = text[:index] + sweet_spots + text[index:]

replace_once(
    "const MUSICAL_EMBER_MODES: readonly EmberMode[] = ['velvet','tube','console','transformer','furnace','exciter','broken'];",
    "const MUSICAL_EMBER_MODES: readonly EmberMode[] = [...EMBER_MODE_ORDER];",
)
replace_once(
    "const MUSICAL_DRIFT_MODES: readonly DriftMode[] = ['chorus','ensemble','dimension','vibrato','rotary','doppler','liquid','orbit'];",
    "const MUSICAL_DRIFT_MODES: readonly DriftMode[] = [...DRIFT_MODE_ORDER];",
)
replace_once(
    "const MUSICAL_HALO_MODES: readonly DelayAlgorithm[] = ['clean','tape','bbd','pingpong','diffuse','scatter','constellation'];",
    "const MUSICAL_HALO_MODES: readonly DelayAlgorithm[] = [...DELAY_ALGORITHM_ORDER];",
)
replace_once(
    "const MUSICAL_ATMOS_MODES: readonly ReverbAlgorithm[] = ['room','plate','hall','cinema','cloud','freeze','celestial','aurora','nebula','abyss'];",
    "const MUSICAL_ATMOS_MODES: readonly ReverbAlgorithm[] = [...REVERB_ALGORITHM_ORDER];",
)
replace_once(
    "const MUSICAL_GRAIN_MODES: readonly GrainMode[] = ['reconstruct','shatter','smear','prism','stutter','ruin'];",
    "const MUSICAL_GRAIN_MODES: readonly GrainMode[] = [...GRAIN_MODE_ORDER];",
)
replace_once(
    "const MUSICAL_MEDIA_MODES: readonly MediaMode[] = ['cassette','reel','vinyl','vhs','radio','wax','broken','archive'];",
    "const MUSICAL_MEDIA_MODES: readonly MediaMode[] = [...MEDIA_MODE_ORDER];",
)

new_randomizer = r'''  function randomizeActiveModules(): void {
    const activeModules = modules.filter((module) => module.enabled && module.available);
    if (activeModules.length === 0) {
      setMessage('Turn on at least one module before using MUSICAL RANDOM.');
      return;
    }

    const sweetSpotsUsed: string[] = [];
    const nextModules = modules.map((module) => {
      if (!module.enabled || !module.available) return module;

      // Pick the module mode first. Hardware recipes depend on the selected machine,
      // so its operating point must be chosen before the knobs are randomized.
      const modeModule = withMusicalRandomMode(module);
      const sweetSpot = chooseHardwareSweetSpot(modeModule);
      if (sweetSpot) sweetSpotsUsed.push(`${modeModule.name}: ${sweetSpot.name}`);

      const genericRanges = MUSICAL_RANDOM_RANGES[modeModule.id] ?? {};
      const nextParameters = modeModule.parameters.map((parameter) => {
        const range = sweetSpot?.parameters[parameter.id] ?? genericRanges[parameter.id];
        if (!range) return parameter;

        // Hardware recipes are intentionally tighter and more center-biased than the
        // creative modes: variation around a known good setting, not a lottery ticket.
        let next = randomMusicalValue(range, sweetSpot ? 0.60 : 0.35);

        // Extra guardrails for parameters where combinations can get unruly.
        if (modeModule.id === 'delay' && parameter.id === 'feedback') {
          next = Math.min(next, (modeModule.delayAlgorithm === 'constellation' || modeModule.delayAlgorithm === 'scatter') ? 0.56 : 0.68);
        }
        if (modeModule.id === 'reverb' && parameter.id === 'decay' && modeModule.algorithm === 'freeze') {
          next = Math.max(0.48, next);
        }
        if (modeModule.id === 'bitcrusher' && parameter.id === 'chaos') {
          next = Math.min(next, 0.52);
        }
        if (parameter.id === 'mix') {
          // Wet/dry is deliberately conservative so a randomized patch stays playable.
          next = Math.min(next, 0.52);
        }

        next = clamp(next, 0, 1);
        return {
          ...parameter,
          value: next,
          display: formatParameterValue(modeModule.id, parameter.id, next),
        };
      });

      return { ...modeModule, parameters: nextParameters };
    });

    setModules(nextModules);

    if (engineState === 'running') {
      const engine = engineRef.current;
      for (const module of nextModules) {
        if (!module.enabled) continue;

        if (module.id === 'saturation' && module.emberMode) {
          setEffectParameterIfLoaded(engine, 'saturation', 'mode', EMBER_MODE_ORDER.indexOf(module.emberMode));
        }
        if (module.id === 'chorus' && module.driftMode) {
          setEffectParameterIfLoaded(engine, 'chorus', 'mode', DRIFT_MODE_ORDER.indexOf(module.driftMode));
        }
        if (module.id === 'delay' && module.delayAlgorithm) {
          setEffectParameterIfLoaded(engine, 'delay', 'algorithm', DELAY_ALGORITHMS.indexOf(module.delayAlgorithm));
        }
        if (module.id === 'reverb' && module.algorithm) {
          setEffectParameterIfLoaded(engine, 'reverb', 'algorithm', REVERB_ALGORITHMS.indexOf(module.algorithm));
        }
        if (module.id === 'media' && module.mediaMode) {
          setEffectParameterIfLoaded(engine, 'media', 'mode', MEDIA_MODE_ORDER.indexOf(module.mediaMode));
        }
        if (module.id === 'bitcrusher' && module.grainMode) {
          setEffectParameterIfLoaded(engine, 'bitcrusher', 'mode', GRAIN_MODE_ORDER.indexOf(module.grainMode));
        }

        for (const parameter of module.parameters) {
          setEffectParameterIfLoaded(
            engine,
            module.id,
            parameter.id,
            toDspParameterValue(module.id, parameter.id, parameter.value)
          );
        }
      }
    }

    const sweetSpotSummary = sweetSpotsUsed.length
      ? ` · Sweet spots: ${sweetSpotsUsed.join(' · ')}`
      : '';
    setMessage(`MUSICAL RANDOM reshaped ${activeModules.length} active module${activeModules.length === 1 ? '' : 's'}${sweetSpotSummary}.`);
  }

'''

replace_between(
    '  function randomizeActiveModules(): void {',
    '  function toggleModule(moduleId: string): void {',
    new_randomizer,
)

PATH.write_text(text)
