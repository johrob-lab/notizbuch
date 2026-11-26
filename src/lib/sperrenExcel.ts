import { parseCsv } from './csv';
import { isValidDay, type Day } from './dates';
import { FACHLINIEN, type Fachlinie } from './sperren';
import { PLAETZE, sperrenFeldId, type Platz } from '../pages/sperren';

/** Die Kopfzeile der Excel-Datei, 36 Spalten. */
export const EXCEL_KOPF =
  'Fachlinie;Datum;Betra-Nr.;Abschnitt;Gleis;von;bis;HTW Anz./Nr.;HTW Fahrer;HTW best.;HTW zug.;BCR Anz./Nr.;BCR best.;BCR zug.;TUF Anz./Nr.;TUF best.;TUF zug.;MTW Anz./Nr.;MTW best.;MTW zug.;SAS ET Anz./Name;SAS ET best.;SAS ET zug.;TFZF Art;TFZF Name / Firma;TFZF best.;TFZF zug.;Bemerkung / Ansprechpartner;offen;Platz;Anzeigetext;Bedarf-Nr.;fremd;Zeitraum;Hinweis Übernahme;Stand';

const KOPF = EXCEL_KOPF.split(';');
const SPALTEN = KOPF.length;
const IX = {
  fachlinie: KOPF.indexOf('Fachlinie'),
  datum: KOPF.indexOf('Datum'),
  abschnitt: KOPF.indexOf('Abschnitt'),
  gleis: KOPF.indexOf('Gleis'),
  von: KOPF.indexOf('von'),
  bis: KOPF.indexOf('bis'),
  platz: KOPF.indexOf('Platz'),
  anzeigetext: KOPF.indexOf('Anzeigetext'),
  hinweis: KOPF.indexOf('Hinweis Übernahme'),
  stand: KOPF.indexOf('Stand'),
};

export type ExcelZeile = {
  datum: Day;
  abschnitt: string;
  gleis: string;
  von: string;
  bis: string;
  platz: number | null;
  anzeigetext: string;
  hinweis: string;
};

export type ExcelStand = {
  fachlinie: Fachlinie;
  jahr: number;
  /** Der späteste Wert der Spalte Stand, `null` ohne Zeilen. */
  stand: string | null;
  zeilen: ExcelZeile[];
  /** Wie viele Zeilen aus dem Notizbuch stammen (Kennung im Hinweis). */
  ausNotizbuch: number;
};

export type ExcelLesung = { ok: true; stand: ExcelStand } | { ok: false; fehler: string };

export const KEIN_EXCEL_STAND = 'Die Datei ist kein Excel-Stand der Sperren: Die erste Zeile passt nicht.';
const fehlerSpalten = (n: number, k: number): string => `Zeile ${n}: ${k} statt ${SPALTEN} Spalten.`;
const fehlerFachlinie = (n: number, x: string): string => `Zeile ${n}: Die Fachlinie „${x}“ gibt es nicht.`;
const fehlerDatum = (n: number, d: string): string => `Zeile ${n}: „${d}“ ist kein Tag im Format JJJJ-MM-TT.`;
const fehlerStand = (n: number, s: string): string => `Zeile ${n}: Der Stand „${s}“ ist nicht im Format JJJJ-MM-TT HH:MM.`;
const fehlerAndereDatei = (f: string, j: number, F: string, J: number): string =>
  `Die Datei ist für ${f} ${j}, offen ist ${F} ${J}.`;

const STAND_FORM = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const KENNUNG = /^(?:im Notizbuch (?:geändert|gestrichen) \| )?NB (?:IB|Lehne)-\d{4}-\d{2}-\d{2}-[123] \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/** Wahr, wenn „Hinweis Übernahme“ sagt, dass die Zeile aus dem Notizbuch stammt (wie im Makro). */
export function ausNotizbuch(hinweis: string): boolean {
  return KENNUNG.test(hinweis.trim());
}

/** Abschnitte vergleichen wie im Makro: Leerraum am Rand weg, innen ein Leerzeichen, Groß und klein egal. */
export function vergleichsform(s: string): string {
  return s.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Liest den Excel-Stand. Der erste Fehler gewinnt, `n` zählt die Datensätze, die Kopfzeile ist 1. */
export function leseExcelStand(text: string, erwartet: { fachlinie: Fachlinie; jahr: number }): ExcelLesung {
  const records = parseCsv(text);
  if (records.length === 0 || records[0].join(';') !== EXCEL_KOPF) return { ok: false, fehler: KEIN_EXCEL_STAND };

  const zeilen: ExcelZeile[] = [];
  let fachlinie: Fachlinie = erwartet.fachlinie;
  let jahr = erwartet.jahr;
  let stand: string | null = null;
  let nb = 0;

  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    const n = i + 1;
    if (r.length !== SPALTEN) return { ok: false, fehler: fehlerSpalten(n, r.length) };
    const f = r[IX.fachlinie].trim();
    if (!(FACHLINIEN as readonly string[]).includes(f)) return { ok: false, fehler: fehlerFachlinie(n, f) };
    const datum = r[IX.datum].trim();
    if (!isValidDay(datum)) return { ok: false, fehler: fehlerDatum(n, datum) };
    const st = r[IX.stand].trim();
    if (!STAND_FORM.test(st)) return { ok: false, fehler: fehlerStand(n, st) };
    const j = Number(datum.slice(0, 4));
    if (f !== erwartet.fachlinie || j !== erwartet.jahr) {
      return { ok: false, fehler: fehlerAndereDatei(f, j, erwartet.fachlinie, erwartet.jahr) };
    }
    fachlinie = f as Fachlinie;
    jahr = j;
    if (stand === null || st > stand) stand = st;
    const hinweis = r[IX.hinweis].trim();
    if (ausNotizbuch(hinweis)) nb++;
    const p = /^\d+$/.test(r[IX.platz].trim()) ? Number(r[IX.platz].trim()) : null;
    zeilen.push({
      datum,
      abschnitt: r[IX.abschnitt].trim(),
      gleis: r[IX.gleis].trim(),
      von: r[IX.von].trim(),
      bis: r[IX.bis].trim(),
      platz: p,
      anzeigetext: r[IX.anzeigetext].trim(),
      hinweis,
    });
  }
  return { ok: true, stand: { fachlinie, jahr, stand, zeilen, ausNotizbuch: nb } };
}

/**
 * Der Stand im Kopf der Sperrenseite: leer, solange die Datei lädt (`undefined`), ohne Datei (`null`) „Noch kein Excel-Stand für
 * IB 2027“, sonst das Datum des Stands als `TT.MM.JJJJ, HH:MM`. Kaputt oder ohne Sperren sagt er das.
 */
export function excelStandText(lesung: ExcelLesung | null | undefined, f: Fachlinie, jahr: number): string {
  if (lesung === undefined) return '';
  if (lesung === null) return `Noch kein Excel-Stand für ${f} ${jahr}`;
  if (!lesung.ok) return `Der Excel-Stand für ${f} ${jahr} lässt sich nicht lesen.`;
  const { stand, zeilen } = lesung.stand;
  if (zeilen.length === 0 || stand === null) return `Excel-Stand für ${f} ${jahr}: keine Sperren`;
  return `Excel-Stand vom ${stand.slice(8, 10)}.${stand.slice(5, 7)}.${stand.slice(0, 4)}, ${stand.slice(11, 16)}`;
}

/**
 * Die Einträge der Liste aus dem Notizbuch, die gültig sind, als `JJJJ-MM-TT|<vergleichsform(Abschnitt)>`.
 * Die Spalten werden an ihren Überschriften gefunden. Wirft nie.
 */
export function gueltigeEintraege(liste: string | null): Set<string> {
  const aus = new Set<string>();
  if (!liste) return aus;
  const records = parseCsv(liste);
  if (records.length === 0) return aus;
  const kopf = records[0].map((k) => k.trim());
  const d = kopf.indexOf('Datum');
  const a = kopf.indexOf('Abschnitt');
  const s = kopf.indexOf('Status');
  if (d < 0 || a < 0 || s < 0) return aus;
  for (const r of records.slice(1)) {
    if ((r[s] ?? '').trim() !== 'gültig') continue;
    aus.add(`${(r[d] ?? '').trim()}|${vergleichsform(r[a] ?? '')}`);
  }
  return aus;
}

/** Der Text im grauen Platz: Anzeigetext oder Abschnitt, dazu die Zeit. Ohne Text und Abschnitt leer. */
export function grauerText(z: ExcelZeile): string {
  const text = z.anzeigetext || z.abschnitt;
  if (!text) return '';
  if (z.von && z.bis) return `${text} ${z.von}-${z.bis}`;
  if (z.von) return `${text} ab ${z.von}`;
  if (z.bis) return `${text} bis ${z.bis}`;
  return text;
}

export type GrauerPlatz = { feld: string; text: string };
/** Weitere graue Sperren, die keinen freien Platz mehr fanden, am Feld des dritten Platzes. */
export type GrauesMehr = { feld: string; anzahl: number };

/**
 * Verteilt die Zeilen des Excel-Stands auf die Plätze der Seite. Zeilen aus dem Notizbuch (Kennung),
 * im Notizbuch schon gültige Zeilen (Datum und Abschnitt) und Zeilen ohne Text bleiben draußen. Je Tag
 * stabil nach Platz sortiert (ohne Platz und über 3 zuletzt) bekommt jede Zeile ihren Wunschplatz, wenn
 * er frei ist, sonst den nächsten freien rechts davon, dann von links. Frei heißt weder Tinte (`belegt`) noch schon grau.
 */
export function graueSperren(
  zeilen: readonly ExcelZeile[],
  o: { tage: readonly Day[]; belegt: ReadonlySet<string>; gueltig: ReadonlySet<string> },
): { plaetze: GrauerPlatz[]; mehr: GrauesMehr[] } {
  const plaetze: GrauerPlatz[] = [];
  const mehr: GrauesMehr[] = [];
  const rang = (z: ExcelZeile): number => (z.platz !== null && z.platz >= 1 && z.platz <= 3 ? z.platz : 4);

  for (const tag of o.tage) {
    const heute = zeilen
      .filter((z) => z.datum === tag)
      .filter((z) => !ausNotizbuch(z.hinweis))
      .filter((z) => !o.gueltig.has(`${z.datum}|${vergleichsform(z.abschnitt)}`))
      .filter((z) => grauerText(z) !== '')
      .map((z, i) => ({ z, i }))
      .sort((a, b) => rang(a.z) - rang(b.z) || a.i - b.i)
      .map((x) => x.z);

    const vergeben = new Set<Platz>();
    const frei = (p: Platz): boolean => !o.belegt.has(sperrenFeldId(tag, p)) && !vergeben.has(p);
    // R6: zuerst der Platz aus Excel, sonst der nächste freie rechts davon, dann von links. Ohne Platz der erste freie.
    const suche = (wunsch: number | null): Platz | undefined => {
      const gueltig = wunsch !== null && wunsch >= 1 && wunsch <= 3;
      if (!gueltig) return PLAETZE.find(frei);
      return PLAETZE.find((p) => p >= wunsch && frei(p)) ?? PLAETZE.find(frei);
    };
    let ueber = 0;
    for (const z of heute) {
      const platz = suche(z.platz);
      if (platz === undefined) {
        ueber++;
        continue;
      }
      vergeben.add(platz);
      plaetze.push({ feld: sperrenFeldId(tag, platz), text: grauerText(z) });
    }
    if (ueber > 0) mehr.push({ feld: sperrenFeldId(tag, 3), anzahl: ueber });
  }
  return { plaetze, mehr };
}
