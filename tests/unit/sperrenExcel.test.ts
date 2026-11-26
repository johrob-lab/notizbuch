import { describe, expect, test } from 'vitest';
import {
  ausNotizbuch,
  EXCEL_KOPF,
  excelStandText,
  grauerText,
  graueSperren,
  gueltigeEintraege,
  KEIN_EXCEL_STAND,
  leseExcelStand,
  pruefeExcelDatei,
  uebernommenText,
  vergleichsform,
  type ExcelZeile,
} from '../../src/lib/sperrenExcel';

type Feld = 'datum' | 'abschnitt' | 'gleis' | 'von' | 'bis' | 'platz' | 'anzeigetext' | 'hinweis' | 'bemerkung' | 'fachlinie' | 'stand';

function wert(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Baut eine Excel-CSV: BOM, Kopf, je Zeile 36 Werte in der Reihenfolge des Kopfs. */
function excelCsv(zeilen: Partial<Record<Feld, string>>[]): string {
  const kopf = EXCEL_KOPF.split(';');
  const spalte: Record<Feld, string> = {
    fachlinie: 'Fachlinie',
    datum: 'Datum',
    abschnitt: 'Abschnitt',
    gleis: 'Gleis',
    von: 'von',
    bis: 'bis',
    bemerkung: 'Bemerkung / Ansprechpartner',
    platz: 'Platz',
    anzeigetext: 'Anzeigetext',
    hinweis: 'Hinweis Übernahme',
    stand: 'Stand',
  };
  const zeilenText = zeilen.map((z) => {
    const v = { fachlinie: 'IB', stand: '2026-11-26 09:40', ...z } as Partial<Record<Feld, string>>;
    return kopf
      .map((k) => {
        const f = (Object.keys(spalte) as Feld[]).find((x) => spalte[x] === k);
        return wert(f ? (v[f] ?? '') : '');
      })
      .join(';');
  });
  return '\uFEFF' + [EXCEL_KOPF, ...zeilenText].join('\r\n') + '\r\n';
}

const ERWARTET = { fachlinie: 'IB' as const, jahr: 2027 };

describe('leseExcelStand', () => {
  const drei = [
    {
      datum: '2027-03-01',
      abschnitt: 'Muster Abschnitt 1',
      gleis: '2',
      von: '08:00',
      bis: '14:00',
      platz: '1',
      anzeigetext: 'Muster Abschnitt 1 / Gl. 2',
      hinweis: 'NB IB-2027-03-01-1 2026-11-25 19:05',
    },
    { datum: '2027-03-02', abschnitt: 'Beispielstrecke Nord', stand: '2026-11-26 10:15' },
    { datum: '2027-04-02', abschnitt: 'Muster Abschnitt 2', hinweis: 'im Notizbuch geändert | NB IB-2027-04-02-2 2026-11-25 19:05' },
  ];

  test('drei Zeilen', () => {
    const r = leseExcelStand(excelCsv(drei), ERWARTET);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stand.fachlinie).toBe('IB');
    expect(r.stand.jahr).toBe(2027);
    expect(r.stand.stand).toBe('2026-11-26 10:15');
    expect(r.stand.zeilen).toHaveLength(3);
    expect(r.stand.zeilen[0]).toEqual({
      datum: '2027-03-01',
      abschnitt: 'Muster Abschnitt 1',
      gleis: '2',
      von: '08:00',
      bis: '14:00',
      platz: 1,
      anzeigetext: 'Muster Abschnitt 1 / Gl. 2',
      hinweis: 'NB IB-2027-03-01-1 2026-11-25 19:05',
    });
    expect(r.stand.ausNotizbuch).toBe(2);
  });

  test('eine Bemerkung mit Strichpunkt, Anführungszeichen und Zeilenumbruch verschiebt nichts', () => {
    const r = leseExcelStand(
      excelCsv([{ datum: '2027-03-01', abschnitt: 'Muster Abschnitt 1', bemerkung: 'Muster; mit "Zitat"\r\nzweite Zeile', platz: '2', anzeigetext: 'Text', hinweis: 'x' }]),
      ERWARTET,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stand.zeilen[0]).toMatchObject({ abschnitt: 'Muster Abschnitt 1', platz: 2, anzeigetext: 'Text', hinweis: 'x' });
  });

  test('LF und kein BOM gehen auch', () => {
    const text = excelCsv(drei).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    expect(leseExcelStand(text, ERWARTET).ok).toBe(true);
  });

  test('Platz leer, Text und 4', () => {
    const r = leseExcelStand(
      excelCsv([{ datum: '2027-03-01', platz: '' }, { datum: '2027-03-01', platz: 'x' }, { datum: '2027-03-01', platz: '4' }]),
      ERWARTET,
    );
    expect(r.ok && r.stand.zeilen.map((z) => z.platz)).toEqual([null, null, 4]);
  });

  test('andere Kopfzeile', () => {
    expect(leseExcelStand('a;b\r\n', ERWARTET)).toEqual({ ok: false, fehler: KEIN_EXCEL_STAND });
    expect(leseExcelStand('', ERWARTET)).toEqual({ ok: false, fehler: KEIN_EXCEL_STAND });
  });

  test('35 Werte', () => {
    const text = excelCsv([{ datum: '2027-03-01' }, { datum: '2027-03-02' }]).replace(/;[^;\r\n]*(\r\n$)/, '$1');
    expect(leseExcelStand(text, ERWARTET)).toEqual({ ok: false, fehler: 'Zeile 3: 35 statt 36 Spalten.' });
  });

  test('ungültiges Datum', () => {
    expect(leseExcelStand(excelCsv([{ datum: '2027-02-30' }]), ERWARTET)).toEqual({
      ok: false,
      fehler: 'Zeile 2: „2027-02-30“ ist kein Tag im Format JJJJ-MM-TT.',
    });
  });

  test('unbekannte Fachlinie', () => {
    expect(leseExcelStand(excelCsv([{ datum: '2027-03-01', fachlinie: 'Ost' }]), ERWARTET)).toEqual({
      ok: false,
      fehler: 'Zeile 2: Die Fachlinie „Ost“ gibt es nicht.',
    });
  });

  test('Stand im falschen Format', () => {
    const r = leseExcelStand(excelCsv([{ datum: '2027-03-01', stand: '26.11.2026' }]), ERWARTET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toContain('nicht im Format JJJJ-MM-TT HH:MM');
  });

  test('falsche Fachlinie und falsches Jahr', () => {
    expect(leseExcelStand(excelCsv([{ datum: '2027-03-01', fachlinie: 'Lehne' }]), ERWARTET)).toEqual({
      ok: false,
      fehler: 'Die Datei ist für Lehne 2027, offen ist IB 2027.',
    });
    expect(leseExcelStand(excelCsv([{ datum: '2028-03-01' }]), ERWARTET)).toEqual({
      ok: false,
      fehler: 'Die Datei ist für IB 2028, offen ist IB 2027.',
    });
  });

  test('nur der Kopf', () => {
    expect(leseExcelStand(excelCsv([]), ERWARTET)).toEqual({
      ok: true,
      stand: { fachlinie: 'IB', jahr: 2027, stand: null, zeilen: [], ausNotizbuch: 0 },
    });
  });
});

test('ausNotizbuch', () => {
  expect(ausNotizbuch('NB IB-2027-03-01-1 2026-11-25 19:05')).toBe(true);
  expect(ausNotizbuch(' im Notizbuch geändert | NB IB-2027-03-01-2 2026-11-25 19:05 ')).toBe(true);
  expect(ausNotizbuch('im Notizbuch gestrichen | NB Lehne-2027-04-02-3 2026-11-25 19:05')).toBe(true);
  expect(ausNotizbuch('')).toBe(false);
  expect(ausNotizbuch('kein Zeitraum mehr')).toBe(false);
  expect(ausNotizbuch('NB IB-2027-03-01-4 2026-11-25 19:05')).toBe(false);
  expect(ausNotizbuch('NB IB-2027-03-01-1')).toBe(false);
});

test('vergleichsform', () => {
  expect(vergleichsform('  Muster \t Abschnitt\u00A01 ')).toBe('muster abschnitt 1');
});

describe('gueltigeEintraege', () => {
  const kopf = 'ID;Fachlinie;Datum;Abschnitt;Abschnitt gelesen;Gleis;von;bis;Betra-Nr.;Sperre;Status;Hinweis;Stand';
  const zeile = (datum: string, abschnitt: string, status: string) =>
    `IB-${datum}-1;IB;${datum};${abschnitt};${abschnitt};;;;;;${status};;2026-11-25 19:05`;
  const liste = '\uFEFF' + [kopf, zeile('2027-03-02', 'Beispielstrecke Nord', 'gültig'), zeile('2027-03-03', 'Muster Abschnitt 1', 'unsicher'), zeile('2027-03-04', 'Muster Abschnitt 2', 'gestrichen')].join('\r\n') + '\r\n';

  test('nur Status gültig', () => {
    expect([...gueltigeEintraege(liste)]).toEqual(['2027-03-02|beispielstrecke nord']);
  });

  test('leer, null, fehlende Spalten', () => {
    expect(gueltigeEintraege(null).size).toBe(0);
    expect(gueltigeEintraege('').size).toBe(0);
    expect(gueltigeEintraege('ID;Fachlinie\r\nx;y\r\n').size).toBe(0);
  });
});

describe('grauerText', () => {
  const z = (o: Partial<ExcelZeile>): ExcelZeile => ({ datum: '2027-03-01', abschnitt: '', gleis: '', von: '', bis: '', platz: null, anzeigetext: '', hinweis: '', ...o });
  test('Varianten', () => {
    expect(grauerText(z({ anzeigetext: 'Muster Abschnitt 1 / Gl. 2', von: '08:00', bis: '14:00' }))).toBe('Muster Abschnitt 1 / Gl. 2 08:00-14:00');
    expect(grauerText(z({ abschnitt: 'Muster Abschnitt 1' }))).toBe('Muster Abschnitt 1');
    expect(grauerText(z({ abschnitt: 'Muster Abschnitt 1', von: '22:30' }))).toBe('Muster Abschnitt 1 ab 22:30');
    expect(grauerText(z({ abschnitt: 'Muster Abschnitt 1', bis: '06:00' }))).toBe('Muster Abschnitt 1 bis 06:00');
    expect(grauerText(z({ von: '08:00' }))).toBe('');
  });
});

describe('graueSperren', () => {
  const tage = ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05'];
  const z = (o: Partial<ExcelZeile>): ExcelZeile => ({
    datum: '2027-03-01',
    abschnitt: 'Muster Abschnitt 1',
    gleis: '',
    von: '',
    bis: '',
    platz: null,
    anzeigetext: 'Muster Abschnitt 1',
    hinweis: '',
    ...o,
  });
  const leer = new Set<string>();
  const alle = new Set(['2027-03-01|muster abschnitt 1']);
  const f = (p: number, d = '2027-03-01') => `sperre-${d}-${p}`;
  const feldNamen = (r: ReturnType<typeof graueSperren>) => r.plaetze.map((p) => p.feld);

  test('Platz 1', () => {
    const r = graueSperren([z({ platz: 1 })], { tage, belegt: leer, gueltig: leer });
    expect(r.plaetze).toEqual([{ feld: f(1), text: 'Muster Abschnitt 1' }]);
    expect(r.mehr).toEqual([]);
  });

  test('Kennung im Hinweis', () => {
    expect(graueSperren([z({ platz: 1, hinweis: 'NB IB-2027-03-01-1 2026-11-25 19:05' })], { tage, belegt: leer, gueltig: leer }).plaetze).toEqual([]);
  });

  test('im Notizbuch gültig, auch mit anderem Leerraum', () => {
    expect(graueSperren([z({ platz: 1, abschnitt: 'muster  abschnitt 1' })], { tage, belegt: leer, gueltig: alle }).plaetze).toEqual([]);
  });

  test('Tinte in Platz 1 schiebt in Platz 2', () => {
    const r = graueSperren([z({ platz: 1 })], { tage, belegt: new Set([f(1)]), gueltig: leer });
    expect(feldNamen(r)).toEqual([f(2)]);
  });

  test('Platz 1, 2, 3 mit Tinte in 2: Grau in 1 und 3, eine mehr', () => {
    const r = graueSperren(
      [z({ platz: 1, anzeigetext: 'A' }), z({ platz: 2, anzeigetext: 'B' }), z({ platz: 3, anzeigetext: 'C' })],
      { tage, belegt: new Set([f(2)]), gueltig: leer },
    );
    expect(r.plaetze).toEqual([{ feld: f(1), text: 'A' }, { feld: f(3), text: 'B' }]);
    expect(r.mehr).toEqual([{ feld: f(3), anzahl: 1 }]);
  });

  test('Platz 2 mit Tinte in 2 geht nach rechts in Platz 3, nicht nach 1', () => {
    const r = graueSperren([z({ platz: 2 })], { tage, belegt: new Set([f(2)]), gueltig: leer });
    expect(feldNamen(r)).toEqual([f(3)]);
  });

  test('Platz 3 mit Tinte in 3 geht nach 1', () => {
    expect(feldNamen(graueSperren([z({ platz: 3 })], { tage, belegt: new Set([f(3)]), gueltig: leer }))).toEqual([f(1)]);
  });

  test('zwei Zeilen ohne Platz in Dateireihenfolge', () => {
    const r = graueSperren([z({ anzeigetext: 'A' }), z({ anzeigetext: 'B' })], { tage, belegt: leer, gueltig: leer });
    expect(r.plaetze).toEqual([{ feld: f(1), text: 'A' }, { feld: f(2), text: 'B' }]);
  });

  test('Platz 4 nimmt den ersten freien', () => {
    expect(feldNamen(graueSperren([z({ platz: 4 })], { tage, belegt: leer, gueltig: leer }))).toEqual([f(1)]);
  });

  test('alle drei mit Tinte, zwei Zeilen', () => {
    const r = graueSperren([z({}), z({})], { tage, belegt: new Set([f(1), f(2), f(3)]), gueltig: leer });
    expect(r.plaetze).toEqual([]);
    expect(r.mehr).toEqual([{ feld: f(3), anzahl: 2 }]);
  });

  test('Tag nicht auf der Seite', () => {
    const r = graueSperren([z({ datum: '2027-04-01', platz: 1 })], { tage, belegt: leer, gueltig: leer });
    expect(r).toEqual({ plaetze: [], mehr: [] });
  });

  test('Zeile ohne Text', () => {
    const r = graueSperren([z({ anzeigetext: '', abschnitt: '' })], { tage, belegt: new Set([f(1), f(2), f(3)]), gueltig: leer });
    expect(r).toEqual({ plaetze: [], mehr: [] });
  });
});

describe('excelStandText', () => {
  test('solange die Datei lädt, steht nichts da', () => {
    expect(excelStandText(undefined, 'IB', 2027)).toBe('');
  });

  test('ohne Datei', () => {
    expect(excelStandText(null, 'IB', 2027)).toBe('Noch kein Excel-Stand für IB 2027');
    expect(excelStandText(null, 'Lehne', 2028)).toBe('Noch kein Excel-Stand für Lehne 2028');
  });

  test('kaputt', () => {
    expect(excelStandText({ ok: false, fehler: KEIN_EXCEL_STAND }, 'IB', 2027)).toBe('Der Excel-Stand für IB 2027 lässt sich nicht lesen.');
  });

  test('mit Stand: Datum und Uhrzeit', () => {
    const lesung = leseExcelStand(excelCsv([{ datum: '2027-03-01', abschnitt: 'Muster Abschnitt 1' }]), ERWARTET);
    expect(excelStandText(lesung, 'IB', 2027)).toBe('Excel-Stand vom 26.11.2026, 09:40');
  });

  test('ohne Zeilen', () => {
    expect(excelStandText(leseExcelStand(excelCsv([]), ERWARTET), 'IB', 2027)).toBe('Excel-Stand für IB 2027: keine Sperren');
  });
});

describe('pruefeExcelDatei', () => {
  const KEINE_SPERREN = 'Die Datei hat keine Sperren und passt nach ihrem Namen nicht zu IB 2027.';
  const zeile = { datum: '2027-03-01', abschnitt: 'Muster Abschnitt 1' };

  test('Zeilen einer anderen Fachlinie', () => {
    const r = pruefeExcelDatei(excelCsv([{ ...zeile, fachlinie: 'Lehne' }]), 'Sperren Lehne 2027 Excel.csv', ERWARTET);
    expect(r).toEqual({ ok: false, fehler: 'Die Datei ist für Lehne 2027, offen ist IB 2027.' });
  });

  test('Zeilen passen: der Name zählt nicht', () => {
    expect(pruefeExcelDatei(excelCsv([zeile]), 'export.csv', ERWARTET).ok).toBe(true);
  });

  test('nur Kopf mit passendem Namen, auch mit Zähler', () => {
    expect(pruefeExcelDatei(excelCsv([]), 'Sperren IB 2027 Excel (1).csv', ERWARTET).ok).toBe(true);
    expect(pruefeExcelDatei(excelCsv([]), 'sperren ib 2027 excel.CSV', ERWARTET).ok).toBe(true);
  });

  test('nur Kopf mit falschem Namen', () => {
    for (const name of ['Sperren Lehne 2027 Excel.csv', 'Sperren IB 2028 Excel.csv', 'export.csv']) {
      expect(pruefeExcelDatei(excelCsv([]), name, ERWARTET), name).toEqual({ ok: false, fehler: KEINE_SPERREN });
    }
  });

  test('kein Excel-Stand: der Fehler der Lesung', () => {
    expect(pruefeExcelDatei('a;b\r\n', 'Sperren IB 2027 Excel.csv', ERWARTET)).toEqual({ ok: false, fehler: KEIN_EXCEL_STAND });
  });
});

describe('uebernommenText', () => {
  const stand = (n: number, nb: number) => ({ fachlinie: 'IB' as const, jahr: 2027, stand: null, zeilen: Array(n).fill(null), ausNotizbuch: nb });
  test('mehrere und eine Sperre', () => {
    expect(uebernommenText(stand(223, 0))).toBe('Excel-Stand übernommen: 223 Sperren, davon 0 aus dem Notizbuch.');
    expect(uebernommenText(stand(1, 1))).toBe('Excel-Stand übernommen: 1 Sperre, davon 1 aus dem Notizbuch.');
  });
});
