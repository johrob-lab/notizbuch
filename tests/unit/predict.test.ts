import { expect, test } from 'vitest';
import { extrapolate, type Sample } from '../../src/ink/predict';

// Vorhersage, wenn der Browser keine liefert: aus der Geschwindigkeit der letzten Punkte 18 ms vorausrechnen,
// höchstens 16 px weit. Punkte in Bildschirmpunkten, die Zeit in Millisekunden.

const at = (...points: [number, number, number][]): Sample[] => points.map(([x, y, t]) => ({ x, y, t }));

test('too few points give no prediction', () => {
  expect(extrapolate([])).toBeNull();
  expect(extrapolate(at([0, 0, 0], [5, 0, 8]))).toBeNull();
});

test('a slow pen is predicted 18 ms ahead', () => {
  // 0,25 px je ms über 16 ms: 4,5 px in 18 ms
  const target = extrapolate(at([100, 50, 0], [102, 50, 8], [104, 50, 16]));
  expect(target).not.toBeNull();
  expect(target!.x).toBeCloseTo(104 + 4.5, 5);
  expect(target!.y).toBeCloseTo(50, 5);
});

test('the direction follows the movement', () => {
  const target = extrapolate(at([10, 10, 0], [10, 14, 8], [10, 18, 16]));
  expect(target!.x).toBeCloseTo(10, 5);
  expect(target!.y).toBeCloseTo(18 + 9, 5); // 0,5 px je ms
});

test('a fast pen is predicted at most 16 px ahead', () => {
  const target = extrapolate(at([0, 0, 0], [30, 40, 8], [60, 80, 16])); // 5 px je ms
  const dx = target!.x - 60;
  const dy = target!.y - 80;
  expect(Math.hypot(dx, dy)).toBeCloseTo(16, 5);
  expect(dx / dy).toBeCloseTo(60 / 80, 5); // gleiche Richtung
});

test('the speed is measured against the newest point that is at least 12 ms older', () => {
  // Der Stift ruckelt zuletzt: Gemessen wird über 12 ms, nicht über die letzten 4 ms und nicht über einen längeren Weg.
  const target = extrapolate(at([0, 0, 0], [2, 0, 4], [4, 0, 8], [6, 0, 12], [7, 0, 16], [8, 0, 20]));
  // Vergleichspunkt: t = 8 (20 - 12 = 8, genau 12 ms zählen mit), also 4 px in 12 ms, in 18 ms 6 px
  expect(target!.x).toBeCloseTo(8 + 6, 5);
});

test('the oldest point is used when none is 12 ms older', () => {
  const target = extrapolate(at([0, 0, 0], [1, 0, 3], [2, 0, 6])); // 1/3 px je ms über die 6 ms
  expect(target!.x).toBeCloseTo(2 + (2 / 6) * 18, 5);
});

test('a pen that hardly moves gives no prediction', () => {
  expect(extrapolate(at([10, 10, 0], [10.1, 10, 8], [10.2, 10, 16]))).toBeNull();
});

test('points with no time between them give no prediction', () => {
  expect(extrapolate(at([0, 0, 5], [4, 0, 5], [8, 0, 5]))).toBeNull();
});

test('a pause of more than 60 ms gives no prediction', () => {
  expect(extrapolate(at([0, 0, 0], [20, 0, 30], [40, 0, 100]))).toBeNull(); // 70 ms zum Vergleichspunkt
  expect(extrapolate(at([0, 0, 0], [20, 0, 30], [40, 0, 90]))).not.toBeNull(); // 60 ms gehen noch
});
