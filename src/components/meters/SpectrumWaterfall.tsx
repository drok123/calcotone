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
    let lastSampleTime = 0;
    const historyLength = 24;
    const pointCount = 36;
    const history: number[][] = Array.from({ length: historyLength }, () =>
      Array(pointCount).fill(0)
    );
    const frequencyData = analyser
      ? new Uint8Array(analyser.frequencyBinCount)
      : null;

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

    function collectSpectrum(): number[] {
      if (!analyser || !frequencyData || !running) {
        return Array(pointCount).fill(0);
      }

      analyser.getByteFrequencyData(frequencyData);
      const values: number[] = [];

      for (let point = 0; point < pointCount; point += 1) {
        const normalized = point / Math.max(1, pointCount - 1);
        const startIndex = Math.floor(
          normalized ** 2 * (frequencyData.length - 1)
        );
        const nextNormalized = (point + 1) / pointCount;
        const endIndex = Math.max(
          startIndex + 1,
          Math.floor(nextNormalized ** 2 * frequencyData.length)
        );

        let total = 0;
        let samples = 0;
        for (
          let index = startIndex;
          index < endIndex && index < frequencyData.length;
          index += 1
        ) {
          total += frequencyData[index];
          samples += 1;
        }

        values.push((samples > 0 ? total / samples : 0) / 255);
      }

      return values;
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
      context.strokeStyle = 'rgba(72, 255, 145, 0.13)';
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

      context.strokeStyle = 'rgba(119, 255, 172, 0.48)';
      context.lineWidth = Math.max(1, width / 500);
      context.strokeRect(1, 1, width - 2, height - 2);
    }

    function drawSpectrum(width: number, height: number): void {
      for (let rowIndex = 0; rowIndex < history.length; rowIndex += 1) {
        const depthPosition = rowIndex / Math.max(1, history.length - 1);
        const row = history[history.length - 1 - rowIndex];
        const opacity = 0.22 + depthPosition * 0.78;

        context.strokeStyle = `rgba(92, 255, 154, ${0.22 + opacity * 0.7})`;
        context.lineWidth = 1 + depthPosition * 1.2;
        context.beginPath();

        for (let pointIndex = 0; pointIndex < row.length; pointIndex += 1) {
          const frequencyPosition = pointIndex / Math.max(1, row.length - 1);
          const point = projectPoint(
            frequencyPosition,
            depthPosition,
            row[pointIndex],
            width,
            height
          );

          if (pointIndex === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }

        context.stroke();
      }
    }

    function drawLabels(width: number, height: number): void {
      const fontSize = Math.max(8, Math.round(width / 42));
      context.fillStyle = 'rgba(137, 255, 180, 0.88)';
      context.font = `700 ${fontSize}px "Courier New", monospace`;
      context.textBaseline = 'top';
      context.textAlign = 'left';
      context.fillText('SPECTRUM', width * 0.045, height * 0.045);
      context.textAlign = 'right';
      context.fillText(
        running ? 'LIVE' : 'STANDBY',
        width * 0.955,
        height * 0.045
      );
      context.textBaseline = 'bottom';
      context.textAlign = 'left';
      context.fillText('LOW', width * 0.045, height * 0.955);
      context.textAlign = 'right';
      context.fillText('HIGH', width * 0.955, height * 0.955);
    }

    function draw(timestamp: number): void {
      resizeCanvas();

      if (timestamp - lastSampleTime > 42) {
        history.shift();
        history.push(collectSpectrum());
        lastSampleTime = timestamp;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(canvas.width, canvas.height);
      drawSpectrum(canvas.width, canvas.height);
      drawLabels(canvas.width, canvas.height);
      animationFrame = window.requestAnimationFrame(draw);
    }

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
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
        <canvas
          ref={canvasRef}
          aria-label="Live three-dimensional audio spectrum waterfall"
        />
      </div>

    </section>
  );
}

