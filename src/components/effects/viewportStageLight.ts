import type { ViewportRoomMotion, ViewportRoomPalette } from './viewportRoom';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const rgba = (color: readonly [number, number, number], alpha: number): string =>
  `rgba(${color[0]},${color[1]},${color[2]},${clamp01(alpha)})`;

/**
 * Quiet cinematic lighting shared by every module scene.
 *
 * The room supplies perspective and architecture; this pass gives the animated effect a
 * physical place to exist inside it: a soft overhead volume, a floor pool and a restrained
 * contact glow. It deliberately avoids outlines around the artwork so the individual
 * module renderer remains the hero.
 */
export function drawViewportStageLight(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
): void {
  const energy = clamp01(motion.level * 0.7 + motion.low * 0.2 + motion.transient * 0.18);
  const breathing = 0.5 + Math.sin(time * 0.12) * 0.5;
  const centerX = width * 0.5 + Math.sin(time * 0.055) * 0.8;
  const floorY = height * 0.795;

  context.save();
  context.globalCompositeOperation = 'screen';

  // Thin, barely visible overhead volume. Reverb gets a wider shaft; Grain remains tighter.
  const beamHalfWidth = moduleId === 'reverb' ? 42 : moduleId === 'bitcrusher' ? 26 : 34;
  const beam = context.createLinearGradient(centerX, height * 0.08, centerX, floorY);
  beam.addColorStop(0, rgba(palette.pale, 0));
  beam.addColorStop(0.2, rgba(palette.a, 0.012 + energy * 0.012));
  beam.addColorStop(0.72, rgba(palette.b, 0.025 + energy * 0.018));
  beam.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = beam;
  context.beginPath();
  context.moveTo(centerX - beamHalfWidth * 0.32, height * 0.08);
  context.lineTo(centerX + beamHalfWidth * 0.32, height * 0.08);
  context.lineTo(centerX + beamHalfWidth, floorY);
  context.lineTo(centerX - beamHalfWidth, floorY);
  context.closePath();
  context.fill();

  // Floor light well. The shallow ellipse is what makes the central animation feel like it
  // is floating above a surface rather than simply being scaled down in the middle.
  context.save();
  context.translate(centerX, floorY);
  context.scale(1, 0.22);
  const floorGlow = context.createRadialGradient(0, 0, 0, 0, 0, 62);
  floorGlow.addColorStop(0, rgba(palette.pale, 0.075 + energy * 0.065));
  floorGlow.addColorStop(0.24, rgba(palette.a, 0.055 + energy * 0.045));
  floorGlow.addColorStop(0.58, rgba(palette.b, 0.018 + energy * 0.02));
  floorGlow.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = floorGlow;
  context.beginPath();
  context.arc(0, 0, 62, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // A tiny contact core gives transients somewhere to land without brightness pumping the room.
  const core = context.createRadialGradient(centerX, floorY, 0, centerX, floorY, 18);
  core.addColorStop(
    0,
    rgba(palette.warm, 0.035 + energy * 0.05 + breathing * 0.008),
  );
  core.addColorStop(1, rgba(palette.warm, 0));
  context.fillStyle = core;
  context.fillRect(centerX - 20, floorY - 6, 40, 12);

  context.restore();
}
