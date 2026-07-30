import { converterOperatingPoint } from './HardwareCalibration';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function makeQuantizer(bits: number, drive: number): Float32Array<ArrayBuffer> {
  const size = 4096;
  const curve = new Float32Array(size);
  const levels = Math.max(16, Math.pow(2, Math.max(4, Math.min(16, Math.round(bits)))) - 1);
  const gain = 1 + clamp01(drive) * 0.65;
  for (let i = 0; i < size; i += 1) {
    const x = ((i / (size - 1)) * 2 - 1) * gain;
    const clipped = Math.max(-1, Math.min(1, x));
    curve[i] = Math.round(((clipped + 1) * 0.5) * levels) / levels * 2 - 1;
  }
  return curve;
}

/** Converter coloration for early digital delay/reverb/sampler hardware. */
export class EarlyConverterStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypass: GainNode;
  private readonly processInput: GainNode;
  private readonly processed: GainNode;
  private readonly antiAlias: BiquadFilterNode;
  private readonly quantizer: WaveShaperNode;
  private readonly reconstruction: BiquadFilterNode;
  private readonly trim: GainNode;
  private key = '';

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain(); this.output = context.createGain();
    this.bypass = context.createGain(); this.processInput = context.createGain(); this.processed = context.createGain();
    this.antiAlias = context.createBiquadFilter(); this.quantizer = context.createWaveShaper();
    this.reconstruction = context.createBiquadFilter(); this.trim = context.createGain();
    this.bypass.gain.value = 1; this.processInput.gain.value = 0; this.processed.gain.value = 0;
    this.antiAlias.type = 'lowpass'; this.antiAlias.frequency.value = 10_500; this.antiAlias.Q.value = 0.48;
    this.quantizer.oversample = 'none'; this.quantizer.curve = makeQuantizer(12, 0.1);
    this.reconstruction.type = 'lowpass'; this.reconstruction.frequency.value = 10_200; this.reconstruction.Q.value = 0.56;
    this.trim.gain.value = 0.98;
    this.input.connect(this.bypass); this.bypass.connect(this.output);
    this.input.connect(this.processInput); this.processInput.connect(this.antiAlias); this.antiAlias.connect(this.quantizer); this.quantizer.connect(this.reconstruction); this.reconstruction.connect(this.trim); this.trim.connect(this.processed); this.processed.connect(this.output);
  }

  public connect(destination: AudioNode): void { this.output.connect(destination); }

  public setEnabled(enabled: boolean): void {
    const now = this.context.currentTime;
    this.bypass.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.014);
    this.processInput.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.014);
    this.processed.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.014);
  }

  public configure(bits: number, bandwidth: number, drive: number): void {
    const point = converterOperatingPoint(bits, bandwidth, drive);
    const now = this.context.currentTime;
    this.antiAlias.frequency.setTargetAtTime(point.antiAliasHz, now, 0.035);
    this.reconstruction.frequency.setTargetAtTime(point.reconstructionHz, now, 0.035);
    this.trim.gain.setTargetAtTime(point.trimGain, now, 0.03);
    const key = `${point.curveBits}:${Math.round(point.curveDrive * 48)}`;
    if (key !== this.key) {
      this.key = key;
      this.quantizer.curve = makeQuantizer(point.curveBits, point.curveDrive);
    }
  }

  public dispose(): void {
    [this.input,this.output,this.bypass,this.processInput,this.processed,this.antiAlias,this.quantizer,this.reconstruction,this.trim].forEach((node) => node.disconnect());
  }
}
