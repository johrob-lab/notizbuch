import { expect, test } from 'vitest';
import { GRAIN, grainMask } from '../../src/ink/grain';

// Die Körnung des Bleistifts auf dem Bildschirm: eine Kachel, deren Felder ganz decken oder gar nicht.

test('the grain mask is the same every time and covers about three quarters', () => {
  const mask = grainMask(GRAIN.tile, GRAIN.cover, GRAIN.seed);
  expect(grainMask(GRAIN.tile, GRAIN.cover, GRAIN.seed)).toEqual(mask);
  expect(mask).toHaveLength(GRAIN.tile * GRAIN.tile);
  expect(mask.every((v) => v === 0 || v === 255)).toBe(true);
  const covered = mask.filter((v) => v === 255).length / mask.length;
  expect(covered).toBeGreaterThan(0.7);
  expect(covered).toBeLessThan(0.8);
});
