import type { Side } from '../ink/chain';
import type { View } from '../ink/gestures';
import type { NeighborPage } from '../ink/surface';
import { normalizePath } from '../sync/paths';

// Die Übergabe beim Weiterscrollen: Wird eine Nachbarseite durch Scrollen zur offenen Seite, wechselt die Adresse, und die App
// baut die neue Seite auf wie bei jeder anderen Adresse. Damit nichts springt, legt die alte Seite vorher hier bereit, was die
// neue zuerst zeigt: dieselbe Ansicht, die Vorschau des Nachbarn und sich selbst als Nachbarin. Ein Wert im Arbeitsspeicher,
// nach einem Neuladen gibt es keine Übergabe.

/**
 * Was die Seite `path` beim Öffnen von der Seite übernimmt, die sie eben noch als Nachbarin zeigte. `view` ist die Ansicht in
 * Einheiten der neuen Seite (siehe `viewFor`), `page` das, was sie zeigt, bis ihre Datei gelesen ist (die Vorschau). `read` sagt,
 * ob die Vorschau ihre Datei schon gelesen hatte; sonst zeigt die neue Seite beim Laden den Hinweis wie jede andere. `from` ist
 * die bisherige Seite als Nachbarin, `side` von der neuen Seite aus gesehen. `from.read`: Ihre Sitzung hatte die Datei gelesen
 * (`bereit`). Dann zeigt `from.page` ihre neuesten Striche, und weil sie vielleicht noch speichert, liest die neue Seite die
 * Datei erst nach einer fremden Änderung. Sonst hat sie nie geschrieben, und die neue Seite liest sie wie jeden Nachbarn.
 * `at` ist `Date.now()` beim Anbieten.
 */
export type Handoff = {
  path: string;
  view: View;
  page: NeighborPage;
  read: boolean;
  from: { side: Side; page: NeighborPage; read: boolean };
  at: number;
};

/** So lange (ms) nach dem Anbieten gilt eine Übergabe noch. Eine Seite, die später öffnet, öffnet wie sonst. */
const FRESH_MS = 2000;

let offered: Handoff | null = null;

/** Legt eine Übergabe bereit. Eine neue ersetzt die alte. */
export function offerHandoff(h: Handoff): void {
  offered = h;
}

/**
 * Die Übergabe für die Seite `path`, wenn sie für diese Seite bestimmt ist (Pfade in NFC verglichen) und höchstens
 * `FRESH_MS` alt ist, sonst `null`. Danach ist sie verbraucht, auch wenn sie nicht passte: Eine alte Übergabe landet nie
 * auf einer Seite, die später öffnet.
 */
export function takeHandoff(path: string, now = Date.now()): Handoff | null {
  const h = offered;
  offered = null;
  if (!h || normalizePath(h.path) !== normalizePath(path) || now - h.at > FRESH_MS) return null;
  return h;
}
