import { AudioGraph } from './AudioGraph';
import { createEffect, type EffectId } from './EffectFactory';
import type { Effect } from './effects/Effect';
import type { Preset } from './Preset';
import { InputMatrix, type InputMode } from './InputMatrix';
import { WavRecorder, type RecordedWav } from './WavRecorder';
import type { GrainProfilerStats } from './effects/Bitcrusher';
import { DreamBuffer, type DreamBufferStats } from './DreamBuffer';

export type AudioEngineState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'stopped'
  | 'error';

export type PerformanceMode = 'live' | 'balanced' | 'studio';

const WORKLET_BUILD_VERSION = '8.4.30-ui-polish-b';
export type EngineHealth = 'offline' | 'healthy' | 'warm' | 'critical';


export interface DspProfilerSnapshot {
  contextState: AudioContextState | 'offline';
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  grain: GrainProfilerStats;
  health: EngineHealth;
  spectralCentroidHz: number;
  spectralEnergy: number;
  adaptiveMode: boolean;
  adaptiveAction: string;
  dreamBuffer: DreamBufferStats;
}

export interface StartAudioOptions {
  deviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  performanceMode?: PerformanceMode;
  inputMode?: InputMode;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private graph: AudioGraph | null = null;
  private inputMatrix: InputMatrix | null = null;
  private inputGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private dcBlock: BiquadFilterNode | null = null;
  private safetyClipper: WaveShaperNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: WavRecorder | null = null;
  private dreamBuffer: DreamBuffer | null = null;

  private effects = new Map<string, Effect>();
  private state: AudioEngineState = 'idle';
  private performanceMode: PerformanceMode = 'live';
  private inputMode: InputMode = 'mono-to-stereo';
  private inputWidth = 1;
  private invertLeft = false;
  private invertRight = false;
  private adaptiveMode = true;
  private adaptiveAction = 'FULL QUALITY';
  private overloadWindows = 0;
  private recoveryWindows = 0;
  private lastOverrunCount = 0;
  private spectralData: Float32Array<ArrayBuffer> | null = null;
  private routeTransition: Promise<void> = Promise.resolve();

  public getState(): AudioEngineState {
    return this.state;
  }

  public getContext(): AudioContext | null {
    return this.context;
  }

  public getInputStream(): MediaStream | null {
    return this.stream;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getProfilerSnapshot(): DspProfilerSnapshot {
    const grain = this.effects.get('bitcrusher');
    const ember = this.effects.get('saturation');
    const drift = this.effects.get('chorus');
    const artifact = this.effects.get('media');
    const grainStats = grain && 'getProfilerStats' in grain
      ? (grain as Effect & { getProfilerStats(): GrainProfilerStats }).getProfilerStats()
      : { averageCallbackMs: 0, worstCallbackMs: 0, callbackBudgetMs: 0, cpuLoad: 0, callbackJitterMs: 0, activeVoices: 0, maxVoices: 0, effectiveVoiceLimit: 0, overruns: 0, droppedSpawns: 0 };
    const spectral = this.measureSpectrum();
    const health: EngineHealth = !this.context || this.context.state !== 'running'
      ? 'offline'
      : grainStats.cpuLoad >= 0.82 || grainStats.overruns > 0
      ? 'critical'
      : grainStats.cpuLoad >= 0.58
      ? 'warm'
      : 'healthy';
    return {
      contextState: this.context?.state ?? 'offline',
      sampleRate: this.context?.sampleRate ?? 0,
      baseLatencyMs: (this.context?.baseLatency ?? 0) * 1000,
      outputLatencyMs: (this.context?.outputLatency ?? 0) * 1000,
      grain: grainStats,
      health,
      spectralCentroidHz: spectral.centroidHz,
      spectralEnergy: spectral.energy,
      adaptiveMode: this.adaptiveMode,
      adaptiveAction: this.adaptiveAction,
      dreamBuffer: this.dreamBuffer?.getStats() ?? { fillRatio: 0, historySeconds: 8, inputPeak: 0, captures: 0, activeRoutes: 0 },
    };
  }


  public setAdaptiveMode(enabled: boolean): void {
    this.adaptiveMode = enabled;
    this.overloadWindows = 0;
    this.recoveryWindows = 0;
    this.adaptiveAction = enabled ? 'WATCHING HEADROOM' : 'MANUAL QUALITY';
  }

  public getAdaptiveMode(): boolean {
    return this.adaptiveMode;
  }

  /** Called by the low-rate UI profiler. Never runs inside the audio callback. */
  public updateAdaptivePerformance(): void {
    if (!this.adaptiveMode || this.state !== 'running') return;
    const stats = this.getProfilerSnapshot().grain;
    const newOverrun = stats.overruns > this.lastOverrunCount;
    this.lastOverrunCount = stats.overruns;
    const stressed = stats.cpuLoad > 0.76 || newOverrun;
    const relaxed = stats.cpuLoad < 0.38 && !newOverrun;
    this.overloadWindows = stressed ? this.overloadWindows + 1 : 0;
    this.recoveryWindows = relaxed ? this.recoveryWindows + 1 : 0;

    if (this.overloadWindows >= 2) {
      if (this.performanceMode === 'studio') {
        this.setPerformanceMode('balanced');
        this.adaptiveAction = 'STUDIO → BALANCED';
      } else if (this.performanceMode === 'balanced') {
        this.setPerformanceMode('live');
        this.adaptiveAction = 'BALANCED → LIVE';
      } else {
        this.adaptiveAction = 'LIVE · VOICE GUARD';
      }
      this.overloadWindows = 0;
      this.recoveryWindows = 0;
      return;
    }

    if (this.recoveryWindows >= 12) {
      if (this.performanceMode === 'live') {
        this.setPerformanceMode('balanced');
        this.adaptiveAction = 'LIVE → BALANCED';
      } else if (this.performanceMode === 'balanced') {
        this.setPerformanceMode('studio');
        this.adaptiveAction = 'BALANCED → STUDIO';
      } else {
        this.adaptiveAction = 'FULL QUALITY';
      }
      this.recoveryWindows = 0;
    }
  }

  private measureSpectrum(): { centroidHz: number; energy: number } {
    if (!this.analyser || !this.context) return { centroidHz: 0, energy: 0 };
    if (!this.spectralData || this.spectralData.length !== this.analyser.frequencyBinCount) {
      this.spectralData = new Float32Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getFloatFrequencyData(this.spectralData);
    let weighted = 0;
    let total = 0;
    const nyquist = this.context.sampleRate * 0.5;
    for (let i = 0; i < this.spectralData.length; i += 1) {
      const db = this.spectralData[i];
      if (!Number.isFinite(db)) continue;
      const amplitude = Math.pow(10, db / 20);
      total += amplitude;
      weighted += amplitude * (i / Math.max(1, this.spectralData.length - 1)) * nyquist;
    }
    return { centroidHz: total > 1e-9 ? weighted / total : 0, energy: Math.min(1, total / Math.max(1, this.spectralData.length) * 12) };
  }

  public getLatency(): {
    baseLatency: number | null;
    outputLatency: number | null;
  } {
    if (!this.context) {
      return {
        baseLatency: null,
        outputLatency: null,
      };
    }

    return {
      baseLatency: this.context.baseLatency ?? null,
      outputLatency: this.context.outputLatency ?? null,
    };
  }

  public async start(options: StartAudioOptions = {}): Promise<void> {
    if (this.state === 'starting') {
      return;
    }

    if (this.state === 'running') {
      await this.resume();
      return;
    }

    this.state = 'starting';

    try {
      this.assertBrowserSupport();

      this.performanceMode = options.performanceMode ?? this.performanceMode;

      this.context = new AudioContext({
        latencyHint:
          this.performanceMode === 'studio' ? 'playback' : 'interactive',
      });

      await this.loadAudioWorklets(this.context);

      this.graph = new AudioGraph(this.context);
      this.inputMatrix = new InputMatrix(this.context);
      this.inputGain = this.context.createGain();
      this.outputGain = this.context.createGain();
      this.dcBlock = this.context.createBiquadFilter();
      this.safetyClipper = this.context.createWaveShaper();
      this.limiter = this.context.createDynamicsCompressor();
      this.analyser = this.context.createAnalyser();
      this.dreamBuffer = new DreamBuffer(this.context);

      this.dcBlock.type = 'highpass';
      this.dcBlock.frequency.value = 18;
      this.dcBlock.Q.value = 0.5;
      this.safetyClipper.curve = createSafetyCurve();
      this.safetyClipper.oversample = '4x';
      this.configureLimiter(this.limiter);
      this.configureQualityMode();
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -12;

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,

          echoCancellation: options.echoCancellation ?? false,

          noiseSuppression: options.noiseSuppression ?? false,

          autoGainControl: options.autoGainControl ?? false,

          channelCount: {
            ideal: 2,
          },
        },
      });

      this.source = this.context.createMediaStreamSource(this.stream);

      this.inputMode = options.inputMode ?? this.inputMode;
      this.inputMatrix.setMode(this.inputMode);
      this.inputMatrix.setWidth(this.inputWidth);
      this.inputMatrix.setPolarity(this.invertLeft, this.invertRight);

      this.source.connect(this.inputMatrix.input);
      this.inputMatrix.output.connect(this.inputGain);
      this.inputGain.connect(this.graph.input);

      this.connectMasterChain();
      this.outputGain.connect(this.context.destination);
      // Dream Buffer returns join immediately before the global DC/safety path.
      // This is a quiet parallel memory layer, never a recursive graph cycle.
      this.dreamBuffer.connectReturn(this.dcBlock);

      this.inputGain.gain.value = 1;
      this.outputGain.gain.value = 0.72;

      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      this.state = 'running';
    } catch (error) {
      this.state = 'error';
      await this.stop();

      throw normalizeAudioError(error);
    }
  }

  public async resume(): Promise<void> {
    if (!this.context) {
      throw new Error('The audio engine has not been started.');
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.state = 'running';
  }

  public async suspend(): Promise<void> {
    if (!this.context) {
      return;
    }

    if (this.context.state === 'running') {
      await this.context.suspend();
    }

    this.state = 'suspended';
  }

  public setPerformanceMode(mode: PerformanceMode): void {
    this.performanceMode = mode;

    if (
      !this.context ||
      !this.graph ||
      !this.analyser ||
      !this.outputGain ||
      !this.limiter
    ) {
      return;
    }

    this.configureQualityMode();

    const grain = this.effects.get('bitcrusher');
    const ember = this.effects.get('saturation');
    const drift = this.effects.get('chorus');
    const artifact = this.effects.get('media');
    if (grain && 'setQualityMode' in grain) {
      (grain as Effect & { setQualityMode(value: PerformanceMode): void }).setQualityMode(mode);
    }

    const saturation = this.effects.get('saturation');
    if (saturation && 'setOversampling' in saturation) {
      const target =
        mode === 'studio' ? '4x' : mode === 'balanced' ? '2x' : 'none';
      (
        saturation as Effect & { setOversampling(value: OverSampleType): void }
      ).setOversampling(target);
    }
  }

  public getPerformanceMode(): PerformanceMode {
    return this.performanceMode;
  }

  public setInputMode(mode: InputMode): void {
    this.inputMode = mode;
    this.inputMatrix?.setMode(mode);
  }

  public getInputMode(): InputMode {
    return this.inputMode;
  }

  public setInputWidth(value: number): void {
    this.inputWidth = Math.min(2, Math.max(0, value));
    this.inputMatrix?.setWidth(this.inputWidth);
  }

  public setInputPolarity(invertLeft: boolean, invertRight: boolean): void {
    this.invertLeft = invertLeft;
    this.invertRight = invertRight;
    this.inputMatrix?.setPolarity(invertLeft, invertRight);
  }

  public getChannelDiagnostics(): {
    inputChannels: number | null;
    destinationChannels: number | null;
    destinationMaxChannels: number | null;
    sampleRate: number | null;
  } {
    const track = this.stream?.getAudioTracks()[0];
    const settings = track?.getSettings();
    return {
      inputChannels:
        settings?.channelCount ?? this.source?.channelCount ?? null,
      destinationChannels: this.context?.destination.channelCount ?? null,
      destinationMaxChannels: this.context?.destination.maxChannelCount ?? null,
      sampleRate: this.context?.sampleRate ?? null,
    };
  }

  public setInputGain(value: number): void {
    if (!this.context || !this.inputGain) {
      return;
    }

    const gain = Math.min(4, Math.max(0, value));

    this.inputGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.01);
  }

  public setOutputGain(value: number): void {
    if (!this.context || !this.outputGain) {
      return;
    }

    const gain = Math.min(1.2, Math.max(0, value));

    this.outputGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.01);
  }

  public addEffect(effectId: EffectId): Effect | null {
    if (!this.context || !this.graph) {
      throw new Error('Start the audio engine before adding effects.');
    }

    if (effectId === 'bypass') {
      return null;
    }

    const existingEffect = this.effects.get(effectId);

    if (existingEffect) {
      return existingEffect;
    }

    const effect = createEffect(effectId, this.context);

    if (!effect) {
      return null;
    }

    this.effects.set(effect.id, effect);
    this.attachDreamSource(effect);
    if ('setQualityMode' in effect) {
      (effect as Effect & { setQualityMode(value: PerformanceMode): void }).setQualityMode(this.performanceMode);
    }
    this.graph.addEffect(effect);
    this.rebuildDreamRoutes();

    return effect;
  }

  public removeEffect(effectId: string): void {
    if (!this.graph) {
      return;
    }

    const removedEffect = this.graph.removeEffect(effectId);

    if (!removedEffect) {
      return;
    }

    this.dreamBuffer?.detachSource(effectId);
    this.effects.delete(effectId);
    this.rebuildDreamRoutes();
    removedEffect.dispose();
  }

  public getEffect(effectId: string): Effect | undefined {
    return this.effects.get(effectId);
  }

  public getEffectOrder(): string[] {
    return this.graph?.getEffects().map((effect) => effect.id) ?? [];
  }

  public setEffectParameter(
    effectId: string,
    parameterId: string,
    value: number
  ): void {
    const effect = this.effects.get(effectId);

    if (!effect) {
      throw new Error(`Effect "${effectId}" is not currently loaded.`);
    }

    const parameter = effect.getParameter(parameterId);
    if (!parameter) {
      throw new Error(`Effect "${effectId}" has no parameter "${parameterId}".`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Effect "${effectId}" parameter "${parameterId}" received a non-finite value.`);
    }
    effect.setParameter(parameterId, value);
  }

  public setEffectBypassed(effectId: string, bypassed: boolean): void {
    const effect = this.effects.get(effectId);

    if (!effect) {
      return;
    }

    effect.setBypassed(bypassed);
    this.dreamBuffer?.setSendAmount(effectId, bypassed ? 0 : getDreamSendAmount(effectId));
    this.updateDreamRouteForEffect(effectId);
  }

  public reorderEffects(effectIds: string[]): void {
    this.graph?.reorderEffects(effectIds);
  }

  public reorderEffectsClickSafe(effectIds: string[]): Promise<void> {
    const requestedOrder = [...effectIds];
    this.routeTransition = this.routeTransition
      .catch(() => undefined)
      .then(() => this.performClickSafeReorder(requestedOrder));
    return this.routeTransition;
  }

  private async performClickSafeReorder(effectIds: string[]): Promise<void> {
    if (!this.graph || !this.context) return;

    const current = this.graph.getEffects().map((effect) => effect.id);
    if (current.length === effectIds.length && current.every((id, index) => id === effectIds[index])) {
      return;
    }

    const gain = this.graph.output.gain;
    const fadeOutSeconds = 0.012;
    const fadeInSeconds = 0.026;
    const now = this.context.currentTime;

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0.0001, now + fadeOutSeconds);

    await sleepMilliseconds(15);

    try {
      this.graph.reorderEffects(effectIds);
    } finally {
      const resumeAt = this.context.currentTime;
      gain.cancelScheduledValues(resumeAt);
      gain.setValueAtTime(0.0001, resumeAt);
      gain.linearRampToValueAtTime(1, resumeAt + fadeInSeconds);
    }
  }

  public loadPreset(preset: Preset): void {
    if (!this.context || !this.graph) {
      throw new Error('Start the audio engine before loading a preset.');
    }

    const oldEffects = [...this.effects.values()];

    this.effects.clear();

    const presetEffects: Effect[] = [];

    for (const presetEffect of preset.effects) {
      const effect = createEffect(presetEffect.id, this.context);

      if (!effect) {
        continue;
      }

      for (const [parameterId, value] of Object.entries(
        presetEffect.parameters
      )) {
        if (!effect.getParameter(parameterId)) {
          effect.dispose();
          throw new Error(`Preset "${preset.name}" references unknown parameter "${presetEffect.id}.${parameterId}".`);
        }
        if (!Number.isFinite(value)) {
          effect.dispose();
          throw new Error(`Preset "${preset.name}" contains a non-finite value for "${presetEffect.id}.${parameterId}".`);
        }
        effect.setParameter(parameterId, value);
      }

      effect.setBypassed(!presetEffect.enabled);

      this.effects.set(effect.id, effect);
      this.attachDreamSource(effect);
      if ('setQualityMode' in effect) {
        (effect as Effect & { setQualityMode(value: PerformanceMode): void }).setQualityMode(this.performanceMode);
      }
      presetEffects.push(effect);
    }

    this.graph.setEffects(presetEffects);
    this.rebuildDreamRoutes();

    for (const oldEffect of oldEffects) {
      oldEffect.dispose();
    }

    this.setInputGain(preset.inputGain);
    this.setOutputGain(preset.outputGain);
  }

  public startRecording(): { sampleRate: number; maxDurationSeconds: number } {
    if (!this.context || !this.outputGain || this.state !== 'running') {
      throw new Error('Start the audio engine before recording a sample.');
    }

    if (!this.recorder) {
      this.recorder = new WavRecorder(this.context, this.outputGain);
    }

    this.recorder.start();
    return {
      sampleRate: this.context.sampleRate,
      maxDurationSeconds: this.recorder.maxDurationSeconds,
    };
  }

  public async stopRecording(): Promise<RecordedWav> {
    if (!this.recorder?.isRecording) {
      throw new Error('No sample is currently being recorded.');
    }
    return this.recorder.stop();
  }

  public cancelRecording(): void {
    this.recorder?.cancel();
  }

  public isRecording(): boolean {
    return this.recorder?.isRecording ?? false;
  }

  public async stop(): Promise<void> {
    this.recorder?.dispose();
    this.recorder = null;

    this.dreamBuffer?.dispose();
    this.dreamBuffer = null;

    this.source?.disconnect();
    this.inputMatrix?.dispose();
    this.source = null;
    this.inputMatrix = null;

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }

    this.stream = null;

    // AudioGraph.dispose() disconnects and disposes its effects.
    this.graph?.dispose();
    this.graph = null;

    // Clear references without disposing the effects a second time.
    this.effects.clear();

    this.inputGain?.disconnect();
    this.outputGain?.disconnect();
    this.dcBlock?.disconnect();
    this.safetyClipper?.disconnect();
    this.limiter?.disconnect();
    this.analyser?.disconnect();

    this.inputGain = null;
    this.outputGain = null;
    this.dcBlock = null;
    this.safetyClipper = null;
    this.limiter = null;
    this.analyser = null;

    if (this.context && this.context.state !== 'closed') {
      await this.context.close();
    }

    this.context = null;

    if (this.state !== 'error') {
      this.state = 'stopped';
    }
  }

  private connectMasterChain(): void {
    if (!this.graph || !this.dcBlock || !this.safetyClipper || !this.limiter || !this.analyser || !this.outputGain) {
      return;
    }

    this.graph.output.disconnect();
    this.dcBlock.disconnect();
    this.safetyClipper.disconnect();
    this.limiter.disconnect();
    this.analyser.disconnect();

    this.graph.output.connect(this.dcBlock);
    this.dcBlock.connect(this.safetyClipper);
    this.safetyClipper.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.outputGain);
  }

  private configureQualityMode(): void {
    if (!this.analyser || !this.limiter) return;
    if (this.safetyClipper) {
      this.safetyClipper.oversample =
        this.performanceMode === 'studio'
          ? '4x'
          : this.performanceMode === 'balanced'
          ? '2x'
          : 'none';
    }
    this.analyser.fftSize =
      this.performanceMode === 'studio'
        ? 1024
        : this.performanceMode === 'balanced'
        ? 512
        : 256;
    this.analyser.smoothingTimeConstant =
      this.performanceMode === 'live' ? 0.72 : 0.8;
    // Keep topology fixed. Live mode merely makes the safety stage gentler.
    this.limiter.threshold.setValueAtTime(
      this.performanceMode === 'live' ? -1.2 : -3,
      this.context?.currentTime ?? 0
    );
    this.limiter.ratio.setValueAtTime(
      this.performanceMode === 'live' ? 6 : 12,
      this.context?.currentTime ?? 0
    );
  }

  private configureLimiter(limiter: DynamicsCompressorNode): void {
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.0015;
    limiter.release.value = 0.12;
  }

  private async loadAudioWorklets(context: AudioContext): Promise<void> {
    if (!context.audioWorklet) {
      throw new Error('This browser does not support AudioWorklet, which CALCOTONE requires for realtime Dream Engine DSP.');
    }
    const modules = [
      ['Grain', `grain-processor.js?v=8.4.27-grain-engine`],
      ['Dream Buffer', `dream-buffer-processor.js?v=${WORKLET_BUILD_VERSION}`],
      ['Recorder', `recorder-processor.js?v=${WORKLET_BUILD_VERSION}`],
    ] as const;
    for (const [label, file] of modules) {
      const moduleUrl = new URL(`${import.meta.env.BASE_URL}${file}`, window.location.origin).toString();
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } catch (error) {
        throw new Error(`Dream Engine ${label} processor failed to load from ${moduleUrl}. ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private attachDreamSource(effect: Effect): void {
    if (!this.dreamBuffer) return;
    const amount = effect.isBypassed() ? 0 : getDreamSendAmount(effect.id);
    if (amount > 0 || ['saturation','chorus','delay','reverb','bitcrusher','media'].includes(effect.id)) {
      this.dreamBuffer.attachSource(effect.id, effect.output, amount);
    }
  }

  /** Rebuild the guarded cross-module Dream-memory routes after graph changes. */
  private rebuildDreamRoutes(): void {
    if (!this.dreamBuffer) return;
    this.dreamBuffer.detachAllRoutes();

    const delay = this.effects.get('delay');
    const reverb = this.effects.get('reverb');
    const grain = this.effects.get('bitcrusher');
    const ember = this.effects.get('saturation');
    const drift = this.effects.get('chorus');
    const artifact = this.effects.get('media');


    // SHORT -> Drift: recent memory subtly perturbs the movement field.
    if (drift) this.dreamBuffer.attachRoute('memory-to-chorus','short',drift.input,drift.isBypassed()?0:0.009);
    // MEDIUM -> Ember: remembered harmonics are re-heated at a nearly subliminal level.
    if (ember) this.dreamBuffer.attachRoute('memory-to-saturation','medium',ember.input,ember.isBypassed()?0:0.007);
    // LONG -> Artifact: old program material becomes ghost/print-through memory.
    if (artifact) this.dreamBuffer.attachRoute('memory-to-media','long',artifact.input,artifact.isBypassed()?0:0.011);

    // SHORT -> Atmos: recent fragments become early spatial energy.
    if (reverb) {
      this.dreamBuffer.attachRoute(
        'memory-to-reverb',
        'short',
        reverb.input,
        reverb.isBypassed() ? 0 : 0.026,
      );
    }

    // MEDIUM -> Grain: older material can be reconstructed as fragments.
    if (grain) {
      this.dreamBuffer.attachRoute(
        'memory-to-bitcrusher',
        'medium',
        grain.input,
        grain.isBypassed() ? 0 : 0.014,
      );
    }

    // LONG -> Halo: distant memory quietly re-enters the echo field.
    if (delay) {
      this.dreamBuffer.attachRoute(
        'memory-to-delay',
        'long',
        delay.input,
        delay.isBypassed() ? 0 : 0.019,
      );
    }
  }

  private updateDreamRouteForEffect(effectId: string): void {
    if (!this.dreamBuffer) return;
    const effect = this.effects.get(effectId);
    if (!effect) return;
    const amount = effect.isBypassed() ? 0 : getDreamRouteAmount(effectId);
    this.dreamBuffer.setRouteAmount(`memory-to-${effectId}`, amount);
  }

  private assertBrowserSupport(): void {
    if (!window.AudioContext) {
      throw new Error('This browser does not support the Web Audio API.');
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Audio input is unavailable. Open the app through HTTPS and grant microphone permission.'
      );
    }
  }
}

function getDreamRouteAmount(effectId: string): number {
  switch (effectId) {
    case 'reverb': return 0.026;
    case 'bitcrusher': return 0.014;
    case 'delay': return 0.019;
    case 'chorus': return 0.009;
    case 'saturation': return 0.007;
    case 'media': return 0.011;
    default: return 0;
  }
}

function getDreamSendAmount(effectId: string): number {
  switch (effectId) {
    case 'delay': return 0.18;
    case 'reverb': return 0.12;
    case 'bitcrusher': return 0.1;
    case 'saturation': return 0.06;
    case 'chorus': return 0.07;
    case 'media': return 0.08;
    default: return 0;
  }
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}


function normalizeAudioError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return new Error(
          'Audio-input permission was denied. Allow microphone access and try again.'
        );

      case 'NotFoundError':
        return new Error('No usable audio-input device was found.');

      case 'NotReadableError':
        return new Error(
          'The audio input is busy or could not be opened. Close other audio applications and try again.'
        );

      case 'OverconstrainedError':
        return new Error(
          'The selected audio device does not support the requested settings.'
        );

      default:
        return new Error(`Audio device error: ${error.message}`);
    }
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error('An unknown audio error occurred.');
}

function createSafetyCurve(): Float32Array {
  const length = 4096;
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const x = (i / (length - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const shaped = magnitude <= 0.72
      ? magnitude
      : 0.72 + (1 - Math.exp(-(magnitude - 0.72) * 4.2)) * 0.26;
    curve[i] = Math.sign(x) * Math.min(0.98, shaped);
  }
  return curve;
}
