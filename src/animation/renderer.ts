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
  TimelineState,
} from './timeline';

const REF_W = 1920;
const REF_H = 1080;
const CENTER_X = 960;

// Z emblem coordinate system from netflix_z_intro_038aed5e.html (viewBox 380x300, center at 190,150)
const Z_CENTER_X = 190;
const Z_CENTER_Y = 150;
// Base scale mapping 220px Z height (y=40..260) to 374px in 1920x1080 space
const Z_BASE_SCALE = 374 / 220; // 1.70

// High-definition vector streak layout inside the Z / vertical pipe (for ultra-crisp Stage 3 zoom!)
const INTERNAL_RIBBON_STREAKS = [
  { frac: 0.04, w: 1.3, r: 165, g: 0, b: 0 },
  { frac: 0.10, w: 1.8, r: 245, g: 18, b: 4 },
  { frac: 0.17, w: 1.1, r: 95, g: 0, b: 0 },
  { frac: 0.23, w: 2.1, r: 252, g: 58, b: 8 },
  { frac: 0.30, w: 1.2, r: 150, g: 0, b: 0 },
  { frac: 0.36, w: 1.7, r: 240, g: 12, b: 2 },
  { frac: 0.43, w: 2.0, r: 255, g: 118, b: 16 },
  { frac: 0.50, w: 1.1, r: 85, g: 0, b: 0 },
  { frac: 0.56, w: 2.2, r: 248, g: 28, b: 4 },
  { frac: 0.64, w: 1.3, r: 195, g: 4, b: 2 },
  { frac: 0.71, w: 1.9, r: 252, g: 75, b: 10 },
  { frac: 0.78, w: 1.2, r: 130, g: 0, b: 0 },
  { frac: 0.85, w: 2.0, r: 244, g: 14, b: 4 },
  { frac: 0.92, w: 1.4, r: 215, g: 38, b: 6 },
  { frac: 0.96, w: 1.1, r: 170, g: 0, b: 0 },
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
 * Applies the responsive reference-to-viewport coordinate transform and camera zoom
 * so that the Z emblem's center (190, 150) maps to `(state.pipeCenterTargetX, 540)` in 1920x1080 space.
 */
function applyZEmblemCameraTransform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TimelineState
): void {
  const fitScale = Math.min(width / (REF_W * 0.55), height / REF_H);
  const baseScale = Math.max(width / REF_W, fitScale * 0.85);

  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(baseScale, baseScale);
  ctx.translate(state.pipeCenterTargetX - CENTER_X, 0);
  ctx.scale(state.scaleX * Z_BASE_SCALE, state.scaleY * Z_BASE_SCALE);
  ctx.translate(-Z_CENTER_X, -Z_CENTER_Y);
}

function drawInterpolatedPolygon(
  ctx: CanvasRenderingContext2D,
  ptsA: [number, number][],
  ptsB: [number, number][],
  t: number
): void {
  ctx.beginPath();
  for (let i = 0; i < ptsA.length; i++) {
    const x = lerp(ptsA[i][0], ptsB[i][0], t);
    const y = lerp(ptsA[i][1], ptsB[i][1], t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Renders the Netflix-style 3D folded 'Z' ribbon intro and its morph into the center
 * vertical pipe '|' (Stages 1, 2, and 3), followed by internal vertical streak splitting as it zooms.
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

  applyZEmblemCameraTransform(ctx, width, height, state);

  const m = state.morphToPipeProgress;

  // ---------------------------------------------------------------------------
  // 1. TOP BAR OF 'Z' (#B1060F)
  // Draws left -> right (110..270, y=40..80), morphs into top of pipe (170..210, y=40)
  // ---------------------------------------------------------------------------
  if (state.leftPillarProgress > 0.001 && m < 0.999) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(110, 40, 160 * state.leftPillarProgress, 40);
    ctx.clip();

    drawInterpolatedPolygon(
      ctx,
      [
        [110, 40],
        [270, 40],
        [270, 80],
        [110, 80],
      ],
      [
        [170, 40],
        [210, 40],
        [210, 40],
        [170, 40],
      ],
      m
    );

    const topGrad = ctx.createLinearGradient(110, 40, 270, 40);
    topGrad.addColorStop(0, '#9E050D');
    topGrad.addColorStop(0.25, '#B1060F');
    topGrad.addColorStop(0.75, '#B1060F');
    topGrad.addColorStop(1, '#98050C');
    ctx.fillStyle = topGrad;
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 2. BOTTOM BAR OF 'Z' (#B1060F)
  // Draws left -> right (110..270, y=220..260), morphs into bottom of pipe (170..210, y=260)
  // ---------------------------------------------------------------------------
  if (state.rightPillarProgress > 0.001 && m < 0.999) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(110, 220, 160 * state.rightPillarProgress, 40);
    ctx.clip();

    drawInterpolatedPolygon(
      ctx,
      [
        [110, 220],
        [270, 220],
        [270, 260],
        [110, 260],
      ],
      [
        [170, 260],
        [210, 260],
        [210, 260],
        [170, 260],
      ],
      m
    );

    const botGrad = ctx.createLinearGradient(110, 220, 270, 220);
    botGrad.addColorStop(0, '#98050C');
    botGrad.addColorStop(0.25, '#B1060F');
    botGrad.addColorStop(0.75, '#B1060F');
    botGrad.addColorStop(1, '#9E050D');
    ctx.fillStyle = botGrad;
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 3. TOP & BOTTOM 3D CAST SHADOW TRIANGLES (#7A0509)
  // ---------------------------------------------------------------------------
  if (state.shadowOpacity > 0.001 && m < 0.995) {
    ctx.save();
    ctx.globalAlpha = state.emblemOpacity * state.shadowOpacity * (1 - m * 0.65);
    ctx.fillStyle = '#7A0509';

    // Top shadow triangle: 230,40 203,80 175,80 -> 190,40
    drawInterpolatedPolygon(
      ctx,
      [
        [230, 40],
        [203, 80],
        [175, 80],
      ],
      [
        [190, 40],
        [190, 40],
        [190, 40],
      ],
      m
    );
    ctx.fill();

    // Bottom shadow triangle: 177,220 150,260 205,260 -> 190,260
    drawInterpolatedPolygon(
      ctx,
      [
        [177, 220],
        [150, 260],
        [205, 260],
      ],
      [
        [190, 260],
        [190, 260],
        [190, 260],
      ],
      m
    );
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 4. CENTER DIAGONAL RIBBON OF 'Z' (#E50914) -> MORPHS INTO VERTICAL PIPE '|' (170..210, 40..260)
  // ---------------------------------------------------------------------------
  if (state.diagonalRibbonProgress > 0.001) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(100, 40, 190, 220 * state.diagonalRibbonProgress);
    ctx.clip();

    drawInterpolatedPolygon(
      ctx,
      [
        [230, 40],
        [270, 40],
        [270, 80],
        [150, 260],
        [110, 260],
        [110, 220],
      ],
      [
        [170, 40],
        [210, 40],
        [210, 40],
        [210, 260],
        [170, 260],
        [170, 260],
      ],
      m
    );

    const diagGrad = ctx.createLinearGradient(250, 40, 130, 260);
    diagGrad.addColorStop(0, '#EE0914');
    diagGrad.addColorStop(0.5, '#E50914');
    diagGrad.addColorStop(1, '#DC0812');
    ctx.fillStyle = diagGrad;
    ctx.fill();

    // Stage 3: Clip inside the morphing ribbon/pipe and draw razor-sharp red/scarlet/amber light filaments!
    if (state.internalStreakIntensity > 0.01) {
      ctx.clip();
      const sAlpha = state.internalStreakIntensity;
      const topLeftX = lerp(230, 170, m);
      const botLeftX = lerp(110, 170, m);
      const ribbonW = 40;

      // Crisp dark separation grooves inside the morphing pipe
      const darkGrooves = [0.14, 0.31, 0.48, 0.66, 0.83];
      for (const gf of darkGrooves) {
        const xt = topLeftX + gf * ribbonW;
        const xb = botLeftX + gf * ribbonW;
        ctx.beginPath();
        ctx.moveTo(xt - 0.7, 40);
        ctx.lineTo(xt + 0.7, 40);
        ctx.lineTo(xb + 0.7, 260);
        ctx.lineTo(xb - 0.7, 260);
        ctx.closePath();
        ctx.fillStyle = `rgba(8, 0, 0, ${0.84 * sAlpha})`;
        ctx.fill();
      }

      // Luminous red, scarlet, and warm-amber filaments inside the zooming pipe '|'
      for (const st of INTERNAL_RIBBON_STREAKS) {
        const xt = topLeftX + st.frac * ribbonW;
        const xb = botLeftX + st.frac * ribbonW;
        const hw = st.w * 0.45;
        ctx.beginPath();
        ctx.moveTo(xt - hw, 40);
        ctx.lineTo(xt + hw, 40);
        ctx.lineTo(xb + hw, 260);
        ctx.lineTo(xb - hw, 260);
        ctx.closePath();
        ctx.fillStyle = `rgba(${st.r}, ${st.g}, ${st.b}, ${0.96 * sAlpha})`;
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

  // Before f=58.0, clip the volumetric streaks to the zooming vertical pipe's bounds (170..210, 40..260)
  if (state.frame < 58.0) {
    ctx.save();
    applyZEmblemCameraTransform(ctx, width, height, state);
    ctx.beginPath();
    ctx.rect(168, 40, 44, 220);
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

  // Render 3D Folded 'Z' Geometric Ribbon Emblem & Pipe Morph (Stages 1, 2, 3)
  if (state.emblemOpacity > 0.001) {
    renderGeometricEmblem(ctx, width, height, state);
  }

  // Render HD 640-Emitter Volumetric Light Streak Field (Stages 3, 4, 5)
  if (state.streakFieldOpacity > 0.001) {
    renderVolumetricLightStreaks(ctx, width, height, state);
  }

  return state;
}
