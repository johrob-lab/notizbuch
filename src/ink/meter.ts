// Messung für die Schreibverzögerung: wie lange die App je Stiftbewegung rechnet und zeichnet, wie weit die Bilder
// auseinanderliegen und wie viele Punkte eine Bewegung neu zeichnet. Die Zeile erscheint auf Wunsch über der Seite.

export type MeterSummary = { events: number; workAvg: number; workMax: number; frameAvg: number; ptsMax: number };

export class InkMeter {
  #events = 0;
  #workSum = 0;
  #workMax = 0;
  #frames = 0;
  #frameSum = 0;
  #lastFrame: number | null = null;
  #ptsMax = 0;

  /** Eine Stiftbewegung hat `workMs` Millisekunden gekostet. */
  event(workMs: number, _now: number): void {
    this.#events++;
    this.#workSum += workMs;
    this.#workMax = Math.max(this.#workMax, workMs);
  }

  /** Ein Bild wurde gezeigt (aus `requestAnimationFrame`). */
  frame(now: number): void {
    if (this.#lastFrame !== null) {
      this.#frames++;
      this.#frameSum += now - this.#lastFrame;
    }
    this.#lastFrame = now;
  }

  /** Das Bild davor zählt nicht als Vorgänger (der Stift war abgehoben). */
  pause(): void {
    this.#lastFrame = null;
  }

  /** Eine Bewegung hat `n` Punkte gezeichnet. */
  points(n: number): void {
    this.#ptsMax = Math.max(this.#ptsMax, n);
  }

  summary(): MeterSummary {
    return {
      events: this.#events,
      workAvg: this.#events ? this.#workSum / this.#events : 0,
      workMax: this.#workMax,
      frameAvg: this.#frames ? this.#frameSum / this.#frames : 0,
      ptsMax: this.#ptsMax,
    };
  }
}

const ms = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Die Zeile für den Bildschirm, zum Beispiel „Arbeit 0,4 ms (max 1,2) · Bild 8,3 ms · Punkte je Bewegung 6“. */
export function meterLabel(s: MeterSummary): string {
  return `Arbeit ${ms(s.workAvg)} ms (max ${ms(s.workMax)}) · Bild ${ms(s.frameAvg)} ms · Punkte je Bewegung ${s.ptsMax}`;
}
