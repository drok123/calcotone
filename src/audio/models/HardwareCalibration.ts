export const HARDWARE_CALIBRATION_REVISION = '2026-08-tascam-headroom-c';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export interface CompanderOperatingPoint {
  thresholdDb: number;
  ratio: number;
  attackSeconds: number;
  releaseSeconds: number;
  makeupGain: number;
  expansionAmount: number;
}

export function companderOperatingPoint(amount: number, speed: number, color: number): CompanderOperatingPoint {
  const a = clamp01(amount);
  const s = clamp01(speed);
  const c = clamp01(color);
  return {
    thresholdDb: -16 - a * 22,
    ratio: 1.5 + a * 3.5,
    attackSeconds: 0.0015 + (1 - s) * 0.012,
    releaseSeconds: 0.055 + (1 - s) * 0.24,
    makeupGain: 1.02 + a * 0.24 + c * 0.05,
    expansionAmount: Math.round((0.18 + a * 0.58) * 48) / 48,
  };
}

export function companderExpansionTransfer(input: number, amount: number): number {
  const power = 1 + clamp01(amount) * 0.34;
  return Math.sign(input) * Math.pow(Math.abs(input), power);
}

export interface BbdOperatingPoint {
  bucketCutoffHz: number;
  preEmphasisDb: number;
  deEmphasisDb: number;
  trimGain: number;
  companderAmount: number;
  companderSpeed: number;
  companderColor: number;
  compander: CompanderOperatingPoint;
  clockCurveAmount: number;
}

export function bbdOperatingPoint(
  delayTimeSeconds: number,
  character: number,
  color: number,
  modulation: number,
): BbdOperatingPoint {
  const time = Math.max(0.0005, Number.isFinite(delayTimeSeconds) ? delayTimeSeconds : 0.02);
  const c = clamp01(character);
  const tone = clamp01(color);
  const mod = clamp01(modulation);
  const companderAmount = 0.36 + c * 0.46;
  const companderSpeed = 0.5 + mod * 0.35;
  const clockLoss = clamp01(Math.log10(1 + time * 75) / Math.log10(1 + 6.2 * 75));
  return {
    bucketCutoffHz: Math.max(1400, 9200 - clockLoss * 5200 - c * 1500 + tone * 1700),
    preEmphasisDb: 1.2 + c * 3.8,
    deEmphasisDb: -1.0 - c * 3.4,
    trimGain: 0.99 - c * 0.08,
    companderAmount,
    companderSpeed,
    companderColor: tone,
    compander: companderOperatingPoint(companderAmount, companderSpeed, tone),
    clockCurveAmount: Math.round((c * 0.72 + clockLoss * 0.28) * 48) / 48,
  };
}

export function bbdClockTransfer(input: number, amount: number): number {
  const drive = 1 + clamp01(amount) * 2.2;
  return Math.tanh(input * drive) / Math.tanh(drive);
}

export interface TapeTransportOperatingPoint {
  headBumpHz: number;
  headBumpDb: number;
  headLossHz: number;
  delaySeconds: number;
  wowHz: number;
  flutterHz: number;
  wowDepthSeconds: number;
  flutterDepthSeconds: number;
  trimGain: number;
  curveDrive: number;
  curveBias: number;
}

export function tapeTransportOperatingPoint(
  speed: number,
  wear: number,
  tone: number,
  drive: number,
): TapeTransportOperatingPoint {
  const s = clamp01(speed);
  const w = clamp01(wear);
  const t = clamp01(tone);
  const d = clamp01(drive);
  return {
    headBumpHz: 58 + s * 52,
    headBumpDb: 0.4 + d * 2.3 + (1 - s) * 0.8,
    headLossHz: Math.max(2800, 7200 + t * 10_000 - w * 4400 - (1 - s) * 2200),
    delaySeconds: 0.010 + (1 - s) * 0.006,
    wowHz: 0.18 + s * 0.34,
    flutterHz: 4.1 + s * 4.8,
    wowDepthSeconds: 0.00004 + w * w * 0.00175,
    flutterDepthSeconds: 0.000015 + w * w * 0.00042,
    trimGain: 1 - d * 0.045,
    curveDrive: d,
    curveBias: 0.35 + w * 0.45,
  };
}

export function tapeTransportTransfer(input: number, drive: number, bias: number): number {
  const gain = 1 + clamp01(drive) * 4.4;
  const asymmetry = (clamp01(bias) - 0.5) * 0.12;
  const shifted = input + Math.max(0, input) * asymmetry;
  return Math.tanh(shifted * gain) / Math.tanh(gain);
}

export interface SpringTankOperatingPoint {
  tapTimesSeconds: readonly number[];
  allpassFrequenciesHz: readonly number[];
  allpassQ: readonly number[];
  damperFrequenciesHz: readonly number[];
  feedbackGain: number;
  feedbackToneHz: number;
  transducerOutputDb: number;
  transducerDrive: number;
}

export function springTankOperatingPoint(
  decay: number,
  size: number,
  color: number,
  drive: number,
): SpringTankOperatingPoint {
  const d = clamp01(decay);
  const s = clamp01(size);
  const c = clamp01(color);
  const x = clamp01(drive);
  const scale = 0.72 + s * 0.72;
  const indices = [0, 1, 2, 3] as const;
  return {
    tapTimesSeconds: [0.019, 0.027, 0.036, 0.048].map((base) => base * scale),
    allpassFrequenciesHz: indices.map((index) => 520 + c * 1850 + index * 470),
    allpassQ: indices.map((index) => 1.8 + d * 3.1 + index * 0.25),
    damperFrequenciesHz: indices.map((index) => Math.max(1700, 4200 + c * 6400 - d * 900 - index * 420)),
    feedbackGain: Math.min(0.86, 0.34 + d * 0.5),
    feedbackToneHz: 3000 + c * 6200,
    transducerOutputDb: 0.5 + x * 3.5,
    transducerDrive: Math.round(x * 48) / 48,
  };
}

export function springTransducerTransfer(input: number, amount: number): number {
  const safeAmount = clamp01(amount);
  const gain = 1 + safeAmount * 3.1;
  return Math.tanh((input + Math.max(0, input) * safeAmount * 0.05) * gain) / Math.tanh(gain);
}

export interface ConverterOperatingPoint {
  bits: number;
  antiAliasHz: number;
  reconstructionHz: number;
  trimGain: number;
  curveBits: number;
  curveDrive: number;
}

export function converterOperatingPoint(bits: number, bandwidth: number, drive: number): ConverterOperatingPoint {
  const bw = clamp01(bandwidth);
  const d = clamp01(drive);
  const b = Math.max(6, Math.min(16, Number.isFinite(bits) ? bits : 12));
  const cutoff = 4200 + bw * 12_500;
  return {
    bits: b,
    antiAliasHz: cutoff * 0.96,
    reconstructionHz: cutoff,
    trimGain: 0.99 - d * 0.06,
    curveBits: Math.round(b),
    curveDrive: d,
  };
}

export type ArtifactConsoleMode = 'Neve 1073' | 'SSL 4000E' | 'API 1608';

export interface SummingBusOperatingPoint {
  preCompression: number;
  postCompression: number;
  asymmetry: number;
  lowHz: number;
  lowDb: number;
  highHz: number;
  highDb: number;
  highpassHz: number;
  lowpassHz: number;
  crossfeed: number;
}

function bipolarAroundDefault(value: number, center: number): number {
  if (value >= center) return (value - center) / Math.max(1e-6, 1 - center);
  return (value - center) / Math.max(1e-6, center);
}

export function summingBusOperatingPoint(
  mode: ArtifactConsoleMode,
  wear: number,
  wow: number,
  noise: number,
  tone: number,
): SummingBusOperatingPoint {
  const behavior = clamp01(wear);
  const weight = bipolarAroundDefault(clamp01(wow), 0.16);
  const presence = bipolarAroundDefault(clamp01(noise), 0.1);
  const character = clamp01(tone);
  if (mode === 'Neve 1073') {
    return {
      preCompression: 0.008 + behavior * 0.035,
      postCompression: 0.006 + character * 0.022,
      asymmetry: 0.004 + behavior * 0.018,
      lowHz: 110,
      lowDb: weight * 1.5 + behavior * 0.15,
      highHz: 12_000,
      highDb: presence * 1.15 - behavior * 0.12,
      highpassHz: 20 + Math.max(0, -weight) * 8,
      lowpassHz: 21_500 - behavior * 450,
      crossfeed: 0.0015 + behavior * 0.0045,
    };
  }
  if (mode === 'SSL 4000E') {
    return {
      preCompression: 0.007 + behavior * 0.038,
      postCompression: 0.006 + character * 0.018,
      asymmetry: 0.0015 + behavior * 0.005,
      lowHz: 90,
      lowDb: weight - behavior * 0.08,
      highHz: 8500,
      highDb: presence * 1.2 + behavior * 0.08,
      highpassHz: 24,
      lowpassHz: 22_000,
      crossfeed: 0.001 + behavior * 0.003,
    };
  }
  return {
    preCompression: 0.006 + behavior * 0.028,
    postCompression: 0.005 + character * 0.018,
    asymmetry: 0.002 + behavior * 0.008,
    lowHz: 100,
    lowDb: weight * 1.3 + behavior * 0.12,
    highHz: 10_500,
    highDb: presence * 1.1 + behavior * 0.1,
    highpassHz: 22,
    lowpassHz: 21_800,
    crossfeed: 0.0008 + behavior * 0.0025,
  };
}

export function summingBusTransfer(input: number, compression: number, asymmetry: number): number {
  const comp = Math.max(0, Math.min(0.12, Math.round(compression * 512) / 512));
  const asym = Math.max(-0.08, Math.min(0.08, Math.round(asymmetry * 512) / 512));
  const even = asym * input * input * (1 - Math.abs(input));
  return Math.max(-1, Math.min(1, input - comp * input * input * input + even));
}

export interface Tascam424OperatingPoint {
  inputGain: number;
  preDrive: number;
  preAsymmetry: number;
  postDrive: number;
  postAsymmetry: number;
  outputGain: number;
  lowShelfHz: number;
  lowShelfDb: number;
  highShelfHz: number;
  highShelfDb: number;
  highpassHz: number;
  lowpassHz: number;
}

function normalizedTanhSlope(drive: number): number {
  const safeDrive = Math.max(1, drive);
  return safeDrive / Math.max(1e-6, Math.tanh(safeDrive));
}

export function hardwareAutoTrim(inputGain: number, ...stageSlopes: number[]): number {
  const transferGain = stageSlopes.reduce(
    (gain, slope) => gain * Math.max(1e-6, slope),
    Math.max(1e-6, inputGain),
  );
  return 1 / Math.max(1, transferGain);
}

export function opAmpSlope(drive: number): number {
  return normalizedTanhSlope(drive);
}

export function transformerSlope(drive: number): number {
  return normalizedTanhSlope(drive) * 0.985;
}

export function tapeSlope(drive: number): number {
  return normalizedTanhSlope(drive);
}

export function tascam424OperatingPoint(
  wear: number,
  wow: number,
  noise: number,
  tone: number,
): Tascam424OperatingPoint {
  const trimDrive = clamp01(wear);
  const channelDrive = clamp01(tone);
  const inputGain = 0.58 + trimDrive * 1.8;
  const preDrive = 1.02 + trimDrive * 2.2;
  const postDrive = 1 + Math.pow(channelDrive, 1.55) * 3.4;
  const nominalGain = Math.max(1, inputGain * preDrive * postDrive);
  const outputGain = Math.max(0.08, Math.min(1.1, Math.pow(nominalGain, -0.72)));
  return {
    inputGain,
    preDrive,
    preAsymmetry: 0.032,
    postDrive,
    postAsymmetry: 0.022 + trimDrive * 0.018,
    outputGain,
    lowShelfHz: 100,
    lowShelfDb: bipolarAroundDefault(clamp01(wow), 0.16) * 10,
    highShelfHz: 10_000,
    highShelfDb: bipolarAroundDefault(clamp01(noise), 0.1) * 10,
    highpassHz: 28,
    lowpassHz: 19_000,
  };
}

export function opAmpTransfer(input: number, drive: number, asymmetry: number): number {
  const safeDrive = Math.max(1, Math.round(drive * 128) / 128);
  const asym = Math.round(asymmetry * 512) / 512;
  const sideDrive = safeDrive * (input >= 0 ? 1 + asym : 1 - asym * 0.62);
  return Math.tanh(input * sideDrive) / Math.max(1e-6, Math.tanh(sideDrive));
}

export type Atr102Speed = 3.75 | 7.5 | 15 | 30;

export interface Atr102SpeedProfile {
  bumpHz: number;
  bumpDb: number;
  highpassHz: number;
  lowpassHz: number;
  wowHz: number;
  flutterHz: number;
  modDepth: number;
  noiseScale: number;
  driveScale: number;
}

export function atr102Speed(value: number): Atr102Speed {
  if (value < 0.08) return 3.75;
  if (value < 0.14) return 7.5;
  if (value < 0.62) return 15;
  return 30;
}

export function atr102SpeedProfile(speed: Atr102Speed): Atr102SpeedProfile {
  if (speed === 3.75) return { bumpHz: 48, bumpDb: 3.8, highpassHz: 38, lowpassHz: 11_800, wowHz: 0.16, flutterHz: 2.7, modDepth: 0.0019, noiseScale: 1.7, driveScale: 1.28 };
  if (speed === 7.5) return { bumpHz: 62, bumpDb: 3.0, highpassHz: 31, lowpassHz: 15_200, wowHz: 0.18, flutterHz: 3.1, modDepth: 0.00125, noiseScale: 1.35, driveScale: 1.14 };
  if (speed === 15) return { bumpHz: 82, bumpDb: 2.15, highpassHz: 27, lowpassHz: 18_900, wowHz: 0.21, flutterHz: 3.6, modDepth: 0.00068, noiseScale: 1, driveScale: 1 };
  return { bumpHz: 108, bumpDb: 1.05, highpassHz: 24, lowpassHz: 21_500, wowHz: 0.25, flutterHz: 4.2, modDepth: 0.00034, noiseScale: 0.72, driveScale: 0.82 };
}

export interface Atr102OperatingPoint extends Atr102SpeedProfile {
  speed: Atr102Speed;
  inputGain: number;
  preDrive: number;
  preAsymmetry: number;
  postDrive: number;
  bias: number;
  outputGain: number;
  highShelfHz: number;
  highShelfDb: number;
  finalLowpassHz: number;
  instabilitySeconds: number;
  hissGain: number;
}

export function atr102OperatingPoint(
  wear: number,
  wow: number,
  noise: number,
  tone: number,
): Atr102OperatingPoint {
  const record = clamp01(wear);
  const speed = atr102Speed(clamp01(wow));
  const speedProfile = atr102SpeedProfile(speed);
  const bias = (clamp01(tone) - 0.5) * 2;
  const inputGain = 0.9 + record * 2.8;
  const preDrive = 1.02 + record * 2.6;
  const postDrive = 1.05 + record * speedProfile.driveScale * 5.4;
  return {
    ...speedProfile,
    speed,
    inputGain,
    preDrive,
    preAsymmetry: 0.018,
    postDrive,
    bias,
    outputGain: hardwareAutoTrim(inputGain, transformerSlope(preDrive), tapeSlope(postDrive)),
    highShelfHz: 10_500,
    highShelfDb: bias * 1.8 - record * 0.45,
    finalLowpassHz: speedProfile.lowpassHz - Math.max(0, bias) * 650,
    instabilitySeconds: speedProfile.modDepth * (0.35 + record * 0.65),
    hissGain: clamp01(noise) ** 2 * speedProfile.noiseScale * 0.0085,
  };
}

export function transformerTransfer(input: number, drive: number, asymmetry: number): number {
  const safeDrive = Math.max(1, Math.round(drive * 128) / 128);
  const asym = Math.round(asymmetry * 512) / 512;
  const magneticCurvature = input * input * (input >= 0 ? 1 : -0.42);
  const compressed = Math.tanh((input + asym * magneticCurvature) * safeDrive) / Math.max(1e-6, Math.tanh(safeDrive));
  return Math.max(-1, Math.min(1, compressed * 0.985));
}

export function atrTapeTransfer(input: number, drive: number, bias: number): number {
  const safeDrive = Math.max(1, Math.round(drive * 128) / 128);
  const quantizedBias = Math.round(bias * 256) / 256;
  const biased = input + quantizedBias * 0.035 + input * input * (0.018 + quantizedBias * 0.012);
  const soft = Math.tanh(biased * safeDrive) / Math.max(1e-6, Math.tanh(safeDrive));
  const compression = 1 - Math.min(0.085, Math.abs(input) * 0.045 * safeDrive);
  return Math.max(-1, Math.min(1, soft * compression));
}
