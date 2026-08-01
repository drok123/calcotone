export type SignalLabMode = 'fet' | 'opto' | 'varimu' | 'vca';
export type SignalLabStyle = 'soft' | 'punch' | 'glue' | 'crush';

export const SIGNAL_LAB_MODES: readonly SignalLabMode[] = ['fet', 'opto', 'varimu', 'vca'] as const;
export const SIGNAL_LAB_STYLES: readonly SignalLabStyle[] = ['soft', 'punch', 'glue', 'crush'] as const;

export const SIGNAL_LAB_LABELS: Record<SignalLabMode, string> = {
  fet: 'FET 76',
  opto: 'OPTO 2A',
  varimu: 'VARI-MU',
  vca: 'VCA BUS',
};

export interface SignalLabState {
  enabled: boolean;
  mode: SignalLabMode;
  style: SignalLabStyle;
  drive: number;
  time: number;
  character: number;
  mix: number;
}

export const DEFAULT_SIGNAL_LAB_STATE: SignalLabState = {
  enabled: false,
  mode: 'fet',
  style: 'glue',
  drive: 0.42,
  time: 0.46,
  character: 0.38,
  mix: 0.72,
};

export interface SignalLabSweetSpot {
  mode: SignalLabMode;
  style: SignalLabStyle;
  drive: readonly [number, number];
  time: readonly [number, number];
  character: readonly [number, number];
  mix: readonly [number, number];
}

export const SIGNAL_LAB_SWEET_SPOTS: readonly SignalLabSweetSpot[] = [
  { mode:'fet', style:'punch', drive:[0.38,0.58], time:[0.24,0.44], character:[0.30,0.52], mix:[0.62,0.82] },
  { mode:'fet', style:'crush', drive:[0.66,0.88], time:[0.18,0.38], character:[0.62,0.86], mix:[0.28,0.52] },
  { mode:'opto', style:'soft', drive:[0.26,0.48], time:[0.58,0.82], character:[0.28,0.50], mix:[0.72,0.94] },
  { mode:'opto', style:'glue', drive:[0.38,0.58], time:[0.52,0.76], character:[0.40,0.62], mix:[0.68,0.90] },
  { mode:'varimu', style:'glue', drive:[0.34,0.54], time:[0.48,0.72], character:[0.52,0.72], mix:[0.76,0.96] },
  { mode:'varimu', style:'soft', drive:[0.22,0.42], time:[0.58,0.82], character:[0.40,0.62], mix:[0.78,0.98] },
  { mode:'vca', style:'glue', drive:[0.34,0.52], time:[0.34,0.58], character:[0.24,0.46], mix:[0.78,0.96] },
  { mode:'vca', style:'punch', drive:[0.44,0.64], time:[0.20,0.42], character:[0.34,0.56], mix:[0.72,0.92] },
] as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function makeGainElementCurve(mode: SignalLabMode, character: number, drive: number): Float32Array<ArrayBuffer> {
  const size = 4096;
  const curve = new Float32Array(size);
  const c = clamp01(character);
  const d = clamp01(drive);
  const modeDrive = mode === 'fet' ? 4.8 : mode === 'varimu' ? 3.1 : mode === 'opto' ? 2.3 : 1.8;
  const gain = 1 + d * modeDrive;
  const asym = mode === 'varimu' ? 0.055 + c * 0.075 : mode === 'fet' ? 0.02 + c * 0.035 : 0.006 + c * 0.014;
  const nonlinearMix = mode === 'fet'
    ? 0.16 + d * 0.24
    : mode === 'varimu'
      ? 0.12 + d * 0.18
      : mode === 'opto'
        ? 0.08 + d * 0.14
        : 0.025 + c * 0.045;
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    const shifted = x + Math.max(0, x) * asym;
    // Unit-slope parallel saturation keeps machine changes from multiplying quiet
    // material while retaining topology-specific peak compression and asymmetry.
    const soft = Math.tanh(shifted * gain) / gain;
    let y = shifted + (soft - shifted) * nonlinearMix;
    if (mode === 'opto') y *= 0.996 - Math.abs(x) * c * 0.018;
    if (mode === 'vca') y = x * (1 - c * 0.018) + y * c * 0.018;
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

function pressureMakeupGain(
  mode: SignalLabMode,
  style: SignalLabStyle,
  effectiveDrive: number,
  thresholdDb: number,
  ratio: number
): number {
  // Recover only part of the predicted gain reduction at a -18 dBFS reference.
  // Per-machine trims keep topology changes within a narrow loudness window.
  const referenceDb = -18;
  const predictedReductionDb = Math.max(0, referenceDb - thresholdDb) * (1 - 1 / ratio);
  const recovery = style === 'crush' ? 0.32 : style === 'soft' ? 0.42 : style === 'punch' ? 0.52 : 0.48;
  const modeTrimDb = mode === 'fet' ? -0.5 : mode === 'varimu' ? 0.4 : mode === 'vca' ? -0.1 : 0;
  const makeupDb = Math.max(-0.75, Math.min(2.5,
    predictedReductionDb * recovery + effectiveDrive * 0.6 + modeTrimDb
  ));
  return Math.pow(10, makeupDb / 20);
}

/**
 * PRESSURE: compact hardware-dynamics station occupying the old Signal Lab role.
 * The four machine types deliberately share four macro controls while the hidden
 * detector, timing, knee and gain-element relationships change per topology.
 */
export class SignalLab {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly detectorFilter: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly gainElement: WaveShaperNode;
  private readonly makeup: GainNode;
  private readonly tone: BiquadFilterNode;
  private state: SignalLabState = { ...DEFAULT_SIGNAL_LAB_STATE };
  private curveKey = '';
  private disposed = false;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.detectorFilter = context.createBiquadFilter();
    this.compressor = context.createDynamicsCompressor();
    this.gainElement = context.createWaveShaper();
    this.makeup = context.createGain();
    this.tone = context.createBiquadFilter();

    this.detectorFilter.type = 'highpass';
    this.detectorFilter.frequency.value = 42;
    this.detectorFilter.Q.value = 0.45;
    this.gainElement.oversample = '4x';
    this.gainElement.curve = makeGainElementCurve('fet', this.state.character, this.state.drive);
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.42;

    this.input.connect(this.dry); this.dry.connect(this.output);
    this.input.connect(this.detectorFilter); this.detectorFilter.connect(this.compressor);
    this.compressor.connect(this.gainElement); this.gainElement.connect(this.makeup);
    this.makeup.connect(this.tone); this.tone.connect(this.wet); this.wet.connect(this.output);

    this.applyState(true);
  }

  public getState(): SignalLabState { return { ...this.state }; }

  public setState(next: Partial<SignalLabState>): void {
    if (this.disposed) return;
    this.state = {
      ...this.state,
      ...next,
      drive: clamp01(next.drive ?? this.state.drive),
      time: clamp01(next.time ?? this.state.time),
      character: clamp01(next.character ?? this.state.character),
      mix: clamp01(next.mix ?? this.state.mix),
    };
    this.applyState(false);
  }

  public connect(destination: AudioNode): void { this.output.connect(destination); }

  private applyState(immediate: boolean): void {
    const now = this.context.currentTime;
    const tau = immediate ? 0.001 : 0.06;
    const { mode, style } = this.state;
    const drive = this.state.drive;
    const time = this.state.time;
    const character = this.state.character;
    const activeMix = this.state.enabled ? this.state.mix : 0;

    const dryMix = Math.cos(activeMix * Math.PI * 0.5);
    const wetMix = Math.sin(activeMix * Math.PI * 0.5);
    const correlatedNormalization = Math.max(1, dryMix + wetMix);
    this.dry.gain.setTargetAtTime(dryMix / correlatedNormalization, now, tau);
    this.wet.gain.setTargetAtTime(wetMix / correlatedNormalization, now, tau);

    const styleDrive = style === 'soft' ? 0.72 : style === 'punch' ? 0.95 : style === 'crush' ? 1.42 : 0.84;
    const effectiveDrive = clamp01(drive * styleDrive);
    const threshold = -8 - effectiveDrive * (mode === 'fet' ? 30 : mode === 'opto' ? 23 : mode === 'varimu' ? 20 : 26);
    const ratioBase = mode === 'fet' ? 4.0 : mode === 'opto' ? 2.1 : mode === 'varimu' ? 2.4 : 3.2;
    const ratioStyle = style === 'soft' ? 0.72 : style === 'punch' ? 1.18 : style === 'crush' ? 2.8 : 0.92;
    const ratio = Math.min(20, Math.max(1.2, ratioBase * ratioStyle + character * (mode === 'fet' ? 3.2 : 1.4)));

    const attack = mode === 'fet'
      ? 0.00022 + time * 0.0065
      : mode === 'opto'
        ? 0.008 + time * 0.045
        : mode === 'varimu'
          ? 0.004 + time * 0.032
          : 0.0008 + time * 0.018;
    const release = mode === 'opto'
      ? 0.18 + time * 1.05 + effectiveDrive * 0.32
      : mode === 'varimu'
        ? 0.10 + time * 0.72 + effectiveDrive * 0.18
        : mode === 'fet'
          ? 0.035 + time * 0.34
          : 0.045 + time * 0.46;
    const knee = mode === 'vca' ? 3 + character * 8 : mode === 'fet' ? 2 + character * 5 : 10 + character * 16;

    this.compressor.threshold.setTargetAtTime(threshold, now, tau);
    this.compressor.ratio.setTargetAtTime(ratio, now, tau);
    this.compressor.knee.setTargetAtTime(knee, now, tau);
    this.compressor.attack.setTargetAtTime(Math.max(0.0001, attack), now, tau);
    this.compressor.release.setTargetAtTime(Math.min(1.5, release), now, tau);

    this.detectorFilter.frequency.setTargetAtTime(mode === 'vca' ? 78 + character * 75 : 38 + character * 48, now, tau);
    this.tone.frequency.setTargetAtTime(mode === 'fet' ? 13_500 - character * 2200 : mode === 'opto' ? 11_800 - character * 1500 : mode === 'varimu' ? 14_200 - character * 1800 : 16_000 - character * 900, now, tau);
    this.makeup.gain.setTargetAtTime(
      pressureMakeupGain(mode, style, effectiveDrive, threshold, ratio),
      now,
      tau
    );

    const key = `${mode}:${Math.round(character * 48)}:${Math.round(effectiveDrive * 48)}`;
    if (key !== this.curveKey) {
      this.curveKey = key;
      this.gainElement.curve = makeGainElementCurve(mode, character, effectiveDrive);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    [this.input,this.output,this.dry,this.wet,this.detectorFilter,this.compressor,this.gainElement,this.makeup,this.tone].forEach((node) => node.disconnect());
  }
}
