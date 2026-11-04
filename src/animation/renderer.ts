import {
  evaluateKinematicFilaments,
  evaluateStreakEmittersAtFrame,
} from './streakEngine';
import {
  STREAK_FIELD_NUM_EMITTERS,
} from './streakFieldData';
import {
  clamp,
  evaluateTimeline,
  lerp,
  smoothstep,
  TimelineState,
} from './timeline';

const REF_W = 1920;
const REF_H = 1080;
const CENTER_X = 960;
const CENTER_Y = 540;

// Exact emblem coordinates in 1920x1080 space
const EMBLEM_LEFT = 856;
const EMBLEM_RIGHT = 1062;
const EMBLEM_TOP = 352;
const EMBLEM_BOT = 726;
const STEM_W = 72; // 856..928 and 990..1062

// High-definition vector streak layout inside the emblem (for ultra-crisp Stage 3 zoom!)
const INTERNAL_RIBBON_STREAKS = [
  { frac: 0.03, w: 2.2, r: 165, g: 0, b: 0 },
  { frac: 0.09, w: 3.0, r: 245, g: 18, b: 4 },
  { frac: 0.16, w: 1.8, r: 95, g: 0, b: 0 },
  { frac: 0.22, w: 3.6, r: 252, g: 58, b: 8 },
  { frac: 0.29, w: 2.0, r: 150, g: 0, b: 0 },
  { frac: 0.35, w: 2.8, r: 240, g: 12, b: 2 },
  { frac: 0.42, w: 3.4, r: 255, g: 118, b: 16 },
  { frac: 0.49, w: 1.8, r: 85, g: 0, b: 0 },
  { frac: 0.55, w: 3.8, r: 248, g: 28, b: 4 },
  { frac: 0.63, w: 2.2, r: 195, g: 4, b: 2 },
  { frac: 0.70, w: 3.2, r: 252, g: 75, b: 10 },
  { frac: 0.77, w: 2.0, r: 130, g: 0, b: 0 },
  { frac: 0.84, w: 3.4, r: 244, g: 14, b: 4 },
  { frac: 0.91, w: 2.4, r: 215, g: 38, b: 6 },
  { frac: 0.96, w: 1.8, r: 170, g: 0, b: 0 },
];

// Reusable HD 640x16 offscreen buffer for razor-sharp 2D spectral streak synthesis
const OFFSCREEN_W = STREAK_FIELD_NUM_EMITTERS; // 640
const OFFSCREEN_H = 16;
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;
let offscreenImageData: ImageData | null = null;

function getOffscreenBuffer(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imgData: ImageData;
} | null {
  if (typeof document === 'undefined') return null;
  if (!offscreenCanvas || offscreenCanvas.width !== OFFSCREEN_W) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = OFFSCREEN_W;
    offscreenCanvas.height = OFFSCREEN_H;
    offscreenCtx = offscreenCanvas.getContext('2d');
    if (offscreenCtx) {
      offscreenImageData = offscreenCtx.createImageData(OFFSCREEN_W, OFFSCREEN_H);
    }
  }
  if (!offscreenCanvas || !offscreenCtx || !offscreenImageData) return null;
  return {
    canvas: offscreenCanvas,
    ctx: offscreenCtx,
    imgData: offscreenImageData,
  };
}

/**
 * Applies the responsive reference-to-viewport coordinate transform and the
 * Left-stem pivoted camera zoom so that `EMBLEM_LEFT` (856) maps to `state.leftStemTargetX`
 * and `CENTER_Y` (540) stays vertically centered.
 */
function applyEmblemCameraTransform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TimelineState
): void {
  const fitScale = Math.min(width / (REF_W * 0.55), height / REF_H);
  const baseScale = Math.max(width / REF_W, fitScale * 0.85);

  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(baseScale, baseScale);
  ctx.translate(state.leftStemTargetX - CENTER_X, 0);
  ctx.scale(state.scaleX, state.scaleY);
  ctx.translate(-EMBLEM_LEFT, -CENTER_Y);
}

/**
 * Renders the 3D folded geometric ribbon emblem for Stages 1, 2, and 3
 * using crisp native-DPI vector geometry.
 */
function renderGeometricEmblem(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TimelineState
): void {
  if (state.emblemOpacity <= 0.001 || state.leftPillarProgress <= 0.001) return;

  ctx.save();
  ctx.globalAlpha = state.emblemOpacity;

  applyEmblemCameraTransform(ctx, width, height, state);

  // Clip emblem with the signature concave bottom arch (and top edge)
  ctx.beginPath();
  ctx.moveTo(EMBLEM_LEFT - 20, EMBLEM_TOP);
  ctx.lineTo(EMBLEM_RIGHT + 20, EMBLEM_TOP);
  ctx.lineTo(EMBLEM_RIGHT + 20, EMBLEM_BOT + 4);
  ctx.quadraticCurveTo(CENTER_X, EMBLEM_BOT - 9.5, EMBLEM_LEFT - 20, EMBLEM_BOT + 4);
  ctx.closePath();
  ctx.clip();

  // ---------------------------------------------------------------------------
  // 1. RIGHT VERTICAL PILLAR (tucked behind the diagonal ribbon)
  // Splits into crisp vertical red hairlines and retracts 100% downward into bottom-right (f=42.5..49.2)
  // ---------------------------------------------------------------------------
  if (state.rightPillarProgress > 0.001 && state.rightPillarDissolve < 0.999) {
    const rLeft = EMBLEM_RIGHT - STEM_W; // 990
    const rRight = EMBLEM_RIGHT; // 1062
    const growTop = lerp(EMBLEM_BOT, EMBLEM_TOP, state.rightPillarProgress);
    const dissolveTop = lerp(growTop, EMBLEM_BOT, state.rightPillarDissolve);
    const rAlpha = clamp(1.0 - Math.pow(state.rightPillarDissolve, 1.6), 0, 1);

    ctx.save();
    ctx.globalAlpha = state.emblemOpacity * rAlpha;

    const rightGrad = ctx.createLinearGradient(rLeft, 0, rRight, 0);
    rightGrad.addColorStop(0, 'rgb(128, 0, 0)');
    rightGrad.addColorStop(0.25, 'rgb(148, 0, 0)');
    rightGrad.addColorStop(0.78, 'rgb(142, 0, 0)');
    rightGrad.addColorStop(1, 'rgb(118, 0, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(rLeft, dissolveTop, STEM_W, EMBLEM_BOT - dissolveTop);

    // Crisp 3D cast shadow from the diagonal ribbon onto the lower portion of the right pillar
    const rShadowGrad = ctx.createLinearGradient(
      rLeft,
      EMBLEM_BOT - 190,
      rLeft + 32,
      EMBLEM_BOT - 38
    );
    rShadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rShadowGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.48)');
    rShadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.76)');
    ctx.fillStyle = rShadowGrad;
    ctx.fillRect(rLeft, dissolveTop, STEM_W, EMBLEM_BOT - dissolveTop);

    // Crisp vertical vector hairlines as Right Pillar retracts downward (f=42.5..49)
    if (state.internalStreakIntensity > 0.01) {
      const sInt = state.internalStreakIntensity;
      for (let i = 0; i < INTERNAL_RIBBON_STREAKS.length; i++) {
        const st = INTERNAL_RIBBON_STREAKS[i];
        const sx = rLeft + st.frac * STEM_W;
        const tipOffset = (i % 3) * 18 * state.rightPillarDissolve;
        const yStart = Math.max(EMBLEM_TOP, dissolveTop - tipOffset);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.88 * sInt})`;
        ctx.fillRect(sx + st.w * 0.45, dissolveTop, 2.2, EMBLEM_BOT - dissolveTop);
        ctx.fillStyle = `rgba(${st.r}, 0, 0, ${0.95 * sInt})`;
        ctx.fillRect(sx - st.w * 0.45, yStart, st.w * 0.9, EMBLEM_BOT - yStart);
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 2. LEFT VERTICAL PILLAR ('|' line of the N that zooms to full height!)
  // ---------------------------------------------------------------------------
  if (state.leftPillarProgress > 0.001) {
    const lLeft = EMBLEM_LEFT; // 856
    const lRight = EMBLEM_LEFT + STEM_W; // 928
    const lTop = lerp(EMBLEM_BOT, EMBLEM_TOP, state.leftPillarProgress);

    const leftGrad = ctx.createLinearGradient(lLeft, 0, lRight, 0);
    leftGrad.addColorStop(0, 'rgb(126, 0, 0)');
    leftGrad.addColorStop(0.22, 'rgb(146, 0, 0)');
    leftGrad.addColorStop(0.76, 'rgb(142, 0, 0)');
    leftGrad.addColorStop(1, 'rgb(116, 0, 0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(lLeft, lTop, STEM_W, EMBLEM_BOT - lTop);

    // Top-fold 3D cast shadow underneath the diagonal ribbon's upper fold
    if (state.diagonalRibbonProgress > 0.01) {
      const shadowStrength =
        clamp(state.diagonalRibbonProgress * 1.2, 0, 1) *
        (1 - state.diagonalRetractProgress * 0.9);
      if (shadowStrength > 0.01) {
        const lShadowGrad = ctx.createLinearGradient(
          lRight,
          EMBLEM_TOP + 18,
          lLeft,
          EMBLEM_TOP + 180
        );
        lShadowGrad.addColorStop(0, `rgba(0, 0, 0, ${0.72 * shadowStrength})`);
        lShadowGrad.addColorStop(0.55, `rgba(0, 0, 0, ${0.30 * shadowStrength})`);
        lShadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = lShadowGrad;
        ctx.fillRect(lLeft, lTop, STEM_W, EMBLEM_BOT - lTop);
      }
    }

    // Stage 3: Razor-sharp vector red, scarlet, and warm-amber light streaks inside the zooming Left '|' Pillar
    if (state.internalStreakIntensity > 0.01) {
      const splitAlpha = state.internalStreakIntensity;
      // Crisp dark background channels between vector filaments
      ctx.fillStyle = `rgba(6, 0, 0, ${0.82 * splitAlpha})`;
      ctx.fillRect(lLeft + 8, lTop, 2.0, EMBLEM_BOT - lTop);
      ctx.fillRect(lLeft + 19, lTop, 2.4, EMBLEM_BOT - lTop);
      ctx.fillRect(lLeft + 33, lTop, 2.2, EMBLEM_BOT - lTop);
      ctx.fillRect(lLeft + 46, lTop, 2.5, EMBLEM_BOT - lTop);
      ctx.fillRect(lLeft + 60, lTop, 2.0, EMBLEM_BOT - lTop);

      for (const st of INTERNAL_RIBBON_STREAKS) {
        const sx = lLeft + st.frac * STEM_W;
        ctx.fillStyle = `rgba(${st.r}, ${st.g}, ${st.b}, ${0.98 * splitAlpha})`;
        ctx.fillRect(sx - st.w * 0.45, lTop, st.w * 0.9, EMBLEM_BOT - lTop);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CENTER FOLDED DIAGONAL RIBBON
  // Splits into crisp DIAGONAL vector streaks parallel to '\' and retracts upward into the Left '|' stem
  // ---------------------------------------------------------------------------
  const diagActiveProg = clamp(
    state.diagonalRibbonProgress - state.diagonalRetractProgress,
    0,
    1
  );
  if (diagActiveProg > 0.001) {
    const topL = EMBLEM_LEFT; // 856
    const topR = EMBLEM_LEFT + STEM_W; // 928
    const fullBotL = EMBLEM_RIGHT - STEM_W; // 990
    const fullBotR = EMBLEM_RIGHT; // 1062

    const botL = lerp(topL, fullBotL, diagActiveProg);
    const botR = lerp(topR, fullBotR, diagActiveProg);
    const curBotY = lerp(EMBLEM_TOP, EMBLEM_BOT, diagActiveProg);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(topL, EMBLEM_TOP);
    ctx.lineTo(topR, EMBLEM_TOP);
    ctx.lineTo(botR, curBotY);
    ctx.lineTo(botL, curBotY);
    ctx.closePath();
    ctx.clip();

    const diagGrad = ctx.createLinearGradient(topL, EMBLEM_TOP, botR, curBotY);
    diagGrad.addColorStop(0, 'rgb(238, 0, 0)');
    diagGrad.addColorStop(0.45, 'rgb(244, 4, 4)');
    diagGrad.addColorStop(0.55, 'rgb(248, 10, 8)');
    diagGrad.addColorStop(1, 'rgb(238, 0, 0)');
    ctx.fillStyle = diagGrad;
    ctx.fillRect(
      EMBLEM_LEFT,
      EMBLEM_TOP,
      EMBLEM_RIGHT - EMBLEM_LEFT,
      EMBLEM_BOT - EMBLEM_TOP
    );

    // Stage 3: Crisp diagonal vector streak lines parallel to the '\' ribbon
    if (state.internalStreakIntensity > 0.01) {
      const sAlpha = state.internalStreakIntensity;
      for (let i = 0; i < INTERNAL_RIBBON_STREAKS.length; i++) {
        const st = INTERNAL_RIBBON_STREAKS[i];
        const xTop = topL + st.frac * STEM_W;
        const xBot = botL + st.frac * STEM_W;

        ctx.beginPath();
        ctx.moveTo(xTop - st.w * 0.4, EMBLEM_TOP);
        ctx.lineTo(xTop + st.w * 0.4, EMBLEM_TOP);
        ctx.lineTo(xBot + st.w * 0.4, curBotY);
        ctx.lineTo(xBot - st.w * 0.4, curBotY);
        ctx.closePath();
        ctx.fillStyle = `rgba(8, 0, 0, ${0.84 * sAlpha})`;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(xTop + st.w * 0.4, EMBLEM_TOP);
        ctx.lineTo(xTop + st.w * 1.15, EMBLEM_TOP);
        ctx.lineTo(xBot + st.w * 1.15, curBotY);
        ctx.lineTo(xBot + st.w * 0.4, curBotY);
        ctx.closePath();
        ctx.fillStyle = `rgba(${st.r}, ${st.g}, ${st.b}, ${0.95 * sAlpha})`;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Renders the High-Definition 640-Emitter Volumetric Light Streak Synthesizer
 * plus crisp native-DPI vector micro-filaments for Stages 3, 4, and 5.
 */
function renderVolumetricLightStreaks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TimelineState
): void {
  if (state.streakFieldOpacity <= 0.001) return;

  const emitters = evaluateStreakEmittersAtFrame(state.frame);
  const offscreen = getOffscreenBuffer();

  ctx.save();
  ctx.globalAlpha = state.streakFieldOpacity;

  if (state.frame < 58.0) {
    ctx.save();
    applyEmblemCameraTransform(ctx, width, height, state);
    ctx.beginPath();
    ctx.moveTo(EMBLEM_LEFT - 4, EMBLEM_TOP);
    ctx.lineTo(EMBLEM_LEFT + STEM_W + 8, EMBLEM_TOP);
    ctx.lineTo(EMBLEM_LEFT + STEM_W + 8, EMBLEM_BOT + 4);
    ctx.quadraticCurveTo(
      CENTER_X,
      EMBLEM_BOT - 9.5,
      EMBLEM_LEFT - 4,
      EMBLEM_BOT + 4
    );
    ctx.closePath();
    ctx.restore();
    ctx.clip();
  }

  if (offscreen) {
    const data = offscreen.imgData.data;
    const midRow = OFFSCREEN_H * 0.5;

    for (let y = 0; y < OFFSCREEN_H; y++) {
      const isUpper = y <= midRow;
      const tVert = isUpper
        ? clamp((y - 1) / (midRow - 1), 0, 1)
        : clamp((y - midRow) / (OFFSCREEN_H - 2 - midRow), 0, 1);
      const rowOffset = y * OFFSCREEN_W * 4;

      for (let x = 0; x < OFFSCREEN_W; x++) {
        const em = emitters[x];
        const idx = rowOffset + x * 4;
        if (em.maxLum < 3) {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
          continue;
        }
        if (isUpper) {
          data[idx] = em.rTop + (em.rMid - em.rTop) * tVert;
          data[idx + 1] = em.gTop + (em.gMid - em.gTop) * tVert;
          data[idx + 2] = em.bTop + (em.bMid - em.bTop) * tVert;
        } else {
          data[idx] = em.rMid + (em.rBot - em.rMid) * tVert;
          data[idx + 1] = em.gMid + (em.gBot - em.gMid) * tVert;
          data[idx + 2] = em.bMid + (em.bBot - em.bMid) * tVert;
        }
        data[idx + 3] = 255;
      }
    }

    offscreen.ctx.putImageData(offscreen.imgData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen.canvas, 0, 0, width, height);
  }

  // Pass 2: Ultra-crisp native-DPI vector micro-filaments for razor-sharp optical cores
  const filaments = evaluateKinematicFilaments(state.frame);
  if (filaments.length > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (const fil of filaments) {
      const cx = Math.round(fil.u * width);
      const coreW = Math.max(1.5, Math.round(fil.widthNorm * width * 0.75));
      const glowW = Math.max(3.0, fil.glowRadiusNorm * width * 0.65);

      ctx.fillStyle = `rgba(${fil.r}, ${fil.g}, ${fil.b}, ${fil.alpha * 0.18})`;
      ctx.fillRect(cx - glowW, 0, glowW * 2, height);

      ctx.fillStyle = `rgba(${fil.r}, ${fil.g}, ${fil.b}, ${fil.alpha * 0.82})`;
      ctx.fillRect(cx - coreW * 0.5, 0, coreW, height);
    }
  }

  ctx.restore();
}

/**
 * Main entry point to render a complete frame of the animation at `timeSeconds`.
 */
export function renderAnimationFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeSeconds: number
): TimelineState {
  const state = evaluateTimeline(timeSeconds);

  // Pure black background (#000000) across the entire viewport
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  if (state.isBlackFrame) {
    return state;
  }

  // Render 3D Folded Geometric Ribbon Emblem (Stages 1, 2, 3)
  if (state.emblemOpacity > 0.001) {
    renderGeometricEmblem(ctx, width, height, state);
  }

  // Render HD 640-Emitter Volumetric Light Streak Field
  if (state.streakFieldOpacity > 0.001) {
    renderVolumetricLightStreaks(ctx, width, height, state);
  }

  return state;
}
