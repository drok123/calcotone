import { memo, useEffect, useRef, useState } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { AsciiArtEngine, moduleModeKey } from '../ascii/AsciiArtEngine';

type ModuleViewportProps = {
  module: ModuleState;
  visualState: VisualAudioState;
};

function ModuleViewportView({ module }: ModuleViewportProps) {
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
      data-visual-mode={sceneKey}
    >
      <AsciiArtEngine kind="module" module={module} className="module-spectacle-ascii" />
    </div>
  );
}

// The ASCII engine already samples the live non-React audio snapshot on the shared
// viewport scheduler. Parent visualState updates therefore do not need to rerender this
// React subtree. Immutable module updates create a new module object whenever power,
// mode, program, or a parameter changes, so the owning module still updates immediately.
export const ModuleViewport = memo(
  ModuleViewportView,
  (previous, next) => previous.module === next.module,
);
