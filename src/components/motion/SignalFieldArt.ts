import type { ModuleState } from '../../ui/types';
import type { SignalLabState } from '../../audio/SignalLab';
import type { VisualAudioState } from '../../visual/VisualEngine';

type RGB = [number, number, number];
type SignalArtFrame = {
  state: SignalLabState;
  modules: ModuleState[];
  x: number;
  y: number;
  time: number;
  audio: VisualAudioState;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

function scenePalette(modules: ModuleState[]): { a: RGB; b: RGB; detail: RGB } {
  const artifact = modules.find((m) => m.id === 'media' && m.enabled && m.available);
  const mode = artifact?.mediaMode ?? 'cassette';
  if (mode === 'vhs' || mode === 'broken') return { a: [90, 222, 225], b: [233, 82, 192], detail: [225, 239, 242] };
  if (['Neve 1073', 'API 1608', 'SSL 4000E', 'cassette', 'reel', 'tascam424'].includes(mode)) {
    return { a: [240, 181, 104], b: [194, 124, 76], detail: [243, 231, 214] };
  }
  if (['archive', 'wax', 'vinyl'].includes(mode)) return { a: [224, 192, 145], b: [171, 127, 86], detail: [239, 226, 198] };
  return { a: [90, 222, 225], b: [233, 82, 192], detail: [230, 240, 240] };
}

function landscapeVocabulary(modules: ModuleState[]): 'architectural' | 'mechanical' | 'fluid' | 'organic' {
  const artifact = modules.find((m) => m.id === 'media' && m.enabled && m.available);
  if (artifact?.mediaMode === 'vhs') return 'architectural';
  if (artifact && ['Neve 1073', 'API 1608', 'SSL 4000E', 'tascam424', 'reel'].includes(artifact.mediaMode ?? '')) return 'mechanical';
  const atmos = modules.find((m) => m.id === 'reverb' && m.enabled && m.available);
  if (atmos && ['aurora', 'nebula', 'celestial', 'cloud'].includes(atmos.algorithm ?? '')) return 'fluid';
  return 'organic';
}

/** Draws a sparse, landscape-derived SIGNAL intervention over the Dream field. */
export function drawSignalFieldArt(ctx: CanvasRenderingContext2D, width: number, height: number, frame: SignalArtFrame): void {
  const { state } = frame;
  if (!state.enabled) return;

  const palette = scenePalette(frame.modules);
  const vocabulary = landscapeVocabulary(frame.modules);
  const x = clamp01(frame.x);
  const y = clamp01(frame.y);
  const amount = clamp01(state.amount);
  const motion = clamp01(state.motion);
  const level = clamp01(frame.audio.level);
  const transient = clamp01(frame.audio.transient);
  const influence = 0.035 + amount * 0.045 + level * 0.018;
  const cx = width * x;
  const cy = height * (1 - y);
  const horizon = height * (0.50 + (0.5 - y) * 0.05);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineWidth = Math.max(0.55, Math.min(1.05, width / 900));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (state.mode) {
    case 'octaver': {
      // A landscape contour and its harmonic echo: same terrain grammar, shifted in scale/depth.
      for (let layer = 0; layer < 2; layer += 1) {
        ctx.strokeStyle = rgba(layer ? palette.b : palette.a, influence * (layer ? 0.62 : 0.82));
        ctx.beginPath();
        for (let i = 0; i <= 48; i += 1) {
          const u = i / 48;
          const px = u * width;
          const base = horizon + height * (0.055 + layer * 0.035);
          const perspective = vocabulary === 'architectural' ? Math.abs(u - x) * height * 0.018 : 0;
          const wave = Math.sin(u * Math.PI * (2.2 + layer * 1.8) + x * 2.2) * height * (0.006 + amount * 0.006);
          const pull = Math.exp(-Math.pow((u - x) / 0.16, 2)) * (y - 0.5) * height * 0.025;
          const py = base + perspective + wave - pull;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      break;
    }
    case 'ringmod': {
      // Two restrained interference fields share the scene's perspective instead of floating circles.
      const span = Math.min(width, height) * (0.16 + amount * 0.12);
      for (let i = 0; i < 3; i += 1) {
        const radius = span * (0.52 + i * 0.24);
        const squash = vocabulary === 'architectural' ? 0.34 : vocabulary === 'mechanical' ? 0.52 : 0.68;
        ctx.strokeStyle = rgba(i % 2 ? palette.b : palette.a, influence * (0.72 - i * 0.13));
        ctx.beginPath();
        ctx.ellipse(cx + (i - 1) * width * 0.018, cy, radius, radius * squash, (x - 0.5) * 0.22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(palette.detail, influence * 0.42);
      ctx.beginPath();
      ctx.moveTo(width * 0.08, horizon);
      ctx.quadraticCurveTo(cx, cy, width * 0.92, horizon + (y - 0.5) * height * 0.025);
      ctx.stroke();
      break;
    }
    case 'tremolo': {
      // Fine horizon strata breathe rather than generic waveform lines.
      for (let i = 0; i < 3; i += 1) {
        const base = horizon + height * (0.045 + i * 0.035);
        ctx.strokeStyle = rgba(i === 1 ? palette.b : palette.a, influence * (0.62 - i * 0.08));
        ctx.beginPath();
        for (let s = 0; s <= 36; s += 1) {
          const u = s / 36;
          const focus = Math.exp(-Math.pow((u - x) / 0.22, 2));
          const pulse = Math.sin(frame.time * (0.35 + motion * 0.8) + u * Math.PI * 2) * height * 0.0035 * amount * focus;
          const py = base + pulse + (u - 0.5) * (y - 0.5) * height * 0.018;
          s === 0 ? ctx.moveTo(u * width, py) : ctx.lineTo(u * width, py);
        }
        ctx.stroke();
      }
      break;
    }
    case 'autopan': {
      // Long perspective arcs imply stereo travel while remaining anchored to the world horizon.
      for (let i = 0; i < 2; i += 1) {
        const offset = (i ? 1 : -1) * width * (0.05 + amount * 0.04);
        ctx.strokeStyle = rgba(i ? palette.b : palette.a, influence * 0.68);
        ctx.beginPath();
        ctx.moveTo(width * 0.08, horizon + i * height * 0.018);
        ctx.bezierCurveTo(cx - offset, cy, cx + offset, cy, width * 0.92, horizon + (1 - i) * height * 0.018);
        ctx.stroke();
      }
      break;
    }
    case 'wavefolder': {
      // A topographic contour is locally pleated around the cursor; folds stay tied to terrain depth.
      for (let row = 0; row < 3; row += 1) {
        ctx.strokeStyle = rgba(row === 1 ? palette.b : palette.a, influence * (0.66 - row * 0.07));
        ctx.beginPath();
        for (let s = 0; s <= 52; s += 1) {
          const u = s / 52;
          const distance = (u - x) / 0.22;
          const envelope = Math.exp(-distance * distance);
          const fold = Math.sin(distance * Math.PI * (2 + amount * 4)) * envelope * height * (0.006 + amount * 0.010);
          const py = horizon + height * (0.045 + row * 0.032) + fold * (0.7 + y * 0.6);
          s === 0 ? ctx.moveTo(u * width, py) : ctx.lineTo(u * width, py);
        }
        ctx.stroke();
      }
      break;
    }
  }

  // One tiny transient accent at meaningful intersections, never a particle shower.
  if (transient > 0.35) {
    ctx.fillStyle = rgba(palette.detail, influence * transient * 0.8);
    ctx.beginPath();
    ctx.arc(cx, cy, 0.7 + transient * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
