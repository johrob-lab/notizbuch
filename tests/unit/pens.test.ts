import { expect, test } from 'vitest';
import {
  DEFAULT_FUELLER,
  DEFAULT_PEN_ANGLE,
  doubled,
  nibFactorR,
  nibShape,
  penAngle,
  pressureFactor,
  pressureRamp,
  taperFactor,
} from '../../src/ink/pens';

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

// ---------- Füllfeder (Paket 3b) ----------

test('pressureFactor follows the sensitivity', () => {
  // 0 %: Der Druck wirkt nicht.
  for (const p of [0.05, 0.45, 0.9]) expect(pressureFactor(0, p)).toBe(1);
  // 25 % (Startwert): leicht 0,8-fach, fest 1,2-fach.
  expect(pressureFactor(0.25, 0.05)).toBeCloseTo(0.8, 9);
  expect(pressureFactor(0.25, 0.9)).toBeCloseTo(1.2, 9);
  // 100 %: von 0,2- bis 1,8-fach.
  expect(pressureFactor(1, 0.05)).toBeCloseTo(0.2, 9);
  expect(pressureFactor(1, 0.9)).toBeCloseTo(1.8, 9);
});

test('nibFactorR is round at 100 % and flat at 0 %', () => {
  const pen = doubled(Math.PI / 4); // der Stift zeigt nach rechts unten
  const along = doubled(Math.PI / 4);
  const alongBack = doubled((5 * Math.PI) / 4); // dieselbe Linie, andersherum gezogen
  const across = doubled((3 * Math.PI) / 4);
  for (const dir of [along, alongBack, across, doubled(0), doubled(1)]) expect(nibFactorR(1, dir, pen)).toBeCloseTo(1, 9);
  expect(nibFactorR(0, along, pen)).toBeCloseTo(1.7, 9);
  expect(nibFactorR(0, alongBack, pen)).toBeCloseTo(1.7, 9);
  expect(nibFactorR(0, across, pen)).toBeCloseTo(0.3, 9);
  expect(nibFactorR(0.33, along, pen)).toBeCloseTo(1.469, 9);
  expect(nibFactorR(0.33, across, pen)).toBeCloseTo(0.531, 9);
  // Ohne Richtung ist die Feder rund.
  expect(nibFactorR(0, null, pen)).toBe(1);
  expect(nibFactorR(0.33, null, pen)).toBe(1);
  // Ein Vektor ohne Länge (unsichere Richtung) landet in der Mitte.
  expect(nibFactorR(0, { c: 0, s: 0 }, pen)).toBeCloseTo(0.3 + 1.4 * Math.SQRT1_2, 9);
});

test('taperFactor makes sharp or round ends', () => {
  expect(taperFactor(1, 0, 9)).toBeCloseTo(0.15, 9);
  expect(taperFactor(1, 4.5, 9)).toBeCloseTo(1 - 0.85 * 0.25, 9); // weich (quadratisch) zur Mitte hin
  expect(taperFactor(1, 9, 9)).toBe(1);
  expect(taperFactor(1, 20, 9)).toBe(1);
  expect(taperFactor(0.5, 0, 9)).toBeCloseTo(1 - 0.5 * 0.85, 9);
  for (const s of [0, 3, 9, 20]) expect(taperFactor(0, s, 9)).toBe(1);
  for (const s of [0, 3, 20]) {
    expect(taperFactor(1, s, 0)).toBe(1);
    expect(taperFactor(1, s, -2)).toBe(1);
  }
});

test('nibShape is a circle at 100 % roundness and turns with the pen', () => {
  const nomW = 1.2;
  const round = nibShape({ ...DEFAULT_FUELLER, rundung: 1 }, nomW, Math.PI / 4);
  expect(round.long).toBeCloseTo(nomW, 9);
  expect(round.short).toBeCloseTo(nomW, 9);
  const flat = nibShape(DEFAULT_FUELLER, nomW, 0.3);
  expect(flat.long).toBeCloseTo(1.469 * nomW, 9);
  expect(flat.short).toBeCloseTo(0.531 * nomW, 9);
  expect(flat.angle).toBeCloseTo(0.3 + Math.PI / 2, 9);
  expect(nibShape(DEFAULT_FUELLER, nomW, DEFAULT_PEN_ANGLE).angle).toBeCloseTo(DEFAULT_PEN_ANGLE + Math.PI / 2, 9);
});
