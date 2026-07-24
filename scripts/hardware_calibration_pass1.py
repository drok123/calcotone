from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1))


# App integration: use the same ordered reverb table as the DSP and keep named hardware
# models out of Musical Random until they have reference-capture calibration.
replace_once(
    "src/App.tsx",
    "import type { ReverbAlgorithm } from './audio/effects/Reverb';",
    "import { REVERB_ALGORITHM_ORDER, type ReverbAlgorithm } from './audio/effects/Reverb';",
)
replace_once(
    "src/App.tsx",
    """const REVERB_ALGORITHMS: ReverbAlgorithm[] = [
  'room',
  'plate',
  'hall',
  'cinema',
  'cloud',
  'freeze',
  'celestial',
  'aurora',
  'nebula',
  'abyss',
];""",
    "const REVERB_ALGORITHMS: ReverbAlgorithm[] = [...REVERB_ALGORITHM_ORDER];",
)
replace_once(
    "src/App.tsx",
    "const MUSICAL_GRAIN_MODES: readonly GrainMode[] = [...GRAIN_MODE_ORDER];",
    "const MUSICAL_GRAIN_MODES: readonly GrainMode[] = ['reconstruct','shatter','smear','prism','stutter','ruin'];",
)

# Worklet versioning + master nonlinear quality floor.
replace_once(
    "src/audio/AudioEngine.ts",
    "const WORKLET_BUILD_VERSION = '8.4.30-ui-polish-b';",
    "const WORKLET_BUILD_VERSION = '8.4.31-hardware-calibration-a';",
)
replace_once(
    "src/audio/AudioEngine.ts",
    "['Grain', `grain-processor.js?v=8.4.27-grain-engine`],",
    "['Grain', `grain-processor.js?v=${WORKLET_BUILD_VERSION}`],\n      ['Lexicon 224', `lexicon-224-converter.js?v=${WORKLET_BUILD_VERSION}`],",
)
replace_once(
    "src/audio/AudioEngine.ts",
    """this.safetyClipper.oversample =
        this.performanceMode === 'studio'
          ? '4x'
          : this.performanceMode === 'balanced'
          ? '2x'
          : 'none';""",
    """this.safetyClipper.oversample =
        this.performanceMode === 'studio'
          ? '4x'
          : '2x';""",
)

# RE-201: preserve the measured three-head timing relationships, but make the former
# Width control the seven original three-head combinations and return the wet echo in mono.
replace_once(
    "src/audio/effects/Delay.ts",
    "const tone = 2600 * Math.pow(4.5, color);",
    "const tone = 2100 * Math.pow(4.4, color);",
)
replace_once(
    "src/audio/effects/Delay.ts",
    "this.inputLowpass.frequency.setTargetAtTime(10_500 + color * 5_500 - age * 2_400, now, 0.06);",
    "this.inputLowpass.frequency.setTargetAtTime(8_900 + color * 3_600 - age * 1_600, now, 0.06);",
)
replace_once(
    "src/audio/effects/Delay.ts",
    """const headBase = [0.74 - width * 0.16, 0.44 + width * 0.22, 0.28 + width * 0.42];
    const panSpread = width * 0.72;
    this.heads.forEach((head, i) => {
      head.delayTime.setTargetAtTime(head1 * ratios[i], now, 0.065);
      this.headHighpasses[i].frequency.setTargetAtTime(62 + age * 45 + i * 8, now, 0.06);
      this.headLowpasses[i].frequency.setTargetAtTime(Math.max(1800, tone * (1 - i * 0.055) * (1 - age * 0.12)), now, 0.06);
      this.headGains[i].gain.setTargetAtTime(headBase[i] * 0.72, now, 0.06);
      this.headPans[i].pan.setTargetAtTime(i === 0 ? -panSpread : i === 2 ? panSpread : 0, now, 0.07);
      this.feedbackTaps[i].gain.setTargetAtTime([0.38,0.34,0.28][i] * (0.78 + width * 0.22), now, 0.06);
      const wowDepth = (0.00008 + age * age * 0.0019) * (1 + i * 0.17);
      const flutterDepth = (0.000025 + age * age * 0.00042) * (1 + i * 0.12);
      this.wowDepths[i].gain.setTargetAtTime(wowDepth, now, 0.08);
      this.flutterDepths[i].gain.setTargetAtTime(i % 2 ? -flutterDepth : flutterDepth, now, 0.08);
    });""",
    """const modeIndex = Math.max(0, Math.min(6, Math.floor(width * 7)));
    const modeHeads = [
      [1,0,0], [0,1,0], [0,0,1], [1,1,0], [0,1,1], [1,0,1], [1,1,1],
    ][modeIndex];
    const headBase = [0.72, 0.62, 0.54];
    this.heads.forEach((head, i) => {
      const active = modeHeads[i];
      head.delayTime.setTargetAtTime(head1 * ratios[i], now, 0.065);
      this.headHighpasses[i].frequency.setTargetAtTime(62 + age * 45 + i * 8, now, 0.06);
      this.headLowpasses[i].frequency.setTargetAtTime(Math.max(1700, tone * (1 - i * 0.055) * (1 - age * 0.12)), now, 0.06);
      this.headGains[i].gain.setTargetAtTime(active * headBase[i], now, 0.06);
      this.headPans[i].pan.setTargetAtTime(0, now, 0.07);
      this.feedbackTaps[i].gain.setTargetAtTime(active * [0.38,0.34,0.28][i], now, 0.06);
      const wowDepth = (0.00006 + age * age * 0.00165) * (1 + i * 0.17);
      const flutterDepth = (0.00002 + age * age * 0.00036) * (1 + i * 0.12);
      this.wowDepths[i].gain.setTargetAtTime(wowDepth, now, 0.08);
      this.flutterDepths[i].gain.setTargetAtTime(i % 2 ? -flutterDepth : flutterDepth, now, 0.08);
    });""",
)

# EMT 140: mono excitation -> stereo pickup network, mechanical 0.5–5.5 s damper range,
# and no LFO modulation in the original-hardware path.
replace_once(
    "src/audio/effects/Reverb.ts",
    "emt140: { id:'emt140', lineTimes:[0.0119,0.0157,0.0193,0.0233,0.0277,0.0329,0.0383,0.0449,0.0521,0.0601,0.0691,0.0793], predelay:[0.0035,0.0052], sizeRange:[0.88,1.34], decayBias:1.0, dampingBias:1.34, diffusionBias:1.55, modulationDepth:0.000035, modulationRates:[0.031,0.037,0.043,0.047,0.053,0.059,0.067,0.071,0.079,0.083,0.089,0.097], crossAmount:0.105, outputTrim:0.19, inputTrim:0.62, highpass:115, splitDecay:0.16, plateDispersion:1.0 },",
    "emt140: { id:'emt140', lineTimes:[0.0119,0.0157,0.0193,0.0233,0.0277,0.0329,0.0383,0.0449,0.0521,0.0601,0.0691,0.0793], predelay:[0.0035,0.0052], sizeRange:[0.94,1.08], decayBias:1.0, dampingBias:1.34, diffusionBias:1.62, modulationDepth:0, modulationRates:[0.031,0.037,0.043,0.047,0.053,0.059,0.067,0.071,0.079,0.083,0.089,0.097], crossAmount:0.105, outputTrim:0.19, inputTrim:0.31, highpass:115, splitDecay:0.16, plateDispersion:1.0 },",
)

# Lexicon 224: dedicated stateful 20 kHz / gain-stepped converter on both edges of the
# reverb network. Keep the algorithm itself explicitly a process-informed study.
replace_once(
    "src/audio/effects/Reverb.ts",
    "lexicon224: { id:'lexicon224', lineTimes:[0.0247,0.0311,0.0389,0.0473,0.0571,0.0683,0.0811,0.0953,0.1117,0.1301], predelay:[0.024,0.031], sizeRange:[0.78,2.2], decayBias:1.12, dampingBias:0.72, diffusionBias:1.24, modulationDepth:0.00082, modulationRates:[0.071,0.089,0.113,0.137,0.173,0.211,0.257,0.307,0.367,0.433], crossAmount:0.12, outputTrim:0.21, inputTrim:0.58, highpass:145, converterBits:12, converterLowpass:9800, splitDecay:0.34 },",
    "lexicon224: { id:'lexicon224', lineTimes:[0.0247,0.0311,0.0389,0.0473,0.0571,0.0683,0.0811,0.0953,0.1117,0.1301], predelay:[0.024,0.031], sizeRange:[0.78,2.2], decayBias:1.12, dampingBias:0.72, diffusionBias:1.24, modulationDepth:0.00082, modulationRates:[0.071,0.089,0.113,0.137,0.173,0.211,0.257,0.307,0.367,0.433], crossAmount:0.12, outputTrim:0.21, inputTrim:0.58, highpass:145, converterBits:12, converterLowpass:8800, splitDecay:0.34 },",
)
replace_once(
    "src/audio/effects/Reverb.ts",
    "private readonly converterLowpass: BiquadFilterNode;\n  private readonly splitter: ChannelSplitterNode;",
    "private readonly converterLowpass: BiquadFilterNode;\n  private readonly lexiconInput: AudioWorkletNode | null;\n  private readonly lexiconOutput: AudioWorkletNode | null;\n  private readonly splitter: ChannelSplitterNode;",
)
replace_once(
    "src/audio/effects/Reverb.ts",
    """this.inputConverter.oversample = '2x';
    this.outputConverter.oversample = '2x';
    const converterCurve = config.converterBits ? createConverterCurve(config.converterBits) : IDENTITY_CURVE;
    this.inputConverter.curve = converterCurve;
    this.outputConverter.curve = converterCurve;
    this.converterLowpass = context.createBiquadFilter();""",
    """this.inputConverter.oversample = '2x';
    this.outputConverter.oversample = '2x';
    const converterCurve = config.converterBits && config.id !== 'lexicon224' ? createConverterCurve(config.converterBits) : IDENTITY_CURVE;
    this.inputConverter.curve = converterCurve;
    this.outputConverter.curve = converterCurve;
    this.lexiconInput = config.id === 'lexicon224'
      ? new AudioWorkletNode(context, 'calcotone-lexicon224-converter', { processorOptions: { role: 'input' }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
      : null;
    this.lexiconOutput = config.id === 'lexicon224'
      ? new AudioWorkletNode(context, 'calcotone-lexicon224-converter', { processorOptions: { role: 'output' }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
      : null;
    this.converterLowpass = context.createBiquadFilter();""",
)
replace_once(
    "src/audio/effects/Reverb.ts",
    """this.input.gain.value = config.inputTrim;
    this.input.connect(this.inputConverter);
    this.inputConverter.connect(this.splitter);

    for (let channel = 0; channel < 2; channel += 1) {
      const hp = context.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = config.highpass; hp.Q.value = 0.55;
      const lp = context.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = config.converterLowpass ?? 16_000; lp.Q.value = 0.4;
      this.splitter.connect(hp, channel); hp.connect(lp); lp.connect(this.predelays[channel]); this.inputFilters.push(hp, lp);
    }""",
    """this.input.gain.value = config.inputTrim;
    this.input.connect(this.inputConverter);
    if (this.lexiconInput) {
      this.inputConverter.connect(this.lexiconInput);
      this.lexiconInput.connect(this.splitter);
    } else {
      this.inputConverter.connect(this.splitter);
    }

    for (let channel = 0; channel < 2; channel += 1) {
      const hp = context.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = config.highpass; hp.Q.value = 0.55;
      const lp = context.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = config.converterLowpass ?? 16_000; lp.Q.value = 0.4;
      if (config.id === 'emt140') {
        this.splitter.connect(hp, 0);
        this.splitter.connect(hp, 1);
      } else {
        this.splitter.connect(hp, channel);
      }
      hp.connect(lp); lp.connect(this.predelays[channel]); this.inputFilters.push(hp, lp);
    }""",
)
replace_once(
    "src/audio/effects/Reverb.ts",
    "this.merger.connect(this.converterLowpass); this.converterLowpass.connect(this.outputConverter); this.outputConverter.connect(this.output);",
    """this.merger.connect(this.converterLowpass); this.converterLowpass.connect(this.outputConverter);
    if (this.lexiconOutput) {
      this.outputConverter.connect(this.lexiconOutput);
      this.lexiconOutput.connect(this.output);
    } else {
      this.outputConverter.connect(this.output);
    }""",
)
replace_once(
    "src/audio/effects/Reverb.ts",
    "const effectiveDecay = Math.max(0.25, decay * this.config.decayBias);",
    """const normalizedDecay = Math.max(0, Math.min(1, Math.log(Math.max(0.35, decay) / 0.35) / Math.log(16 / 0.35)));
    const effectiveDecay = this.config.id === 'emt140'
      ? 0.5 + normalizedDecay * 5.0
      : Math.max(0.25, decay * this.config.decayBias);""",
)
replace_once(
    "src/audio/effects/Reverb.ts",
    "[this.input,this.output,this.inputConverter,this.outputConverter,this.converterLowpass,this.splitter,this.merger,...this.predelays,...this.inputFilters,...this.diffusers,...this.delays,...this.damping,...this.loopHighpasses,...this.loopSaturators,...this.feedback,...this.outputGains,...this.crossGains,...this.lfoDepths].forEach((node) => node.disconnect());",
    "[this.input,this.output,this.inputConverter,this.outputConverter,this.converterLowpass,...(this.lexiconInput ? [this.lexiconInput] : []),...(this.lexiconOutput ? [this.lexiconOutput] : []),this.splitter,this.merger,...this.predelays,...this.inputFilters,...this.diffusers,...this.delays,...this.damping,...this.loopHighpasses,...this.loopSaturators,...this.feedback,...this.outputGains,...this.crossGains,...this.lfoDepths].forEach((node) => node.disconnect());",
)

# MPC60: use a conservative nonlinear 12-bit storage approximation rather than linear
# truncation. SP-1200 remains fixed at its authentic 26.04 kHz capture clock in hardware mode.
replace_once(
    "public/grain-processor.js",
    """  quantize(value, bits) {
    const levels = Math.pow(2, bits - 1);
    return Math.round(Math.max(-1, Math.min(1, value)) * levels) / levels;
  }
""",
    """  quantize(value, bits) {
    const levels = Math.pow(2, bits - 1);
    return Math.round(Math.max(-1, Math.min(1, value)) * levels) / levels;
  }

  quantizeNonlinear12(value) {
    // MPC60 stores a proprietary nonlinear 12-bit representation after its input A/D.
    // The exact companding law is not public, so use a conservative reversible log law
    // rather than pretending ordinary linear 12-bit truncation is the original machine.
    const sign = value < 0 ? -1 : 1;
    const magnitude = Math.min(1, Math.abs(value));
    const mu = 7.5;
    const encoded = Math.log1p(mu * magnitude) / Math.log1p(mu);
    const quantized = Math.round(encoded * 2047) / 2047;
    return sign * Math.expm1(quantized * Math.log1p(mu)) / mu;
  }
""",
)
replace_once(
    "public/grain-processor.js",
    """    } else if (pitch > 0.005) {
      // SP-1200 clock coloration extension: unity at Pitch=0, increasingly abusive clocking above it.
      targetRate = 26040 * (0.72 + pitch * 0.56);
    }
""",
    """    }
""",
)
replace_once(
    "public/grain-processor.js",
    """      this.hardwareHeldL = this.quantize(shapedL, bitDepth);
      this.hardwareHeldR = this.quantize(shapedR, bitDepth);""",
    """      this.hardwareHeldL = mode === 7 ? this.quantizeNonlinear12(shapedL) : this.quantize(shapedL, bitDepth);
      this.hardwareHeldR = mode === 7 ? this.quantizeNonlinear12(shapedR) : this.quantize(shapedR, bitDepth);""",
)

# Hardware UI must describe what the calibrated model is actually doing.
replace_once(
    "src/components/effects/EffectModule.tsx",
    "if (parameterId === 'width') return { label: 'Head Mix', display };",
    "if (parameterId === 'width') return { label: 'Mode', display: `MODE ${re201Mode(value)}` };",
)
replace_once(
    "src/components/effects/EffectModule.tsx",
    """if (module.id === 'chorus' && module.driftMode === 'ce1') {
    if (parameterId === 'shape') return { label: 'Intensity', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'motion') return { label: 'Preamp', display: `${Math.round(value * 100)}%` };
  }""",
    """if (module.id === 'chorus' && module.driftMode === 'ce1') {
    if (parameterId === 'rate') return { label: 'Rate', display: 'INTENSITY', disabled: true };
    if (parameterId === 'depth') return { label: 'Depth', display: 'INTENSITY', disabled: true };
    if (parameterId === 'shape') return { label: 'Intensity', display: `${Math.round(value * 100)}%` };
    if (parameterId === 'spread') return { label: 'Stereo', display: 'CLASSIC', disabled: true };
    if (parameterId === 'motion') return { label: 'Preamp', display: `${Math.round(value * 100)}%` };
  }""",
)
replace_once(
    "src/components/effects/EffectModule.tsx",
    """if (module.id === 'chorus' && module.driftMode === 'dimensiond') {
    if (parameterId === 'shape') return { label: 'Mode', display: `${Math.max(1, Math.min(4, 1 + Math.floor(value * 3.999)))}` };
    if (parameterId === 'motion') return { label: 'Circuit', display: `${Math.round(value * 100)}%` };
  }""",
    """if (module.id === 'chorus' && module.driftMode === 'dimensiond') {
    if (parameterId === 'rate') return { label: 'Rate', display: 'FIXED', disabled: true };
    if (parameterId === 'depth') return { label: 'Depth', display: 'FIXED', disabled: true };
    if (parameterId === 'shape') return { label: 'Mode', display: dimensionDMode(value) };
    if (parameterId === 'spread') return { label: 'Stereo', display: 'FIXED', disabled: true };
    if (parameterId === 'motion') return { label: 'Circuit', display: 'FIXED', disabled: true };
  }""",
)
replace_once(
    "src/components/effects/EffectModule.tsx",
    """if (module.id === 'reverb' && module.algorithm === 'emt140') {
    if (parameterId === 'size') return { label: 'Plate', display };
    if (parameterId === 'color') return { label: 'Damping', display };
    if (parameterId === 'diffusion') return { label: 'Tension', display };
    if (parameterId === 'motion') return { label: 'Pickup', display };
  }""",
    """if (module.id === 'reverb' && module.algorithm === 'emt140') {
    if (parameterId === 'decay') return { label: 'Damper', display: `${emt140Decay(value).toFixed(1)} s` };
    if (parameterId === 'size') return { label: 'Plate', display: '140', disabled: true };
    if (parameterId === 'color') return { label: 'Damping', display };
    if (parameterId === 'diffusion') return { label: 'Tension', display };
    if (parameterId === 'motion') return { label: 'Mod', display: 'NONE', disabled: true };
  }""",
)
replace_once(
    "src/components/effects/EffectModule.tsx",
    "if (parameterId === 'pitch') return { label: 'Clock', display: `${sp1200ClockKhz(value).toFixed(2)} kHz` };",
    "if (parameterId === 'pitch') return { label: 'Clock', display: '26.04 kHz FIXED', disabled: true };",
)
replace_once(
    "src/components/effects/EffectModule.tsx",
    """function sp1200ClockKhz(value: number): number {
  return value <= 0.005 ? 26.04 : 26.04 * (0.72 + value * 0.56);
}

function mirageRateKhz""",
    """function re201Mode(value: number): number {
  return Math.max(1, Math.min(7, 1 + Math.floor(value * 7)));
}

function dimensionDMode(value: number): string {
  const index = Math.max(0, Math.min(6, Math.floor(value * 7)));
  return ['1', '2', '3', '4', '1+4', '2+4', '3+4'][index] ?? '1';
}

function emt140Decay(value: number): number {
  return 0.5 + Math.max(0, Math.min(1, value)) * 5;
}

function mirageRateKhz""",
)
