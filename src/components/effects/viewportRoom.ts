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
}

interface RoomRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface RoomGeometry {
  near: RoomRect;
  back: RoomRect;
  centerX: number;
  centerY: number;
}

const TAU = Math.PI * 2;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const fract = (value: number): number => value - Math.floor(value);
const hash = (value: number): number => fract(Math.sin(value * 127.1) * 43758.5453123);
const rgba = (color: ViewportRoomColor, alpha: number): string =>
  `rgba(${color[0]},${color[1]},${color[2]},${clamp01(alpha)})`;

function roomGeometry(
  width: number,
  height: number,
  time: number,
  motion: ViewportRoomMotion,
): RoomGeometry {
  // The room moves much more slowly than the sculpture. This gives the eye a stable
  // architectural reference while the effect itself feels suspended inside the volume.
  const driftX = Math.sin(time * 0.055) * 1.15 + motion.mid * 0.55;
  const driftY = Math.cos(time * 0.047) * 0.65 - motion.low * 0.75;
  const near = {
    left: 7,
    right: width - 7,
    top: 7,
    bottom: height - 7,
  };
  const back = {
    left: width * 0.19 + driftX,
    right: width * 0.81 + driftX,
    top: height * 0.19 + driftY,
    bottom: height * 0.79 + driftY,
  };

  return {
    near,
    back,
    centerX: (back.left + back.right) * 0.5,
    centerY: (back.top + back.bottom) * 0.5,
  };
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

function line(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function drawPerspectivePlane(
  context: CanvasRenderingContext2D,
  backLeft: { x: number; y: number },
  backRight: { x: number; y: number },
  nearLeft: { x: number; y: number },
  nearRight: { x: number; y: number },
  color: ViewportRoomColor,
  secondary: ViewportRoomColor,
  energy: number,
): void {
  const longitudinal = 7;
  for (let index = 0; index <= longitudinal; index += 1) {
    const q = index / longitudinal;
    stroke(context, index % 2 ? secondary : color, 0.038 + energy * 0.012, 0.55);
    line(
      context,
      lerp(backLeft.x, backRight.x, q),
      lerp(backLeft.y, backRight.y, q),
      lerp(nearLeft.x, nearRight.x, q),
      lerp(nearLeft.y, nearRight.y, q),
    );
  }

  const depthLines = 6;
  for (let index = 1; index < depthLines; index += 1) {
    const q = index / depthLines;
    const perspective = q * q;
    const leftX = lerp(backLeft.x, nearLeft.x, perspective);
    const leftY = lerp(backLeft.y, nearLeft.y, perspective);
    const rightX = lerp(backRight.x, nearRight.x, perspective);
    const rightY = lerp(backRight.y, nearRight.y, perspective);
    stroke(context, color, 0.03 + perspective * 0.035 + energy * 0.01, 0.5);
    line(context, leftX, leftY, rightX, rightY);
  }
}

function drawBackWallGlow(
  context: CanvasRenderingContext2D,
  geometry: RoomGeometry,
  palette: ViewportRoomPalette,
  energy: number,
  transient: number,
): void {
  const radius = Math.max(
    geometry.back.right - geometry.back.left,
    geometry.back.bottom - geometry.back.top,
  ) * 0.56;
  const glow = context.createRadialGradient(
    geometry.centerX,
    geometry.centerY,
    0,
    geometry.centerX,
    geometry.centerY,
    radius,
  );
  glow.addColorStop(0, rgba(palette.a, 0.07 + energy * 0.055 + transient * 0.015));
  glow.addColorStop(0.42, rgba(palette.b, 0.032 + energy * 0.025));
  glow.addColorStop(1, rgba(palette.a, 0));
  context.fillStyle = glow;
  context.fillRect(
    geometry.back.left,
    geometry.back.top,
    geometry.back.right - geometry.back.left,
    geometry.back.bottom - geometry.back.top,
  );
}

function drawVolumeMotes(
  context: CanvasRenderingContext2D,
  geometry: RoomGeometry,
  palette: ViewportRoomPalette,
  time: number,
  motion: ViewportRoomMotion,
): void {
  for (let index = 0; index < 13; index += 1) {
    const seed = hash(index * 8.31 + 0.41);
    const depth = fract(seed + time * (0.006 + hash(index * 3.7) * 0.008));
    const perspective = depth * depth;
    const targetX = lerp(
      geometry.near.left + 8,
      geometry.near.right - 8,
      hash(index * 11.91 + 2.4),
    );
    const targetY = lerp(
      geometry.near.top + 8,
      geometry.near.bottom - 8,
      hash(index * 7.13 + 5.8),
    );
    const x = lerp(geometry.centerX, targetX, perspective);
    const y = lerp(geometry.centerY, targetY, perspective);
    const radius = 0.25 + perspective * 0.8 + motion.transient * 0.18;
    const alpha = 0.035 + perspective * 0.085 + motion.high * 0.025;
    const color = index % 4 === 0 ? palette.pale : index % 2 ? palette.b : palette.a;

    context.save();
    context.fillStyle = rgba(color, alpha);
    context.shadowColor = rgba(color, Math.min(0.18, alpha * 1.6));
    context.shadowBlur = 2 + perspective * 4;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
    context.restore();
  }
}

function drawModuleRoomSignature(
  context: CanvasRenderingContext2D,
  geometry: RoomGeometry,
  moduleId: string,
  palette: ViewportRoomPalette,
  time: number,
  motion: ViewportRoomMotion,
): void {
  const { back } = geometry;
  const width = back.right - back.left;
  const height = back.bottom - back.top;

  if (moduleId === 'saturation') {
    for (let index = 0; index < 3; index += 1) {
      const x = back.left + width * (0.25 + index * 0.25);
      const rise = fract(time * (0.045 + index * 0.004) + index * 0.31);
      const y = back.bottom - 8 - rise * (height - 16);
      const gradient = context.createLinearGradient(x, back.bottom, x, back.top);
      gradient.addColorStop(0, rgba(palette.warm, 0.07 + motion.low * 0.025));
      gradient.addColorStop(0.6, rgba(palette.a, 0.025));
      gradient.addColorStop(1, rgba(palette.a, 0));
      context.fillStyle = gradient;
      context.fillRect(x - 0.5, back.top + 5, 1, height - 10);
      context.fillStyle = rgba(palette.pale, 0.12 + motion.transient * 0.05);
      context.fillRect(x - 0.75, y, 1.5, 1.5);
    }
    return;
  }

  if (moduleId === 'chorus') {
    stroke(context, palette.a, 0.07 + motion.mid * 0.02, 0.6);
    context.beginPath();
    context.moveTo(back.left + 5, geometry.centerY);
    context.bezierCurveTo(
      back.left + width * 0.3,
      back.top + 9 + Math.sin(time * 0.16) * 3,
      back.right - width * 0.3,
      back.bottom - 9 - Math.sin(time * 0.14) * 3,
      back.right - 5,
      geometry.centerY,
    );
    context.stroke();
    stroke(context, palette.b, 0.06 + motion.high * 0.02, 0.6);
    context.beginPath();
    context.moveTo(back.left + 5, geometry.centerY + 4);
    context.bezierCurveTo(
      back.left + width * 0.3,
      back.bottom - 10,
      back.right - width * 0.3,
      back.top + 10,
      back.right - 5,
      geometry.centerY + 4,
    );
    context.stroke();
    return;
  }

  if (moduleId === 'delay') {
    for (let index = 0; index < 4; index += 1) {
      const q = index / 4;
      const insetX = 8 + q * 18;
      const insetY = 6 + q * 12;
      stroke(context, index % 2 ? palette.b : palette.a, 0.038 + (1 - q) * 0.025, 0.55);
      context.strokeRect(
        back.left + insetX,
        back.top + insetY,
        width - insetX * 2,
        height - insetY * 2,
      );
    }
    return;
  }

  if (moduleId === 'reverb') {
    context.save();
    context.globalCompositeOperation = 'screen';
    for (let index = 0; index < 4; index += 1) {
      const x = back.left + width * (0.18 + index * 0.21);
      const beam = context.createLinearGradient(x, back.top, geometry.centerX, back.bottom);
      beam.addColorStop(0, rgba(index % 2 ? palette.b : palette.a, 0.045 + motion.mid * 0.025));
      beam.addColorStop(1, rgba(palette.a, 0));
      context.fillStyle = beam;
      context.beginPath();
      context.moveTo(x - 2, back.top);
      context.lineTo(x + 2, back.top);
      context.lineTo(geometry.centerX + (index - 1.5) * 12, back.bottom);
      context.lineTo(geometry.centerX + (index - 1.5) * 8, back.bottom);
      context.closePath();
      context.fill();
    }
    context.restore();
    return;
  }

  if (moduleId === 'bitcrusher') {
    const cell = 12;
    for (let y = back.top + 8; y < back.bottom - 5; y += cell) {
      for (let x = back.left + 8; x < back.right - 5; x += cell) {
        const active = hash(x * 0.17 + y * 0.23 + Math.floor(time * 3.5) * 0.31);
        if (active < 0.83) continue;
        context.fillStyle = rgba(active > 0.94 ? palette.pale : palette.a, 0.025 + motion.high * 0.03);
        context.fillRect(x, y, 2, 2);
      }
    }
    return;
  }

  // Artifact gets restrained transport/calibration marks rather than another effect animation.
  stroke(context, palette.warm, 0.055 + motion.high * 0.018, 0.55);
  for (let index = 0; index <= 8; index += 1) {
    const x = lerp(back.left + 8, back.right - 8, index / 8);
    const tick = index % 2 === 0 ? 4 : 2;
    line(context, x, back.bottom - tick, x, back.bottom);
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
  const geometry = roomGeometry(width, height, time, motion);
  const { near, back } = geometry;
  const energy = clamp01(motion.level * 0.65 + motion.low * 0.2 + motion.mid * 0.1);

  context.save();
  context.globalCompositeOperation = 'screen';

  drawBackWallGlow(context, geometry, palette, energy, motion.transient);

  // Floor and ceiling share a vanishing chamber, giving every module the same physical
  // world while palette/signature details retain each machine's identity.
  drawPerspectivePlane(
    context,
    { x: back.left, y: back.bottom },
    { x: back.right, y: back.bottom },
    { x: near.left, y: near.bottom },
    { x: near.right, y: near.bottom },
    palette.a,
    palette.b,
    energy,
  );
  drawPerspectivePlane(
    context,
    { x: back.left, y: back.top },
    { x: back.right, y: back.top },
    { x: near.left, y: near.top },
    { x: near.right, y: near.top },
    palette.b,
    palette.a,
    energy * 0.7,
  );

  // Side-wall depth seams.
  for (let index = 1; index < 5; index += 1) {
    const q = (index / 5) ** 2;
    const leftTopX = lerp(back.left, near.left, q);
    const leftTopY = lerp(back.top, near.top, q);
    const leftBottomX = lerp(back.left, near.left, q);
    const leftBottomY = lerp(back.bottom, near.bottom, q);
    const rightTopX = lerp(back.right, near.right, q);
    const rightTopY = lerp(back.top, near.top, q);
    const rightBottomX = lerp(back.right, near.right, q);
    const rightBottomY = lerp(back.bottom, near.bottom, q);
    stroke(context, index % 2 ? palette.a : palette.b, 0.025 + q * 0.03, 0.5);
    line(context, leftTopX, leftTopY, leftBottomX, leftBottomY);
    line(context, rightTopX, rightTopY, rightBottomX, rightBottomY);
  }

  // Back wall and the four perspective rails establish the actual cube.
  stroke(context, palette.pale, 0.075 + energy * 0.035, 0.65);
  context.strokeRect(back.left, back.top, back.right - back.left, back.bottom - back.top);
  stroke(context, palette.a, 0.065 + energy * 0.025, 0.65);
  line(context, near.left, near.top, back.left, back.top);
  line(context, near.right, near.top, back.right, back.top);
  line(context, near.left, near.bottom, back.left, back.bottom);
  line(context, near.right, near.bottom, back.right, back.bottom);

  drawModuleRoomSignature(context, geometry, moduleId, palette, time, motion);
  drawVolumeMotes(context, geometry, palette, time, motion);
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
  const geometry = roomGeometry(width, height, time, motion);
  const { near, back } = geometry;
  const energy = clamp01(motion.level * 0.7 + motion.transient * 0.25);

  context.save();
  context.globalCompositeOperation = 'screen';

  // Front frame is intentionally incomplete: four luminous corner brackets read as glass
  // architecture without putting a bright rectangle around every animation.
  const bracket = 18;
  stroke(context, palette.pale, 0.075 + energy * 0.045, 0.72);
  line(context, near.left, near.top, near.left + bracket, near.top);
  line(context, near.left, near.top, near.left, near.top + bracket);
  line(context, near.right, near.top, near.right - bracket, near.top);
  line(context, near.right, near.top, near.right, near.top + bracket);
  line(context, near.left, near.bottom, near.left + bracket, near.bottom);
  line(context, near.left, near.bottom, near.left, near.bottom - bracket);
  line(context, near.right, near.bottom, near.right - bracket, near.bottom);
  line(context, near.right, near.bottom, near.right, near.bottom - bracket);

  // Two near rails cross in front of the sculpture, creating genuine visual occlusion and
  // making the artwork feel suspended inside the room rather than pasted over a backdrop.
  stroke(context, palette.a, 0.045 + energy * 0.025, 0.6);
  line(context, near.left, near.bottom, back.left, back.bottom);
  stroke(context, palette.b, 0.04 + energy * 0.022, 0.6);
  line(context, near.right, near.top, back.right, back.top);

  for (const [x, y, color] of [
    [near.left, near.top, palette.a],
    [near.right, near.top, palette.b],
    [near.left, near.bottom, palette.b],
    [near.right, near.bottom, palette.a],
  ] as const) {
    context.save();
    context.fillStyle = rgba(color, 0.17 + energy * 0.07);
    context.shadowColor = rgba(color, 0.22 + energy * 0.08);
    context.shadowBlur = 5;
    context.beginPath();
    context.arc(x, y, 0.8 + motion.transient * 0.25, 0, TAU);
    context.fill();
    context.restore();
  }

  context.restore();
}

export function getViewportSculptureTransform(
  moduleId: string,
  time: number,
  motion: ViewportRoomMotion,
): ViewportSculptureTransform {
  const transient = clamp01(motion.transient);
  const level = clamp01(motion.level);

  if (moduleId === 'saturation') {
    return {
      x: Math.sin(time * 0.08) * 0.8,
      y: -2.2 - motion.low * 1.8 + Math.cos(time * 0.11) * 0.5,
      scale: 0.82 + level * 0.018 + transient * 0.012,
      rotation: Math.sin(time * 0.055) * 0.007,
    };
  }

  if (moduleId === 'chorus') {
    return {
      x: Math.sin(time * 0.19) * (1.6 + motion.mid * 1.2),
      y: Math.cos(time * 0.13) * 0.85,
      scale: 0.84 + level * 0.012,
      rotation: Math.sin(time * 0.12) * 0.012,
    };
  }

  if (moduleId === 'delay') {
    return {
      x: Math.sin(time * 0.065) * 1.1,
      y: Math.cos(time * 0.052) * 0.7 - motion.low * 0.8,
      scale: 0.80 + level * 0.014 + transient * 0.022,
      rotation: Math.sin(time * 0.041) * 0.004,
    };
  }

  if (moduleId === 'reverb') {
    return {
      x: Math.sin(time * 0.07) * 0.65,
      y: Math.sin(time * 0.105) * 1.75 - motion.mid * 1.1,
      scale: 0.86 + level * 0.018,
      rotation: Math.sin(time * 0.047) * 0.006,
    };
  }

  if (moduleId === 'bitcrusher') {
    const stepped = Math.round(Math.sin(time * 3.4) * 2) * 0.16 * motion.high;
    return {
      x: stepped,
      y: -stepped * 0.45,
      scale: 0.83 + level * 0.01 + transient * 0.014,
      rotation: 0,
    };
  }

  return {
    x: Math.sin(time * 0.24) * 1.05,
    y: Math.cos(time * 0.09) * 0.45,
    scale: 0.83 + level * 0.012,
    rotation: Math.sin(time * 0.16) * 0.004,
  };
}
