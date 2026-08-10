import type { LoopCommand, LoopSettings, LoopRuntime } from '../components/signal/loopStore';
import { LOOP_WAVEFORM_BINS } from '../components/signal/loopStore';

export class LoopDeck {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly node: AudioWorkletNode;
  private lastSettings: LoopSettings | null = null;

  private constructor(context: AudioContext, onRuntime: (runtime: LoopRuntime) => void) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.node = new AudioWorkletNode(context, 'calcotone-loop-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.input.connect(this.node);
    this.node.connect(this.output);
    this.node.port.onmessage = (event: MessageEvent<{ type?: string } & Partial<LoopRuntime>>) => {
      const detail = event.data;
      if (detail?.type !== 'runtime') return;
      onRuntime({
        transport: detail.transport ?? 'empty',
        trackMask: detail.trackMask ?? 0,
        trackActiveMask: detail.trackActiveMask ?? 0,
        trackMuteMask: detail.trackMuteMask ?? 0,
        trackSoloMask: detail.trackSoloMask ?? 0,
        loopFrames: detail.loopFrames ?? 0,
        rawFrames: detail.rawFrames ?? detail.loopFrames ?? 0,
        position: detail.position ?? 0,
        sampleRate: detail.sampleRate ?? context.sampleRate,
        trimStart: detail.trimStart ?? 0,
        trimEnd: detail.trimEnd ?? 1,
        waveform: Array.from({ length: LOOP_WAVEFORM_BINS }, (_, index) => detail.waveform?.[index] ?? 0),
      });
    };
  }

  public static async create(context: AudioContext, onRuntime: (runtime: LoopRuntime) => void): Promise<LoopDeck> {
    await context.audioWorklet.addModule('/loop-processor.js');
    return new LoopDeck(context, onRuntime);
  }

  public setSettings(settings: LoopSettings): void {
    const previous = this.lastSettings;
    const message: { type: 'settings' } & Partial<LoopSettings> = { type: 'settings' };
    let changed = false;

    if (!previous || previous.enabled !== settings.enabled) { message.enabled = settings.enabled; changed = true; }
    if (!previous || previous.selectedTrack !== settings.selectedTrack) { message.selectedTrack = settings.selectedTrack; changed = true; }
    if (!previous || previous.masterLevel !== settings.masterLevel) { message.masterLevel = settings.masterLevel; changed = true; }
    if (!previous || previous.overdub !== settings.overdub) { message.overdub = settings.overdub; changed = true; }
    if (!previous || previous.fade !== settings.fade) { message.fade = settings.fade; changed = true; }
    if (!previous || previous.bpm !== settings.bpm) { message.bpm = settings.bpm; changed = true; }
    if (!previous || previous.quantize !== settings.quantize) { message.quantize = settings.quantize; changed = true; }

    const levelsChanged = !previous
      || previous.trackLevels.length !== settings.trackLevels.length
      || settings.trackLevels.some((level, index) => previous.trackLevels[index] !== level);
    if (levelsChanged) {
      message.trackLevels = [...settings.trackLevels];
      changed = true;
    }
    if (!changed) return;

    this.lastSettings = {
      enabled: settings.enabled,
      selectedTrack: settings.selectedTrack,
      masterLevel: settings.masterLevel,
      overdub: settings.overdub,
      fade: settings.fade,
      bpm: settings.bpm,
      quantize: settings.quantize,
      trackLevels: levelsChanged ? [...settings.trackLevels] : [...previous!.trackLevels],
    };
    this.node.port.postMessage(message);
  }

  public command(command: LoopCommand): void {
    this.node.port.postMessage({ type: 'command', command });
  }

  public dispose(): void {
    this.node.port.onmessage = null;
    this.lastSettings = null;
    try { this.input.disconnect(); } catch { /* already disconnected */ }
    try { this.node.disconnect(); } catch { /* already disconnected */ }
    try { this.output.disconnect(); } catch { /* already disconnected */ }
  }
}
