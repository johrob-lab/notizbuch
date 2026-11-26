import { formatDayLong, isValidDay, type Day } from '../lib/dates';
import { dailyNotePath } from '../lib/filenames';

// Die Zeile „Quellen:“ am Ende einer Antwort von Claude (`Quellen: <pfad>[#Abschnitt] | <pfad>`): Sie steht nie im Text der Antwort,
// ihre Pfade werden Knöpfe unter der Antwort und beim Übernehmen die Wikilinks des letzten Punkts. Eine Quelle zählt nur, wenn es
// die Notiz in der Kopie gibt und sie im Gespräch bis zu dieser Frage vorkam: Was Claude sonst nennt, fällt weg, die Antwort bleibt.

/** Eine Quelle unter der Antwort: der Pfad in der Kopie, der Abschnitt, der Tag einer Tagesnotiz und der Text des Knopfs. */
export type Quelle = {
  pfad: string;
  abschnitt: string | null;
  tag: Day | null;
  etikett: string;
};

/** Mehr Quellen als so viele zeigt die Runde nicht. */
export const MAX_QUELLEN = 8;

const KOPF = 'Quellen:';
const TAGESNOTIZ = /^05 Daily Notes\/(\d{4}-\d{2}-\d{2})\.md$/;

const dateiname = (pfad: string) => pfad.slice(pfad.lastIndexOf('/') + 1);
const istMd = (pfad: string) => /\.md$/i.test(pfad);
const ohneMd = (name: string) => (istMd(name) ? name.slice(0, -3) : name);
const gleich = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

/** Index der letzten Zeile mit Text, `-1` bei leerem Text. */
function letzteZeile(zeilen: string[]): number {
  for (let i = zeilen.length - 1; i >= 0; i--) if (zeilen[i].trim() !== '') return i;
  return -1;
}

/**
 * Der Text ohne seine letzte Zeile, wenn sie mit `Quellen:` beginnt. Nur mit `laeuft` (die Antwort wird noch geschrieben): Eine letzte
 * Zeile, die erst ein Anfang davon ist (`Q`, `Quel` …), bleibt verborgen, bis sie sich als etwas anderes zeigt. Eine fertige Antwort
 * verliert nur eine Zeile, die mit `Quellen:` beginnt.
 */
export function ohneQuellenZeile(text: string, laeuft = false): string {
  const zeilen = text.split('\n');
  const i = letzteZeile(zeilen);
  if (i < 0) return text;
  const zeile = zeilen[i].trim();
  if (!zeile.startsWith(KOPF) && !(laeuft && KOPF.startsWith(zeile))) return text;
  return zeilen.slice(0, i).join('\n').trimEnd();
}

/**
 * Die Pfade, die im Gespräch bis zu dieser Frage vorkamen (`pfade` dieser Runde und der früheren), und die Tagesnotiz des Tages der
 * Seite, aber nur, wenn mit dieser Frage eine Tagesseite mitging (`seitenTag`, sonst `null`: Woche, Monat, keine Seite oder Schalter
 * aus).
 */
export function erlaubtePfade(pfade: readonly string[], seitenTag: Day | null): string[] {
  return seitenTag === null ? [...pfade] : [...pfade, dailyNotePath(seitenTag)];
}

/** Die Quellen aus der letzten Zeile `Quellen:`: nur Pfade, die `finde` kennt und die in `erlaubt` stehen, ohne Doppelte. */
export function quellenAus(text: string, finde: (pfad: string) => string | null, erlaubt: readonly string[]): Quelle[] {
  const zeilen = text.split('\n');
  const i = letzteZeile(zeilen);
  if (i < 0) return [];
  const zeile = zeilen[i].trim();
  if (!zeile.startsWith(KOPF)) return [];
  const quellen: Quelle[] = [];
  for (const roh of zeile.slice(KOPF.length).split(' | ')) {
    const eintrag = roh.trim();
    const raute = eintrag.indexOf('#');
    const name = (raute < 0 ? eintrag : eintrag.slice(0, raute)).trim();
    const abschnitt = raute < 0 ? null : eintrag.slice(raute + 1).trim() || null;
    if (name === '') continue;
    const pfad = finde(name);
    if (pfad === null || !erlaubt.some((e) => gleich(e, pfad))) continue;
    if (quellen.some((q) => q.pfad === pfad)) continue;
    const tag = TAGESNOTIZ.exec(pfad)?.[1] ?? null;
    const gueltig = tag !== null && isValidDay(tag) ? tag : null;
    const basis = gueltig ? formatDayLong(gueltig) : ohneMd(dateiname(pfad));
    quellen.push({
      pfad,
      abschnitt,
      tag: gueltig,
      etikett: abschnitt ? `${basis} (${abschnitt})` : basis,
    });
    if (quellen.length === MAX_QUELLEN) break;
  }
  return quellen;
}

/**
 * Die Zeile fürs Übernehmen: `Quellen: [[2026-11-26]], [[Sperren Abschnitte Lehne]]`. Bei `.md` steht der Name ohne Endung, sonst mit.
 * Kommt der Name unter `namen` (allen Pfaden der Kopie) mehrfach vor, steht der Pfad (bei `.md` ohne Endung).
 */
export function quellenZeile(quellen: Quelle[], namen: readonly string[]): string {
  const links = quellen.map((q) => {
    const name = dateiname(q.pfad);
    const mehrfach = namen.filter((n) => gleich(dateiname(n), name)).length > 1;
    return `[[${ohneMd(mehrfach ? q.pfad : name)}]]`;
  });
  return `${KOPF} ${links.join(', ')}`;
}
