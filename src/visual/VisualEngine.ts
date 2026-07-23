import { useEffect, useRef, useState } from 'react';

export interface VisualAudioState {
  level: number;
  low: number;
  mid: number;
  high: number;
  transient: number;
  driftPhase: number;
  time: number;
}

const IDLE_STATE: VisualAudioState = {
  level: 0,
  low: 0,
  mid: 0,
  high: 0,
  transient: 0,
  driftPhase: 0,
  time: 0,
};

export function useVisualEngine(
  analyser: AnalyserNode | null,
  running: boolean,
  frameRate = 30
): VisualAudioState {
  const [state, setState] = useState<VisualAudioState>(IDLE_STATE);
  const previousLevel = useRef(0);

  useEffect(() => {
    let frame = 0;
    let lastFrame = 0;
    const interval = 1000 / frameRate;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const render = (timestamp: number) => {
      frame = requestAnimationFrame(render);
      if (timestamp - lastFrame < interval) return;
      lastFrame = timestamp;

      if (!running || !analyser || !data) {
        const idlePulse = (Math.sin(timestamp * 0.0008) + 1) * 0.015;
        setState({
          ...IDLE_STATE,
          level: idlePulse,
          driftPhase: (timestamp * 0.00008) % 1,
          time: timestamp / 1000,
        });
        return;
      }

      analyser.getByteFrequencyData(data);
      const average = (start: number, end: number) => {
        let total = 0;
        const safeEnd = Math.min(end, data.length);
        for (let index = start; index < safeEnd; index += 1)
          total += data[index];
        return safeEnd > start ? total / (safeEnd - start) / 255 : 0;
      };

      const low = average(1, Math.floor(data.length * 0.12));
      const mid = average(
        Math.floor(data.length * 0.12),
        Math.floor(data.length * 0.48)
      );
      const high = average(Math.floor(data.length * 0.48), data.length);
      const level = Math.min(1, low * 0.38 + mid * 0.44 + high * 0.18);
      const transient = Math.min(
        1,
        Math.max(0, level - previousLevel.current) * 7
      );
      previousLevel.current = previousLevel.current * 0.68 + level * 0.32;

      setState({
        level,
        low,
        mid,
        high,
        transient,
        driftPhase: (timestamp * 0.00008) % 1,
        time: timestamp / 1000,
      });
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [analyser, running, frameRate]);

  return state;
}
