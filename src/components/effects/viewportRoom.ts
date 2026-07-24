import {
  clamp01,
  depthAlpha,
  lerp,
  line3,
  makeViewportCamera,
  polyline3,
  project3,
  type Vec3,
  type ViewportCamera,
} from './viewportProjection';

export type ViewportRoomColor = readonly [number, number, number];

export interface ViewportRoomPalette {
  a: ViewportRoomColor;
  b: ViewportRoomColor;
  warm: ViewportRoomColor;
  pale: ViewportRoomColor;
}

export interface ViewportRoomMotion {
  level: number;
  low: number;
  mid: number;
  high: number;
  transient: number;
}

export interface ViewportSculptureTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  shearX: number;
  shearY: number;
}

const TAU = Math.PI * 2;
const ROOM_X = 1.56;
const ROOM_Y = 0.92;
const ROOM_NEAR_Z = -1.46;
const ROOM_FAR_Z = 1.48;
const WORLD_SCALE = 1;

const fract = (value: number): number => value - Math.floor(value);
const hash = (value: number): number => fract(Math.sin(value * 127.1) * 43758.5453123);
const rgba = (color: ViewportRoomColor, alpha: number): string =>
  `rgba(${color[0]},${color[1]},${color[2]},${clamp01(alpha)})`;

function energyOf(motion: ViewportRoomMotion): number {
  return clamp01(
    motion.level * 0.58 +
      motion.low * 0.17 +
      motion.mid * 0.13 +
      motion.high * 0.05 +
      motion.transient * 0.12,
  );
}

function sceneCamera(
  width: number,
  height: number,
  time: number,
  motion: ViewportRoomMotion,
): ViewportCamera {
  const camera = makeViewportCamera(width, height, time, energyOf(motion));
  camera.yaw += (motion.mid - motion.high) * 0.018;
  camera.pitch -= motion.low * 0.012;
  camera.centerY -= motion.low * 0.8;
  return camera;
}

function stroke(
  context: CanvasRenderingContext2D,
  color: ViewportRoomColor,
  alpha: number,
  width = 1,
): void {
  context.strokeStyle = rgba(color, alpha);
  context.lineWidth = width;
}

function drawBackWallAura(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ViewportRoomPalette,
  camera: ViewportCamera,
  energy: number,
): void {
  const backCenter = project3({ x: 0, y: -0.02, z: ROOM_FAR_Z }, camera, WORLD_SCALE);
  const radius = Math.min(width, height) * (0.46 + energy * 0.06);
  const glow = context.createRadialGradient(
    backCenter.x,
    backCenter.y,
    0,
    backCenter.x,
    backCenter.y,
    radius,
  );
  glow.addColorStop(0, rgba(palette.a, 0.085 + energy * 0.055));
  glow.addColorStop(0.28, rgba(palette.b, 0.045 + energy * 0.032));
  glow.addColorStop(0.68, rgba(palette.a, 0.012));
  glow.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
}

function drawDepthGrid(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  palette: ViewportRoomPalette,
  motion: ViewportRoomMotion,
): void {
  const energy = energyOf(motion);
  const depthSteps = 10;
  const widthSteps = 10;

  // Floor + ceiling longitudinal rays.
  for (let index = 0; index <= widthSteps; index += 1) {
    const q = index / widthSteps;
    const x = lerp(-ROOM_X, ROOM_X, q);
    const primary = index === Math.floor(widthSteps / 2) || index % 5 === 0;
    stroke(
      context,
      index % 2 ? palette.b : palette.a,
      (primary ? 0.075 : 0.036) + energy * (primary ? 0.025 : 0.01),
      primary ? 0.72 : 0.48,
    );
    line3(
      context,
      { x, y: ROOM_Y, z: ROOM_NEAR_Z },
      { x, y: ROOM_Y, z: ROOM_FAR_Z },
      camera,
      WORLD_SCALE,
    );
    stroke(
      context,
      index % 2 ? palette.a : palette.b,
      (primary ? 0.045 : 0.022) + energy * 0.008,
      primary ? 0.58 : 0.42,
    );
    line3(
      context,
      { x, y: -ROOM_Y, z: ROOM_NEAR_Z },
      { x, y: -ROOM_Y, z: ROOM_FAR_Z },
      camera,
      WORLD_SCALE,
    );
  }

  // Perspective depth rings. Quadratic spacing pushes more information toward the camera,
  // which makes the chamber feel physically long instead of like one trapezoid.
  for (let index = 1; index < depthSteps; index += 1) {
    const q = index / depthSteps;
    const z = ROOM_FAR_Z - (ROOM_FAR_Z - ROOM_NEAR_Z) * q * q;
    const nearStrength = 1 - q;
    const alpha = 0.026 + nearStrength * 0.035 + energy * 0.012;
    stroke(context, index % 2 ? palette.a : palette.b, alpha, 0.48 + nearStrength * 0.14);
    line3(context, { x: -ROOM_X, y: ROOM_Y, z }, { x: ROOM_X, y: ROOM_Y, z }, camera);
    stroke(context, index % 2 ? palette.b : palette.a, alpha * 0.72, 0.45);
    line3(context, { x: -ROOM_X, y: -ROOM_Y, z }, { x: ROOM_X, y: -ROOM_Y, z }, camera);
    stroke(context, palette.a, alpha * 0.56, 0.42);
    line3(context, { x: -ROOM_X, y: -ROOM_Y, z }, { x: -ROOM_X, y: ROOM_Y, z }, camera);
    stroke(context, palette.b, alpha * 0.56, 0.42);
    line3(context, { x: ROOM_X, y: -ROOM_Y, z }, { x: ROOM_X, y: ROOM_Y, z }, camera);
  }
}

function drawFarFrame(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  palette: ViewportRoomPalette,
  motion: ViewportRoomMotion,
): void {
  const energy = energyOf(motion);
  const far: Vec3[] = [
    { x: -ROOM_X, y: -ROOM_Y, z: ROOM_FAR_Z },
    { x: ROOM_X, y: -ROOM_Y, z: ROOM_FAR_Z },
    { x: ROOM_X, y: ROOM_Y, z: ROOM_FAR_Z },
    { x: -ROOM_X, y: ROOM_Y, z: ROOM_FAR_Z },
  ];
  stroke(context, palette.pale, 0.11 + energy * 0.05, 0.72);
  polyline3(context, far, camera, WORLD_SCALE, true);

  // A second floating inner frame is the visual equivalent of the PS3-era deep-space
  // boot geometry: very simple, very centered, but obviously existing behind the sculpture.
  const pulse = 0.78 + Math.sin((camera.yaw + camera.pitch) * 7) * 0.015;
  const inner: Vec3[] = [
    { x: -ROOM_X * pulse, y: -ROOM_Y * pulse, z: ROOM_FAR_Z - 0.02 },
    { x: ROOM_X * pulse, y: -ROOM_Y * pulse, z: ROOM_FAR_Z - 0.02 },
    { x: ROOM_X * pulse, y: ROOM_Y * pulse, z: ROOM_FAR_Z - 0.02 },
    { x: -ROOM_X * pulse, y: ROOM_Y * pulse, z: ROOM_FAR_Z - 0.02 },
  ];
  stroke(context, palette.a, 0.035 + energy * 0.018, 0.48);
  polyline3(context, inner, camera, WORLD_SCALE, true);
}

function drawDepthMotes(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  palette: ViewportRoomPalette,
  time: number,
  motion: ViewportRoomMotion,
): void {
  const energy = energyOf(motion);
  for (let index = 0; index < 25; index += 1) {
    const speed = 0.018 + hash(index * 2.81 + 4.2) * 0.024;
    const depthCycle = fract(hash(index * 8.19 + 0.73) + time * speed);
    const z = ROOM_FAR_Z - depthCycle * (ROOM_FAR_Z - ROOM_NEAR_Z);
    const drift = Math.sin(time * (0.08 + hash(index * 1.77) * 0.05) + index) * 0.07;
    const point: Vec3 = {
      x: lerp(-ROOM_X * 0.88, ROOM_X * 0.88, hash(index * 11.27 + 1.3)) + drift,
      y: lerp(-ROOM_Y * 0.78, ROOM_Y * 0.82, hash(index * 6.71 + 8.2)) + drift * 0.35,
      z,
    };
    const projected = project3(point, camera, WORLD_SCALE);
    const near = depthAlpha(projected.depth, ROOM_NEAR_Z, ROOM_FAR_Z);
    const radius = 0.34 + near * 1.05 + motion.transient * 0.16;
    const alpha = 0.03 + near * 0.12 + energy * 0.022;
    const color = index % 6 === 0 ? palette.pale : index % 2 ? palette.b : palette.a;
    context.save();
    context.fillStyle = rgba(color, alpha);
    context.shadowColor = rgba(color, alpha * 1.7);
    context.shadowBlur = 2 + near * 6;
    context.beginPath();
    context.arc(projected.x, projected.y, radius, 0, TAU);
    context.fill();
    context.restore();
  }
}

function drawModuleArchitecture(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
): void {
  const energy = energyOf(motion);

  if (moduleId === 'delay') {
    for (let index = 0; index < 7; index += 1) {
      const z = ROOM_FAR_Z - 0.22 - index * 0.34;
      const shrink = 0.9 - index * 0.035;
      const frame: Vec3[] = [
        { x: -ROOM_X * shrink, y: -ROOM_Y * shrink, z },
        { x: ROOM_X * shrink, y: -ROOM_Y * shrink, z },
        { x: ROOM_X * shrink, y: ROOM_Y * shrink, z },
        { x: -ROOM_X * shrink, y: ROOM_Y * shrink, z },
      ];
      stroke(context, index % 2 ? palette.b : palette.a, 0.025 + (7 - index) * 0.006 + energy * 0.01, 0.52);
      polyline3(context, frame, camera, WORLD_SCALE, true);
    }
    return;
  }

  if (moduleId === 'chorus') {
    for (let lane = 0; lane < 3; lane += 1) {
      const points: Vec3[] = [];
      for (let index = 0; index <= 42; index += 1) {
        const q = index / 42;
        points.push({
          x: lerp(-ROOM_X * 0.9, ROOM_X * 0.9, q),
          y: Math.sin(q * TAU * 1.45 + time * 0.16 + lane * 1.7) * (0.2 + lane * 0.035),
          z: ROOM_FAR_Z - q * 2.35 + Math.cos(q * TAU + lane) * 0.12,
        });
      }
      stroke(context, lane % 2 ? palette.b : palette.a, 0.055 + energy * 0.018, 0.62);
      polyline3(context, points, camera);
    }
    return;
  }

  if (moduleId === 'saturation') {
    for (let index = -1; index <= 1; index += 1) {
      const x = index * 0.58;
      const phase = fract(time * (0.08 + (index + 1) * 0.008) + index * 0.19);
      const y = ROOM_Y * 0.72 - phase * ROOM_Y * 1.44;
      stroke(context, index === 0 ? palette.warm : palette.a, 0.07 + energy * 0.025, 0.6);
      line3(
        context,
        { x, y: -ROOM_Y * 0.68, z: 0.84 },
        { x, y: ROOM_Y * 0.68, z: 0.84 },
        camera,
      );
      const spark = project3({ x, y, z: 0.74 }, camera);
      context.fillStyle = rgba(palette.pale, 0.16 + motion.transient * 0.08);
      context.fillRect(spark.x - 0.7, spark.y - 0.7, 1.4, 1.4);
    }
    return;
  }

  if (moduleId === 'reverb') {
    context.save();
    context.globalCompositeOperation = 'screen';
    for (let index = 0; index < 5; index += 1) {
      const x = lerp(-1.1, 1.1, index / 4);
      const top = project3({ x, y: -0.92, z: 1.1 }, camera);
      const bottom = project3({ x: x * 0.25, y: 0.82, z: -0.5 }, camera);
      const beam = context.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
      beam.addColorStop(0, rgba(index % 2 ? palette.b : palette.a, 0.052 + energy * 0.025));
      beam.addColorStop(1, rgba(palette.a, 0));
      context.strokeStyle = beam;
      context.lineWidth = 1.3 + motion.mid * 0.8;
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(bottom.x, bottom.y);
      context.stroke();
    }
    context.restore();
    return;
  }

  if (moduleId === 'bitcrusher') {
    const step = Math.floor(time * (3.5 + motion.high * 2.5));
    for (let index = 0; index < 32; index += 1) {
      const active = hash(index * 2.1 + step * 0.31);
      if (active < 0.72) continue;
      const point = project3(
        {
          x: lerp(-1.25, 1.25, hash(index * 9.1 + 0.3)),
          y: lerp(-0.7, 0.7, hash(index * 4.4 + 1.7)),
          z: lerp(-0.35, 1.2, hash(index * 7.8 + 3.2)),
        },
        camera,
      );
      const size = active > 0.93 ? 2 : 1;
      context.fillStyle = rgba(active > 0.93 ? palette.pale : palette.a, 0.045 + energy * 0.04);
      context.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
    }
    return;
  }

  // Artifact: floating calibration rails in the back half of the chamber.
  for (let index = 0; index <= 8; index += 1) {
    const q = index / 8;
    const x = lerp(-1.15, 1.15, q);
    stroke(context, index % 2 ? palette.warm : palette.a, 0.04 + energy * 0.014, 0.48);
    line3(
      context,
      { x, y: 0.71, z: 0.65 },
      { x, y: 0.71 - (index % 2 ? 0.05 : 0.09), z: 0.65 },
      camera,
    );
  }
}

export function drawViewportRoomBack(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
): void {
  const energy = energyOf(motion);
  const camera = sceneCamera(width, height, time, motion);

  context.save();
  context.globalCompositeOperation = 'screen';
  drawBackWallAura(context, width, height, palette, camera, energy);
  drawDepthGrid(context, camera, palette, motion);
  drawFarFrame(context, camera, palette, motion);
  drawModuleArchitecture(context, camera, moduleId, time, motion, palette);
  drawDepthMotes(context, camera, palette, time, motion);
  context.restore();
}

export function drawViewportRoomFront(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
): void {
  const camera = sceneCamera(width, height, time, motion);
  const energy = energyOf(motion);
  const corners: Vec3[] = [
    { x: -ROOM_X, y: -ROOM_Y, z: ROOM_NEAR_Z },
    { x: ROOM_X, y: -ROOM_Y, z: ROOM_NEAR_Z },
    { x: ROOM_X, y: ROOM_Y, z: ROOM_NEAR_Z },
    { x: -ROOM_X, y: ROOM_Y, z: ROOM_NEAR_Z },
  ];
  const farCorners: Vec3[] = [
    { x: -ROOM_X, y: -ROOM_Y, z: ROOM_FAR_Z },
    { x: ROOM_X, y: -ROOM_Y, z: ROOM_FAR_Z },
    { x: ROOM_X, y: ROOM_Y, z: ROOM_FAR_Z },
    { x: -ROOM_X, y: ROOM_Y, z: ROOM_FAR_Z },
  ];

  context.save();
  context.globalCompositeOperation = 'screen';

  // Front plane is intentionally broken into corner brackets. A full rectangle would make the
  // scene read like a HUD; these incomplete near edges feel like a glass room passing the camera.
  const projected = corners.map((corner) => project3(corner, camera));
  const bracket = 0.22;
  for (let index = 0; index < 4; index += 1) {
    const corner = corners[index];
    const signX = corner.x < 0 ? 1 : -1;
    const signY = corner.y < 0 ? 1 : -1;
    stroke(context, index % 2 ? palette.b : palette.pale, 0.11 + energy * 0.065, 0.74);
    line3(context, corner, { ...corner, x: corner.x + signX * bracket }, camera);
    line3(context, corner, { ...corner, y: corner.y + signY * bracket }, camera);
  }

  // Long rails are true XYZ edges. Their depth gradient is represented by low-alpha back ends
  // and brighter near ends, so they visually pass around the 2D sculpture in the center.
  for (let index = 0; index < 4; index += 1) {
    stroke(context, index % 2 ? palette.b : palette.a, 0.045 + energy * 0.03, 0.56);
    line3(context, farCorners[index], corners[index], camera);
  }

  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const color = index % 2 ? palette.b : palette.a;
    context.save();
    context.fillStyle = rgba(color, 0.18 + energy * 0.08);
    context.shadowColor = rgba(color, 0.31 + energy * 0.09);
    context.shadowBlur = 7 + motion.transient * 3;
    context.beginPath();
    context.arc(point.x, point.y, 0.9 + motion.transient * 0.24, 0, TAU);
    context.fill();
    context.restore();
  }

  // One near-field traveling spark sells the camera distance more than another dozen grid lines.
  const travel = fract(time * 0.08);
  const edgePoint = project3(
    {
      x: ROOM_X,
      y: lerp(-ROOM_Y * 0.72, ROOM_Y * 0.72, travel),
      z: ROOM_NEAR_Z + 0.02,
    },
    camera,
  );
  context.save();
  context.fillStyle = rgba(palette.pale, 0.21 + energy * 0.08);
  context.shadowColor = rgba(palette.a, 0.33 + energy * 0.12);
  context.shadowBlur = 9;
  context.beginPath();
  context.arc(edgePoint.x, edgePoint.y, 0.7 + motion.high * 0.35, 0, TAU);
  context.fill();
  context.restore();

  context.restore();
}

export function getViewportSculptureTransform(
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
): ViewportSculptureTransform {
  const transient = clamp01(motion.transient);
  const level = clamp01(motion.level);
  const mid = clamp01(motion.mid);
  const high = clamp01(motion.high);

  if (moduleId === 'saturation') {
    return {
      x: Math.sin(time * 0.09) * 1.1,
      y: -3.5 - motion.low * 2.2 + Math.cos(time * 0.12) * 0.7,
      scale: 0.73 + level * 0.028 + transient * 0.016,
      rotation: Math.sin(time * 0.06) * 0.01,
      shearX: Math.sin(time * 0.045) * 0.025,
      shearY: -0.01,
    };
  }

  if (moduleId === 'chorus') {
    return {
      x: Math.sin(time * 0.19) * (2.0 + mid * 1.4),
      y: Math.cos(time * 0.13) * 1.2,
      scale: 0.75 + level * 0.018,
      rotation: Math.sin(time * 0.12) * 0.018,
      shearX: Math.sin(time * 0.15) * 0.035,
      shearY: Math.cos(time * 0.11) * 0.012,
    };
  }

  if (moduleId === 'delay') {
    return {
      x: Math.sin(time * 0.065) * 1.45,
      y: Math.cos(time * 0.052) * 0.85 - motion.low,
      scale: 0.72 + level * 0.018 + transient * 0.028,
      rotation: Math.sin(time * 0.041) * 0.007,
      shearX: Math.sin(time * 0.035) * 0.02,
      shearY: 0,
    };
  }

  if (moduleId === 'reverb') {
    return {
      x: Math.sin(time * 0.07) * 0.9,
      y: Math.sin(time * 0.105) * 2.2 - motion.mid * 1.4,
      scale: 0.78 + level * 0.025,
      rotation: Math.sin(time * 0.047) * 0.009,
      shearX: Math.sin(time * 0.038) * 0.018,
      shearY: Math.cos(time * 0.03) * 0.012,
    };
  }

  if (moduleId === 'bitcrusher') {
    const stepped = Math.round(Math.sin(time * 3.4) * 3) * 0.18 * high;
    return {
      x: stepped,
      y: -stepped * 0.45,
      scale: 0.74 + level * 0.015 + transient * 0.02,
      rotation: 0,
      shearX: Math.round(Math.sin(time * 2.2) * 2) * 0.008 * high,
      shearY: 0,
    };
  }

  return {
    x: Math.sin(time * 0.24) * 1.35,
    y: Math.cos(time * 0.09) * 0.65,
    scale: 0.74 + level * 0.018,
    rotation: Math.sin(time * 0.16) * 0.006,
    shearX: Math.sin(time * 0.08) * 0.018,
    shearY: Math.cos(time * 0.06) * 0.008,
  };
}
