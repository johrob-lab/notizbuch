import { expect, test } from 'vitest';
import { addUsage, costCents, costLabel } from '../../src/ki/cost';

test('cost follows the price list', () => {
  expect(costCents('sonnet', { input_tokens: 5000, output_tokens: 100 })).toBeCloseTo(1.1, 6);
  expect(costCents('haiku', { input_tokens: 5000, output_tokens: 100 })).toBeCloseTo(0.055, 6);
  // (5000 · 2 + 100 · 10 + 1000 · 2 · 1,25 + 1000 · 2 · 0,05) $ / 1 000 000 = 0,0136 $, also 1,36 Cent.
  expect(
    costCents('sonnet', { input_tokens: 5000, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 }),
  ).toBeCloseTo(1.36, 6);
});

test('Lesen aus dem Zwischenspeicher kostet je Modell seinen Anteil, Schreiben das 1,25-fache', () => {
  const read = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 };
  expect(costCents('sonnet', read)).toBeCloseTo(10, 6); // 0,05 · 2 $
  expect(costCents('haiku', read)).toBeCloseTo(1, 6); // 0,1 · 0,10 $
  const write = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 };
  expect(costCents('sonnet', write)).toBeCloseTo(250, 6);
  expect(costCents('haiku', write)).toBeCloseTo(12.5, 6);
});

test('the label rounds to a tenth of a cent', () => {
  expect(costLabel(1.1)).toBe('≈ 1,1 Cent');
  expect(costLabel(12.345)).toBe('≈ 12,3 Cent');
  expect(costLabel(0.1)).toBe('≈ 0,1 Cent');
  expect(costLabel(0.055)).toBe('unter 0,1 Cent');
  expect(costLabel(1.2, false)).toBe('≈ 1,2 Cent');
});

test('fehlen Zahlen, sagt das Etikett mindestens', () => {
  expect(costLabel(1.2, true)).toBe('mindestens ≈ 1,2 Cent');
  expect(costLabel(0.1, true)).toBe('mindestens ≈ 0,1 Cent');
  expect(costLabel(0.05, true)).toBe('Kosten unvollständig');
  expect(costLabel(0, true)).toBe('Kosten unvollständig');
});

test('addUsage zählt zusammen, null nur ohne Zahlen', () => {
  expect(addUsage(null, null)).toBeNull();
  expect(addUsage({ input_tokens: 5, output_tokens: 1 }, null)).toEqual({ input_tokens: 5, output_tokens: 1 });
  expect(addUsage(null, { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 7 })).toEqual({
    input_tokens: 5,
    output_tokens: 1,
    cache_read_input_tokens: 7,
  });
  expect(
    addUsage(
      { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 2000 },
      { input_tokens: 3, output_tokens: 40, cache_creation_input_tokens: 300, cache_read_input_tokens: 2000 },
    ),
  ).toEqual({ input_tokens: 13, output_tokens: 42, cache_creation_input_tokens: 2300, cache_read_input_tokens: 2000 });
});
