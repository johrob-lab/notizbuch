import type { KiModel } from '../lib/settings';
import type { Usage } from './claude';

/** Preise in US-Dollar je Million Token, getrennt nach Token hinein und hinaus. */
export const PRICES: Record<KiModel, { input: number; output: number }> = {
  sonnet: { input: 2, output: 10 },
  haiku: { input: 0.1, output: 0.5 },
};

// Zwischenspeicher: Schreiben kostet das 1,25-fache, Lesen das 0,1-fache des Preises hinein.
const CACHE_WRITE = 1.25;
const CACHE_READ = 0.1;

/** Was eine Antwort gekostet hat, in US-Cent (Token mal Preis je Million, mal 100 Cent je Dollar). */
export function costCents(model: KiModel, usage: Usage): number {
  const price = PRICES[model];
  const dollars =
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.input * CACHE_WRITE +
      (usage.cache_read_input_tokens ?? 0) * price.input * CACHE_READ) /
    1_000_000;
  return dollars * 100;
}

/** Zum Beispiel `≈ 1,1 Cent`. Unter einem Zehntel Cent steht `unter 0,1 Cent`. */
export function costLabel(cents: number): string {
  if (cents < 0.1) return 'unter 0,1 Cent';
  return `≈ ${cents.toFixed(1).replace('.', ',')} Cent`;
}
