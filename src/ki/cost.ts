import type { KiModel } from '../lib/settings';
import type { Usage } from './claude';

/** Preise in US-Dollar je Million Token, getrennt nach Token hinein und hinaus. */
export const PRICES: Record<KiModel, { input: number; output: number }> = {
  sonnet: { input: 2, output: 10 },
  haiku: { input: 0.1, output: 0.5 },
};

/** Lesen aus dem Zwischenspeicher kostet diesen Anteil des Preises hinein (Doku vom 26.11.2026). */
export const CACHE_READ: Record<KiModel, number> = { sonnet: 0.05, haiku: 0.1 };
/** Schreiben in den Zwischenspeicher (5 Minuten) kostet das 1,25-fache des Preises hinein. */
export const CACHE_WRITE = 1.25;

/** Was eine Antwort gekostet hat, in US-Cent (Token mal Preis je Million, mal 100 Cent je Dollar). */
export function costCents(model: KiModel, usage: Usage): number {
  const price = PRICES[model];
  const dollars =
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.input * CACHE_WRITE +
      (usage.cache_read_input_tokens ?? 0) * price.input * CACHE_READ[model]) /
    1_000_000;
  return dollars * 100;
}

/** Die Zahlen zweier Schritte zusammen. `null` nur, wenn beide fehlen. Die Zahlen zum Zwischenspeicher nur, wenn einer sie hat. */
export function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (a === null && b === null) return null;
  const sum: Usage = {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
  };
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens'] as const) {
    if (a?.[key] !== undefined || b?.[key] !== undefined) sum[key] = (a?.[key] ?? 0) + (b?.[key] ?? 0);
  }
  return sum;
}

/**
 * Zum Beispiel `≈ 1,1 Cent`. Unter einem Zehntel Cent steht `unter 0,1 Cent`. Mit `partial` fehlten Zahlen, die Kosten sind
 * also höher: `mindestens ≈ 1,2 Cent`, und unter einem Zehntel Cent `Kosten unvollständig`.
 */
export function costLabel(cents: number, partial = false): string {
  if (cents < 0.1) return partial ? 'Kosten unvollständig' : 'unter 0,1 Cent';
  const label = `≈ ${cents.toFixed(1).replace('.', ',')} Cent`;
  return partial ? `mindestens ${label}` : label;
}
