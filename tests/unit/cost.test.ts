import { expect, test } from 'vitest';
import { costCents, costLabel } from '../../src/ki/cost';

test('cost follows the price list', () => {
  expect(costCents('sonnet', { input_tokens: 5000, output_tokens: 100 })).toBeCloseTo(1.1, 6);
  expect(costCents('haiku', { input_tokens: 5000, output_tokens: 100 })).toBeCloseTo(0.055, 6);
  expect(
    costCents('sonnet', { input_tokens: 5000, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 }),
  ).toBeCloseTo(1.37, 6);
});

test('the label rounds to a tenth of a cent', () => {
  expect(costLabel(1.1)).toBe('≈ 1,1 Cent');
  expect(costLabel(12.345)).toBe('≈ 12,3 Cent');
  expect(costLabel(0.1)).toBe('≈ 0,1 Cent');
  expect(costLabel(0.055)).toBe('unter 0,1 Cent');
});
