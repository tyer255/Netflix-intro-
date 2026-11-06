import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateKinematicFilaments,
  evaluateStreakEmittersAtFrame,
} from './streakEngine';
import {
  ANIMATION_FPS,
  evaluateTimeline,
  getStageAtFrame,
} from './timeline';

test('Stage classification matches frame boundaries across all 96 frames', () => {
  assert.equal(getStageAtFrame(0), 'initial-appearance');
  assert.equal(getStageAtFrame(14), 'initial-appearance');
  assert.equal(getStageAtFrame(15), 'geometric-hold');
  assert.equal(getStageAtFrame(25), 'geometric-hold');
  assert.equal(getStageAtFrame(42), 'streak-transformation');
  assert.equal(getStageAtFrame(58), 'streak-transformation');
  assert.equal(getStageAtFrame(62), 'multicolored-expansion');
  assert.equal(getStageAtFrame(70), 'multicolored-expansion');
  assert.equal(getStageAtFrame(75), 'final-composition');
  assert.equal(getStageAtFrame(95), 'final-composition');
});

test('Stage 1 Z ribbon sequential growth: top bar -> diagonal ribbon -> bottom bar -> shadows', () => {
  const f0 = evaluateTimeline(0 / ANIMATION_FPS);
  assert.equal(f0.isBlackFrame, true);
  assert.equal(f0.leftPillarProgress, 0);

  const f2 = evaluateTimeline(2 / ANIMATION_FPS);
  assert.equal(f2.isBlackFrame, false);
  assert.ok(f2.leftPillarProgress > 0.3 && f2.leftPillarProgress < 0.99);
  assert.equal(f2.diagonalRibbonProgress, 0);
  assert.equal(f2.rightPillarProgress, 0);

  const f6 = evaluateTimeline(6 / ANIMATION_FPS);
  assert.equal(f6.leftPillarProgress, 1);
  assert.ok(f6.diagonalRibbonProgress > 0.3 && f6.diagonalRibbonProgress < 0.99);
  assert.equal(f6.rightPillarProgress, 0);

  const f11 = evaluateTimeline(11 / ANIMATION_FPS);
  assert.equal(f11.diagonalRibbonProgress, 1);
  assert.ok(f11.rightPillarProgress > 0.3 && f11.rightPillarProgress < 0.99);

  const f16 = evaluateTimeline(16 / ANIMATION_FPS);
  assert.equal(f16.leftPillarProgress, 1);
  assert.equal(f16.diagonalRibbonProgress, 1);
  assert.equal(f16.rightPillarProgress, 1);
  assert.equal(f16.shadowOpacity, 1);
});

test('Stage 2 & 3 Z-to-pipe morph and uniform camera zoom curves', () => {
  const f20 = evaluateTimeline(20 / ANIMATION_FPS);
  const f35 = evaluateTimeline(35 / ANIMATION_FPS);
  const f45 = evaluateTimeline(45 / ANIMATION_FPS);
  const f55 = evaluateTimeline(55 / ANIMATION_FPS);
  const f58 = evaluateTimeline(58 / ANIMATION_FPS);

  assert.equal(f20.scaleX, 1.0);
  assert.equal(f20.scaleY, 1.0);
  assert.equal(f20.morphToPipeProgress, 0);
  assert.ok(f35.scaleX > 1.05);

  // At f=45, Z is actively morphing into the center vertical pipe '|'
  assert.ok(f45.morphToPipeProgress > 0.2 && f45.morphToPipeProgress < 0.9);

  // By f=55, Z has completely morphed into the vertical pipe '|'
  assert.equal(f55.morphToPipeProgress, 1);

  // By f=58, the pipe has zoomed uniformly to full screen height (scaleY = scaleX = 2.92)
  assert.equal(f58.scaleX, f58.scaleY);
  assert.ok(f58.scaleY > 2.9);
  assert.equal(f58.pipeCenterTargetX, 886);
});

test('Stage 4 & 5 volumetric streak emitters produce multicolored spectrum and final red hero streak', () => {
  // Frame 70: full-screen multicolored spectrum (warm on left, blue/cyan on right)
  const emitters70 = evaluateStreakEmittersAtFrame(70);
  assert.equal(emitters70.length, 640);

  // Check blue/cyan dominance in right-center cluster (u ~ 0.72)
  const rightBlueSample = emitters70[Math.round(0.72 * 639)];
  assert.ok(
    rightBlueSample.bMid > rightBlueSample.rMid,
    'Expected strong blue/cyan streak intensity on right side at frame 70'
  );

  // Frame 92: single glowing red-orange hero streak sweeping right (around x=1100 / 1920 => u ~ 0.57)
  const emitters92 = evaluateStreakEmittersAtFrame(92);
  const heroSample = emitters92[Math.round(0.57 * 639)];
  assert.ok(
    heroSample.rMid > 200 && heroSample.rMid > heroSample.bMid * 5,
    'Expected bright red-orange hero streak around u=0.57 at frame 92'
  );

  // Kinematic filaments active at frame 68
  const filaments68 = evaluateKinematicFilaments(68);
  assert.ok(filaments68.length > 5);

  // Frame 95 is pure black
  const f95 = evaluateTimeline(95 / ANIMATION_FPS);
  assert.equal(f95.isBlackFrame, true);
});
