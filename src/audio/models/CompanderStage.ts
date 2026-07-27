function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function makeExpansionCurve(amount: number): Float32Array<ArrayBuffer> {
  const size = 2048;
  const curve = new Float32Array(size);
  const power = 1 + clamp01(amount) * 0.34;
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.sign(x) * Math.pow(Math.abs(x), power);
  }
  return curve;
}

/**
 * Feed-forward compander approximation for BBD/media hardware.
 * The compressor models the encode side; the post shaper restores some
 * envelope contrast while preserving the characteristic level-dependent tone.
 */
export class CompanderStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypass: GainNode;
  private readonly processed: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private readonly expander: WaveShaperNode;
  private enabled = false;
  private curveAmount = -1;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.bypass = context.createGain();
    this.processed = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.makeup = context.createGain();
    this.expander = context.createWaveShaper();

    this.bypass.gain.value = 1;
    this.processed.gain.value = 0;
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 2.2;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.12;
    this.makeup.gain.value = 1.12;
    this.expander.oversample = '2x';
    this.expander.curve = makeExpansionCurve(0.35);

    this.input.connect(this.bypass);
    this.bypass.connect(this.output);
    this.input.connect(this.compressor);
    this.compressor.connect(this.makeup);
    this.makeup.connect(this.expander);
    this.expander.connect(this.processed);
    this.processed.connect(this.output);
  }

  public connect(destination: AudioNode): void { this.output.connect(destination); }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const now = this.context.currentTime;
    this.bypass.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.014);
    this.processed.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.014);
  }

  public configure(amount: number, speed: number, color: number): void {
    const a = clamp01(amount);
    const s = clamp01(speed);
    const c = clamp01(color);
    const now = this.context.currentTime;
    this.compressor.threshold.setTargetAtTime(-16 - a * 22, now, 0.025);
    this.compressor.ratio.setTargetAtTime(1.5 + a * 3.5, now, 0.025);
    this.compressor.attack.setTargetAtTime(0.0015 + (1 - s) * 0.012, now, 0.025);
    this.compressor.release.setTargetAtTime(0.055 + (1 - s) * 0.24, now, 0.03);
    this.makeup.gain.setTargetAtTime(1.02 + a * 0.24 + c * 0.05, now, 0.025);
    const curveAmount = Math.round((0.18 + a * 0.58) * 48) / 48;
    if (curveAmount !== this.curveAmount) {
      this.curveAmount = curveAmount;
      this.expander.curve = makeExpansionCurve(curveAmount);
    }
  }

  public dispose(): void {
    [this.input, this.output, this.bypass, this.processed, this.compressor, this.makeup, this.expander].forEach((node) => node.disconnect());
  }
}
