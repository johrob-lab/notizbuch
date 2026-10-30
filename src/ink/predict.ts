// Vorhersage des Strichs, wenn der Browser selbst keine liefert (Safari liefert sie mit `getPredictedEvents()`). Reine
// Rechnung: Die Schreibfläche zeichnet das Ergebnis.

/** Ein Messpunkt des Stifts: Ort in Bildschirmpunkten, Zeit in Millisekunden. */
export type Sample = { x: number; y: number; t: number };

/** So weit voraus wird gerechnet. */
const HORIZON_MS = 18;
/** Weiter als so viele Bildschirmpunkte reicht die Vorhersage nie. */
const MAX_REACH_PX = 16;
/** Die Geschwindigkeit wird über mindestens so viele Millisekunden gemessen. */
const MIN_SPAN_MS = 12;
/** Liegt der Vergleichspunkt weiter zurück, ist der Stift zwischendurch gestanden. */
const MAX_SPAN_MS = 60;
/** Kürzer als so viele Bildschirmpunkte lohnt sich keine Vorhersage. */
const MIN_REACH_PX = 0.5;

/**
 * Wo der Stift in 18 ms sein wird, wenn er so weiterfährt, höchstens 16 Bildschirmpunkte vom letzten Punkt entfernt.
 * `samples` sind die letzten Messpunkte, der neueste zuletzt. Gemessen wird gegen den neuesten Punkt, der mindestens 12 ms
 * älter ist (sonst gegen den ältesten). Keine Vorhersage (`null`) gibt es bei weniger als drei Punkten, bei Punkten
 * ohne Zeit dazwischen, nach einer Pause von mehr als 60 ms und wenn sich der Stift kaum bewegt.
 */
export function extrapolate(samples: readonly Sample[]): { x: number; y: number } | null {
  const n = samples.length;
  if (n < 3) return null;
  const a = samples[n - 1];
  let b = samples[0];
  for (let i = n - 2; i >= 0; i--) {
    if (a.t - samples[i].t >= MIN_SPAN_MS) {
      b = samples[i];
      break;
    }
  }
  const dt = a.t - b.t;
  if (dt <= 0 || dt > MAX_SPAN_MS) return null;
  let dx = ((a.x - b.x) / dt) * HORIZON_MS;
  let dy = ((a.y - b.y) / dt) * HORIZON_MS;
  const len = Math.hypot(dx, dy);
  if (len < MIN_REACH_PX) return null;
  if (len > MAX_REACH_PX) {
    dx *= MAX_REACH_PX / len;
    dy *= MAX_REACH_PX / len;
  }
  return { x: a.x + dx, y: a.y + dy };
}
