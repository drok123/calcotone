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

let latestVisualAudioState: VisualAudioState = IDLE_STATE;

/**
 * The canvas Dream Field renders on the shared viewport scheduler instead of
 * React's render cadence. Exposing the latest analyser snapshot lets that
 * canvas consume the same audio state without causing another component tree
 * update on every animation frame.
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
    if (!running || !analyser) {
      previousLevel.current = 0;
      smoothedBands.current = { low: 0, mid: 0, high: 0 };
      latestVisualAudioState = IDLE_STATE;
      setState((current) => current === IDLE_STATE ? current : IDLE_STATE);
      return;
    }

    let frame = 0;
    let lastSample = 0;
    let lastReactPublish = 0;
    const sampleInterval = 1000 / Math.max(1, frameRate);
    // Canvas/video visualizers consume the shared snapshot independently. React only
    // needs a modest cadence for meters, labels and CSS feedback; lowering this from
    // 20 Hz substantially reduces full-workstation reconciliation with no DSP impact.
    const reactInterval = 1000 / 15;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const lowEnd = Math.floor(data.length * 0.12);
    const midEnd = Math.floor(data.length * 0.48);

    const average = (start: number, end: number) => {
      let total = 0;
      const safeEnd = Math.min(end, data.length);
      for (let index = start; index < safeEnd; index += 1) total += data[index];
      return safeEnd > start ? total / (safeEnd - start) / 255 : 0;
    };

    const smoothBand = (previous: number, next: number) => {
      const amount = next > previous ? 0.48 : 0.20;
      return previous + (next - previous) * amount;
    };

    const render = (timestamp: number) => {
      frame = requestAnimationFrame(render);
      if (timestamp - lastSample < sampleInterval) return;
      lastSample = timestamp;

      analyser.getByteFrequencyData(data);
      const rawLow = average(1, lowEnd);
      const rawMid = average(lowEnd, midEnd);
      const rawHigh = average(midEnd, data.length);

      const low = smoothBand(smoothedBands.current.low, rawLow);
      const mid = smoothBand(smoothedBands.current.mid, rawMid);
      const high = smoothBand(smoothedBands.current.high, rawHigh);
      smoothedBands.current = { low, mid, high };

      const level = Math.min(1, low * 0.40 + mid * 0.43 + high * 0.17);
      const levelRise = Math.max(0, level - previousLevel.current);
      const spectralSnap = Math.max(0, rawHigh - high) * 0.45 + Math.max(0, rawMid - mid) * 0.25;
      const transient = Math.min(1, levelRise * 8.5 + spectralSnap * 2.8);
      previousLevel.current = previousLevel.current * 0.66 + level * 0.34;

      const next = {
        level,
        low,
        mid,
        high,
        transient,
        driftPhase: (timestamp * 0.00008) % 1,
        time: timestamp / 1000,
      };
      latestVisualAudioState = next;

      if (timestamp - lastReactPublish >= reactInterval) {
        lastReactPublish = timestamp;
        setState(next);
      }
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      latestVisualAudioState = IDLE_STATE;
    };
  }, [analyser, running, frameRate]);

  return state;
}
