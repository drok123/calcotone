import { useEffect, useRef } from 'react';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';

const MODULE_ORDER = ['saturation', 'chorus', 'delay', 'reverb', 'bitcrusher', 'media'];

// One instrument, one visual language. Modules keep a subtle mineral tint instead
// of competing neon identities; their behavior does most of the differentiating.
const MODULE_COLORS: Record<string, [number, number, number]> = {
  saturation: [205, 151, 96],   // oxidized copper
  chorus: [121, 166, 157],      // smoked teal
  delay: [143, 126, 166],       // bruised violet
  reverb: [105, 137, 154],      // slate blue
  bitcrusher: [159, 121, 139],  // dusty rose
  media: [177, 142, 101],       // aged amber
};

const SIGNAL_COLOR: [number, number, number] = [178, 205, 190];
const CURSOR_COLOR: [number, number, number] = [188, 220, 201];

export function XYSignalField({
  modules,
  assignments,
  position,
  dragging,
}: {
  modules: ModuleState[];
  assignments: XYAssignment[];
  position: { x: number; y: number };
  dragging: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modulesRef = useRef(modules);
  const assignmentsRef = useRef(assignments);
  const positionRef = useRef(position);
  const draggingRef = useRef(dragging);

  modulesRef.current = modules;
  assignmentsRef.current = assignments;
  positionRef.current = position;
  draggingRef.current = dragging;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let cursorX = 0.5;
    let cursorY = 0.5;
    let gestureEnergy = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const valueOf = (module: ModuleState, id: string, fallback = 0) =>
      module.parameters.find((parameter) => parameter.id === id)?.value ?? fallback;

    const rgba = (color: [number, number, number], alpha: number) =>
      `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;

    const mixColor = (a: [number, number, number], b: [number, number, number], amount: number): [number, number, number] => [
      Math.round(a[0] + (b[0] - a[0]) * amount),
      Math.round(a[1] + (b[1] - a[1]) * amount),
      Math.round(a[2] + (b[2] - a[2]) * amount),
    ];

    const render: ViewportRenderCallback = (stamp) => {
      const t = stamp / 1000;
      const currentModules = modulesRef.current;
      const activeModules = MODULE_ORDER
        .map((id) => currentModules.find((module) => module.id === id))
        .filter((module): module is ModuleState => Boolean(module?.enabled && module.available));

      const targetX = positionRef.current.x / 100;
      const targetY = 1 - positionRef.current.y / 100;
      const follow = draggingRef.current ? 0.28 : 0.09;
      cursorX += (targetX - cursorX) * follow;
      cursorY += (targetY - cursorY) * follow;
      gestureEnergy += ((draggingRef.current ? 1 : 0) - gestureEnergy) * (draggingRef.current ? 0.17 : 0.05);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const midY = height * 0.5;
      const padScale = Math.min(width, height);
      const inputX = width * 0.055;
      const outputX = width * 0.945;
      const stageCount = Math.max(1, activeModules.length);
      const stageGap = (outputX - inputX) / (stageCount + 1);
      const cursorPx = cursorX * width;
      const cursorPy = cursorY * height;
      const assignmentEnergy = Math.min(1, assignmentsRef.current.length / 6);

      const chamber = context.createRadialGradient(cursorPx, cursorPy, 0, width * 0.5, midY, padScale * 0.76);
      chamber.addColorStop(0, `rgba(${CURSOR_COLOR[0]},${CURSOR_COLOR[1]},${CURSOR_COLOR[2]},${0.018 + gestureEnergy * 0.032})`);
      chamber.addColorStop(0.46, 'rgba(15,18,17,0.022)');
      chamber.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = chamber;
      context.fillRect(0, 0, width, height);

      context.strokeStyle = 'rgba(206,218,211,0.035)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(inputX, midY);
      context.lineTo(outputX, midY);
      context.stroke();

      const baseSignal: [number, number, number] = SIGNAL_COLOR;
      let amplitude = height * 0.032;
      let frequency = 1.55;
      let phaseWarp = 0;
      let noise = 0;
      let spread = 0;
      let tail = 0;

      const stages = activeModules.map((module, index) => ({
        module,
        x: inputX + stageGap * (index + 1),
      }));

      const sampleSignal = (x: number) => {
        const progress = (x - inputX) / Math.max(1, outputX - inputX);
        let localAmplitude = amplitude;
        let localFrequency = frequency;
        let localPhaseWarp = phaseWarp;
        let localNoise = noise;
        let localSpread = spread;
        let localTail = tail;
        let localColor = baseSignal;

        for (const stage of stages) {
          if (x < stage.x) break;
          const module = stage.module;
          const mix = valueOf(module, 'mix', 0.4);
          const color = MODULE_COLORS[module.id] ?? baseSignal;
          localColor = mixColor(localColor, color, 0.18 + mix * 0.22);

          if (module.id === 'saturation') {
            const drive = valueOf(module, 'drive', 0.2);
            const heat = valueOf(module, 'heat', 0.2);
            localAmplitude *= 1 + drive * 0.55;
            localPhaseWarp += heat * 0.65;
          } else if (module.id === 'chorus') {
            const depth = valueOf(module, 'depth', 0.3);
            const rate = valueOf(module, 'rate', 0.2);
            localSpread += 0.35 + depth * 1.25;
            localPhaseWarp += Math.sin(t * (0.6 + rate * 2.4)) * depth * 0.9;
          } else if (module.id === 'delay') {
            const feedback = valueOf(module, 'feedback', 0.2);
            const time = valueOf(module, 'time', 0.2);
            localTail += 0.45 + feedback * 1.8 + time * 0.8;
          } else if (module.id === 'reverb') {
            const size = valueOf(module, 'size', 0.5);
            const diffusion = valueOf(module, 'diffusion', 0.6);
            localAmplitude *= 1 + size * 0.32;
            localSpread += diffusion * 0.95;
          } else if (module.id === 'bitcrusher') {
            const bits = valueOf(module, 'bits', 0.7);
            const chaos = valueOf(module, 'chaos', 0.15);
            localFrequency *= 1 + (1 - bits) * 0.7;
            localNoise += 0.15 + chaos * 0.9;
          } else if (module.id === 'media') {
            const wow = valueOf(module, 'wow', 0.15);
            const wear = valueOf(module, 'wear', 0.15);
            localPhaseWarp += Math.sin(t * 1.1 + progress * 9) * wow * 1.4;
            localNoise += wear * 0.32;
          }
        }

        const magneticDistance = Math.max(0.08, Math.hypot(progress - cursorX, 0.5 - cursorY));
        const magneticPull = gestureEnergy * (0.055 / magneticDistance);
        const baseWave = Math.sin(progress * Math.PI * 2 * localFrequency + t * 2.1 + localPhaseWarp);
        const harmonic = Math.sin(progress * Math.PI * 4.8 - t * 1.25) * 0.24;
        const stepped = localNoise > 0.01
          ? Math.round((baseWave + harmonic) * (7 + (1 - localNoise) * 12)) / (7 + (1 - localNoise) * 12)
          : baseWave + harmonic;
        const pullShape = Math.exp(-Math.pow((x - cursorPx) / (width * 0.14), 2));
        const y = midY
          + stepped * localAmplitude
          + Math.sin(progress * 16 + t * 0.8) * localSpread * 2.1
          + (cursorPy - midY) * pullShape * magneticPull;

        return { y, color: localColor, spread: localSpread, tail: localTail };
      };

      for (let ghost = 3; ghost >= 0; ghost -= 1) {
        context.beginPath();
        let lastColor: [number, number, number] = baseSignal;
        for (let x = inputX; x <= outputX; x += 3) {
          const sample = sampleSignal(x - ghost * 5);
          const ghostY = sample.y + ghost * (sample.spread * 1.8 + 1.4);
          lastColor = sample.color;
          if (x === inputX) context.moveTo(x, ghostY);
          else context.lineTo(x, ghostY);
        }
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.strokeStyle = rgba(lastColor, ghost === 0 ? 0.42 : 0.045 + assignmentEnergy * 0.018);
        context.lineWidth = ghost === 0 ? 1.85 : 0.7;
        context.stroke();
        context.restore();
      }

      for (const [index, stage] of stages.entries()) {
        const module = stage.module;
        const color = MODULE_COLORS[module.id] ?? baseSignal;
        const mix = valueOf(module, 'mix', 0.4);
        const pulse = 0.5 + Math.sin(t * 1.8 - index * 0.8) * 0.5;

        context.save();
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = rgba(color, 0.018 + mix * 0.025);
        context.strokeStyle = rgba(color, 0.20 + pulse * 0.10);
        context.lineWidth = 1;
        const stageWidth = Math.max(20, width * 0.055);
        const stageHeight = height * (0.34 + mix * 0.12);
        context.fillRect(stage.x - stageWidth * 0.5, midY - stageHeight * 0.5, stageWidth, stageHeight);
        context.strokeRect(stage.x - stageWidth * 0.5, midY - stageHeight * 0.5, stageWidth, stageHeight);

        for (let bar = 0; bar < 3; bar += 1) {
          const barY = midY - stageHeight * 0.28 + bar * stageHeight * 0.28;
          context.strokeStyle = rgba(color, 0.08 + bar * 0.035);
          context.beginPath();
          context.moveTo(stage.x - stageWidth * 0.36, barY);
          context.lineTo(stage.x + stageWidth * 0.36, barY);
          context.stroke();
        }
        context.restore();
      }

      if (stages.length === 0) {
        context.strokeStyle = rgba(baseSignal, 0.20);
        context.lineWidth = 1.25;
        context.beginPath();
        for (let x = inputX; x <= outputX; x += 3) {
          const progress = (x - inputX) / Math.max(1, outputX - inputX);
          const y = midY + Math.sin(progress * Math.PI * 3 + t * 1.8) * height * 0.025;
          if (x === inputX) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }

      const travel = (t * 0.21) % 1;
      for (let packet = 0; packet < 5; packet += 1) {
        const p = (travel + packet * 0.2) % 1;
        const x = inputX + p * (outputX - inputX);
        const sample = sampleSignal(x);
        context.fillStyle = rgba(sample.color, 0.42);
        context.beginPath();
        context.arc(x, sample.y, 1.1 + gestureEnergy * 0.55, 0, Math.PI * 2);
        context.fill();
      }

      context.save();
      context.globalCompositeOperation = 'lighter';
      context.strokeStyle = rgba(CURSOR_COLOR, 0.18 + gestureEnergy * 0.30);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cursorPx, cursorPy, 6 + gestureEnergy * 2.5, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(cursorPx - 12, cursorPy); context.lineTo(cursorPx - 7, cursorPy);
      context.moveTo(cursorPx + 7, cursorPy); context.lineTo(cursorPx + 12, cursorPy);
      context.moveTo(cursorPx, cursorPy - 12); context.lineTo(cursorPx, cursorPy - 7);
      context.moveTo(cursorPx, cursorPy + 7); context.lineTo(cursorPx, cursorPy + 12);
      context.stroke();
      context.restore();
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="xy-signal-field" aria-hidden="true" />;
}
