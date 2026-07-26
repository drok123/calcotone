export type SignalLabMode = 'octaver' | 'ringmod' | 'tremolo' | 'autopan' | 'wavefolder';
export type SignalLabPosition = 'pre' | 'post';

export const SIGNAL_LAB_MODES: readonly SignalLabMode[] = [
  'octaver', 'ringmod', 'tremolo', 'autopan', 'wavefolder',
] as const;

export const SIGNAL_LAB_LABELS: Record<SignalLabMode, string> = {
  octaver: 'OCTAVE UP',
  ringmod: 'RING MOD',
  tremolo: 'TREMOLO',
  autopan: 'AUTO PAN',
  wavefolder: 'WAVEFOLDER',
};

export interface SignalLabState {
  enabled: boolean;
  mode: SignalLabMode;
  position: SignalLabPosition;
  amount: number;
  tone: number;
  motion: number;
  mix: number;
}

export const DEFAULT_SIGNAL_LAB_STATE: SignalLabState = {
  enabled: false,
  mode: 'octaver',
  position: 'pre',
  amount: 0.5,
  tone: 0.58,
  motion: 0.35,
  mix: 0.5,
};

const FOLD_CURVE_CACHE_LIMIT = 64;
const foldCurveCache = new Map<number, Float32Array<ArrayBuffer>>();

/** Compact utility processor outside the six-module rack. */
export class SignalLab {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly processorIn: GainNode;
  private readonly dcBlock: BiquadFilterNode;
  private readonly tone: BiquadFilterNode;
  private readonly octave: WaveShaperNode;
  private readonly folder: WaveShaperNode;
  private readonly ringVca: GainNode;
  private readonly tremoloVca: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly ringCarrier: OscillatorNode;
  private readonly ringDepth: GainNode;
  private readonly tremLfo: OscillatorNode;
  private readonly tremDepth: GainNode;
  private readonly panLfo: OscillatorNode;
  private readonly panDepth: GainNode;
  private state: SignalLabState = { ...DEFAULT_SIGNAL_LAB_STATE };
  private disposed = false;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.processorIn = context.createGain();
    this.dcBlock = context.createBiquadFilter();
    this.tone = context.createBiquadFilter();
    this.octave = context.createWaveShaper();
    this.folder = context.createWaveShaper();
    this.ringVca = context.createGain();
    this.tremoloVca = context.createGain();
    this.panner = context.createStereoPanner();
    this.ringCarrier = context.createOscillator();
    this.ringDepth = context.createGain();
    this.tremLfo = context.createOscillator();
    this.tremDepth = context.createGain();
    this.panLfo = context.createOscillator();
    this.panDepth = context.createGain();

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.input.connect(this.processorIn);
    this.dcBlock.connect(this.tone);
    this.tone.connect(this.wet);
    this.wet.connect(this.output);

    this.dcBlock.type = 'highpass';
    this.dcBlock.frequency.value = 24;
    this.dcBlock.Q.value = 0.5;
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.7;
    this.octave.curve = createOctaveUpCurve();
    this.folder.curve = getFoldCurve(0.5);
    this.octave.oversample = '2x';
    this.folder.oversample = '2x';
    this.ringVca.gain.value = 0;
    this.tremoloVca.gain.value = 1;
    this.panner.pan.value = 0;

    this.ringCarrier.type = 'sine';
    this.ringCarrier.frequency.value = 120;
    this.ringDepth.gain.value = 1;
    this.ringCarrier.connect(this.ringDepth);
    this.ringDepth.connect(this.ringVca.gain);

    this.tremLfo.type = 'sine';
    this.tremLfo.frequency.value = 2;
    this.tremDepth.gain.value = 0;
    this.tremLfo.connect(this.tremDepth);
    this.tremDepth.connect(this.tremoloVca.gain);

    this.panLfo.type = 'sine';
    this.panLfo.frequency.value = 2;
    this.panDepth.gain.value = 0;
    this.panLfo.connect(this.panDepth);
    this.panDepth.connect(this.panner.pan);

    this.ringCarrier.start();
    this.tremLfo.start();
    this.panLfo.start();
    this.rebuildMode();
    this.applyState(true);
  }

  public getState(): SignalLabState { return { ...this.state }; }

  public setState(next: Partial<SignalLabState>): void {
    if (this.disposed) return;
    const previousMode = this.state.mode;
    this.state = {
      ...this.state,
      ...next,
      amount: clamp01(next.amount ?? this.state.amount),
      tone: clamp01(next.tone ?? this.state.tone),
      motion: clamp01(next.motion ?? this.state.motion),
      mix: clamp01(next.mix ?? this.state.mix),
    };
    if (this.state.mode !== previousMode) this.rebuildMode();
    this.applyState(false);
  }

  private rebuildMode(): void {
    try { this.processorIn.disconnect(); } catch { /* no edge */ }
    try { this.octave.disconnect(); } catch { /* no edge */ }
    try { this.folder.disconnect(); } catch { /* no edge */ }
    try { this.ringVca.disconnect(); } catch { /* no edge */ }
    try { this.tremoloVca.disconnect(); } catch { /* no edge */ }
    try { this.panner.disconnect(); } catch { /* no edge */ }

    switch (this.state.mode) {
      case 'octaver':
        this.processorIn.connect(this.octave);
        this.octave.connect(this.dcBlock);
        break;
      case 'ringmod':
        this.processorIn.connect(this.ringVca);
        this.ringVca.connect(this.dcBlock);
        break;
      case 'tremolo':
        this.processorIn.connect(this.tremoloVca);
        this.tremoloVca.connect(this.dcBlock);
        break;
      case 'autopan':
        this.processorIn.connect(this.panner);
        this.panner.connect(this.dcBlock);
        break;
      case 'wavefolder':
        this.processorIn.connect(this.folder);
        this.folder.connect(this.dcBlock);
        break;
    }
  }

  private applyState(immediate: boolean): void {
    const now = this.context.currentTime;
    const tau = immediate ? 0.001 : 0.025;
    const activeMix = this.state.enabled ? this.state.mix : 0;
    this.dry.gain.setTargetAtTime(Math.cos(activeMix * Math.PI * 0.5), now, tau);
    this.wet.gain.setTargetAtTime(Math.sin(activeMix * Math.PI * 0.5), now, tau);
    this.tone.frequency.setTargetAtTime(600 + Math.pow(this.state.tone, 1.55) * 17400, now, tau);

    const rate = 0.08 + Math.pow(this.state.motion, 2) * 11.92;
    this.tremLfo.frequency.setTargetAtTime(rate, now, tau);
    this.panLfo.frequency.setTargetAtTime(rate, now, tau);
    this.ringCarrier.frequency.setTargetAtTime(20 + Math.pow(this.state.motion, 2) * 1980, now, tau);

    this.ringDepth.gain.setTargetAtTime(0.15 + this.state.amount * 0.85, now, tau);
    this.tremoloVca.gain.setTargetAtTime(1 - this.state.amount * 0.5, now, tau);
    this.tremDepth.gain.setTargetAtTime(this.state.mode === 'tremolo' ? this.state.amount * 0.5 : 0, now, tau);
    this.panDepth.gain.setTargetAtTime(this.state.mode === 'autopan' ? this.state.amount : 0, now, tau);
    if (this.state.mode !== 'autopan') this.panner.pan.setTargetAtTime(0, now, tau);

    if (this.state.mode === 'wavefolder') this.folder.curve = getFoldCurve(this.state.amount);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const oscillator of [this.ringCarrier, this.tremLfo, this.panLfo]) {
      try { oscillator.stop(); } catch { /* already stopped */ }
      oscillator.disconnect();
    }
    this.input.disconnect(); this.output.disconnect(); this.dry.disconnect(); this.wet.disconnect();
    this.processorIn.disconnect(); this.dcBlock.disconnect(); this.tone.disconnect(); this.octave.disconnect(); this.folder.disconnect();
    this.ringVca.disconnect(); this.tremoloVca.disconnect(); this.panner.disconnect();
    this.ringDepth.disconnect(); this.tremDepth.disconnect(); this.panDepth.disconnect();
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function createOctaveUpCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.min(1, Math.abs(x) * 1.55);
  }
  return curve;
}

function getFoldCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(clamp01(amount) * 63);
  const cached = foldCurveCache.get(key);
  if (cached) return cached;
  if (foldCurveCache.size >= FOLD_CURVE_CACHE_LIMIT) {
    const oldest = foldCurveCache.keys().next().value as number | undefined;
    if (oldest !== undefined) foldCurveCache.delete(oldest);
  }
  const curve = createFoldCurve(key / 63);
  foldCurveCache.set(key, curve);
  return curve;
}

function createFoldCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  const drive = 1 + clamp01(amount) * 7;
  for (let i = 0; i < curve.length; i += 1) {
    let x = ((i / (curve.length - 1)) * 2 - 1) * drive;
    x = ((x + 1) % 4 + 4) % 4 - 1;
    if (x > 1) x = 2 - x;
    curve[i] = Math.max(-1, Math.min(1, x));
  }
  return curve;
}
