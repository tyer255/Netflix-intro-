import {
  getStreakFieldCoefficients,
  STREAK_FIELD_END_FRAME,
  STREAK_FIELD_NUM_EMITTERS,
  STREAK_FIELD_START_FRAME,
} from './streakFieldData';
import { clamp, invLerp, lerp, smoothstep } from './timeline';

export interface EmitterColumnSample {
  /** Normalized horizontal coordinate in [0, 1] */
  u: number;
  rTop: number;
  gTop: number;
  bTop: number;
  rMid: number;
  gMid: number;
  bMid: number;
  rBot: number;
  gBot: number;
  bBot: number;
  maxLum: number;
}

export interface KinematicFilament {
  /** Normalized horizontal position in [0, 1] */
  u: number;
  /** Normalized width relative to viewport width */
  widthNorm: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  glowRadiusNorm: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const v =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return clamp(v, 0, 255);
}

/**
 * Evaluates all 240 horizontal light-streak emitters at any continuous floating-point frame
 * in [42..95] using smooth cubic Catmull-Rom temporal interpolation across the 3 vertical bands.
 */
export function evaluateStreakEmittersAtFrame(frameFloat: number): EmitterColumnSample[] {
  const coeffs = getStreakFieldCoefficients();
  const numX = STREAK_FIELD_NUM_EMITTERS;
  const strideF = numX * 9;

  const fClamped = clamp(frameFloat, STREAK_FIELD_START_FRAME, STREAK_FIELD_END_FRAME);
  const idxFloat = fClamped - STREAK_FIELD_START_FRAME;
  const i1 = Math.floor(idxFloat);
  const frac = idxFloat - i1;

  const maxIdx = STREAK_FIELD_END_FRAME - STREAK_FIELD_START_FRAME;
  const i0 = Math.max(0, i1 - 1);
  const i2 = Math.min(maxIdx, i1 + 1);
  const i3 = Math.min(maxIdx, i1 + 2);

  const off0 = i0 * strideF;
  const off1 = i1 * strideF;
  const off2 = i2 * strideF;
  const off3 = i3 * strideF;

  const out: EmitterColumnSample[] = new Array(numX);

  for (let k = 0; k < numX; k++) {
    const k9 = k * 9;
    const rTop = catmullRom(coeffs[off0 + k9], coeffs[off1 + k9], coeffs[off2 + k9], coeffs[off3 + k9], frac);
    const gTop = catmullRom(coeffs[off0 + k9 + 1], coeffs[off1 + k9 + 1], coeffs[off2 + k9 + 1], coeffs[off3 + k9 + 1], frac);
    const bTop = catmullRom(coeffs[off0 + k9 + 2], coeffs[off1 + k9 + 2], coeffs[off2 + k9 + 2], coeffs[off3 + k9 + 2], frac);

    const rMid = catmullRom(coeffs[off0 + k9 + 3], coeffs[off1 + k9 + 3], coeffs[off2 + k9 + 3], coeffs[off3 + k9 + 3], frac);
    const gMid = catmullRom(coeffs[off0 + k9 + 4], coeffs[off1 + k9 + 4], coeffs[off2 + k9 + 4], coeffs[off3 + k9 + 4], frac);
    const bMid = catmullRom(coeffs[off0 + k9 + 5], coeffs[off1 + k9 + 5], coeffs[off2 + k9 + 5], coeffs[off3 + k9 + 5], frac);

    const rBot = catmullRom(coeffs[off0 + k9 + 6], coeffs[off1 + k9 + 6], coeffs[off2 + k9 + 6], coeffs[off3 + k9 + 6], frac);
    const gBot = catmullRom(coeffs[off0 + k9 + 7], coeffs[off1 + k9 + 7], coeffs[off2 + k9 + 7], coeffs[off3 + k9 + 7], frac);
    const bBot = catmullRom(coeffs[off0 + k9 + 8], coeffs[off1 + k9 + 8], coeffs[off2 + k9 + 8], coeffs[off3 + k9 + 8], frac);

    const maxLum = Math.max(rTop, gTop, bTop, rMid, gMid, bMid, rBot, gBot, bBot);

    out[k] = {
      u: k / (numX - 1),
      rTop,
      gTop,
      bTop,
      rMid,
      gMid,
      bMid,
      rBot,
      gBot,
      bBot,
      maxLum,
    };
  }

  return out;
}

interface FilamentSeed {
  offsetNorm: number;
  speed: number;
  widthNorm: number;
  color: [number, number, number];
  fStart: number;
  fPeak: number;
  fEnd: number;
}

const FILAMENT_SEEDS: FilamentSeed[] = [
  // Core red/amber filaments during initial burst (f=56..72)
  { offsetNorm: -0.028, speed: -0.22, widthNorm: 0.0018, color: [255, 195, 70], fStart: 56, fPeak: 63, fEnd: 74 },
  { offsetNorm: -0.015, speed: -0.14, widthNorm: 0.0022, color: [255, 60, 20], fStart: 55, fPeak: 62, fEnd: 76 },
  { offsetNorm: -0.004, speed: -0.05, widthNorm: 0.0015, color: [255, 130, 45], fStart: 56, fPeak: 64, fEnd: 78 },
  { offsetNorm: 0.006, speed: 0.04, widthNorm: 0.0020, color: [245, 10, 25], fStart: 55, fPeak: 63, fEnd: 82 },
  { offsetNorm: 0.018, speed: 0.16, widthNorm: 0.0016, color: [255, 95, 145], fStart: 60, fPeak: 66, fEnd: 79 },
  // Leftward warm gold / peach / crimson high-velocity filaments (f=62..85)
  { offsetNorm: -0.042, speed: -0.38, widthNorm: 0.0024, color: [255, 220, 165], fStart: 62, fPeak: 69, fEnd: 85 },
  { offsetNorm: -0.032, speed: -0.28, widthNorm: 0.0018, color: [245, 90, 50], fStart: 62, fPeak: 70, fEnd: 86 },
  { offsetNorm: -0.021, speed: -0.19, widthNorm: 0.0025, color: [255, 155, 95], fStart: 63, fPeak: 72, fEnd: 86 },
  { offsetNorm: -0.011, speed: -0.09, widthNorm: 0.0016, color: [240, 15, 10], fStart: 63, fPeak: 74, fEnd: 87 },
  // Rightward cyan / electric blue / magenta filaments (f=63..85)
  { offsetNorm: 0.025, speed: 0.24, widthNorm: 0.0018, color: [195, 95, 220], fStart: 62, fPeak: 68, fEnd: 82 },
  { offsetNorm: 0.038, speed: 0.34, widthNorm: 0.0022, color: [45, 145, 255], fStart: 63, fPeak: 70, fEnd: 81 },
  { offsetNorm: 0.048, speed: 0.42, widthNorm: 0.0028, color: [130, 210, 255], fStart: 64, fPeak: 71, fEnd: 80 },
  { offsetNorm: 0.056, speed: 0.51, widthNorm: 0.0020, color: [20, 110, 245], fStart: 64, fPeak: 72, fEnd: 81 },
  { offsetNorm: 0.031, speed: 0.31, widthNorm: 0.0024, color: [240, 140, 185], fStart: 74, fPeak: 82, fEnd: 87 },
];

/**
 * Evaluates procedural high-definition optical micro-filaments that overlay
 * crisp specular cores and subtle 3D perspective motion onto the streak curtain.
 */
export function evaluateKinematicFilaments(frameFloat: number): KinematicFilament[] {
  if (frameFloat < 54 || frameFloat >= 94.8) return [];
  const originU = 0.462; // Left pillar center in normalized 1920 space (887 / 1920)
  const result: KinematicFilament[] = [];

  for (const seed of FILAMENT_SEEDS) {
    if (frameFloat < seed.fStart || frameFloat > seed.fEnd) continue;
    const lifeU = invLerp(seed.fStart, seed.fEnd, frameFloat);
    // Perspective acceleration: 1 / (1 - 0.65 * lifeU)
    const perspectiveExpansion = Math.pow(lifeU, 1.65) * 1.35;
    const u = originU + seed.offsetNorm + seed.speed * perspectiveExpansion;
    if (u < -0.05 || u > 1.05) continue;

    const fadeIn = smoothstep(seed.fStart, seed.fPeak, frameFloat);
    const fadeOut = 1.0 - smoothstep(seed.fPeak, seed.fEnd, frameFloat);
    const alpha = fadeIn * fadeOut * 0.42;

    if (alpha > 0.01) {
      const widthNorm = seed.widthNorm * lerp(0.8, 1.8, lifeU);
      result.push({
        u,
        widthNorm,
        r: seed.color[0],
        g: seed.color[1],
        b: seed.color[2],
        alpha,
        glowRadiusNorm: widthNorm * 3.2,
      });
    }
  }

  return result;
}
