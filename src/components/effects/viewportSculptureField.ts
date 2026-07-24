import {
  clamp01,
  lerp,
  makeViewportCamera,
  project3,
  rotate3,
  type Vec3,
  type ViewportCamera,
} from './viewportProjection';
import type { ViewportRoomMotion, ViewportRoomPalette } from './viewportRoom';

const TAU = Math.PI * 2;
const fract = (value: number): number => value - Math.floor(value);
const hash = (value: number): number => fract(Math.sin(value * 127.1) * 43758.5453123);
const rgba = (color: readonly [number, number, number], alpha: number): string =>
  `rgba(${color[0]},${color[1]},${color[2]},${clamp01(alpha)})`;

function energyOf(motion: ViewportRoomMotion): number {
  return clamp01(
    motion.level * 0.56 +
      motion.low * 0.14 +
      motion.mid * 0.14 +
      motion.high * 0.06 +
      motion.transient * 0.16,
  );
}

function cameraFor(
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

function rotateAroundX(point: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cosine - point.z * sine,
    z: point.y * sine + point.z * cosine,
  };
}

function rotateAroundY(point: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.z * sine,
    y: point.y,
    z: point.x * sine + point.z * cosine,
  };
}

function rotateAroundZ(point: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
    z: point.z,
  };
}

function transformPoint(
  point: Vec3,
  yaw: number,
  pitch: number,
  roll: number,
): Vec3 {
  return rotateAroundZ(rotateAroundX(rotateAroundY(point, yaw), pitch), roll);
}

function drawDepthSortedCurve(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  camera: ViewportCamera,
  colorA: readonly [number, number, number],
  colorB: readonly [number, number, number],
  alpha: number,
  width: number,
  pass: 'back' | 'front',
): void {
  if (points.length < 2) return;
  for (let index = 1; index < points.length; index += 1) {
    const a3 = points[index - 1];
    const b3 = points[index];
    const aDepth = rotate3(a3, camera).z;
    const bDepth = rotate3(b3, camera).z;
    const midpointDepth = (aDepth + bDepth) * 0.5;
    const isFront = midpointDepth < 0;
    if ((pass === 'front') !== isFront) continue;

    const a = project3(a3, camera, 1.12);
    const b = project3(b3, camera, 1.12);
    const near = clamp01(0.5 - midpointDepth * 0.22);
    const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, rgba(colorA, alpha * (0.55 + near * 0.55)));
    gradient.addColorStop(1, rgba(colorB, alpha * (0.5 + near * 0.65)));
    context.strokeStyle = gradient;
    context.lineWidth = width * (0.8 + near * 0.45);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
}

function ringPoints(
  radiusX: number,
  radiusY: number,
  count: number,
  yaw: number,
  pitch: number,
  roll: number,
  wobble: number,
  phase: number,
): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * TAU;
    const breathing = 1 + Math.sin(angle * 3 + phase) * wobble;
    const point = transformPoint(
      {
        x: Math.cos(angle) * radiusX * breathing,
        y: Math.sin(angle) * radiusY * breathing,
        z: Math.sin(angle * 2 + phase) * wobble * 1.6,
      },
      yaw,
      pitch,
      roll,
    );
    points.push(point);
  }
  return points;
}

function helixPoints(
  radius: number,
  height: number,
  turns: number,
  count: number,
  phase: number,
): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index <= count; index += 1) {
    const q = index / count;
    const angle = q * TAU * turns + phase;
    points.push({
      x: Math.cos(angle) * radius,
      y: lerp(-height, height, q),
      z: Math.sin(angle) * radius,
    });
  }
  return points;
}

function sphereLatitude(
  radius: number,
  latitude: number,
  count: number,
  yaw: number,
): Vec3[] {
  const points: Vec3[] = [];
  const latRadius = radius * Math.cos(latitude);
  const y = radius * Math.sin(latitude);
  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * TAU + yaw;
    points.push({ x: Math.cos(angle) * latRadius, y, z: Math.sin(angle) * latRadius });
  }
  return points;
}

function drawCoreAura(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ViewportRoomPalette,
  motion: ViewportRoomMotion,
  time: number,
  pass: 'back' | 'front',
): void {
  if (pass === 'front') return;
  const energy = energyOf(motion);
  const x = width * 0.5 + Math.sin(time * 0.09) * 1.1;
  const y = height * 0.49 + Math.cos(time * 0.07) * 0.8;
  const radius = 35 + energy * 10;
  const glow = context.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, rgba(palette.pale, 0.045 + motion.transient * 0.025));
  glow.addColorStop(0.22, rgba(palette.a, 0.055 + energy * 0.035));
  glow.addColorStop(0.58, rgba(palette.b, 0.018 + energy * 0.018));
  glow.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = glow;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawOrbitFamily(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  palette: ViewportRoomPalette,
  time: number,
  motion: ViewportRoomMotion,
  pass: 'back' | 'front',
  radius = 1,
  tilt = 0,
): void {
  const energy = energyOf(motion);
  const rings = [
    ringPoints(radius, radius * 0.58, 72, time * 0.075 + tilt, 0.35, time * 0.04, 0.025 + motion.mid * 0.022, time * 0.2),
    ringPoints(radius * 0.87, radius * 0.72, 72, -time * 0.055 - 0.72, -0.42, time * 0.035, 0.018 + motion.high * 0.018, -time * 0.15),
    ringPoints(radius * 0.72, radius * 0.95, 72, time * 0.035 + 1.1, 0.12, -time * 0.028, 0.015, time * 0.1),
  ];

  rings.forEach((points, index) => {
    drawDepthSortedCurve(
      context,
      points,
      camera,
      index % 2 ? palette.b : palette.a,
      index === 2 ? palette.pale : palette.b,
      0.08 + energy * 0.035 - index * 0.012,
      0.72 + (2 - index) * 0.12,
      pass,
    );
  });
}

function drawVoxelConstellation(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  palette: ViewportRoomPalette,
  time: number,
  motion: ViewportRoomMotion,
  pass: 'back' | 'front',
): void {
  const tick = Math.floor(time * (4 + motion.high * 3));
  const energy = energyOf(motion);
  for (let index = 0; index < 38; index += 1) {
    const z = lerp(-0.86, 0.86, hash(index * 5.17 + tick * 0.07));
    if ((pass === 'front') !== (rotate3({ x: 0, y: 0, z }, camera).z < 0)) continue;
    const point3: Vec3 = {
      x: lerp(-1.05, 1.05, hash(index * 9.31 + tick * 0.03)),
      y: lerp(-0.62, 0.62, hash(index * 4.83 + 3.1)),
      z,
    };
    const point = project3(point3, camera, 1.12);
    const hot = hash(index * 1.9 + tick * 0.17) > 0.86;
    const size = hot ? 2.4 : 1.15;
    const color = hot ? palette.pale : index % 2 ? palette.a : palette.b;
    context.save();
    context.fillStyle = rgba(color, (hot ? 0.19 : 0.075) + energy * 0.04);
    if (hot) {
      context.shadowColor = rgba(color, 0.32 + energy * 0.1);
      context.shadowBlur = 7;
    }
    context.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
    context.restore();
  }
}

function drawTransportGyro(
  context: CanvasRenderingContext2D,
  camera: ViewportCamera,
  palette: ViewportRoomPalette,
  time: number,
  motion: ViewportRoomMotion,
  pass: 'back' | 'front',
): void {
  const energy = energyOf(motion);
  for (let ring = 0; ring < 4; ring += 1) {
    const points = ringPoints(
      0.7 + ring * 0.11,
      0.7 + ring * 0.08,
      80,
      time * (0.06 + ring * 0.012) + ring * 0.55,
      -0.55 + ring * 0.34,
      time * (ring % 2 ? -0.03 : 0.024),
      0.009,
      time * 0.12 + ring,
    );
    drawDepthSortedCurve(
      context,
      points,
      camera,
      ring % 2 ? palette.warm : palette.a,
      ring % 2 ? palette.a : palette.b,
      0.06 + energy * 0.028,
      ring === 0 ? 1 : 0.62,
      pass,
    );
  }
}

function drawField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
  pass: 'back' | 'front',
): void {
  const camera = cameraFor(width, height, time, motion);
  const energy = energyOf(motion);

  context.save();
  context.globalCompositeOperation = 'screen';
  drawCoreAura(context, width, height, palette, motion, time, pass);

  if (moduleId === 'saturation') {
    const helix = helixPoints(0.68 + motion.low * 0.08, 0.72, 2.4, 82, time * (0.2 + motion.low * 0.08));
    drawDepthSortedCurve(context, helix, camera, palette.warm, palette.a, 0.11 + energy * 0.04, 0.9, pass);
    drawOrbitFamily(context, camera, palette, time, motion, pass, 0.9, 0.35);
  } else if (moduleId === 'chorus') {
    drawOrbitFamily(context, camera, palette, time * 1.25, motion, pass, 1.04, 0.7);
    drawOrbitFamily(context, camera, { ...palette, a: palette.b, b: palette.a }, -time * 0.95, motion, pass, 0.78, -0.55);
  } else if (moduleId === 'delay') {
    drawOrbitFamily(context, camera, palette, time * 0.6, motion, pass, 1.08, 0.1);
    for (let index = 0; index < 6; index += 1) {
      const q = index / 5;
      const z = lerp(0.82, -0.72, q);
      const radius = 0.42 + q * 0.62;
      const points = ringPoints(radius, radius * 0.62, 64, index * 0.3 + time * 0.025, 0.2, 0, 0, index);
      points.forEach((point) => { point.z += z; });
      drawDepthSortedCurve(context, points, camera, palette.a, palette.b, 0.045 + (1 - q) * 0.04, 0.55, pass);
    }
  } else if (moduleId === 'reverb') {
    for (const latitude of [-0.72, -0.36, 0, 0.36, 0.72]) {
      const points = sphereLatitude(1.0 + motion.mid * 0.08, latitude, 76, time * (0.025 + latitude * 0.004));
      drawDepthSortedCurve(context, points, camera, palette.a, palette.b, 0.047 + energy * 0.025, 0.58, pass);
    }
    drawOrbitFamily(context, camera, palette, -time * 0.45, motion, pass, 1.04, 1.2);
  } else if (moduleId === 'bitcrusher') {
    drawVoxelConstellation(context, camera, palette, time, motion, pass);
    const cubeRadius = 0.84;
    const corners: Vec3[] = [
      [-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
      [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1],
    ].map(([x,y,z]) => transformPoint({ x: x*cubeRadius, y: y*cubeRadius*0.62, z: z*cubeRadius }, time*0.06, time*0.045, 0));
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
    for (const [a,b] of edges) {
      drawDepthSortedCurve(context, [corners[a], corners[b]], camera, palette.a, palette.b, 0.055 + energy * 0.025, 0.62, pass);
    }
  } else {
    drawTransportGyro(context, camera, palette, time, motion, pass);
  }

  // Near pass gets a few expensive glints, not a blanket bloom.
  if (pass === 'front') {
    for (let index = 0; index < 4; index += 1) {
      const angle = time * (0.22 + index * 0.025) + index * 1.7;
      const point3: Vec3 = {
        x: Math.cos(angle) * (0.65 + index * 0.11),
        y: Math.sin(angle * 0.73) * 0.48,
        z: -0.55 - index * 0.08,
      };
      const point = project3(point3, camera, 1.12);
      const color = index % 2 ? palette.pale : palette.a;
      context.save();
      context.fillStyle = rgba(color, 0.16 + motion.transient * 0.07);
      context.shadowColor = rgba(color, 0.3 + energy * 0.12);
      context.shadowBlur = 8 + motion.transient * 5;
      context.beginPath();
      context.arc(point.x, point.y, 0.75 + motion.high * 0.28, 0, TAU);
      context.fill();
      context.restore();
    }
  }

  context.restore();
}

export function drawViewportSculptureFieldBack(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
): void {
  drawField(context, width, height, moduleId, time, motion, palette, 'back');
}

export function drawViewportSculptureFieldFront(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
  palette: ViewportRoomPalette,
): void {
  drawField(context, width, height, moduleId, time, motion, palette, 'front');
}
