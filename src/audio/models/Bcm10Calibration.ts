export const BCM10_CAPTURE_REVISION = '2026-07-bcm10-hybrid-a';

const CAPTURE_SIZE = 2049;
const CAPTURE_CORNERS = [
  buildCaptureCorner(0.16, 0.22),
  buildCaptureCorner(0.84, 0.22),
  buildCaptureCorner(0.16, 0.82),
  buildCaptureCorner(0.84, 0.82),
] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function bipolarAroundDefault(value: number, center: number): number {
  if (value >= center) return (value - center) / Math.max(1e-6, 1 - center);
  return (value - center) / Math.max(1e-6, center);
}

export interface Bcm10OperatingPoint {
  inputGain: number;
  captureDrive: number;
  captureColor: number;
  busCompression: number;
  busAsymmetry: number;
  outputGain: number;
  lowHz: number;
  lowDb: number;
  highHz: number;
  highDb: number;
  highpassHz: number;
  lowpassHz: number;
  crossfeed: number;
}

/**
 * Neve BCM10 hybrid path.
 *
 * The static lattice represents the expensive 1073N class-A / Marinair channel
 * and output-transformer fingerprint. The live operating point preserves the
 * continuously variable 1272 voltage-mixing bus, channel loading, tone, and
 * stereo convergence used by Artifact's controls.
 */
export function bcm10OperatingPoint(
  wear: number,
  wow: number,
  noise: number,
  tone: number,
): Bcm10OperatingPoint {
  const loading = clamp01(wear);
  const weight = bipolarAroundDefault(clamp01(wow), 0.16);
  const presence = bipolarAroundDefault(clamp01(noise), 0.1);
  const drive = clamp01(tone);
  const inputGain = 0.9 + drive * 1.32 + loading * 0.22;
  const captureDrive = clamp01(0.12 + drive * 0.72 + loading * 0.16);
  const captureColor = clamp01(0.24 + loading * 0.48 + Math.max(0, weight) * 0.16);
  const busCompression = 0.012 + loading * 0.044 + drive * 0.018;
  const busAsymmetry = 0.009 + loading * 0.024 + drive * 0.008;
  return {
    inputGain,
    captureDrive,
    captureColor,
    busCompression,
    busAsymmetry,
    outputGain: 1 / Math.max(1, inputGain * (1.035 + drive * 0.18)),
    lowHz: 105,
    lowDb: 0.35 + weight * 1.85 + loading * 0.28,
    highHz: 11_500,
    highDb: presence * 1.28 - loading * 0.18 + drive * 0.12,
    highpassHz: 19 + Math.max(0, -weight) * 8,
    lowpassHz: 21_200 - loading * 720,
    crossfeed: 0.0022 + loading * 0.0062 + drive * 0.0012,
  };
}

/** Runtime lookup/interpolation of the lossless float capture lattice. */
export function bcm10CaptureTransfer(input: number, drive: number, color: number): number {
  const x = Math.max(-1, Math.min(1, Number.isFinite(input) ? input : 0));
  const d = clamp01(drive);
  const c = clamp01(color);
  const lowDrive = sampleCapture(CAPTURE_CORNERS[0], x) * (1 - c)
    + sampleCapture(CAPTURE_CORNERS[2], x) * c;
  const highDrive = sampleCapture(CAPTURE_CORNERS[1], x) * (1 - c)
    + sampleCapture(CAPTURE_CORNERS[3], x) * c;
  return Math.max(-1, Math.min(1, lowDrive * (1 - d) + highDrive * d));
}

export function bcm10CaptureFingerprint(): readonly Float32Array[] {
  return CAPTURE_CORNERS;
}

function sampleCapture(capture: Float32Array, input: number): number {
  const position = (input * 0.5 + 0.5) * (capture.length - 1);
  const index = Math.max(0, Math.min(capture.length - 2, Math.floor(position)));
  const fraction = position - index;
  return capture[index] * (1 - fraction) + capture[index + 1] * fraction;
}

function buildCaptureCorner(drive: number, color: number): Float32Array {
  const capture = new Float32Array(CAPTURE_SIZE);
  for (let index = 0; index < capture.length; index += 1) {
    const input = (index / (capture.length - 1)) * 2 - 1;
    capture[index] = referenceChannelAndTransformer(input, drive, color);
  }
  return capture;
}

/** Offline reference used once to construct the capture lattice at module load. */
function referenceChannelAndTransformer(input: number, drive: number, color: number): number {
  const channelDrive = 1.18 + drive * 4.1;
  const channelAsymmetry = 0.018 + color * 0.055;
  const positiveScale = 1 + channelAsymmetry;
  const negativeScale = 1 - channelAsymmetry * 0.58;
  const channel = Math.tanh(input * channelDrive * (input >= 0 ? positiveScale : negativeScale))
    / Math.max(1e-6, Math.tanh(channelDrive));

  const coreDrive = 1.08 + color * 3.25 + drive * 0.7;
  const memorylessHysteresis = channel + (channel * channel * channel - channel) * (0.018 + color * 0.032);
  const evenOrder = Math.max(0, memorylessHysteresis) ** 2 * (0.008 + color * 0.018);
  const transformer = Math.tanh((memorylessHysteresis + evenOrder) * coreDrive)
    / Math.max(1e-6, Math.tanh(coreDrive));
  return Math.max(-1, Math.min(1, transformer * (0.985 - color * 0.018)));
}
