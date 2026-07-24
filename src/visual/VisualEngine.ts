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

const REACT_TELEMETRY_HZ = 10;
let latestVisualAudioState: VisualAudioState = IDLE_STATE;

/**
 * Canvas renderers consume the freshest analyser snapshot without routing every animation
 * frame through React. The hook still returns low-rate telemetry for CSS/UI consumers.
 */
export function getLatestVisualAudioState(): VisualAudioState {
  return latestVisualAudioState;
}

export function useVisualEngine(
  analyser: AnalyserNode | null,
  running: boolean,
  frameRate = 30
): VisualAudioState {
  const [state, setState] = useState<VisualAudioState>(IDLE_STATE);
  const previousLevel = useRef(0);
  const smoothedBands = useRef({ low: 0, mid: 0, high: 0 });

  useEffect(() => {
    let frame = 0;
    let lastFrame = 0;
    let lastReactPublish = Number.NEGATIVE_INFINITY;
    const interval = 1000 / Math.max(1, frameRate);
    const reactInterval = 1000 / REACT_TELEMETRY_HZ;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const publish = (next: VisualAudioState, timestamp: number) => {
      // Always keep the realtime canvas snapshot fresh.
      latestVisualAudioState = next;

      // React only needs telemetry fast enough for LEDs/CSS state. Keeping it off the
      // 30–45 fps canvas clock avoids re-rendering the entire workstation every frame.
      if (timestamp - lastReactPublish >= reactInterval) {
        lastReactPublish = timestamp;
        setState(next);
      }
    };

    const render = (timestamp: number) => {
      frame = requestAnimationFrame(render);
      if (timestamp - lastFrame < interval) return;
      lastFrame = timestamp;

      if (!running || !analyser || !data) {
        const idlePulse = (Math.sin(timestamp * 0.0008) + 1) * 0.015;
        const next = {
          ...IDLE_STATE,
          level: idlePulse,
          driftPhase: (timestamp * 0.00008) % 1,
          time: timestamp / 1000,
        };
        smoothedBands.current.low *= 0.9;
        smoothedBands.current.mid *= 0.9;
        smoothedBands.current.high *= 0.9;
        previousLevel.current *= 0.9;
        publish(next, timestamp);
        return;
      }

      analyser.getByteFrequencyData(data);
      const average = (start: number, end: number) => {
        let total = 0;
        const safeEnd = Math.min(end, data.length);
        for (let index = start; index < safeEnd; index += 1) total += data[index];
        return safeEnd > start ? total / (safeEnd - start) / 255 : 0;
      };

      const lowEnd = Math.floor(data.length * 0.12);
      const midEnd = Math.floor(data.length * 0.48);
      const rawLow = average(1, lowEnd);
      const rawMid = average(lowEnd, midEnd);
      const rawHigh = average(midEnd, data.length);

      // Light attack/release smoothing keeps the physics input musical while
      // still allowing kicks and snares to create useful impulses.
      const smoothBand = (previous: number, next: number) => {
        const amount = next > previous ? 0.48 : 0.20;
        return previous + (next - previous) * amount;
      };
      const low = smoothBand(smoothedBands.current.low, rawLow);
      const mid = smoothBand(smoothedBands.current.mid, rawMid);
      const high = smoothBand(smoothedBands.current.high, rawHigh);
      smoothedBands.current = { low, mid, high };

      const level = Math.min(1, low * 0.40 + mid * 0.43 + high * 0.17);
      const levelRise = Math.max(0, level - previousLevel.current);
      const spectralSnap =
        Math.max(0, rawHigh - high) * 0.45 +
        Math.max(0, rawMid - mid) * 0.25;
      const transient = Math.min(1, levelRise * 8.5 + spectralSnap * 2.8);
      previousLevel.current = previousLevel.current * 0.66 + level * 0.34;

      publish(
        {
          level,
          low,
          mid,
          high,
          transient,
          driftPhase: (timestamp * 0.00008) % 1,
          time: timestamp / 1000,
        },
        timestamp
      );
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      latestVisualAudioState = IDLE_STATE;
    };
  }, [analyser, running, frameRate]);

  return state;
}
