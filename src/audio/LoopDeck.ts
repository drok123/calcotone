import type { LoopCommand, LoopSettings, LoopRuntime } from '../components/signal/loopStore';
import { LOOP_WAVEFORM_BINS } from '../components/signal/loopStore';

export class LoopDeck {
  public readonly input: GainNode;
  public readonly output: GainNode;
  private readonly node: AudioWorkletNode;

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
    this.node.port.postMessage({ type: 'settings', ...settings });
  }

  public command(command: LoopCommand): void {
    this.node.port.postMessage({ type: 'command', command });
  }

  public dispose(): void {
    this.node.port.onmessage = null;
    try { this.input.disconnect(); } catch { /* already disconnected */ }
    try { this.node.disconnect(); } catch { /* already disconnected */ }
    try { this.output.disconnect(); } catch { /* already disconnected */ }
  }
}
