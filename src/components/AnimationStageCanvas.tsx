import { useEffect, useRef } from 'react';
import { renderAnimationFrame } from '../animation/renderer';
import {
  ANIMATION_DURATION,
  ANIMATION_FPS,
  LOOP_PAUSE_SECONDS,
} from '../animation/timeline';

declare global {
  interface Window {
    __seekFrame?: (frame: number) => void;
    __seekTime?: (seconds: number) => void;
    __resumePlayback?: () => void;
  }
}

export function AnimationStageCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const params = new URLSearchParams(window.location.search);
    const frameParam = params.get('frame');
    const timeParam = params.get('t');

    let lockedTime: number | null = null;
    if (frameParam !== null && !Number.isNaN(Number(frameParam))) {
      lockedTime = Number(frameParam) / ANIMATION_FPS;
    } else if (timeParam !== null && !Number.isNaN(Number(timeParam))) {
      lockedTime = Number(timeParam);
    }

    let startTimestamp = performance.now();
    let rafId = 0;
    let lastStage = '';
    let lastIntFrame = -1;

    let timerId = 0;

    const syncCanvasSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(window.innerWidth * dpr));
      const h = Math.max(1, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const drawAtTime = (tSeconds: number) => {
      syncCanvasSize();
      const state = renderAnimationFrame(
        ctx,
        canvas.width,
        canvas.height,
        tSeconds
      );
      const intFrame = Math.floor(state.frame);
      if (state.stage !== lastStage) {
        lastStage = state.stage;
        document.body.dataset.stage = state.stage;
        canvas.dataset.stage = state.stage;
      }
      if (intFrame !== lastIntFrame) {
        lastIntFrame = intFrame;
        document.body.dataset.frame = String(intFrame);
        canvas.dataset.frame = String(intFrame);
      }
    };

    const scheduleNext = () => {
      timerId = window.setTimeout(() => {
        rafId = window.requestAnimationFrame(tick);
      }, 16);
    };

    const tick = (now: number) => {
      if (lockedTime !== null) {
        drawAtTime(lockedTime);
        return;
      }

      const cycleDuration = ANIMATION_DURATION + LOOP_PAUSE_SECONDS;
      const elapsedSeconds = (now - startTimestamp) / 1000;
      const cycleTime = elapsedSeconds % cycleDuration;
      const animTime = Math.min(cycleTime, ANIMATION_DURATION);

      drawAtTime(animTime);
      scheduleNext();
    };

    window.__seekFrame = (frame: number) => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      lockedTime = frame / ANIMATION_FPS;
      drawAtTime(lockedTime);
    };

    window.__seekTime = (seconds: number) => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      lockedTime = seconds;
      drawAtTime(lockedTime);
    };

    window.__resumePlayback = () => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      lockedTime = null;
      startTimestamp = performance.now();
      rafId = window.requestAnimationFrame(tick);
    };

    const handleRestart = () => {
      if (lockedTime !== null) return;
      startTimestamp = performance.now();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'r' || e.key === 'R') {
        lockedTime = null;
        startTimestamp = performance.now();
        window.clearTimeout(timerId);
        window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const handleResize = () => {
      syncCanvasSize();
      if (lockedTime !== null) {
        drawAtTime(lockedTime);
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);
    canvas.addEventListener('pointerdown', handleRestart);

    syncCanvasSize();
    if (lockedTime !== null) {
      drawAtTime(lockedTime);
    } else {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('pointerdown', handleRestart);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="animation-canvas"
      aria-label="Procedural 3D folded ribbon and multicolored light streak animation"
      className="block w-screen h-screen bg-black cursor-pointer"
    />
  );
}
