import type { Effect } from './effects/Effect';

export class AudioGraph {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private effects: Effect[] = [];

  public constructor(context: AudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();

    this.input.gain.value = 1;
    this.output.gain.value = 1;

    this.reconnect();
  }

  public setEffects(effects: Effect[]): void {
    this.disconnectGraph();
    this.effects = [...effects];
    this.reconnect();
  }

  public addEffect(effect: Effect): void {
    this.disconnectGraph();
    this.effects.push(effect);
    this.reconnect();
  }

  public removeEffect(effectId: string): Effect | undefined {
    const index = this.effects.findIndex((effect) => effect.id === effectId);

    if (index < 0) {
      return undefined;
    }

    this.disconnectGraph();

    const [removedEffect] = this.effects.splice(index, 1);

    this.reconnect();

    return removedEffect;
  }

  public getEffect(effectId: string): Effect | undefined {
    return this.effects.find((effect) => effect.id === effectId);
  }

  public getEffects(): Effect[] {
    return [...this.effects];
  }

  public reorderEffects(effectIds: string[]): void {
    if (effectIds.length !== this.effects.length) {
      throw new Error(
        'The reordered effect list must contain every active effect.'
      );
    }

    const reorderedEffects = effectIds.map((effectId) => {
      const effect = this.getEffect(effectId);

      if (!effect) {
        throw new Error(`Cannot reorder unknown effect "${effectId}".`);
      }

      return effect;
    });

    if (new Set(reorderedEffects).size !== this.effects.length) {
      throw new Error('The reordered effect list contains duplicate effects.');
    }

    this.setEffects(reorderedEffects);
  }

  public dispose(): void {
    this.disconnectGraph();

    for (const effect of this.effects) {
      effect.dispose();
    }

    this.effects = [];

    this.input.disconnect();
    this.output.disconnect();
  }

  private disconnectGraph(): void {
    if (this.effects.length === 0) {
      try { this.input.disconnect(this.output); } catch { /* already disconnected */ }
      return;
    }

    try { this.input.disconnect(this.effects[0].input); } catch { /* already disconnected */ }

    for (let index = 0; index < this.effects.length; index += 1) {
      const effect = this.effects[index];
      const destination =
        index < this.effects.length - 1
          ? this.effects[index + 1].input
          : this.output;
      // Disconnect only the serial graph edge. Effects may also feed Dream Buffer
      // sends or other protected side paths that must survive a reorder.
      try { effect.output.disconnect(destination); } catch { /* already disconnected */ }
    }
  }

  private reconnect(): void {
    if (this.effects.length === 0) {
      this.input.connect(this.output);
      return;
    }

    this.input.connect(this.effects[0].input);

    for (let index = 0; index < this.effects.length - 1; index += 1) {
      this.effects[index].connect(this.effects[index + 1].input);
    }

    this.effects[this.effects.length - 1].connect(this.output);
  }
}
