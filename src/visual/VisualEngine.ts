import { useEffect, useRef, useState } from 'react';
import type { VisualSpectrumSource } from './SharedVisualSpectrum';

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
let latestVisualSpectrum = new Uint8Array(0);
let latestVisualOwner = 0;
let nextVisualOwner = 1;

/**
 * The canvas Dream Field renders on the shared viewport scheduler instead of
 * React's render cadence. Exposing the latest analyser snapshot lets that
 * canvas consume the same audio state without causing another component tree
 * update on every animation frame.
 */
export function getLatestVisualAudioState(): VisualAudioState {
  return latestVisualAudioState;
}

/** Shared by visual surfaces that want the most recent engine-owned snapshot. */
export function getLatestVisualSpectrum(): Uint8Array {
  return latestVisualSpectrum;
}

export function useVisualEngine(
  analyser: VisualSpectrumSource | null,
  running: boolean,
  frameRate = 30
): VisualAudioState {
  const [state, setState] = useState<VisualAudioState>(IDLE_STATE);
  const previousLevel = useRef(0);
  const smoothedBands = useRef({ low: 0, mid: 0, high: 0 });
  const ownerRef = useRef(0);
  if (ownerRef.current === 0) ownerRef.current = nextVisualOwner++;

  useEffect(() => {
    const owner = ownerRef.current;
    if (!running || !analyser) {
      previousLevel.current = 0;
      smoothedBands.current = { low: 0, mid: 0, high: 0 };
      if (latestVisualOwner === owner) {
        latestVisualAudioState = IDLE_STATE;
        latestVisualSpectrum = new Uint8Array(0);
        latestVisualOwner = 0;
      }
      setState((current) => current === IDLE_STATE ? current : IDLE_STATE);
      return;
    }

    let frame = 0;
    let lastSample = 0;
    let lastReactPublish = 0;
    const sampleInterval = 1000 / Math.max(1, frameRate);
    // Canvas/video visualizers consume the shared snapshot independently. React only
    // needs a modest cadence for meters, labels and CSS feedback.
    const reactInterval = 1000 / 15;
    const data = new Uint8Array(analyser.frequencyBinCount);
    latestVisualOwner = owner;
    latestVisualSpectrum = data;
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

      // Animation phase follows the audio presentation clock when the analyser can
      // provide one. requestAnimationFrame remains only the repaint scheduler; it
      // is no longer the musical/visual timeline.
      const audioTime = analyser.getPresentationTimeSeconds?.() ?? timestamp / 1000;
      const next = {
        level,
        low,
        mid,
        high,
        transient,
        driftPhase: (audioTime * 0.08) % 1,
        time: audioTime,
      };
      if (latestVisualOwner === owner) latestVisualAudioState = next;

      if (timestamp - lastReactPublish >= reactInterval) {
        lastReactPublish = timestamp;
        setState(next);
      }
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      if (latestVisualOwner === owner) {
        latestVisualAudioState = IDLE_STATE;
        latestVisualSpectrum = new Uint8Array(0);
        latestVisualOwner = 0;
      }
    };
  }, [analyser, running, frameRate]);

  return state;
}
