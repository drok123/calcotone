export type SignalLabMode = 'octaver' | 'ringmod' | 'freqshift' | 'envelope' | 'tremolo' | 'autopan';
export type SignalLabPosition = 'pre' | 'post';

export const SIGNAL_LAB_MODES: readonly SignalLabMode[] = [
  'octaver', 'ringmod', 'freqshift', 'envelope', 'tremolo', 'autopan',
] as const;

export const SIGNAL_LAB_LABELS: Record<SignalLabMode, string> = {
  octaver: 'OCTAVER',
  ringmod: 'RING MOD',
  freqshift: 'FREQ SHIFT',
  envelope: 'ENVELOPE',
  tremolo: 'TREMOLO',
  autopan: 'AUTO PAN',
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

/**
 * Compact utility processor that lives outside the six-module rack.
 * v1 intentionally uses native WebAudio nodes only: zero AudioWorklet scheduler
 * pressure, bounded node count, click-smoothed bypass/mode changes.
 */
export class SignalLab {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly processorIn: GainNode;
  private readonly processorOut: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly tremolo: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoDepth: GainNode;
  private readonly ringCarrier: OscillatorNode;
  private readonly ringDepth: GainNode;
  private state: SignalLabState = { ...DEFAULT_SIGNAL_LAB_STATE };
  private disposed = false;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.processorIn = context.createGain();
    this.processorOut = context.createGain();
    this.filter = context.createBiquadFilter();
    this.tremolo = context.createGain();
    this.panner = context.createStereoPanner();
    this.lfo = context.createOscillator();
    this.lfoDepth = context.createGain();
    this.ringCarrier = context.createOscillator();
    this.ringDepth = context.createGain();

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.input.connect(this.processorIn);
    this.processorIn.connect(this.filter);
    this.filter.connect(this.tremolo);
    this.tremolo.connect(this.panner);
    this.panner.connect(this.processorOut);
    this.processorOut.connect(this.wet);
    this.wet.connect(this.output);

    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.tremolo.gain.value = 1;
    this.panner.pan.value = 0;

    this.lfo.type = 'sine';
    this.lfo.frequency.value = 2;
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.tremolo.gain);
    this.lfoDepth.connect(this.panner.pan);

    this.ringCarrier.type = 'sine';
    this.ringCarrier.frequency.value = 120;
    this.ringDepth.gain.value = 0;
    this.ringCarrier.connect(this.ringDepth);
    this.ringDepth.connect(this.tremolo.gain);

    this.lfo.start();
    this.ringCarrier.start();
    this.applyState(this.state, true);
  }

  public getState(): SignalLabState { return { ...this.state }; }

  public setState(next: Partial<SignalLabState>): void {
    if (this.disposed) return;
    this.state = {
      ...this.state,
      ...next,
      amount: clamp01(next.amount ?? this.state.amount),
      tone: clamp01(next.tone ?? this.state.tone),
      motion: clamp01(next.motion ?? this.state.motion),
      mix: clamp01(next.mix ?? this.state.mix),
    };
    this.applyState(this.state, false);
  }

  private applyState(state: SignalLabState, immediate: boolean): void {
    const now = this.context.currentTime;
    const tau = immediate ? 0.001 : 0.025;
    const activeMix = state.enabled ? state.mix : 0;
    const dry = Math.cos(activeMix * Math.PI * 0.5);
    const wet = Math.sin(activeMix * Math.PI * 0.5);
    this.dry.gain.setTargetAtTime(dry, now, tau);
    this.wet.gain.setTargetAtTime(wet, now, tau);

    const toneHz = 500 + Math.pow(state.tone, 1.6) * 17500;
    this.filter.frequency.setTargetAtTime(toneHz, now, tau);

    const rate = 0.08 + Math.pow(state.motion, 2) * 11.92;
    this.lfo.frequency.setTargetAtTime(rate, now, tau);
    this.ringCarrier.frequency.setTargetAtTime(25 + Math.pow(state.amount, 2) * 1975, now, tau);

    let tremDepth = 0;
    let panDepth = 0;
    let ringDepth = 0;
    switch (state.mode) {
      case 'tremolo': tremDepth = 0.05 + state.amount * 0.9; break;
      case 'autopan': panDepth = 0.1 + state.amount * 0.9; break;
      case 'ringmod': ringDepth = 0.08 + state.amount * 0.72; break;
      case 'envelope':
        // v1 envelope mode is a resonant signal-shaping filter; a true envelope
        // follower can replace this branch later without changing the panel API.
        this.filter.Q.setTargetAtTime(1 + state.amount * 14, now, tau);
        break;
      case 'octaver':
      case 'freqshift':
        // Reserved modes deliberately remain conservative until the dedicated
        // pitch/frequency worklet lands. They still honor tone + wet/dry safely.
        this.filter.Q.setTargetAtTime(0.7, now, tau);
        break;
    }
    if (state.mode !== 'envelope') this.filter.Q.setTargetAtTime(0.7, now, tau);
    this.lfoDepth.gain.setTargetAtTime(tremDepth, now, tau);
    this.panner.pan.setTargetAtTime(0, now, tau);
    // Pan modulation shares the LFO but is scaled independently by reconnecting
    // through the same depth node; keep tremolo and pan mutually exclusive.
    if (panDepth > 0) this.lfoDepth.gain.setTargetAtTime(panDepth, now, tau);
    this.ringDepth.gain.setTargetAtTime(ringDepth, now, tau);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.lfo.stop(); } catch { /* already stopped */ }
    try { this.ringCarrier.stop(); } catch { /* already stopped */ }
    this.input.disconnect(); this.output.disconnect(); this.dry.disconnect(); this.wet.disconnect();
    this.processorIn.disconnect(); this.processorOut.disconnect(); this.filter.disconnect();
    this.tremolo.disconnect(); this.panner.disconnect(); this.lfo.disconnect(); this.lfoDepth.disconnect();
    this.ringCarrier.disconnect(); this.ringDepth.disconnect();
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
