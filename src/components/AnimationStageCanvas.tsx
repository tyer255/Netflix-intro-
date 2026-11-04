import { useEffect, useRef } from 'react';
import { renderAnimationFrame } from '../animation/renderer';
import {
  ANIMATION_DURATION,
  ANIMATION_FPS,
  LOOP_PAUSE_SECONDS,
} from '../animation/timeline';

const INTRO_AUDIO_SRC = '/assets/aistudio/intro-sound.mp3';

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

    // Preload the exact reference audio track for frame-accurate sync
    const audio = new Audio(INTRO_AUDIO_SRC);
    audio.preload = 'auto';
    audio.volume = 1.0;

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
    let timerId = 0;
    let lastStage = '';
    let lastIntFrame = -1;
    let lastCycleIndex = -1;
    let audioUnlocked = false;

    const triggerAudioFromStart = () => {
      if (lockedTime !== null) return;
      try {
        audio.currentTime = 0;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              audioUnlocked = true;
            })
            .catch(() => {
              // Autoplay blocked until first user gesture; global listener will unlock
            });
        }
      } catch {
        // Ignore audio errors in headless environments
      }
    };

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
      const currentCycleIndex = Math.floor(elapsedSeconds / cycleDuration);
      const cycleTime = elapsedSeconds % cycleDuration;

      // Trigger synchronized audio at the exact start (t=0.000s) of each animation cycle
      if (currentCycleIndex !== lastCycleIndex) {
        lastCycleIndex = currentCycleIndex;
        triggerAudioFromStart();
      }

      // If audio is actively playing, lock visual timeline to audio.currentTime for exact audio-visual sync
      let animTime = Math.min(cycleTime, ANIMATION_DURATION);
      if (
        audioUnlocked &&
        !audio.paused &&
        !audio.ended &&
        audio.currentTime > 0 &&
        cycleTime < ANIMATION_DURATION
      ) {
        animTime = Math.min(audio.currentTime, ANIMATION_DURATION);
      }

      drawAtTime(animTime);
      scheduleNext();
    };

    const restartWithSound = () => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      lockedTime = null;
      startTimestamp = performance.now();
      lastCycleIndex = 0;
      triggerAudioFromStart();
      rafId = window.requestAnimationFrame(tick);
    };

    window.__seekFrame = (frame: number) => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      audio.pause();
      lockedTime = frame / ANIMATION_FPS;
      drawAtTime(lockedTime);
    };

    window.__seekTime = (seconds: number) => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      audio.pause();
      lockedTime = seconds;
      drawAtTime(lockedTime);
    };

    window.__resumePlayback = () => {
      restartWithSound();
    };

    const handleUserGesture = () => {
      if (lockedTime !== null) return;
      restartWithSound();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'r' || e.key === 'R') {
        restartWithSound();
      } else if (!audioUnlocked && lockedTime === null) {
        restartWithSound();
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
    window.addEventListener('pointerdown', handleUserGesture);

    syncCanvasSize();
    if (lockedTime !== null) {
      drawAtTime(lockedTime);
    } else {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      audio.pause();
      audio.src = '';
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handleUserGesture);
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
