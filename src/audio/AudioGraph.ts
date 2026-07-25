import type { Effect } from './effects/Effect';

interface SerialEdge {
  source: AudioNode;
  destination: AudioNode;
}

export class AudioGraph {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private effects: Effect[] = [];
  private serialEdges: SerialEdge[] = [];
  private disposed = false;

  public constructor(context: AudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();

    this.input.gain.value = 1;
    this.output.gain.value = 1;

    this.reconnect();
  }

  public setEffects(effects: Effect[]): void {
    this.disconnectGraph();
    for (const effect of this.effects) effect.setRoutingInvalidator(null);
    this.effects = [...effects];
    for (const effect of this.effects) this.bindEffect(effect);
    this.reconnect();
  }

  public addEffect(effect: Effect): void {
    this.disconnectGraph();
    this.effects.push(effect);
    this.bindEffect(effect);
    this.reconnect();
  }

  public removeEffect(effectId: string): Effect | undefined {
    const index = this.effects.findIndex((effect) => effect.id === effectId);

    if (index < 0) return undefined;

    this.disconnectGraph();
    const [removedEffect] = this.effects.splice(index, 1);
    removedEffect.setRoutingInvalidator(null);
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
      throw new Error('The reordered effect list must contain every active effect.');
    }

    const reorderedEffects = effectIds.map((effectId) => {
      const effect = this.getEffect(effectId);
      if (!effect) throw new Error(`Cannot reorder unknown effect "${effectId}".`);
      return effect;
    });

    if (new Set(reorderedEffects).size !== this.effects.length) {
      throw new Error('The reordered effect list contains duplicate effects.');
    }

    this.setEffects(reorderedEffects);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnectGraph();

    for (const effect of this.effects) {
      effect.setRoutingInvalidator(null);
      effect.dispose();
    }

    this.effects = [];
    this.input.disconnect();
    this.output.disconnect();
  }

  private bindEffect(effect: Effect): void {
    effect.setRoutingInvalidator(() => {
      if (this.disposed) return;
      this.refreshRouting();
    });
  }

  private refreshRouting(): void {
    this.disconnectGraph();
    this.reconnect();
  }

  private connectEdge(source: AudioNode, destination: AudioNode): void {
    source.connect(destination);
    this.serialEdges.push({ source, destination });
  }

  private disconnectGraph(): void {
    for (const { source, destination } of this.serialEdges) {
      try { source.disconnect(destination); } catch { /* already disconnected */ }
    }
    this.serialEdges = [];
  }

  private reconnect(): void {
    if (this.disposed) return;
    const activeEffects = this.effects.filter((effect) => !effect.isProcessingSuspended());

    if (activeEffects.length === 0) {
      this.connectEdge(this.input, this.output);
      return;
    }

    this.connectEdge(this.input, activeEffects[0].input);
    for (let index = 0; index < activeEffects.length - 1; index += 1) {
      this.connectEdge(activeEffects[index].output, activeEffects[index + 1].input);
    }
    this.connectEdge(activeEffects[activeEffects.length - 1].output, this.output);
  }
}
