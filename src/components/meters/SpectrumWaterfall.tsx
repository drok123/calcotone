import { useEffect, useRef } from 'react';
import type { VisualSpectrumSource } from '../../visual/SharedVisualSpectrum';
import { canvasPixelRatio, getDisplayProfile, subscribeDisplayProfile } from '../../ui/displayProfile';
import { subscribeViewportAnimation, type ViewportRenderCallback } from '../effects/viewportScheduler';

export function SpectrumWaterfall({
  analyser,
  running,
}: {
  analyser: VisualSpectrumSource | null;
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const drawingContext = canvasElement.getContext('2d', { alpha: false });
    if (!drawingContext) return;

    const canvas = canvasElement;
    const context = drawingContext;

    let lastDrawTime = 0;
    let lastSampleTime = 0;
    let cssWidth = 1;
    let cssHeight = 1;
    let pixelRatio = 1;
    let visible = true;
    const historyLength = 28;
    const pointCount = 48;
    const history: Float32Array[] = Array.from(
      { length: historyLength },
      () => new Float32Array(pointCount),
    );
    let historyCursor = 0;
    const frequencyBinCount = analyser?.frequencyBinCount ?? 0;
    const frequencyData = new Uint8Array(frequencyBinCount);
    const binStarts = new Uint16Array(pointCount);
    const binEnds = new Uint16Array(pointCount);
    // These values depend only on row index, so keep them out of the animated path.
    const rowDepth = new Float32Array(historyLength);
    const rowLineWidth = new Float32Array(historyLength);
    const rowStrokeStyle = new Array<string>(historyLength);

    for (let rowIndex = 0; rowIndex < historyLength; rowIndex += 1) {
      const depthPosition = rowIndex / Math.max(1, historyLength - 1);
      const opacity = 0.22 + depthPosition * 0.78;
      rowDepth[rowIndex] = depthPosition;
      rowLineWidth[rowIndex] = 1 + depthPosition * 1.2;
      rowStrokeStyle[rowIndex] = `rgba(237, 242, 237, ${0.22 + opacity * 0.72})`;
    }

    if (frequencyBinCount > 0) {
      for (let point = 0; point < pointCount; point += 1) {
        const normalized = point / Math.max(1, pointCount - 1);
        const startIndex = Math.floor(normalized ** 2 * (frequencyBinCount - 1));
        const nextNormalized = (point + 1) / pointCount;
        const endIndex = Math.max(startIndex + 1, Math.floor(nextNormalized ** 2 * frequencyBinCount));
        binStarts[point] = Math.min(65535, startIndex);
        binEnds[point] = Math.min(65535, endIndex);
      }
    }

    function resizeCanvas(): void {
      const bounds = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, bounds.width);
      cssHeight = Math.max(1, bounds.height);
      pixelRatio = canvasPixelRatio(cssWidth, cssHeight, 5_600_000);
      const width = Math.max(1, Math.round(cssWidth * pixelRatio));
      const height = Math.max(1, Math.round(cssHeight * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      lastDrawTime = Number.NEGATIVE_INFINITY;
    }

    function collectSpectrum(): void {
      const row = history[historyCursor];
      row.fill(0);
      if (!analyser || frequencyData.length === 0 || !running) {
        historyCursor = (historyCursor + 1) % historyLength;
        return;
      }

      analyser.getByteFrequencyData(frequencyData);
      for (let point = 0; point < pointCount; point += 1) {
        const startIndex = binStarts[point];
        const endIndex = Math.min(binEnds[point], frequencyData.length);
        let total = 0;
        for (let index = startIndex; index < endIndex; index += 1) total += frequencyData[index];
        const samples = Math.max(1, endIndex - startIndex);
        row[point] = total / samples / 255;
      }
      historyCursor = (historyCursor + 1) % historyLength;
    }

    function drawBackground(width: number, height: number): void {
      context.fillStyle = '#06110c';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(237, 242, 237, 0.13)';
      context.lineWidth = 1;

      const horizonY = height * 0.19;
      const frontY = height * 0.88;
      const centerX = width / 2;

      for (let index = 0; index <= 14; index += 1) {
        const position = index / 14;
        const frontX = width * 0.03 + position * width * 0.94;
        const horizonX = centerX + (position - 0.5) * width * 0.34;
        context.beginPath();
        context.moveTo(frontX, frontY);
        context.lineTo(horizonX, horizonY);
        context.stroke();
      }

      for (let index = 0; index <= 20; index += 1) {
        const normalized = index / 20;
        const curved = normalized ** 1.65;
        const y = horizonY + curved * (frontY - horizonY);
        const widthAtDepth = width * (0.34 + curved * 0.6);
        context.beginPath();
        context.moveTo(centerX - widthAtDepth / 2, y);
        context.lineTo(centerX + widthAtDepth / 2, y);
        context.stroke();
      }

      context.strokeStyle = 'rgba(237, 242, 237, 0.48)';
      context.lineWidth = Math.max(1, width / 500);
      context.strokeRect(1, 1, width - 2, height - 2);
    }

    function drawSpectrum(width: number, height: number): void {
      const horizonY = height * 0.19;
      const frontY = height * 0.88;
      const centerX = width * 0.5;
      const frequencyDenominator = Math.max(1, pointCount - 1);

      for (let rowIndex = 0; rowIndex < historyLength; rowIndex += 1) {
        const depthPosition = rowDepth[rowIndex];
        const historyIndex = (historyCursor - 1 - rowIndex + historyLength) % historyLength;
        const row = history[historyIndex];
        const depthScale = 0.35 + depthPosition * 0.65;
        const halfWidth = width * 0.47 * depthScale;
        const baseY = horizonY + depthPosition * (frontY - horizonY);
        const amplitudeScale = height * 0.34 * depthScale;

        context.strokeStyle = rowStrokeStyle[rowIndex];
        context.lineWidth = rowLineWidth[rowIndex];
        context.beginPath();

        for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
          const frequencyPosition = pointIndex / frequencyDenominator;
          const x = centerX + (frequencyPosition - 0.5) * halfWidth * 2;
          const y = baseY - amplitudeScale * row[pointIndex];
          if (pointIndex === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    }

    function drawLabels(width: number, height: number): void {
      const fontSize = Math.max(9, Math.round(width / 40));
      context.fillStyle = 'rgba(244, 247, 242, 0.94)';
      context.font = `800 ${fontSize}px "IBM Plex Mono", "Courier New", monospace`;
      context.textBaseline = 'top';
      context.textAlign = 'left';
      context.fillText('SPECTRUM', width * 0.045, height * 0.045);
      context.textAlign = 'right';
      context.fillText(running ? 'LIVE' : 'STANDBY', width * 0.955, height * 0.045);
      context.textBaseline = 'bottom';
      context.textAlign = 'left';
      context.fillText('LOW', width * 0.045, height * 0.955);
      context.textAlign = 'right';
      context.fillText('HIGH', width * 0.955, height * 0.955);
    }

    const render: ViewportRenderCallback = (timestamp) => {
      if (!visible || document.hidden) return;
      const visualFps = getDisplayProfile().visualFps;
      const drawInterval = 1000 / visualFps;
      if (timestamp - lastDrawTime < drawInterval) return;
      lastDrawTime = timestamp;

      const sampleInterval = 1000 / visualFps;
      if (timestamp - lastSampleTime >= sampleInterval) {
        collectSpectrum();
        lastSampleTime = timestamp;
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      drawBackground(cssWidth, cssHeight);
      drawSpectrum(cssWidth, cssHeight);
      drawLabels(cssWidth, cssHeight);
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    const visibilityObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible) lastDrawTime = Number.NEGATIVE_INFINITY;
        }, { rootMargin: '80px' })
      : null;
    visibilityObserver?.observe(canvas);
    const unsubscribeProfile = subscribeDisplayProfile(resizeCanvas);
    const unsubscribeAnimation = subscribeViewportAnimation(render);
    resizeCanvas();

    return () => {
      unsubscribeAnimation();
      unsubscribeProfile();
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
    };
  }, [analyser, running]);

  return (
    <section className="spectrum-unit">
      <header className="spectrum-header">
        <strong>SPECTRUM</strong>
        <span className={`spectrum-status ${running ? 'active' : ''}`}><i />{running ? 'LIVE' : 'HOLD'}</span>
      </header>
      <div className="spectrum-screen">
        <canvas ref={canvasRef} aria-label="Live three-dimensional audio spectrum waterfall" />
      </div>
    </section>
  );
}
