import type { MotionCurve, XYAssignment } from './types';
import { clamp } from './math';
export function shapeMotionSource(value: number, curve: MotionCurve): number {
  const safe = clamp(value, 0, 1);
  if (curve === 'soft') return safe * safe * (3 - 2 * safe);
  if (curve === 'exponential') return safe * safe;
  if (curve === 'stepped') return Math.round(safe * 4) / 4;
  return safe;
}
export function getEffectiveMotionValue(baseValue: number, assignment: XYAssignment, position: { x: number; y: number }): number {
  const source = assignment.axis === 'x' ? position.x / 100 : position.y / 100;
  const shaped = shapeMotionSource(assignment.inverted ? 1 - source : source, assignment.curve ?? 'linear');
  return clamp(baseValue + (shaped * 2 - 1) * 0.5 * assignment.depth, assignment.min ?? 0, assignment.max ?? 1);
}
