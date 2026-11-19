import type { NoteItem } from '../lib/briefingEdit';

// Aus Frage und Antwort werden die Punkte, die „In Ergänzungen übernehmen“ an die Tagesnotiz hängt: zuerst die Frage mit der
// Uhrzeit, dann jede Zeile der Antwort als eigener, flacher Punkt. Zeichen für Listen (`-`, `*`, `+`), Überschriften, Zitate und
// Tabellen fallen weg, der Text bleibt. Eine Nummer am Anfang bleibt, mit Schrägstrich (`1\. Schritt`, `29\. Oktober`): So bleibt
// die Zeile flach, und nichts geht verloren (nur bei Aufgaben entfällt sie). Nichts wird versteckt: `%%` entfernt
// `appendErgaenzung`, sodass auch ein Text zwischen `%%` sichtbar in der Notiz steht.

/** Linien, Code-Zäune und die Trennzeile einer Tabelle (`|---|---|`): Sie tragen keinen Text. */
const SKIPPED = /^(?:(?:-{3,}|\*{3,}|_{3,})|```.*|\|?[\s:|-]*-[\s:|-]*\|?)$/;
/** Ein Listenpunkt mit Kästchen: `- [ ] `, `* [ ] `, `+ [ ] ` oder `1. [ ] ` (auch `1)`). Der Haken `x` oder `X` macht ihn zum Punkt. */
const BOX = /^(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s+(.*))?$/;
const BULLET = /^[-*+]\s+(.*)$/;
/** Eine nummerierte Zeile: Die Nummer bleibt (`29. Oktober` ist ein Datum), nur mit Schrägstrich, damit die Zeile flach bleibt. */
const NUMBERED = /^(\d+)([.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;

/** Eine Zeile der Antwort als Punkt, `null`, wenn nichts bleibt. */
function itemOf(raw: string): NoteItem | null {
  let line = raw.trim();
  // Jedes `>` vorne fällt weg, auch mehrere (`> > Zitat`): Ein Zitat im Punkt wäre nicht flach.
  while (line.startsWith('>')) line = line.slice(1).trim();
  if (line === '' || SKIPPED.test(line)) return null;

  const box = BOX.exec(line);
  if (box) return keep(box[2] ?? '', box[1] === ' ');
  const bullet = BULLET.exec(line) ?? HEADING.exec(line);
  if (bullet) return keep(bullet[1], false);
  const numbered = NUMBERED.exec(line);
  if (numbered) return keep(`${numbered[1]}\\${numbered[2]} ${numbered[3]}`, false);
  if (line.startsWith('|') && line.endsWith('|')) {
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim()).filter((cell) => cell !== '');
    return keep(cells.join(' · '), false);
  }
  return keep(line, false);
}

const keep = (text: string, asTask: boolean): NoteItem | null => (text.trim() === '' ? null : { text: text.trim(), asTask });

/** Die Punkte für die Notiz: die Frage (`Claude, HH:MM: …`, auf einer Zeile), danach jede Zeile der Antwort der Reihe nach. */
export function answerItems(question: string, answer: string, time: string): NoteItem[] {
  const lines = answer.split('\n').flatMap((line) => itemOf(line) ?? []);
  return [{ text: `Claude, ${time}: ${question.replace(/\s+/g, ' ').trim()}`, asTask: false }, ...lines];
}
