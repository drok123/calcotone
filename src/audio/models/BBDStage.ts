import { CompanderStage } from './CompanderStage';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function makeClockCurve(amount: number): Float32Array<ArrayBuffer> {
  const size = 2048;
  const curve = new Float32Array(size);
  const drive = 1 + clamp01(amount) * 2.2;
  const norm = Math.tanh(drive);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

/** Shared bucket-brigade front/back-end coloration and clock-loss model. */
export class BBDStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypass: GainNode;
  private readonly processInput: GainNode;
  private readonly processed: GainNode;
  private readonly compander: CompanderStage;
  private readonly preEmphasis: BiquadFilterNode;
  private readonly bucketLoss: BiquadFilterNode;
  private readonly clockShaper: WaveShaperNode;
  private readonly deEmphasis: BiquadFilterNode;
  private readonly trim: GainNode;
  private curveKey = -1;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.bypass = context.createGain();
    this.processInput = context.createGain();
    this.processed = context.createGain();
    this.compander = new CompanderStage(context);
    this.preEmphasis = context.createBiquadFilter();
    this.bucketLoss = context.createBiquadFilter();
    this.clockShaper = context.createWaveShaper();
    this.deEmphasis = context.createBiquadFilter();
    this.trim = context.createGain();

    this.bypass.gain.value = 1;
    this.processInput.gain.value = 0;
    this.processed.gain.value = 0;
    this.preEmphasis.type = 'highshelf'; this.preEmphasis.frequency.value = 2400; this.preEmphasis.gain.value = 2;
    this.bucketLoss.type = 'lowpass'; this.bucketLoss.frequency.value = 6800; this.bucketLoss.Q.value = 0.42;
    this.clockShaper.oversample = '2x'; this.clockShaper.curve = makeClockCurve(0.2);
    this.deEmphasis.type = 'highshelf'; this.deEmphasis.frequency.value = 2400; this.deEmphasis.gain.value = -2;
    this.trim.gain.value = 0.96;

    this.input.connect(this.bypass); this.bypass.connect(this.output);
    this.input.connect(this.processInput); this.processInput.connect(this.compander.input); this.compander.connect(this.preEmphasis);
    this.preEmphasis.connect(this.bucketLoss); this.bucketLoss.connect(this.clockShaper);
    this.clockShaper.connect(this.deEmphasis); this.deEmphasis.connect(this.trim);
    this.trim.connect(this.processed); this.processed.connect(this.output);
    this.compander.setEnabled(true);
  }

  public connect(destination: AudioNode): void { this.output.connect(destination); }

  public setEnabled(enabled: boolean): void {
    const now = this.context.currentTime;
    this.bypass.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.016);
    this.processInput.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.016);
    this.processed.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.016);
  }

  public configure(delayTimeSeconds: number, character: number, color: number, modulation: number): void {
    const time = Math.max(0.0005, Number.isFinite(delayTimeSeconds) ? delayTimeSeconds : 0.02);
    const c = clamp01(character);
    const tone = clamp01(color);
    const mod = clamp01(modulation);
    const now = this.context.currentTime;
    const clockLoss = clamp01(Math.log10(1 + time * 75) / Math.log10(1 + 6.2 * 75));
    const cutoff = 9200 - clockLoss * 5200 - c * 1500 + tone * 1700;
    this.bucketLoss.frequency.setTargetAtTime(Math.max(1400, cutoff), now, 0.04);
    this.preEmphasis.gain.setTargetAtTime(1.2 + c * 3.8, now, 0.035);
    this.deEmphasis.gain.setTargetAtTime(-1.0 - c * 3.4, now, 0.035);
    this.trim.gain.setTargetAtTime(0.99 - c * 0.08, now, 0.03);
    this.compander.configure(0.36 + c * 0.46, 0.5 + mod * 0.35, tone);
    const key = Math.round((c * 0.72 + clockLoss * 0.28) * 48);
    if (key !== this.curveKey) {
      this.curveKey = key;
      this.clockShaper.curve = makeClockCurve(key / 48);
    }
  }

  public dispose(): void {
    this.compander.dispose();
    [this.input, this.output, this.bypass, this.processInput, this.processed, this.preEmphasis, this.bucketLoss, this.clockShaper, this.deEmphasis, this.trim].forEach((node) => node.disconnect());
  }
}
