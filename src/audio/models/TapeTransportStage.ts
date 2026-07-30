import {
  tapeTransportOperatingPoint,
  tapeTransportTransfer,
} from './HardwareCalibration';

function makeTapeCurve(drive: number, bias: number): Float32Array<ArrayBuffer> {
  const size = 4096;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = tapeTransportTransfer(x, drive, bias);
  }
  return curve;
}

/** Shared capstan/head/tape-color stage for cassette, reel, and echo transports. */
export class TapeTransportStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypass: GainNode;
  private readonly processInput: GainNode;
  private readonly processed: GainNode;
  private readonly headBump: BiquadFilterNode;
  private readonly headLoss: BiquadFilterNode;
  private readonly saturator: WaveShaperNode;
  private readonly transportDelay: DelayNode;
  private readonly wowLfo: OscillatorNode;
  private readonly flutterLfo: OscillatorNode;
  private readonly wowDepth: GainNode;
  private readonly flutterDepth: GainNode;
  private readonly trim: GainNode;
  private curveKey = '';
  private modulationConnected = false;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain(); this.output = context.createGain();
    this.bypass = context.createGain(); this.processInput = context.createGain(); this.processed = context.createGain();
    this.headBump = context.createBiquadFilter(); this.headLoss = context.createBiquadFilter();
    this.saturator = context.createWaveShaper(); this.transportDelay = context.createDelay(0.08);
    this.wowLfo = context.createOscillator(); this.flutterLfo = context.createOscillator();
    this.wowDepth = context.createGain(); this.flutterDepth = context.createGain(); this.trim = context.createGain();

    this.bypass.gain.value = 1; this.processInput.gain.value = 0; this.processed.gain.value = 0;
    this.headBump.type = 'peaking'; this.headBump.frequency.value = 82; this.headBump.Q.value = 0.72; this.headBump.gain.value = 1.2;
    this.headLoss.type = 'lowpass'; this.headLoss.frequency.value = 15_000; this.headLoss.Q.value = 0.45;
    this.saturator.oversample = '4x'; this.saturator.curve = makeTapeCurve(0.2, 0.5);
    this.transportDelay.delayTime.value = 0.012; this.trim.gain.value = 0.98;
    this.wowLfo.type = 'sine'; this.wowLfo.frequency.value = 0.33;
    this.flutterLfo.type = 'triangle'; this.flutterLfo.frequency.value = 5.6;
    this.wowDepth.gain.value = 0; this.flutterDepth.gain.value = 0;

    this.input.connect(this.bypass); this.bypass.connect(this.output);
    this.input.connect(this.processInput); this.processInput.connect(this.headBump); this.headBump.connect(this.headLoss); this.headLoss.connect(this.saturator);
    this.saturator.connect(this.transportDelay); this.transportDelay.connect(this.trim); this.trim.connect(this.processed); this.processed.connect(this.output);
    this.wowLfo.connect(this.wowDepth); this.flutterLfo.connect(this.flutterDepth);
    // The oscillators may run for the lifetime of the node, but their control graph stays
    // disconnected until tape is active so disabled transports do not continuously render
    // AudioParam modulation across every BaseEffect instance.
    this.wowLfo.start(); this.flutterLfo.start(context.currentTime + 0.019);
  }

  public connect(destination: AudioNode): void { this.output.connect(destination); }

  private setModulationConnected(enabled: boolean): void {
    if (enabled === this.modulationConnected) return;
    this.modulationConnected = enabled;
    if (enabled) {
      this.wowDepth.connect(this.transportDelay.delayTime);
      this.flutterDepth.connect(this.transportDelay.delayTime);
      return;
    }
    try { this.wowDepth.disconnect(this.transportDelay.delayTime); } catch { /* already disconnected */ }
    try { this.flutterDepth.disconnect(this.transportDelay.delayTime); } catch { /* already disconnected */ }
  }

  public setEnabled(enabled: boolean): void {
    const now = this.context.currentTime;
    this.bypass.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.018);
    this.processInput.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.018);
    this.processed.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.018);
    this.setModulationConnected(enabled);
  }

  public configure(speed: number, wear: number, tone: number, drive: number): void {
    const point = tapeTransportOperatingPoint(speed, wear, tone, drive);
    const now = this.context.currentTime;
    this.headBump.frequency.setTargetAtTime(point.headBumpHz, now, 0.04);
    this.headBump.gain.setTargetAtTime(point.headBumpDb, now, 0.04);
    this.headLoss.frequency.setTargetAtTime(point.headLossHz, now, 0.045);
    this.transportDelay.delayTime.setTargetAtTime(point.delaySeconds, now, 0.06);
    this.wowLfo.frequency.setTargetAtTime(point.wowHz, now, 0.08);
    this.flutterLfo.frequency.setTargetAtTime(point.flutterHz, now, 0.08);
    this.wowDepth.gain.setTargetAtTime(point.wowDepthSeconds, now, 0.08);
    this.flutterDepth.gain.setTargetAtTime(point.flutterDepthSeconds, now, 0.08);
    this.trim.gain.setTargetAtTime(point.trimGain, now, 0.035);
    const key = `${Math.round(point.curveDrive * 48)}:${Math.round(point.curveBias * 48)}`;
    if (key !== this.curveKey) {
      this.curveKey = key;
      this.saturator.curve = makeTapeCurve(point.curveDrive, point.curveBias);
    }
  }

  public dispose(): void {
    this.setModulationConnected(false);
    try { this.wowLfo.stop(); } catch { /* stopped */ }
    try { this.flutterLfo.stop(); } catch { /* stopped */ }
    [this.input,this.output,this.bypass,this.processInput,this.processed,this.headBump,this.headLoss,this.saturator,this.transportDelay,this.wowLfo,this.flutterLfo,this.wowDepth,this.flutterDepth,this.trim].forEach((node) => node.disconnect());
  }
}
