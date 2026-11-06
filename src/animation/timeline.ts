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
  // Stage 1: Z Ribbon draw-in (0..1)
  /** Top horizontal bar of Z (left -> right) */
  leftPillarProgress: number;
  /** Center diagonal ribbon of Z (top-right -> bottom-left) */
  diagonalRibbonProgress: number;
  /** Bottom horizontal bar of Z (left -> right) */
  rightPillarProgress: number;
  /** 3D fold cast shadows under top and bottom diagonal junctions (0..1) */
  shadowOpacity: number;
  // Stage 2 & 3: Uniform camera zoom & Z -> '|' pipe morph
  scaleX: number;
  scaleY: number;
  /** Target horizontal center X of the Z / pipe in 1920x1080 reference space */
  pipeCenterTargetX: number;
  /** Target left-edge X of the zoomed pipe in 1920x1080 reference space */
  leftStemTargetX: number;
  /** Progress of Z morphing into the center vertical pipe '|' (0..1) */
  morphToPipeProgress: number;
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

export function easeInOutCubic(t: number): number {
  const u = clamp(t, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

export function easeInPow(t: number, p: number): number {
  const u = clamp(t, 0, 1);
  return Math.pow(u, p);
}

export function getStageAtFrame(frame: number): AnimationStage {
  if (frame < 15) return 'initial-appearance';
  if (frame < 40) return 'geometric-hold';
  if (frame < 61) return 'streak-transformation';
  if (frame < 75) return 'multicolored-expansion';
  return 'final-composition';
}

/**
 * Evaluates the deterministic frame-by-frame animation state for any timestamp `time` in seconds.
 * Combines the Netflix-style Z ribbon draw-in and Z -> '|' pipe morph with the full-height
 * zoom and 640-emitter HD multicolored light streak expansion.
 */
export function evaluateTimeline(timeSeconds: number): TimelineState {
  const clampedTime = clamp(timeSeconds, 0, ANIMATION_DURATION);
  const frame = clampedTime * ANIMATION_FPS;
  const stage = getStageAtFrame(frame);

  // Frame 0 (f < 0.65) and Frame 95+ (f >= 94.85) are pure black
  const isBlackFrame = frame < 0.65 || frame >= 94.85;

  // Stage 1: Z Ribbon sequential draw-in (matching netflix_z_intro_038aed5e.html)
  // 1) Top horizontal bar draws left -> right (f=0.65..4.5)
  const leftPillarProgress =
    frame < 0.65 ? 0 : easeOutCubic(invLerp(0.65, 4.5, frame));

  // 2) Diagonal ribbon draws top-right -> bottom-left (f=4.0..9.2)
  const diagonalRibbonProgress =
    frame < 4.0 ? 0 : easeOutCubic(invLerp(4.0, 9.2, frame));

  // 3) Bottom horizontal bar draws left -> right (f=8.5..14.0)
  const rightPillarProgress =
    frame < 8.5 ? 0 : easeOutCubic(invLerp(8.5, 14.0, frame));

  // 4) 3D fold shadows fade in (f=10.5..15.5)
  const shadowOpacity = smoothstep(10.5, 15.5, frame);

  // Stage 2 & 3: Z morphs into vertical pipe '|' (f=39.0..51.5) & zooms to full screen height (f=20..58)
  const morphToPipeProgress = easeInOutCubic(invLerp(39.0, 51.5, frame));

  let scale = 1.0;
  let pipeCenterTargetX = 960;

  if (frame > 20 && frame <= 42) {
    const u = invLerp(20, 42, frame);
    const ease = easeInPow(u, 2.15);
    scale = 1.0 + 0.236 * ease;
    pipeCenterTargetX = lerp(960, 935, ease);
  } else if (frame > 42) {
    const u = invLerp(42, 58, frame);
    scale = 1.236 + (2.92 - 1.236) * easeInPow(u, 2.15);
    // Align the zoomed vertical pipe center with the streak burst column center (886)
    pipeCenterTargetX = lerp(935, 886, easeInPow(u, 1.45));
  }

  const scaleX = scale;
  const scaleY = scale;
  // Pipe width in 1920x1080 space is 68 * scale; compute left edge for streak alignment
  const leftStemTargetX = Math.round(pipeCenterTargetX - 34 * scale);

  // Stage 3: Internal vertical red/scarlet/amber streaks appear as Z morphs into the vertical pipe '|'
  const internalStreakIntensity = smoothstep(42.5, 51.5, frame);

  const rightPillarDissolve = morphToPipeProgress;
  const diagonalRetractProgress = morphToPipeProgress;

  // Emblem/pipe stays 100% pure crisp vector through f=57, crossfading cleanly at f=56.5..58.5
  const emblemOpacity =
    frame < 0.65 ? 0 : 1.0 - smoothstep(56.5, 58.5, frame);

  // HD 640-emitter streak synthesizer fades in cleanly at f=55.8..58.2 just as the pipe hits full screen height
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
    shadowOpacity,
    scaleX,
    scaleY,
    pipeCenterTargetX,
    leftStemTargetX,
    morphToPipeProgress,
    internalStreakIntensity,
    rightPillarDissolve,
    diagonalRetractProgress,
    emblemOpacity,
    streakFieldOpacity,
    expansionProgress,
    finalSweepProgress,
  };
}
