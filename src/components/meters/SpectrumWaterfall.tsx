import { useEffect, useRef } from 'react';

export function SpectrumWaterfall({
  analyser,
  running,
}: {
  analyser: AnalyserNode | null;
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const drawingContext = canvasElement.getContext('2d');
    if (!drawingContext) return;

    const canvas = canvasElement;
    const context = drawingContext;

    let animationFrame = 0;
    let lastDrawTime = 0;
    let lastSampleTime = 0;
    const drawInterval = 1000 / 30;
    const sampleInterval = 42;
    const historyLength = 24;
    const pointCount = 36;
    const history: Float32Array[] = Array.from({ length: historyLength }, () => new Float32Array(pointCount));
    let historyCursor = 0;
    const frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const binStarts = new Uint16Array(pointCount);
    const binEnds = new Uint16Array(pointCount);

    if (frequencyData) {
      for (let point = 0; point < pointCount; point += 1) {
        const normalized = point / Math.max(1, pointCount - 1);
        const startIndex = Math.floor(normalized ** 2 * (frequencyData.length - 1));
        const nextNormalized = (point + 1) / pointCount;
        const endIndex = Math.max(startIndex + 1, Math.floor(nextNormalized ** 2 * frequencyData.length));
        binStarts[point] = Math.min(65535, startIndex);
        binEnds[point] = Math.min(65535, endIndex);
      }
    }

    function resizeCanvas(): void {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function collectSpectrum(): void {
      const row = history[historyCursor];
      row.fill(0);
      if (!analyser || !frequencyData || !running) {
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

    function projectPoint(
      frequencyPosition: number,
      depthPosition: number,
      amplitude: number,
      width: number,
      height: number
    ): { x: number; y: number } {
      const horizonY = height * 0.19;
      const frontY = height * 0.88;
      const depthScale = 0.35 + depthPosition * 0.65;
      const halfWidth = width * 0.47 * depthScale;
      const centerX = width / 2;
      const baseY = horizonY + depthPosition * (frontY - horizonY);
      const x = centerX + (frequencyPosition - 0.5) * halfWidth * 2;
      const amplitudeHeight = height * 0.34 * amplitude * depthScale;
      return { x, y: baseY - amplitudeHeight };
    }

    function drawBackground(width: number, height: number): void {
      context.fillStyle = '#06110c';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(237, 242, 237, 0.12)';
      context.lineWidth = 1;

      const horizonY = height * 0.19;
      const frontY = height * 0.88;
      const centerX = width / 2;

      for (let index = 0; index <= 12; index += 1) {
        const position = index / 12;
        const frontX = width * 0.03 + position * width * 0.94;
        const horizonX = centerX + (position - 0.5) * width * 0.34;
        context.beginPath();
        context.moveTo(frontX, frontY);
        context.lineTo(horizonX, horizonY);
        context.stroke();
      }

      for (let index = 0; index <= 18; index += 1) {
        const normalized = index / 18;
        const curved = normalized ** 1.65;
        const y = horizonY + curved * (frontY - horizonY);
        const widthAtDepth = width * (0.34 + curved * 0.6);
        context.beginPath();
        context.moveTo(centerX - widthAtDepth / 2, y);
        context.lineTo(centerX + widthAtDepth / 2, y);
        context.stroke();
      }

      context.strokeStyle = 'rgba(237, 242, 237, 0.44)';
      context.lineWidth = Math.max(1, width / 500);
      context.strokeRect(1, 1, width - 2, height - 2);
    }

    function drawSpectrum(width: number, height: number): void {
      for (let rowIndex = 0; rowIndex < historyLength; rowIndex += 1) {
        const depthPosition = rowIndex / Math.max(1, historyLength - 1);
        const historyIndex = (historyCursor - 1 - rowIndex + historyLength) % historyLength;
        const row = history[historyIndex];
        const opacity = 0.22 + depthPosition * 0.78;

        context.strokeStyle = `rgba(237, 242, 237, ${0.22 + opacity * 0.72})`;
        context.lineWidth = 1 + depthPosition * 1.2;
        context.beginPath();

        for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
          const frequencyPosition = pointIndex / Math.max(1, pointCount - 1);
          const point = projectPoint(frequencyPosition, depthPosition, row[pointIndex], width, height);
          if (pointIndex === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.stroke();
      }
    }

    function drawLabels(width: number, height: number): void {
      const fontSize = Math.max(8, Math.round(width / 42));
      context.fillStyle = 'rgba(237, 242, 237, 0.88)';
      context.font = `700 ${fontSize}px "Courier New", monospace`;
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

    function draw(timestamp: number): void {
      animationFrame = window.requestAnimationFrame(draw);
      if (document.hidden || timestamp - lastDrawTime < drawInterval) return;
      lastDrawTime = timestamp;

      if (timestamp - lastSampleTime >= sampleInterval) {
        collectSpectrum();
        lastSampleTime = timestamp;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(canvas.width, canvas.height);
      drawSpectrum(canvas.width, canvas.height);
      drawLabels(canvas.width, canvas.height);
    }

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    resizeCanvas();
    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
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
