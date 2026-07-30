import {
  companderExpansionTransfer,
  companderOperatingPoint,
} from './HardwareCalibration';

function makeExpansionCurve(amount: number): Float32Array<ArrayBuffer> {
  const size = 2048;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = companderExpansionTransfer(x, amount);
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
    const now = this.context.currentTime;
    this.bypass.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.014);
    this.processed.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.014);
  }

  public configure(amount: number, speed: number, color: number): void {
    const point = companderOperatingPoint(amount, speed, color);
    const now = this.context.currentTime;
    this.compressor.threshold.setTargetAtTime(point.thresholdDb, now, 0.025);
    this.compressor.ratio.setTargetAtTime(point.ratio, now, 0.025);
    this.compressor.attack.setTargetAtTime(point.attackSeconds, now, 0.025);
    this.compressor.release.setTargetAtTime(point.releaseSeconds, now, 0.03);
    this.makeup.gain.setTargetAtTime(point.makeupGain, now, 0.025);
    if (point.expansionAmount !== this.curveAmount) {
      this.curveAmount = point.expansionAmount;
      this.expander.curve = makeExpansionCurve(point.expansionAmount);
    }
  }

  public dispose(): void {
    [this.input, this.output, this.bypass, this.processed, this.compressor, this.makeup, this.expander].forEach((node) => node.disconnect());
  }
}
