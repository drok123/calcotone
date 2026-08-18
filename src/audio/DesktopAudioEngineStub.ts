const DESKTOP_NATIVE_ONLY_MESSAGE =
  'CALCOTONE desktop is native-only. The browser AudioEngine is not part of this build.';

/**
 * Runtime fence for the desktop Vite bundle.
 *
 * TypeScript still checks App.tsx against the full browser AudioEngine before
 * Vite runs. During `vite build --mode desktop`, vite.config.ts resolves every
 * runtime import of audio/AudioEngine to this class instead. The Windows shell
 * must therefore reach the NativeAudioBridge path; any accidental attempt to
 * instantiate the browser engine fails loudly rather than silently restoring
 * Web Audio as a fallback.
 */
export class AudioEngine {
  public async start(): Promise<void> {
    throw new Error(DESKTOP_NATIVE_ONLY_MESSAGE);
  }

  public async stop(): Promise<void> {
    // Startup/teardown cleanup is allowed to remain idempotent even if a caller
    // holds a defensive reference to the desktop fence.
  }

  public getState(): 'idle' {
    return 'idle';
  }

  public setEffectParameter(_effectId: string, _parameterId: string, _value: number): void {
    throw new Error(DESKTOP_NATIVE_ONLY_MESSAGE);
  }

  public setEffectBypassed(_effectId: string, _bypassed: boolean): void {
    throw new Error(DESKTOP_NATIVE_ONLY_MESSAGE);
  }
}
