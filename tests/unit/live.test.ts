import { expect, test } from 'vitest';
import { fixedSegments, tailStart } from '../../src/ink/live';

test('fixedSegments and tailStart', () => {
  expect(fixedSegments(10, 5, 1)).toEqual({ from: 1, to: 4 });
  expect(fixedSegments(10, 5, 4)).toEqual({ from: 4, to: 4 });
  expect(tailStart(10, 5)).toBe(3);
  expect(fixedSegments(3, 0, 1)).toEqual({ from: 1, to: 1 });
});

test('without smoothing every finished segment is fixed', () => {
  // K = 0: alle n Punkte fest, Segmente 1 bis n-2 (Kontrollpunkt i braucht i+1).
  expect(fixedSegments(6, 6, 1)).toEqual({ from: 1, to: 5 });
  expect(tailStart(6, 6)).toBe(4);
});
