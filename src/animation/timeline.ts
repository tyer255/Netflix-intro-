export const ANIMATION_FPS = 24;
export const TOTAL_FRAMES = 96;
export const ANIMATION_DURATION = TOTAL_FRAMES / ANIMATION_FPS; // 4.000s
export const LOOP_PAUSE_SECONDS = 0.35; // brief pure-black pause before seamless loop

export type AnimationStage =
  | 'initial-appearance'
  | 'geometric-hold'
  | 'streak-transformation'
  | 'multicolored-expansion'
  | 'final-composition';

export interface TimelineState {
  time: number;
  frame: number;
  stage: AnimationStage;
  isBlackFrame: boolean;
  // Stage 1: Ribbon draw-in (0..1)
  leftPillarProgress: number;
  diagonalRibbonProgress: number;
  rightPillarProgress: number;
  // Stage 2 & 3: Uniform camera zoom onto the Left '|' stem
  scaleX: number;
  scaleY: number;
  /** Target left-edge X of the Left '|' stem in 1920x1080 reference space */
  leftStemTargetX: number;
  // Stage 3: Emblem transformation into streaks (0..1)
  internalStreakIntensity: number;
  rightPillarDissolve: number;
  diagonalRetractProgress: number;
  emblemOpacity: number;
  // Stage 3-5: Volumetric streak synthesizer blend (0..1)
  streakFieldOpacity: number;
  // Stage 4-5: Horizontal expansion & final sweep progress (0..1)
  expansionProgress: number;
  finalSweepProgress: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function invLerp(a: number, b: number, v: number): number {
  if (Math.abs(b - a) < 1e-9) return 0;
  return clamp((v - a) / (b - a), 0, 1);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t: number): number {
  const u = clamp(t, 0, 1);
  return 1 - Math.pow(1 - u, 3);
}

export function easeInCubic(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * u;
}

export function easeInPow(t: number, p: number): number {
  const u = clamp(t, 0, 1);
  return Math.pow(u, p);
}

export function getStageAtFrame(frame: number): AnimationStage {
  if (frame < 14) return 'initial-appearance';
  if (frame < 42) return 'geometric-hold';
  if (frame < 61) return 'streak-transformation';
  if (frame < 75) return 'multicolored-expansion';
  return 'final-composition';
}

/**
 * Evaluates the deterministic frame-by-frame animation state for any timestamp `time` in seconds.
 * Calibrated directly against the 96-frame (24fps) reference video progression, including the
 * exact uniform camera zoom pivoted onto the Left '|' vertical stem during frames 42..58.
 */
export function evaluateTimeline(timeSeconds: number): TimelineState {
  const clampedTime = clamp(timeSeconds, 0, ANIMATION_DURATION);
  const frame = clampedTime * ANIMATION_FPS;
  const stage = getStageAtFrame(frame);

  // Frame 0 (f < 0.65) and Frame 95+ (f >= 94.85) are pure black
  const isBlackFrame = frame < 0.65 || frame >= 94.85;

  // Stage 1:
  // f=1..4: Left vertical pillar grows upward from bottom (y=726 -> y=352)
  const leftPillarProgress =
    frame < 0.65 ? 0 : easeOutCubic(invLerp(0.65, 4.0, frame));

  // f=4..8: Center folded diagonal ribbon unfolds from top-left to bottom-right
  const diagonalRibbonProgress =
    frame < 4.0 ? 0 : easeOutCubic(invLerp(4.0, 8.0, frame));

  // f=7.2..14: Right vertical pillar grows upward from bottom-right behind the diagonal fold
  const rightPillarProgress =
    frame < 7.2 ? 0 : easeOutCubic(invLerp(7.2, 13.8, frame));

  // Stage 2 & 3: Camera zoom pivoted onto the Left '|' vertical stem
  // At f<=20: scale = 1.000, leftStemTargetX = 856 (w=72, h=374)
  // At f=42:  scale = 1.236, leftStemTargetX = 838 (w=89, h=462, topY=309, botY=771)
  // At f=58:  scale = 2.920, leftStemTargetX = 782 (w=210 -> x=[782..992], h=1092 -> y=[0..1080])
  let scale = 1.0;
  let leftStemTargetX = 856;

  if (frame > 20 && frame <= 42) {
    const u = invLerp(20, 42, frame);
    const ease = easeInPow(u, 2.15);
    scale = 1.0 + 0.236 * ease;
    leftStemTargetX = lerp(856, 838, ease);
  } else if (frame > 42) {
    const u = invLerp(42, 58, frame);
    scale = 1.236 + (2.92 - 1.236) * easeInPow(u, 2.15);
    leftStemTargetX = lerp(838, 782, easeInPow(u, 1.55));
  }

  const scaleX = scale;
  const scaleY = scale;

  // Stage 3: Transformation into vertical red light streaks
  // Internal streaks appear inside the emblem starting at f=42
  const internalStreakIntensity = smoothstep(41.5, 50.0, frame);

  // Right '|' pillar splits into vertical red hairlines and retracts 100% downward into the bottom-right corner over f=42.5..49.2
  const rightPillarDissolve = easeInPow(invLerp(42.5, 49.2, frame), 1.35);

  // Diagonal '\' ribbon splits into diagonal streaks and retracts/zips upward into the top of the Left '|' stem over f=48.0..54.5
  const diagonalRetractProgress = easeInPow(invLerp(48.0, 54.5, frame), 1.4);

  // Emblem geometry stays 100% pure crisp vector through f=57, crossfading cleanly at f=56.5..58.5
  const emblemOpacity =
    frame < 0.65 ? 0 : 1.0 - smoothstep(56.5, 58.5, frame);

  // HD 640-emitter streak synthesizer fades in cleanly at f=56.0..58.2 just as Left '|' stem hits full screen height
  let streakFieldOpacity = 0;
  if (frame >= 55.8 && frame < 94.85) {
    streakFieldOpacity = smoothstep(55.8, 58.2, frame);
    if (frame > 94.2) {
      streakFieldOpacity *= 1.0 - smoothstep(94.2, 94.9, frame);
    }
  }

  const expansionProgress = invLerp(60.0, 75.0, frame);
  const finalSweepProgress = invLerp(75.0, 94.8, frame);

  return {
    time: clampedTime,
    frame,
    stage,
    isBlackFrame,
    leftPillarProgress,
    diagonalRibbonProgress,
    rightPillarProgress,
    scaleX,
    scaleY,
    leftStemTargetX,
    internalStreakIntensity,
    rightPillarDissolve,
    diagonalRetractProgress,
    emblemOpacity,
    streakFieldOpacity,
    expansionProgress,
    finalSweepProgress,
  };
}
