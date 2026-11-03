import { expect, test } from 'vitest';
import { InkMeter, meterLabel } from '../../src/ink/meter';

test('meterLabel', () => {
  const m = new InkMeter();
  m.event(0.4, 0);
  m.points(6);
  m.frame(0);
  m.frame(8.3);
  expect(meterLabel(m.summary())).toBe('Arbeit 0,4 ms (max 0,4) · Bild 8,3 ms · Punkte je Bewegung 6');
});

test('empty meter', () => {
  expect(new InkMeter().summary()).toEqual({ events: 0, workAvg: 0, workMax: 0, frameAvg: 0, ptsMax: 0 });
});
