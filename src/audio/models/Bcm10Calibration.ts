export const BCM10_CAPTURE_REVISION = '2026-08-bcm10-level-matched-b';

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
  // Tone pushes the captured channel into its knee, while the reciprocal trim
  // keeps the low-level wet path at unity. The former model normalized every
  // nonlinear stage at full scale, which accidentally added 14-23 dB around
  // zero and made the Mix control behave like another drive control.
  const inputGain = 0.96 + drive * 0.72 + loading * 0.12;
  const captureDrive = clamp01(0.12 + drive * 0.58 + loading * 0.1);
  const captureColor = clamp01(0.22 + loading * 0.44 + Math.max(0, weight) * 0.14);
  const busCompression = 0.012 + loading * 0.044 + drive * 0.018;
  const busAsymmetry = 0.009 + loading * 0.024 + drive * 0.008;
  return {
    inputGain,
    captureDrive,
    captureColor,
    busCompression,
    busAsymmetry,
    outputGain: 1 / Math.max(1e-6, inputGain),
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
  const y0 = capture[Math.max(0, index - 1)];
  const y1 = capture[index];
  const y2 = capture[index + 1];
  const y3 = capture[Math.min(capture.length - 1, index + 2)];
  const fraction2 = fraction * fraction;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return a0 * fraction * fraction2 + a1 * fraction2 + a2 * fraction + y1;
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
  const channelDrive = 1.1 + drive * 3;
  const channelAsymmetry = 0.012 + color * 0.038;
  const positiveScale = 1 + channelAsymmetry;
  const negativeScale = 1 - channelAsymmetry * 0.58;
  const sideScale = input >= 0 ? positiveScale : negativeScale;
  const channelSoft = Math.tanh(input * channelDrive * sideScale)
    / Math.max(1e-6, channelDrive * sideScale);
  const channelBlend = 0.18 + drive * 0.38;
  const channel = input + (channelSoft - input) * channelBlend;

  const coreDrive = 1.05 + color * 2.4 + drive * 0.45;
  const transformerSoft = Math.tanh(channel * coreDrive) / Math.max(1e-6, coreDrive);
  const transformerBlend = 0.12 + color * 0.28 + drive * 0.06;
  const transformer = channel + (transformerSoft - channel) * transformerBlend;
  const evenOrder = Math.max(0, transformer) ** 2 * (0.004 + color * 0.008);
  return Math.max(-1, Math.min(1, transformer + evenOrder));
}
