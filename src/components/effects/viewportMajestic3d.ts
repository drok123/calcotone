import type { ModuleState } from '../../ui/types';

export type MajesticRGB = readonly [number, number, number];

export interface MajesticMotion {
  level: number;
  low: number;
  mid: number;
  high: number;
  transient: number;
}

export interface MajesticPalette {
  a: MajesticRGB;
  b: MajesticRGB;
  c: MajesticRGB;
  p: MajesticRGB;
  d: MajesticRGB;
}

export interface MajesticCamera {
  centerX: number;
  centerY: number;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  distance: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MajesticProjectedPoint {
  x: number;
  y: number;
  s: number;
  depth: number;
}

const TAU = Math.PI * 2;
const ROOM_X = 1.16;
const ROOM_Y = 0.86;
const ROOM_NEAR = -1.32;
const ROOM_FAR = 1.42;
const X_SCALE = 1.92;
const Y_SCALE = 1.36;

const clamp = (value: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, value));
const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;
const fract = (value: number): number => value - Math.floor(value);
const hash = (value: number): number => fract(Math.sin(value * 127.1) * 43758.5453123);
const rgba = (color: MajesticRGB, alpha: number): string =>
  `rgba(${color[0]},${color[1]},${color[2]},${clamp(alpha)})`;

function energy(motion: MajesticMotion): number {
  return clamp(
    motion.level * 0.52 +
      motion.low * 0.16 +
      motion.mid * 0.12 +
      motion.high * 0.07 +
      motion.transient * 0.16,
  );
}

export function createMajesticCamera(
  time: number,
  motion: MajesticMotion,
): MajesticCamera {
  const e = energy(motion);
  return {
    centerX: 120 + Math.sin(time * 0.061) * 1.25,
    centerY: 76 + Math.cos(time * 0.047) * 0.65 - motion.low * 0.7,
    yaw: Math.sin(time * 0.041) * 0.105 + (motion.mid - motion.high) * 0.016,
    pitch: -0.12 + Math.cos(time * 0.033) * 0.032 - motion.low * 0.012,
    roll: Math.sin(time * 0.025) * 0.008,
    fov: 105 + Math.sin(time * 0.029) * 2 + e * 3.3,
    distance: 3.2 - e * 0.075,
  };
}

function rotate(point: Vec3, camera: MajesticCamera): Vec3 {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const cr = Math.cos(camera.roll);
  const sr = Math.sin(camera.roll);

  const yawX = point.x * cy - point.z * sy;
  const yawZ = point.x * sy + point.z * cy;
  const pitchY = point.y * cp - yawZ * sp;
  const pitchZ = point.y * sp + yawZ * cp;
  return {
    x: yawX * cr - pitchY * sr,
    y: yawX * sr + pitchY * cr,
    z: pitchZ,
  };
}

function projectWorld(point: Vec3, camera: MajesticCamera): MajesticProjectedPoint {
  const rotated = rotate(point, camera);
  const denominator = Math.max(0.34, camera.distance + rotated.z);
  const perspective = camera.fov / denominator;
  const nearPerspective = camera.fov / Math.max(0.34, camera.distance + ROOM_NEAR);
  return {
    x: camera.centerX + rotated.x * perspective * X_SCALE,
    y: camera.centerY + rotated.y * perspective * Y_SCALE,
    s: clamp(perspective / nearPerspective, 0.2, 1.12),
    depth: rotated.z,
  };
}

export function projectMajesticPoint(
  x: number,
  y: number,
  normalizedDepth: number,
  camera: MajesticCamera,
): MajesticProjectedPoint {
  return projectWorld(
    { x, y, z: lerp(ROOM_NEAR, ROOM_FAR, clamp(normalizedDepth)) },
    camera,
  );
}

function stroke(
  context: CanvasRenderingContext2D,
  color: MajesticRGB,
  alpha: number,
  width = 0.7,
): void {
  context.strokeStyle = rgba(color, alpha);
  context.lineWidth = width;
}

function lineWorld(
  context: CanvasRenderingContext2D,
  a: Vec3,
  b: Vec3,
  camera: MajesticCamera,
): void {
  const pa = projectWorld(a, camera);
  const pb = projectWorld(b, camera);
  context.beginPath();
  context.moveTo(pa.x, pa.y);
  context.lineTo(pb.x, pb.y);
  context.stroke();
}

function glow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: MajesticRGB,
  radius: number,
  alpha: number,
  blur = 8,
): void {
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = rgba(color, alpha);
  context.shadowColor = rgba(color, Math.min(0.62, alpha * 1.8));
  context.shadowBlur = blur;
  context.beginPath();
  context.arc(x, y, radius, 0, TAU);
  context.fill();
  context.restore();
}

function drawAmbientVolume(
  context: CanvasRenderingContext2D,
  palette: MajesticPalette,
  motion: MajesticMotion,
  time: number,
): void {
  const e = energy(motion);
  const background = context.createLinearGradient(0, 0, 0, 150);
  background.addColorStop(0, rgba(palette.d, 1));
  background.addColorStop(0.48, 'rgb(3,6,17)');
  background.addColorStop(1, 'rgb(1,2,6)');
  context.fillStyle = background;
  context.fillRect(0, 0, 240, 150);

  const x = 120 + Math.sin(time * 0.05) * 2;
  const y = 74 + Math.cos(time * 0.039) * 1.2;
  const aura = context.createRadialGradient(x, y, 0, x, y, 108 + e * 10);
  aura.addColorStop(0, rgba(palette.a, 0.075 + e * 0.045));
  aura.addColorStop(0.28, rgba(palette.b, 0.027 + e * 0.024));
  aura.addColorStop(0.62, rgba(palette.a, 0.009));
  aura.addColorStop(1, rgba(palette.a, 0));
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = aura;
  context.fillRect(0, 0, 240, 150);
  context.restore();
}

function drawRoomGrid(
  context: CanvasRenderingContext2D,
  camera: MajesticCamera,
  palette: MajesticPalette,
  motion: MajesticMotion,
): void {
  const e = energy(motion);
  for (let index = 0; index <= 10; index += 1) {
    const q = index / 10;
    const x = lerp(-ROOM_X, ROOM_X, q);
    const major = index === 5 || index % 5 === 0;
    stroke(context, index % 2 ? palette.b : palette.a, (major ? 0.067 : 0.025) + e * 0.012, major ? 0.68 : 0.42);
    lineWorld(context, { x, y: ROOM_Y, z: ROOM_NEAR }, { x, y: ROOM_Y, z: ROOM_FAR }, camera);
    stroke(context, index % 2 ? palette.a : palette.b, (major ? 0.036 : 0.014) + e * 0.008, 0.42);
    lineWorld(context, { x, y: -ROOM_Y, z: ROOM_NEAR }, { x, y: -ROOM_Y, z: ROOM_FAR }, camera);
  }

  for (let index = 1; index < 10; index += 1) {
    const q = index / 10;
    const z = ROOM_FAR - (ROOM_FAR - ROOM_NEAR) * q * q;
    const near = 1 - q;
    const alpha = 0.018 + near * 0.036 + e * 0.009;
    stroke(context, index % 2 ? palette.a : palette.b, alpha, 0.42 + near * 0.12);
    lineWorld(context, { x: -ROOM_X, y: ROOM_Y, z }, { x: ROOM_X, y: ROOM_Y, z }, camera);
    stroke(context, palette.a, alpha * 0.55, 0.38);
    lineWorld(context, { x: -ROOM_X, y: -ROOM_Y, z }, { x: -ROOM_X, y: ROOM_Y, z }, camera);
    stroke(context, palette.b, alpha * 0.55, 0.38);
    lineWorld(context, { x: ROOM_X, y: -ROOM_Y, z }, { x: ROOM_X, y: ROOM_Y, z }, camera);
  }
}

function drawFarFrame(
  context: CanvasRenderingContext2D,
  camera: MajesticCamera,
  palette: MajesticPalette,
  motion: MajesticMotion,
): void {
  const e = energy(motion);
  const points: Vec3[] = [
    { x: -ROOM_X, y: -ROOM_Y, z: ROOM_FAR },
    { x: ROOM_X, y: -ROOM_Y, z: ROOM_FAR },
    { x: ROOM_X, y: ROOM_Y, z: ROOM_FAR },
    { x: -ROOM_X, y: ROOM_Y, z: ROOM_FAR },
  ];
  stroke(context, palette.p, 0.085 + e * 0.04, 0.65);
  for (let index = 0; index < points.length; index += 1) {
    lineWorld(context, points[index], points[(index + 1) % points.length], camera);
  }

  const innerScale = 0.73 + Math.sin(camera.yaw * 9) * 0.015;
  const inner: Vec3[] = points.map((point) => ({
    x: point.x * innerScale,
    y: point.y * innerScale,
    z: ROOM_FAR - 0.03,
  }));
  stroke(context, palette.a, 0.026 + e * 0.018, 0.45);
  for (let index = 0; index < inner.length; index += 1) {
    lineWorld(context, inner[index], inner[(index + 1) % inner.length], camera);
  }
}

function drawMotes(
  context: CanvasRenderingContext2D,
  camera: MajesticCamera,
  palette: MajesticPalette,
  motion: MajesticMotion,
  time: number,
): void {
  const e = energy(motion);
  for (let index = 0; index < 22; index += 1) {
    const speed = 0.014 + hash(index * 2.7 + 1.4) * 0.018;
    const travel = fract(hash(index * 8.1 + 0.3) + time * speed);
    const point = projectWorld(
      {
        x: lerp(-ROOM_X * 0.9, ROOM_X * 0.9, hash(index * 11.9 + 2.1)) + Math.sin(time * 0.07 + index) * 0.035,
        y: lerp(-ROOM_Y * 0.78, ROOM_Y * 0.82, hash(index * 6.3 + 7.8)),
        z: ROOM_FAR - travel * (ROOM_FAR - ROOM_NEAR),
      },
      camera,
    );
    const near = clamp(0.5 - point.depth * 0.24);
    const color = index % 6 === 0 ? palette.c : index % 2 ? palette.p : palette.a;
    glow(context, point.x, point.y, color, 0.25 + near * 0.7, 0.02 + near * 0.055 + e * 0.018, 3 + near * 4);
  }
}

function ringWorldPoints(
  radiusX: number,
  radiusY: number,
  count: number,
  yaw: number,
  pitch: number,
  phase: number,
): Vec3[] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const points: Vec3[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * TAU;
    const baseX = Math.cos(angle) * radiusX;
    const baseY = Math.sin(angle) * radiusY;
    const baseZ = Math.sin(angle * 2 + phase) * 0.035;
    const yawX = baseX * cy - baseZ * sy;
    const yawZ = baseX * sy + baseZ * cy;
    points.push({
      x: yawX,
      y: baseY * cp - yawZ * sp,
      z: baseY * sp + yawZ * cp,
    });
  }
  return points;
}

function drawDepthCurve(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  camera: MajesticCamera,
  palette: MajesticPalette,
  alpha: number,
  pass: 'back' | 'front',
  width = 0.72,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const a3 = points[index - 1];
    const b3 = points[index];
    const depth = (rotate(a3, camera).z + rotate(b3, camera).z) * 0.5;
    const front = depth < 0;
    if ((pass === 'front') !== front) continue;
    const a = projectWorld(a3, camera);
    const b = projectWorld(b3, camera);
    const near = clamp(0.5 - depth * 0.25);
    const color = index % 3 === 0 ? palette.b : index % 5 === 0 ? palette.c : palette.a;
    context.strokeStyle = rgba(color, alpha * (0.5 + near * 0.65));
    context.lineWidth = width * (0.82 + near * 0.38);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
}

function drawSculptureField(
  context: CanvasRenderingContext2D,
  module: ModuleState,
  camera: MajesticCamera,
  palette: MajesticPalette,
  motion: MajesticMotion,
  time: number,
  pass: 'back' | 'front',
): void {
  const e = energy(motion);
  context.save();
  context.globalCompositeOperation = 'screen';

  const genericRings = [
    ringWorldPoints(0.72, 0.44, 48, time * 0.065, 0.42, time * 0.12),
    ringWorldPoints(0.62, 0.56, 48, -time * 0.048 - 0.8, -0.5, -time * 0.1),
  ];
  for (let index = 0; index < genericRings.length; index += 1) {
    drawDepthCurve(context, genericRings[index], camera, palette, 0.058 + e * 0.026 - index * 0.01, pass, 0.64);
  }

  if (module.id === 'saturation') {
    const helix: Vec3[] = [];
    for (let index = 0; index <= 56; index += 1) {
      const q = index / 56;
      const angle = q * TAU * 2.4 + time * (0.18 + motion.low * 0.07);
      helix.push({ x: Math.cos(angle) * 0.52, y: lerp(-0.62, 0.62, q), z: Math.sin(angle) * 0.52 });
    }
    drawDepthCurve(context, helix, camera, { ...palette, a: palette.c }, 0.095 + e * 0.04, pass, 0.82);
  } else if (module.id === 'chorus') {
    const ring = ringWorldPoints(0.88, 0.5, 54, -time * 0.092, 0.88, time * 0.18);
    drawDepthCurve(context, ring, camera, { ...palette, a: palette.b, b: palette.a }, 0.08 + e * 0.03, pass, 0.78);
  } else if (module.id === 'delay') {
    for (let index = 0; index < 4; index += 1) {
      const q = index / 3;
      const ring = ringWorldPoints(0.34 + q * 0.58, 0.22 + q * 0.36, 40, time * 0.022 + index * 0.32, 0.18, index);
      for (const point of ring) point.z += lerp(0.62, -0.5, q);
      drawDepthCurve(context, ring, camera, palette, 0.042 + (1 - q) * 0.032 + e * 0.012, pass, 0.55);
    }
  } else if (module.id === 'reverb') {
    for (const latitude of [-0.55, -0.25, 0, 0.25, 0.55]) {
      const radius = 0.76;
      const latRadius = radius * Math.cos(latitude);
      const y = radius * Math.sin(latitude);
      const points: Vec3[] = [];
      for (let index = 0; index <= 48; index += 1) {
        const angle = (index / 48) * TAU + time * 0.018;
        points.push({ x: Math.cos(angle) * latRadius, y, z: Math.sin(angle) * latRadius });
      }
      drawDepthCurve(context, points, camera, palette, 0.038 + e * 0.022, pass, 0.52);
    }
  } else if (module.id === 'bitcrusher') {
    for (let index = 0; index < 24; index += 1) {
      const point3 = {
        x: lerp(-0.82, 0.82, hash(index * 7.3 + Math.floor(time * 3.5) * 0.03)),
        y: lerp(-0.5, 0.5, hash(index * 4.9 + 2.4)),
        z: lerp(-0.68, 0.68, hash(index * 5.8 + 7.2)),
      };
      const front = rotate(point3, camera).z < 0;
      if ((pass === 'front') !== front) continue;
      const point = projectWorld(point3, camera);
      const hot = hash(index * 1.9 + Math.floor(time * 4.1) * 0.17) > 0.85;
      context.fillStyle = rgba(hot ? palette.c : index % 2 ? palette.a : palette.b, hot ? 0.18 + e * 0.05 : 0.055 + e * 0.025);
      const size = hot ? 2.1 : 1;
      context.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
    }
  } else {
    const gyro = ringWorldPoints(0.82, 0.82, 56, time * 0.055, -0.62, time * 0.15);
    drawDepthCurve(context, gyro, camera, { ...palette, a: palette.c }, 0.075 + e * 0.028, pass, 0.72);
  }

  if (pass === 'front') {
    for (let index = 0; index < 3; index += 1) {
      const angle = time * (0.2 + index * 0.026) + index * 2.1;
      const point = projectWorld(
        {
          x: Math.cos(angle) * (0.48 + index * 0.12),
          y: Math.sin(angle * 0.71) * 0.38,
          z: -0.52 - index * 0.08,
        },
        camera,
      );
      glow(context, point.x, point.y, index % 2 ? palette.p : palette.a, 0.7 + motion.high * 0.2, 0.12 + motion.transient * 0.06, 7 + motion.transient * 4);
    }
  }

  context.restore();
}

function drawStageLight(
  context: CanvasRenderingContext2D,
  palette: MajesticPalette,
  motion: MajesticMotion,
  time: number,
): void {
  const e = energy(motion);
  const centerX = 120 + Math.sin(time * 0.055) * 0.8;
  const floorY = 119;

  context.save();
  context.globalCompositeOperation = 'screen';
  const beam = context.createLinearGradient(centerX, 12, centerX, floorY);
  beam.addColorStop(0, rgba(palette.p, 0));
  beam.addColorStop(0.2, rgba(palette.a, 0.011 + e * 0.011));
  beam.addColorStop(0.72, rgba(palette.b, 0.022 + e * 0.016));
  beam.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = beam;
  context.beginPath();
  context.moveTo(centerX - 10, 12);
  context.lineTo(centerX + 10, 12);
  context.lineTo(centerX + 40, floorY);
  context.lineTo(centerX - 40, floorY);
  context.closePath();
  context.fill();

  context.save();
  context.translate(centerX, floorY);
  context.scale(1, 0.2);
  const floor = context.createRadialGradient(0, 0, 0, 0, 0, 56);
  floor.addColorStop(0, rgba(palette.p, 0.065 + e * 0.055));
  floor.addColorStop(0.25, rgba(palette.a, 0.045 + e * 0.035));
  floor.addColorStop(0.58, rgba(palette.b, 0.015 + e * 0.018));
  floor.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = floor;
  context.beginPath();
  context.arc(0, 0, 56, 0, TAU);
  context.fill();
  context.restore();
  context.restore();
}

export function drawMajesticSceneBack(
  context: CanvasRenderingContext2D,
  module: ModuleState,
  camera: MajesticCamera,
  palette: MajesticPalette,
  motion: MajesticMotion,
  time: number,
): void {
  drawAmbientVolume(context, palette, motion, time);
  context.save();
  context.globalCompositeOperation = 'screen';
  drawRoomGrid(context, camera, palette, motion);
  drawFarFrame(context, camera, palette, motion);
  drawMotes(context, camera, palette, motion, time);
  context.restore();
  drawStageLight(context, palette, motion, time);
  drawSculptureField(context, module, camera, palette, motion, time, 'back');
}

export function drawMajesticSceneFront(
  context: CanvasRenderingContext2D,
  module: ModuleState,
  camera: MajesticCamera,
  palette: MajesticPalette,
  motion: MajesticMotion,
  time: number,
): void {
  drawSculptureField(context, module, camera, palette, motion, time, 'front');
  const e = energy(motion);
  const near: Vec3[] = [
    { x: -ROOM_X, y: -ROOM_Y, z: ROOM_NEAR },
    { x: ROOM_X, y: -ROOM_Y, z: ROOM_NEAR },
    { x: ROOM_X, y: ROOM_Y, z: ROOM_NEAR },
    { x: -ROOM_X, y: ROOM_Y, z: ROOM_NEAR },
  ];
  const far: Vec3[] = [
    { x: -ROOM_X, y: -ROOM_Y, z: ROOM_FAR },
    { x: ROOM_X, y: -ROOM_Y, z: ROOM_FAR },
    { x: ROOM_X, y: ROOM_Y, z: ROOM_FAR },
    { x: -ROOM_X, y: ROOM_Y, z: ROOM_FAR },
  ];

  context.save();
  context.globalCompositeOperation = 'screen';
  for (let index = 0; index < 4; index += 1) {
    const corner = near[index];
    const signX = corner.x < 0 ? 1 : -1;
    const signY = corner.y < 0 ? 1 : -1;
    stroke(context, index % 2 ? palette.b : palette.p, 0.09 + e * 0.055, 0.72);
    lineWorld(context, corner, { ...corner, x: corner.x + signX * 0.2 }, camera);
    lineWorld(context, corner, { ...corner, y: corner.y + signY * 0.2 }, camera);
    stroke(context, index % 2 ? palette.b : palette.a, 0.038 + e * 0.024, 0.5);
    lineWorld(context, far[index], near[index], camera);

    const projected = projectWorld(corner, camera);
    glow(context, projected.x, projected.y, index % 2 ? palette.b : palette.a, 0.72 + motion.transient * 0.2, 0.14 + e * 0.07, 6 + motion.transient * 4);
  }
  context.restore();

  context.fillStyle = 'rgba(0,0,0,.22)';
  context.beginPath();
  context.moveTo(0, 119);
  context.lineTo(22, 127);
  context.lineTo(28, 150);
  context.lineTo(0, 150);
  context.fill();
  context.beginPath();
  context.moveTo(240, 119);
  context.lineTo(218, 127);
  context.lineTo(212, 150);
  context.lineTo(240, 150);
  context.fill();

  const vignette = context.createLinearGradient(0, 0, 240, 0);
  vignette.addColorStop(0, 'rgba(0,0,0,.3)');
  vignette.addColorStop(0.055, 'transparent');
  vignette.addColorStop(0.945, 'transparent');
  vignette.addColorStop(1, 'rgba(0,0,0,.3)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, 240, 150);
}
