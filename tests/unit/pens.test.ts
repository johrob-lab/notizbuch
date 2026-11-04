import { expect, test } from 'vitest';
import { doubled, nibFactor, penAngle, pressureRamp } from '../../src/ink/pens';

test('pressureRamp is 0 up to 0.1, 1 from 0.8 and linear between', () => {
  expect(pressureRamp(0.05)).toBe(0);
  expect(pressureRamp(0.45)).toBeCloseTo(0.5, 9);
  expect(pressureRamp(0.9)).toBe(1);
});

test('penAngle follows tiltX and tiltY and is null without tilt', () => {
  expect(penAngle(30, 30)).toBeCloseTo(Math.PI / 4, 9);
  expect(penAngle(0, 0)).toBeNull();
  expect(penAngle(NaN, 5)).toBeNull();
});

test('nibFactor is 1.5 along the pen and 0.5 across it, whatever the direction of travel', () => {
  const pen = doubled(Math.PI / 4);
  expect(nibFactor(doubled(Math.PI / 4), pen)).toBeCloseTo(1.5, 9);
  expect(nibFactor(doubled((5 * Math.PI) / 4), pen)).toBeCloseTo(1.5, 9);
  expect(nibFactor(doubled((3 * Math.PI) / 4), pen)).toBeCloseTo(0.5, 9);
  expect(nibFactor(doubled(-Math.PI / 4), pen)).toBeCloseTo(0.5, 9);
});

test('an unknown stroke direction gives the middle nib factor', () => {
  expect(nibFactor({ c: 0, s: 0 }, doubled(Math.PI / 4))).toBeCloseTo(0.5 + Math.SQRT1_2, 9);
});
