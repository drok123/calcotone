import { forwardRef, useEffect, useRef } from 'react';
import './TemporalVideo.css';

interface TemporalVideoProps {
  src: string;
  className: string;
  playbackRate: number;
  loop?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  onCanPlay?: (video: HTMLVideoElement) => void;
  onError?: () => void;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const MAX_RENDER_WIDTH = 1280;
const MAX_RENDER_HEIGHT = 720;
const MAX_DEVICE_SCALE = 1.25;
const MIN_FRAME_INTERVAL_MS = 32;
const MAX_FRAME_INTERVAL_MS = 420;
const MIN_RENDER_INTERVAL_MS = 14;

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return;
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (targetWidth - width) * 0.5;
  const y = (targetHeight - height) * 0.5;
  context.drawImage(source, x, y, width, height);
}

function easeFrameBlend(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/**
 * CALCOTONE's lightweight slow-motion renderer.
 *
 * Browser playbackRate can only hold decoded frames longer; it cannot invent motion
 * between them. This component captures each newly presented decoder frame and blends
 * from the previous frame to the new one at display refresh rate. The tiny opposing
 * sub-pixel drift on the two layers hides cadence edges without requiring optical-flow
 * inference or extra video decoders.
 */
export const TemporalVideo = forwardRef<HTMLVideoElement, TemporalVideoProps>(function TemporalVideo({
  src,
  className,
  playbackRate,
  loop = true,
  preload = 'auto',
  onCanPlay,
  onError,
}, forwardedRef) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    video.defaultPlaybackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current as FrameCallbackVideo | null;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const previous = document.createElement('canvas');
    const current = document.createElement('canvas');
    let previousContext = previous.getContext('2d', { alpha: false });
    let currentContext = current.getContext('2d', { alpha: false });
    const output = canvas.getContext('2d', { alpha: false });
    if (!previousContext || !currentContext || !output) return;

    let cancelled = false;
    let animationHandle = 0;
    let videoFrameHandle: number | null = null;
    let fallbackHandle = 0;
    let haveFrame = false;
    let lastCaptureAt = performance.now();
    let lastVideoTime = -1;
    let lastRenderAt = 0;
    let frameIntervalMs = 1000 / Math.max(1, 30 * playbackRateRef.current);

    const resizeBuffers = (): boolean => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      const scale = Math.min(MAX_DEVICE_SCALE, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(2, Math.min(MAX_RENDER_WIDTH, Math.round(rect.width * scale)));
      const height = Math.max(2, Math.min(MAX_RENDER_HEIGHT, Math.round(rect.height * scale)));
      if (canvas.width === width && canvas.height === height && previous.width === width && current.width === width) return true;

      canvas.width = width;
      canvas.height = height;
      previous.width = width;
      previous.height = height;
      current.width = width;
      current.height = height;
      previousContext = previous.getContext('2d', { alpha: false });
      currentContext = current.getContext('2d', { alpha: false });
      haveFrame = false;
      return Boolean(previousContext && currentContext);
    };

    const snapshot = (now: number): void => {
      if (cancelled || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      if (!resizeBuffers() || !previousContext || !currentContext) return;

      if (haveFrame) {
        previousContext.setTransform(1, 0, 0, 1, 0, 0);
        previousContext.clearRect(0, 0, previous.width, previous.height);
        previousContext.drawImage(current, 0, 0);
        const observed = now - lastCaptureAt;
        if (observed >= MIN_FRAME_INTERVAL_MS && observed <= MAX_FRAME_INTERVAL_MS) {
          frameIntervalMs = frameIntervalMs * 0.72 + observed * 0.28;
        }
      }

      currentContext.setTransform(1, 0, 0, 1, 0, 0);
      currentContext.clearRect(0, 0, current.width, current.height);
      drawCover(currentContext, video, video.videoWidth, video.videoHeight, current.width, current.height);

      if (!haveFrame) {
        previousContext.drawImage(current, 0, 0);
        haveFrame = true;
      }
      lastCaptureAt = now;
    };

    const render = (now: number): void => {
      if (cancelled) return;
      if (now - lastRenderAt < MIN_RENDER_INTERVAL_MS) {
        animationHandle = requestAnimationFrame(render);
        return;
      }
      lastRenderAt = now;

      if (haveFrame && canvas.width > 1 && canvas.height > 1) {
        const blend = easeFrameBlend((now - lastCaptureAt) / Math.max(MIN_FRAME_INTERVAL_MS, frameIntervalMs * 0.94));
        const width = canvas.width;
        const height = canvas.height;
        const drift = Math.min(1.25, width * 0.00085);

        output.setTransform(1, 0, 0, 1, 0, 0);
        output.globalAlpha = 1;
        output.clearRect(0, 0, width, height);

        output.globalAlpha = 1 - blend;
        output.drawImage(previous, -drift * blend, 0, width + drift, height);
        output.globalAlpha = blend;
        output.drawImage(current, drift * (1 - blend), 0, width + drift, height);
        output.globalAlpha = 1;
      }
      animationHandle = requestAnimationFrame(render);
    };

    const requestNextVideoFrame = (): void => {
      if (cancelled || !video.requestVideoFrameCallback) return;
      videoFrameHandle = video.requestVideoFrameCallback((now) => {
        snapshot(now);
        requestNextVideoFrame();
      });
    };

    const fallbackPoll = (now: number): void => {
      if (cancelled) return;
      if (Math.abs(video.currentTime - lastVideoTime) > 0.0005) {
        lastVideoTime = video.currentTime;
        snapshot(now);
      }
      fallbackHandle = requestAnimationFrame(fallbackPoll);
    };

    video.playbackRate = playbackRateRef.current;
    video.defaultPlaybackRate = playbackRateRef.current;
    video.muted = true;
    video.loop = loop;
    resizeBuffers();

    if (video.requestVideoFrameCallback) requestNextVideoFrame();
    else fallbackHandle = requestAnimationFrame(fallbackPoll);
    animationHandle = requestAnimationFrame(render);

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resizeBuffers()) : null;
    resizeObserver?.observe(canvas);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      cancelAnimationFrame(animationHandle);
      cancelAnimationFrame(fallbackHandle);
      if (videoFrameHandle !== null) video.cancelVideoFrameCallback?.(videoFrameHandle);
    };
  }, [src, loop]);

  return (
    <span className={`${className} temporal-video`} aria-hidden="true">
      <video
        ref={(node) => {
          videoRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        className="temporal-video-source"
        src={src}
        autoPlay
        muted
        loop={loop}
        playsInline
        preload={preload}
        onCanPlay={(event) => onCanPlay?.(event.currentTarget)}
        onError={() => onError?.()}
      />
      <canvas ref={canvasRef} className="temporal-video-canvas" />
    </span>
  );
});
