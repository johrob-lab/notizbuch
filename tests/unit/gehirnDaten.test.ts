import { describe, expect, it } from 'vitest';
import { csvZeilen, datenImText, datumDerNotiz, normalisiert } from '../../src/gehirn/daten';

const HEUTE = '2026-11-26';
const tag = (z: string) => datenImText(z, HEUTE);
const eins = (d: string) => [{ von: d, bis: d }];

describe('normalisiert', () => {
  it('faltet Umlaute und ß', () => {
    expect(normalisiert('Größe Übung Maß')).toBe('groesse uebung mass');
  });
  it('faltet ä als a plus U+0308', () => {
    expect(normalisiert('A\u0308rger')).toBe('aerger');
  });
});

describe('datumDerNotiz', () => {
  it('nimmt den Tag aus dem Namen der Tagesnotiz', () => {
    expect(datumDerNotiz('05 Daily Notes/2026-11-25.md', '')).toBe('2026-11-25');
  });
  it('liest date aus dem Kopf, auch in Anführungszeichen oder mit Uhrzeit', () => {
    expect(datumDerNotiz('01 Inbox/A.md', '---\ndate: "2026-10-01"\n---\nText')).toBe('2026-10-01');
    expect(datumDerNotiz('01 Inbox/A.md', '---\ntags: [a]\ndate: 2026-10-01 08:00\n---\n')).toBe('2026-10-01');
  });
  it('gibt ohne Kopf null und liest kein date nach dem Kopf', () => {
    expect(datumDerNotiz('01 Inbox/A.md', 'Text')).toBeNull();
    expect(datumDerNotiz('01 Inbox/A.md', '---\ntags: x\n---\ndate: 2026-10-01')).toBeNull();
    expect(datumDerNotiz('05 Daily Notes/2026-13-45.md', '')).toBeNull();
  });
});

describe('datenImText', () => {
  it('liest T.M.JJ und T.M.JJJJ', () => {
    expect(tag('bis 24.08.27')).toEqual(eins('2027-08-24'));
    expect(tag('am 1.4.2027')).toEqual(eins('2027-04-01'));
    expect(tag('24.08.2027')).toEqual(eins('2027-08-24'));
  });
  it('wählt ohne Jahr das nächstliegende Jahr', () => {
    expect(tag('24.08.')).toEqual(eins('2026-08-24'));
    expect(tag('15.01.')).toEqual(eins('2027-01-15'));
  });
  it('liest JJJJ-MM-TT', () => {
    expect(tag('2027-03-01')).toEqual(eins('2027-03-01'));
  });
  it('liest Monatsnamen mit Jahr als ganzen Monat', () => {
    expect(tag('April 2027')).toEqual([{ von: '2027-04-01', bis: '2027-04-30' }]);
    expect(tag('Jänner 2027')).toEqual([{ von: '2027-01-01', bis: '2027-01-31' }]);
    expect(tag('Feber 2027')).toEqual([{ von: '2027-02-01', bis: '2027-02-28' }]);
    expect(tag('März 2027')).toEqual([{ von: '2027-03-01', bis: '2027-03-31' }]);
    expect(tag('dezember 2027')).toEqual([{ von: '2027-12-01', bis: '2027-12-31' }]);
  });
  it('liest Kalenderwochen', () => {
    expect(tag('KW 40')).toEqual([{ von: '2026-09-28', bis: '2026-10-04' }]);
    expect(tag('KW40')).toEqual([{ von: '2026-09-28', bis: '2026-10-04' }]);
    expect(tag('KW 15/2027')).toEqual([{ von: '2027-04-12', bis: '2027-04-18' }]);
    expect(tag('KW 15 2027')).toEqual([{ von: '2027-04-12', bis: '2027-04-18' }]);
    expect(tag('KW 1')).toEqual([{ von: '2027-01-04', bis: '2027-01-10' }]);
  });
  it('nimmt kein Jahr zur Kalenderwoche, mit dem ein ISO-Datum beginnt', () => {
    expect(tag('KW 40 2027-03-01')).toEqual([{ von: '2026-09-28', bis: '2026-10-04' }, ...eins('2027-03-01')]);
    expect(tag('KW 40/2027-03-01')).toEqual([{ von: '2026-09-28', bis: '2026-10-04' }, ...eins('2027-03-01')]);
    expect(tag('KW 15 2027.')).toEqual([{ von: '2027-04-12', bis: '2027-04-18' }]);
  });
  it('lässt Ungültiges weg', () => {
    expect(tag('31.02.2027')).toEqual([]);
    expect(tag('1.2.3')).toEqual([]);
    expect(tag('8.00 Uhr')).toEqual([]);
    expect(tag('KW 54')).toEqual([]);
    expect(tag('KW 53 2027')).toEqual([]);
    expect(tag('Aprilfest 2027')).toEqual([]);
  });
  it('gibt zwei Bereiche für zwei Daten und zählt ein Datum nur einmal', () => {
    expect(tag('von 24.08.2027 bis 2027-09-01')).toEqual([eins('2027-08-24')[0], eins('2027-09-01')[0]]);
    expect(tag('24.08.2027')).toHaveLength(1);
  });
});

describe('csvZeilen', () => {
  it('macht je Datenzeile Spalte: Wert und lässt leere Werte und den Kopf weg', () => {
    expect(csvZeilen('Datum;TFZF best.;Bemerkung\n2027-04-03;x;\n')).toEqual(['Datum: 2027-04-03 · TFZF best.: x']);
  });
  it('behält einen Wert mit Strichpunkt in Anführungszeichen ganz', () => {
    expect(csvZeilen('A;B\n"x;y";z')).toEqual(['A: x;y · B: z']);
  });
  it('liest BOM und CRLF', () => {
    expect(csvZeilen('\uFEFFA;B\r\n1;2\r\n')).toEqual(['A: 1 · B: 2']);
  });
});
