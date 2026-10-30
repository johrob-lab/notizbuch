import { serializePage } from '../ink/svg';
import type { Page } from '../ink/types';
import { besprechungLayout } from '../pages/layouts';
import { hasBlockedWordPart } from '../sync/paths';
import { isValidDay, type Day } from './dates';
import { besprechungBase, besprechungPagePath } from './filenames';

// Besprechungen: wie ihre Seiten heißen, welche Kopfdaten sie haben und wie aus einer Dateiliste die Seiten einer
// Besprechung werden. Reine Rechnung ohne DOM und ohne Netz.

const BAD_DAY = 'Bitte ein gültiges Datum angeben.';
const BAD_TIME = 'Bitte die Zeit als HH:MM angeben, zum Beispiel 08:00.';
const BLOCKED = 'Bitte ein anderes Thema wählen, Wörter wie Passwort sind im Dateinamen nicht erlaubt.';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** `2026-10-29 0800 Thema`: Tag, Uhrzeit ohne Doppelpunkt und das Thema, wie es im Dateinamen steht. */
const MEETING_BASE = /^(?<datum>\d{4}-\d{2}-\d{2}) (?<stunde>[01]\d|2[0-3])(?<minute>[0-5]\d) (?<thema>.+)$/;
/** `2026-10-29 0800 Thema S2.svg`: eine Seite einer Besprechung. Konfliktkopien und andere Endungen gehören nicht dazu. */
const MEETING_PAGE = /^(?<datum>\d{4}-\d{2}-\d{2}) (?<zeit>(?:[01]\d|2[0-3])[0-5]\d) (?<thema>.+) S(?<seite>[1-9]\d*)\.svg$/;

/** Die Kopfdaten einer Besprechungsseite in der Reihenfolge, in der sie in der Datei stehen. */
const HEADER_KEYS = ['thema', 'datum', 'zeit', 'ort', 'projekt', 'seitennr'];

/** `true`, wenn `zeit` die Form `HH:MM` hat und es diese Uhrzeit gibt (`00:00` bis `23:59`). */
export function isValidTime(zeit: string): boolean {
  return TIME.test(zeit);
}

/**
 * Tag, Uhrzeit und Thema aus dem Namen einer Besprechung ohne Seitennummer, zum Beispiel `2026-10-29 0800 Thema`.
 * `null`, wenn der Name nicht so gebaut ist.
 */
export function parseMeetingBase(base: string): { datum: Day; zeit: string; thema: string } | null {
  const found = MEETING_BASE.exec(base)?.groups;
  if (!found || !isValidDay(found.datum)) return null;
  return { datum: found.datum, zeit: `${found.stunde}:${found.minute}`, thema: found.thema };
}

/**
 * Legt die erste Seite einer Besprechung an: Name, Pfad und die Seite mit ihren Kopfdaten. Geschrieben wird hier nichts.
 * Wirft einen Fehler mit einem Hinweis für die Person, wenn Tag oder Uhrzeit nicht stimmen oder das Thema einen Dateinamen
 * ergäbe, den die App nie öffnet (Wörter wie Passwort oder Token).
 */
export function createMeeting(o: { datum: Day; zeit: string; thema: string; ort?: string; projekt?: string }): { base: string; path: string; page: Page } {
  if (!isValidDay(o.datum)) throw new Error(BAD_DAY);
  if (!isValidTime(o.zeit)) throw new Error(BAD_TIME);
  // Umlaute als ein Zeichen, wie der Vault sie schreibt: Ein eingefügter Text kann sie als Buchstabe plus Trema mitbringen.
  const thema = o.thema.trim().normalize('NFC');
  const base = besprechungBase(o.datum, o.zeit, thema);
  const path = besprechungPagePath(base, 1);
  if (hasBlockedWordPart(path)) throw new Error(BLOCKED);
  const meta = {
    thema,
    datum: o.datum,
    zeit: o.zeit,
    ort: (o.ort ?? '').trim(),
    projekt: (o.projekt ?? '').trim(),
    seitennr: '1',
  };
  return { base, path, page: { kind: 'besprechung', key: base, meta, strokes: [] } };
}

/**
 * Die vollständigen Kopfdaten der Seite `n` der Besprechung `base`: Was `meta` hat, bleibt (Thema, Ort und Projekt
 * beliebig, Tag und Uhrzeit nur, wenn sie gültig sind). Was fehlt, kommt aus dem Namen, und die Seitennummer kommt immer
 * von `n`, denn der Dateiname bestimmt die Seite. Die Schlüssel stehen in fester Reihenfolge (die Sitzung vergleicht
 * Kopfdaten als Text), Angaben, die die App nicht kennt, bleiben dahinter erhalten.
 */
export function meetingMeta(base: string, n: number, meta: Record<string, string>): Record<string, string> {
  // Ein Name ohne Uhrzeit (zum Beispiel von Hand angelegt) hat trotzdem den Tag am Anfang: den kennt der Router.
  const named = parseMeetingBase(base) ?? { datum: base.slice(0, 10), zeit: '', thema: base.slice(11) };
  const full: Record<string, string> = {
    thema: meta.thema ?? named.thema,
    datum: isValidDay(meta.datum ?? '') ? meta.datum : named.datum,
    zeit: isValidTime(meta.zeit ?? '') ? meta.zeit : named.zeit,
    ort: meta.ort ?? '',
    projekt: meta.projekt ?? '',
    seitennr: String(n),
  };
  for (const [key, value] of Object.entries(meta)) {
    if (!HEADER_KEYS.includes(key)) full[key] = value;
  }
  return full;
}

/** Der Text der Datei zu einer Besprechungsseite: mit Kopfdaten und dem Hintergrund, der sie zeigt. */
export function meetingPageText(page: Page): string {
  const layout = besprechungLayout(page.meta);
  return serializePage(page, layout.fields, layout.background());
}

/**
 * Die Besprechungen eines Tages aus den Dateinamen eines Jahresordners: je Besprechung ihre Seiten aufsteigend, die
 * Besprechungen nach Uhrzeit, dann nach Thema. Alles andere (Tagesseiten, Konfliktkopien, andere Tage) bleibt außen vor.
 */
export function listMeetings(fileNames: string[], d: Day): { base: string; pages: number[] }[] {
  const found = new Map<string, { zeit: string; thema: string; pages: Set<number> }>();
  for (const name of fileNames) {
    // Dasselbe Wort mit Umlaut als ein Zeichen oder als Buchstabe plus Trema ist dieselbe Besprechung.
    const g = MEETING_PAGE.exec(name.normalize('NFC'))?.groups;
    if (!g || g.datum !== d || !isValidDay(g.datum)) continue;
    const page = Number(g.seite);
    if (!Number.isSafeInteger(page)) continue;
    const base = `${g.datum} ${g.zeit} ${g.thema}`;
    const meeting = found.get(base) ?? { zeit: g.zeit, thema: g.thema, pages: new Set<number>() };
    meeting.pages.add(page);
    found.set(base, meeting);
  }
  return [...found]
    .sort(([, a], [, b]) => a.zeit.localeCompare(b.zeit) || a.thema.localeCompare(b.thema, 'de'))
    .map(([base, meeting]) => ({ base, pages: [...meeting.pages].sort((a, b) => a - b) }));
}

/** Die Projekte aus der Dateiliste von `02 Projekte`: nur Markdown-Dateien, ohne Endung, nach deutscher Sortierung. */
export function projectNames(entries: { name: string; type: 'file' | 'dir' }[]): string[] {
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.md') && !hasBlockedWordPart(e.name))
    .map((e) => e.name.slice(0, -'.md'.length).normalize('NFC'))
    .filter((name) => name !== '')
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Die Seite, die nach dem Löschen von Seite `n` aufgeht: die davor, sonst die nächste. `null`, wenn es keine andere
 * gibt (dann geht der Tag der Besprechung auf). Sind die Seiten nicht bekannt (`null`), gilt die Nummer davor.
 */
export function pageAfterDelete(pages: number[] | null, n: number): number | null {
  if (pages === null) return n > 1 ? n - 1 : null;
  const others = pages.filter((page) => page !== n);
  const before = others.filter((page) => page < n);
  if (before.length > 0) return Math.max(...before);
  const after = others.filter((page) => page > n);
  return after.length > 0 ? Math.min(...after) : null;
}

/** Die erste Seitennummer ab `from`, deren Datei es noch nicht gibt: So überschreibt eine neue Seite nie eine vorhandene. */
export async function firstFreePage(base: string, from: number, exists: (path: string) => Promise<boolean>): Promise<number> {
  let n = from;
  while (await exists(besprechungPagePath(base, n))) n++;
  return n;
}
