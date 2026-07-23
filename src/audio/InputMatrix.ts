export type InputMode =
  | 'stereo'
  | 'mono-to-stereo'
  | 'left'
  | 'right'
  | 'sum-mono'
  | 'swap';

/**
 * Realtime-safe stereo input router. The graph remains connected while routing
 * coefficients are smoothed, preventing clicks when modes, width or polarity change.
 */
export class InputMatrix {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly routeLL: GainNode;
  private readonly routeLR: GainNode;
  private readonly routeRL: GainNode;
  private readonly routeRR: GainNode;
  private readonly routedL: GainNode;
  private readonly routedR: GainNode;
  private readonly widthLL: GainNode;
  private readonly widthLR: GainNode;
  private readonly widthRL: GainNode;
  private readonly widthRR: GainNode;
  private readonly outputL: GainNode;
  private readonly outputR: GainNode;

  private mode: InputMode = 'mono-to-stereo';
  private width = 1;
  private invertLeft = false;
  private invertRight = false;

  public constructor(private readonly context: AudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.splitter = context.createChannelSplitter(2);
    this.merger = context.createChannelMerger(2);

    this.routeLL = context.createGain();
    this.routeLR = context.createGain();
    this.routeRL = context.createGain();
    this.routeRR = context.createGain();
    this.routedL = context.createGain();
    this.routedR = context.createGain();

    this.widthLL = context.createGain();
    this.widthLR = context.createGain();
    this.widthRL = context.createGain();
    this.widthRR = context.createGain();
    this.outputL = context.createGain();
    this.outputR = context.createGain();

    this.input.channelCountMode = 'max';
    this.output.channelCountMode = 'explicit';
    this.output.channelCount = 2;

    this.input.connect(this.splitter);

    this.splitter.connect(this.routeLL, 0);
    this.splitter.connect(this.routeLR, 0);
    this.splitter.connect(this.routeRL, 1);
    this.splitter.connect(this.routeRR, 1);
    this.routeLL.connect(this.routedL);
    this.routeRL.connect(this.routedL);
    this.routeLR.connect(this.routedR);
    this.routeRR.connect(this.routedR);

    // Mid/side width matrix: L' = aL + bR, R' = bL + aR,
    // where a=(1+w)/2 and b=(1-w)/2.
    this.routedL.connect(this.widthLL);
    this.routedL.connect(this.widthLR);
    this.routedR.connect(this.widthRL);
    this.routedR.connect(this.widthRR);
    this.widthLL.connect(this.outputL);
    this.widthRL.connect(this.outputL);
    this.widthLR.connect(this.outputR);
    this.widthRR.connect(this.outputR);

    this.outputL.connect(this.merger, 0, 0);
    this.outputR.connect(this.merger, 0, 1);
    this.merger.connect(this.output);

    this.applyRouting(true);
    this.applyWidth(true);
    this.applyPolarity(true);
  }

  public setMode(mode: InputMode): void {
    this.mode = mode;
    this.applyRouting(false);
  }

  public getMode(): InputMode {
    return this.mode;
  }

  public setWidth(value: number): void {
    this.width = Math.min(2, Math.max(0, Number.isFinite(value) ? value : 1));
    this.applyWidth(false);
  }

  public getWidth(): number {
    return this.width;
  }

  public setPolarity(invertLeft: boolean, invertRight: boolean): void {
    this.invertLeft = invertLeft;
    this.invertRight = invertRight;
    this.applyPolarity(false);
  }

  public dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.splitter.disconnect();
    this.merger.disconnect();
    [
      this.routeLL,
      this.routeLR,
      this.routeRL,
      this.routeRR,
      this.routedL,
      this.routedR,
      this.widthLL,
      this.widthLR,
      this.widthRL,
      this.widthRR,
      this.outputL,
      this.outputR,
    ].forEach((node) => node.disconnect());
  }

  private applyRouting(immediate: boolean): void {
    let ll = 0;
    let lr = 0;
    let rl = 0;
    let rr = 0;
    const sum = Math.SQRT1_2;

    switch (this.mode) {
      case 'stereo':
        ll = 1;
        rr = 1;
        break;
      case 'mono-to-stereo':
      case 'left':
        ll = 1;
        lr = 1;
        break;
      case 'right':
        rl = 1;
        rr = 1;
        break;
      case 'sum-mono':
        ll = sum;
        rl = sum;
        lr = sum;
        rr = sum;
        break;
      case 'swap':
        lr = 1;
        rl = 1;
        break;
    }

    this.setGain(this.routeLL.gain, ll, immediate);
    this.setGain(this.routeLR.gain, lr, immediate);
    this.setGain(this.routeRL.gain, rl, immediate);
    this.setGain(this.routeRR.gain, rr, immediate);
  }

  private applyWidth(immediate: boolean): void {
    const direct = (1 + this.width) * 0.5;
    const cross = (1 - this.width) * 0.5;
    this.setGain(this.widthLL.gain, direct, immediate);
    this.setGain(this.widthRR.gain, direct, immediate);
    this.setGain(this.widthLR.gain, cross, immediate);
    this.setGain(this.widthRL.gain, cross, immediate);
  }

  private applyPolarity(immediate: boolean): void {
    this.setGain(this.outputL.gain, this.invertLeft ? -1 : 1, immediate);
    this.setGain(this.outputR.gain, this.invertRight ? -1 : 1, immediate);
  }

  private setGain(parameter: AudioParam, value: number, immediate: boolean): void {
    const now = this.context.currentTime;
    parameter.cancelScheduledValues(now);
    if (immediate) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, 0.018);
  }
}
