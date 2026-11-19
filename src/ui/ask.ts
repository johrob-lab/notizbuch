import type { GestureFilter } from '../ink/gestures';
import type { Day } from '../lib/dates';

// Die Verbindung zwischen der offenen Seite und dem Fenster „Frag Claude“. Das Fenster gehört der App und bleibt beim Blättern
// offen. Die Seite, die gerade offen ist, meldet sich bei der App an und liefert, was das Fenster von ihr braucht.

/** Was „Frag Claude“ von der offenen Seite bekommt. Sie meldet es an, sobald sie gelesen ist, und ab, wenn sie geht. */
export type AskPage = {
  /** `pageLabel`, für den Schalter „Seite mitschicken“. */
  label: string;
  /** `noteDayOf`: Ziel von „Übernehmen“, `null` auf Woche und Monat. */
  day: Day | null;
  /** „Offene Seite: <pageHeader>“, dazu `askExtra` der Seite. */
  describe(): Promise<string>;
  /** Die ganze Seite, wie sie zu sehen ist, `''` ohne Fläche. */
  svg(): string;
  /** Das Tor gegen Handballen dieser Seite. */
  filter: GestureFilter;
};

/** Was die App jeder Seite gibt, solange es „Frag Claude“ gibt: das Fenster öffnen und die Seite anmelden. Die Anmeldung gibt die Abmeldung zurück. */
export type AskHooks = { open(): void; register(page: AskPage): () => void };
