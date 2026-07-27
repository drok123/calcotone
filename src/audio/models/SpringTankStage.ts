function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Lightweight mechanical spring tank: multiple dispersive taps, damping,
 * cross-coupled feedback and transducer coloration. Designed to be shared by
 * spring-style reverb algorithms without changing the public effect controls.
 */
export class SpringTankStage {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly bypass: GainNode;
  private readonly processInput: GainNode;
  private readonly processed: GainNode;
  private readonly transducerIn: BiquadFilterNode;
  private readonly transducerDrive: WaveShaperNode;
  private readonly taps: DelayNode[] = [];
  private readonly allpasses: BiquadFilterNode[] = [];
  private readonly dampers: BiquadFilterNode[] = [];
  private readonly tapGains: GainNode[] = [];
  private readonly feedback: GainNode;
  private readonly feedbackTone: BiquadFilterNode;
  private readonly transducerOut: BiquadFilterNode;
  private readonly sum: GainNode;
  private curveKey = -1;

  public constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain(); this.output = context.createGain();
    this.bypass = context.createGain(); this.processInput = context.createGain(); this.processed = context.createGain();
    this.transducerIn = context.createBiquadFilter(); this.transducerDrive = context.createWaveShaper();
    this.feedback = context.createGain(); this.feedbackTone = context.createBiquadFilter();
    this.transducerOut = context.createBiquadFilter(); this.sum = context.createGain();

    this.bypass.gain.value = 1; this.processInput.gain.value = 0; this.processed.gain.value = 0;
    this.transducerIn.type = 'highpass'; this.transducerIn.frequency.value = 120; this.transducerIn.Q.value = 0.5;
    this.transducerDrive.oversample = '2x'; this.transducerDrive.curve = makeSpringCurve(0.18);
    this.feedback.gain.value = 0.52;
    this.feedbackTone.type = 'lowpass'; this.feedbackTone.frequency.value = 6200; this.feedbackTone.Q.value = 0.45;
    this.transducerOut.type = 'peaking'; this.transducerOut.frequency.value = 2800; this.transducerOut.Q.value = 1.2; this.transducerOut.gain.value = 1.5;
    this.sum.gain.value = 0.58;

    this.input.connect(this.bypass); this.bypass.connect(this.output);
    this.input.connect(this.processInput); this.processInput.connect(this.transducerIn); this.transducerIn.connect(this.transducerDrive);

    const baseTimes = [0.019, 0.027, 0.036, 0.048];
    for (let i = 0; i < baseTimes.length; i += 1) {
      const delay = context.createDelay(0.22);
      const ap = context.createBiquadFilter();
      const damper = context.createBiquadFilter();
      const gain = context.createGain();
      delay.delayTime.value = baseTimes[i];
      ap.type = 'allpass'; ap.frequency.value = 650 + i * 520; ap.Q.value = 2.4 + i * 0.35;
      damper.type = 'lowpass'; damper.frequency.value = 7600 - i * 650; damper.Q.value = 0.42;
      gain.gain.value = 0.52 - i * 0.07;
      this.transducerDrive.connect(delay); delay.connect(ap); ap.connect(damper); damper.connect(gain); gain.connect(this.sum);
      this.taps.push(delay); this.allpasses.push(ap); this.dampers.push(damper); this.tapGains.push(gain);
    }

    this.sum.connect(this.feedbackTone); this.feedbackTone.connect(this.feedback); this.feedback.connect(this.taps[0]);
    this.sum.connect(this.transducerOut); this.transducerOut.connect(this.processed); this.processed.connect(this.output);
  }

  public connect(destination: AudioNode): void { this.output.connect(destination); }

  public setEnabled(enabled: boolean): void {
    const now = this.context.currentTime;
    this.bypass.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.02);
    this.processInput.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.016);
    this.processed.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.02);
  }

  public configure(decay: number, size: number, color: number, drive: number): void {
    const d = clamp01(decay); const s = clamp01(size); const c = clamp01(color); const x = clamp01(drive);
    const now = this.context.currentTime;
    const scale = 0.72 + s * 0.72;
    const bases = [0.019, 0.027, 0.036, 0.048];
    this.taps.forEach((tap, i) => tap.delayTime.setTargetAtTime(bases[i] * scale, now, 0.06));
    this.allpasses.forEach((ap, i) => {
      ap.frequency.setTargetAtTime(520 + c * 1850 + i * 470, now, 0.05);
      ap.Q.setTargetAtTime(1.8 + d * 3.1 + i * 0.25, now, 0.05);
    });
    this.dampers.forEach((lp, i) => lp.frequency.setTargetAtTime(Math.max(1700, 4200 + c * 6400 - d * 900 - i * 420), now, 0.05));
    this.feedback.gain.setTargetAtTime(Math.min(0.86, 0.34 + d * 0.5), now, 0.06);
    this.feedbackTone.frequency.setTargetAtTime(3000 + c * 6200, now, 0.05);
    this.transducerOut.gain.setTargetAtTime(0.5 + x * 3.5, now, 0.04);
    const key = Math.round(x * 48);
    if (key !== this.curveKey) {
      this.curveKey = key;
      this.transducerDrive.curve = makeSpringCurve(key / 48);
    }
  }

  public dispose(): void {
    [this.input,this.output,this.bypass,this.processInput,this.processed,this.transducerIn,this.transducerDrive,this.feedback,this.feedbackTone,this.transducerOut,this.sum,...this.taps,...this.allpasses,...this.dampers,...this.tapGains].forEach((node) => node.disconnect());
  }
}

function makeSpringCurve(amount: number): Float32Array<ArrayBuffer> {
  const size = 2048; const curve = new Float32Array(size);
  const gain = 1 + clamp01(amount) * 3.1; const norm = Math.tanh(gain);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh((x + Math.max(0, x) * amount * 0.05) * gain) / norm;
  }
  return curve;
}
