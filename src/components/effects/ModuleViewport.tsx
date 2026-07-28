import { useEffect, useRef, useState } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { AsciiArtEngine, moduleModeKey } from '../ascii/AsciiArtEngine';

export function ModuleViewport({ module, visualState }: { module: ModuleState; visualState: VisualAudioState }) {
  const sceneKey = moduleModeKey(module);
  const previousSceneRef = useRef(sceneKey);
  const transitionTimerRef = useRef<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (previousSceneRef.current === sceneKey) return;
    previousSceneRef.current = sceneKey;
    setTransitioning(true);
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setTransitioning(false);
    }, 360);

    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [sceneKey]);

  return (
    <div
      className={`dsp-viewport ascii-viewport viewport-${module.id} ${module.enabled ? 'active' : 'is-off'} ${transitioning ? 'is-reconfiguring' : ''}`}
      data-audio-level={Math.max(0, Math.min(1, visualState.level)).toFixed(3)}
      data-visual-mode={sceneKey}
    >
      <AsciiArtEngine kind="module" module={module} />
    </div>
  );
}
