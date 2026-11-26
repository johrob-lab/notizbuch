import { parseCsv } from '../lib/csv';
import { addDays, isoWeekKey, isValidDay, weekDays, type Day } from '../lib/dates';

// Reine Hilfen für die Suche im Gehirn: Text vereinheitlichen, Tage in Zeilen erkennen, CSV lesbar machen.

/** Klein, NFC, ä/ö/ü/ß als ae/oe/ue/ss, damit „Größe“ und „Groesse“ (auch mit U+0308) gleich sind. */
export function normalisiert(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

const TAGESNOTIZ = /^05 daily notes\/(\d{4}-\d{2}-\d{2})\.md$/;

/** Tag der Notiz: Tagesnotiz nach dem Dateinamen, sonst `date:` im Kopf (erster `---`-Block), sonst `null`. */
export function datumDerNotiz(path: string, text: string): Day | null {
  const m = TAGESNOTIZ.exec(normalisiert(path));
  if (m && isValidDay(m[1])) return m[1];
  const s = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (!/^---[ \t]*\r?\n/.test(s)) return null;
  const zeilen = s.split(/\r?\n/);
  for (let i = 1; i < zeilen.length; i++) {
    if (/^---[ \t]*$/.test(zeilen[i])) break;
    const d = /^date:[ \t]*["']?(\d{4}-\d{2}-\d{2})(?!\d)/.exec(zeilen[i]);
    if (d && isValidDay(d[1])) return d[1];
  }
  return null;
}

const MONATE: Record<string, number> = {
  januar: 1,
  jaenner: 1,
  feber: 2,
  februar: 2,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

// Eine Runde von links nach rechts, damit `24.08.2027` nicht zugleich als `24.08.` zählt.
const DATUM = new RegExp(
  [
    String.raw`(?<![\d.])(?<t>\d{1,2})\.(?<m>\d{1,2})\.(?<j>\d{4}|\d{2})?(?!\d)`,
    String.raw`(?<![\d-])(?<iso>\d{4}-\d{2}-\d{2})(?!\d)`,
    String.raw`(?<![a-z])(?<mn>${Object.keys(MONATE).join('|')})\s+(?<mj>\d{4})(?!\d)`,
    String.raw`(?<![a-z])kw\s?(?<kw>\d{1,2})(?:[\s/]+(?<kj>\d{4})(?!\d))?(?!\d)`,
  ].join('|'),
  'g',
);

const TAG_MS = 86_400_000;

function tageZwischen(a: Day, b: Day): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / TAG_MS);
}

/** Abstand eines Bereichs zu einem Tag in Tagen, 0 wenn der Tag darin liegt. */
function abstand(von: Day, bis: Day, tag: Day): number {
  if (tag < von) return tageZwischen(von, tag);
  if (tag > bis) return tageZwischen(tag, bis);
  return 0;
}

/** Der Bereich, der `heute` am nächsten liegt, bei Gleichstand der spätere. */
function naechster(kandidaten: { von: Day; bis: Day }[], heute: Day): { von: Day; bis: Day } | null {
  let best: { von: Day; bis: Day } | null = null;
  let bestAbstand = Infinity;
  for (const k of kandidaten) {
    const a = abstand(k.von, k.bis, heute);
    if (a < bestAbstand || (a === bestAbstand && best && k.von > best.von)) {
      best = k;
      bestAbstand = a;
    }
  }
  return best;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function woche(jahr: number, kw: number): { von: Day; bis: Day } | null {
  if (kw < 1 || kw > 53) return null;
  const key = `${jahr}-W${pad2(kw)}`;
  const tage = weekDays(key);
  // Woche 53 gibt es nicht in jedem Jahr: Dann landet der Montag in der Woche 1 des Folgejahrs.
  if (isoWeekKey(tage[0]) !== key) return null;
  return { von: tage[0], bis: tage[6] };
}

/** Alle Tage und Zeiträume, die eine Zeile nennt (siehe die Formen im Konzept). Ungültige Tage fallen weg. */
export function datenImText(zeile: string, heute: Day): { von: Day; bis: Day }[] {
  const ergebnis: { von: Day; bis: Day }[] = [];
  const jahrHeute = Number(heute.slice(0, 4));
  for (const m of normalisiert(zeile).matchAll(DATUM)) {
    const g = m.groups ?? {};
    if (g.t !== undefined) {
      const tag = Number(g.t);
      const monat = Number(g.m);
      if (g.j !== undefined) {
        const jahr = g.j.length === 2 ? 2000 + Number(g.j) : Number(g.j);
        const d = `${jahr}-${pad2(monat)}-${pad2(tag)}`;
        if (isValidDay(d)) ergebnis.push({ von: d, bis: d });
      } else {
        const kandidaten = [jahrHeute - 1, jahrHeute, jahrHeute + 1]
          .map((j) => `${j}-${pad2(monat)}-${pad2(tag)}`)
          .filter(isValidDay)
          .map((d) => ({ von: d, bis: d }));
        const b = naechster(kandidaten, heute);
        if (b) ergebnis.push(b);
      }
    } else if (g.iso !== undefined) {
      if (isValidDay(g.iso)) ergebnis.push({ von: g.iso, bis: g.iso });
    } else if (g.mn !== undefined) {
      const von = `${g.mj}-${pad2(MONATE[g.mn])}-01`;
      if (isValidDay(von)) {
        const folgemonat = MONATE[g.mn] === 12 ? `${Number(g.mj) + 1}-01-01` : `${g.mj}-${pad2(MONATE[g.mn] + 1)}-01`;
        ergebnis.push({ von, bis: addDays(folgemonat, -1) });
      }
    } else if (g.kw !== undefined) {
      const kw = Number(g.kw);
      if (g.kj !== undefined) {
        const w = woche(Number(g.kj), kw);
        if (w) ergebnis.push(w);
      } else {
        const kandidaten = [jahrHeute - 1, jahrHeute, jahrHeute + 1]
          .map((j) => woche(j, kw))
          .filter((w): w is { von: Day; bis: Day } => w !== null);
        const b = naechster(kandidaten, heute);
        if (b) ergebnis.push(b);
      }
    }
  }
  return ergebnis;
}

/** Je Datenzeile einer CSV eine Zeile `Spalte: Wert · Spalte: Wert`, nur nicht leere Werte, ohne die Kopfzeile. */
export function csvZeilen(text: string): string[] {
  const zeilen = parseCsv(text);
  if (zeilen.length < 2) return [];
  const kopf = zeilen[0].map((k) => k.trim());
  const aus: string[] = [];
  for (const z of zeilen.slice(1)) {
    const teile: string[] = [];
    z.forEach((wert, i) => {
      const w = wert.replace(/\s+/g, ' ').trim();
      if (w === '') return;
      teile.push(kopf[i] ? `${kopf[i]}: ${w}` : w);
    });
    if (teile.length > 0) aus.push(teile.join(' · '));
  }
  return aus;
}
