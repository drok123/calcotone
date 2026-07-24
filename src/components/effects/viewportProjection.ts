export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
  visible: boolean;
}

export interface ViewportCamera {
  centerX: number;
  centerY: number;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  distance: number;
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;
export const lerp3 = (a: Vec3, b: Vec3, amount: number): Vec3 => ({
  x: lerp(a.x, b.x, amount),
  y: lerp(a.y, b.y, amount),
  z: lerp(a.z, b.z, amount),
});

export function rotate3(point: Vec3, camera: ViewportCamera): Vec3 {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const cr = Math.cos(camera.roll);
  const sr = Math.sin(camera.roll);

  // World yaw.
  const yawX = point.x * cy - point.z * sy;
  const yawZ = point.x * sy + point.z * cy;

  // Camera pitch.
  const pitchY = point.y * cp - yawZ * sp;
  const pitchZ = point.y * sp + yawZ * cp;

  // Subtle camera roll is useful for a floating-console feel, but is deliberately tiny.
  return {
    x: yawX * cr - pitchY * sr,
    y: yawX * sr + pitchY * cr,
    z: pitchZ,
  };
}

export function project3(
  point: Vec3,
  camera: ViewportCamera,
  worldScale = 1,
): ProjectedPoint {
  const rotated = rotate3(point, camera);
  const denominator = Math.max(0.34, camera.distance + rotated.z);
  const perspective = camera.fov / denominator;
  return {
    x: camera.centerX + rotated.x * perspective * worldScale,
    y: camera.centerY + rotated.y * perspective * worldScale,
    depth: rotated.z,
    scale: perspective,
    visible: denominator > 0.36,
  };
}

export function depthAlpha(depth: number, near = -1.8, far = 1.8): number {
  return clamp01(1 - (depth - near) / Math.max(0.0001, far - near));
}

export function makeViewportCamera(
  width: number,
  height: number,
  time: number,
  energy: number,
): ViewportCamera {
  return {
    centerX: width * 0.5 + Math.sin(time * 0.067) * 1.25,
    centerY: height * 0.505 + Math.cos(time * 0.053) * 0.7,
    yaw: Math.sin(time * 0.043) * 0.115 + Math.sin(time * 0.017) * 0.035,
    pitch: -0.115 + Math.cos(time * 0.037) * 0.035 - energy * 0.018,
    roll: Math.sin(time * 0.027) * 0.008,
    fov: 104 + Math.sin(time * 0.031) * 2.2 + energy * 3.5,
    distance: 3.55 - energy * 0.08,
  };
}

export function line3(
  context: CanvasRenderingContext2D,
  a: Vec3,
  b: Vec3,
  camera: ViewportCamera,
  worldScale = 1,
): { a: ProjectedPoint; b: ProjectedPoint } {
  const pa = project3(a, camera, worldScale);
  const pb = project3(b, camera, worldScale);
  context.beginPath();
  context.moveTo(pa.x, pa.y);
  context.lineTo(pb.x, pb.y);
  context.stroke();
  return { a: pa, b: pb };
}

export function polyline3(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  camera: ViewportCamera,
  worldScale = 1,
  close = false,
): void {
  if (points.length === 0) return;
  const first = project3(points[0], camera, worldScale);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = project3(points[index], camera, worldScale);
    context.lineTo(point.x, point.y);
  }
  if (close) context.closePath();
  context.stroke();
}
