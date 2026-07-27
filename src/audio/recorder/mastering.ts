export type RecorderMasterMode = 'raw' | 'clean' | 'loud';

export interface MasterResult {
  left: Float32Array;
  right: Float32Array;
  peak: number;
  gainAppliedDb: number;
}

const CLEAN_TARGET_PEAK = dbToGain(-1);
const LOUD_TARGET_PEAK = dbToGain(-0.8);

export function masterStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  mode: Exclude<RecorderMasterMode, 'raw'>
): MasterResult {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  const hp = makeHighPassState(sampleRate, 24);
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < left.length; i += 1) {
    const l = highPass(left[i], hp.left, hp.alpha);
    const r = highPass(right[i], hp.right, hp.alpha);
    outL[i] = l;
    outR[i] = r;
    sumSquares += (l * l + r * r) * 0.5;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, left.length));
  const targetRms = dbToGain(mode === 'loud' ? -12 : -16);
  const maxMakeup = dbToGain(mode === 'loud' ? 12 : 9);
  const targetPeak = mode === 'loud' ? LOUD_TARGET_PEAK : CLEAN_TARGET_PEAK;
  const rmsGain = rms > 1e-8 ? targetRms / rms : 1;
  const peakGain = peak > 1e-8 ? targetPeak / peak : 1;
  const transientAllowance = mode === 'loud' ? 1.7 : 1.25;
  const makeup = Math.min(maxMakeup, Math.max(0.25, rmsGain), peakGain * transientAllowance);
  const drive = mode === 'loud' ? 1.55 : 1.18;
  let finalPeak = 0;

  for (let i = 0; i < outL.length; i += 1) {
    outL[i] = softLimit(outL[i] * makeup, drive, targetPeak);
    outR[i] = softLimit(outR[i] * makeup, drive, targetPeak);
    finalPeak = Math.max(finalPeak, Math.abs(outL[i]), Math.abs(outR[i]));
  }

  return {
    left: outL,
    right: outR,
    peak: finalPeak,
    gainAppliedDb: 20 * Math.log10(Math.max(1e-8, makeup)),
  };
}

export function measurePeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  return peak;
}

function makeHighPassState(sampleRate: number, frequency: number) {
  const rc = 1 / (2 * Math.PI * frequency);
  const dt = 1 / sampleRate;
  return {
    alpha: rc / (rc + dt),
    left: { x: 0, y: 0 },
    right: { x: 0, y: 0 },
  };
}

function highPass(input: number, state: { x: number; y: number }, alpha: number): number {
  const output = alpha * (state.y + input - state.x);
  state.x = input;
  state.y = output;
  return output;
}

function softLimit(sample: number, drive: number, ceiling: number): number {
  const sign = sample < 0 ? -1 : 1;
  const magnitude = Math.abs(sample);
  const knee = ceiling * (drive > 1.4 ? 0.68 : 0.78);
  if (magnitude <= knee) return sample;
  const span = Math.max(1e-8, ceiling - knee);
  const normalized = (magnitude - knee) / span;
  const compressed = Math.tanh(normalized * drive) / Math.tanh(drive);
  return sign * Math.min(ceiling, knee + span * compressed);
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
