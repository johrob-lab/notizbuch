import { expect, test } from 'vitest';
import { findePfad } from '../../src/gehirn/werkzeuge';
import { ohneQuellenZeile, quellenAus, quellenZeile } from '../../src/gehirn/quellen';

// Die Zeile „Quellen:“ am Ende der Antwort: Sie bleibt unsichtbar, ihre Pfade werden zu Knöpfen, aber nur, wenn es die Notiz gibt
// und sie in dieser Frage vorkam.

const PFADE = ['05 Daily Notes/2026-11-25.md', '02 Projekte/Beispiel Projekt.md', '03 Bereiche/Planung/Sperren Abschnitte Lehne.md', '07 Anhänge/Notizbuch/2027/Sperren IB 2027.csv'];
const dateien = (pfade: readonly string[]) => pfade.map((path) => ({ path, sha: 'x', text: '' }));
const finde = (pfad: string) => findePfad(dateien(PFADE), pfad);

test('zwei Pfade mit Abschnitt werden zwei Quellen mit Etikett', () => {
  const text = 'Antwort.\nQuellen: 05 Daily Notes/2026-11-25.md#Besprechungen | 02 Projekte/Beispiel Projekt.md';
  const quellen = quellenAus(text, finde, PFADE);
  expect(quellen).toEqual([
    { pfad: '05 Daily Notes/2026-11-25.md', abschnitt: 'Besprechungen', tag: '2026-11-25', etikett: 'Mi 25.11.2026 (Besprechungen)' },
    { pfad: '02 Projekte/Beispiel Projekt.md', abschnitt: null, tag: null, etikett: 'Beispiel Projekt' },
  ]);
});

test('eine CSV behält ihre Endung im Etikett', () => {
  const [q] = quellenAus('A\nQuellen: Sperren IB 2027.csv', finde, PFADE);
  expect(q.etikett).toBe('Sperren IB 2027.csv');
  expect(q.pfad).toBe('07 Anhänge/Notizbuch/2027/Sperren IB 2027.csv');
});

test('ein erfundener Pfad fällt weg', () => {
  const quellen = quellenAus('A\nQuellen: 01 Inbox/Gibt es nicht.md | 02 Projekte/Beispiel Projekt.md', finde, PFADE);
  expect(quellen.map((q) => q.pfad)).toEqual(['02 Projekte/Beispiel Projekt.md']);
});

test('ein Pfad, der in dieser Frage nicht vorkam, fällt weg', () => {
  const quellen = quellenAus('A\nQuellen: 05 Daily Notes/2026-11-25.md | 02 Projekte/Beispiel Projekt.md', finde, ['02 Projekte/Beispiel Projekt.md']);
  expect(quellen.map((q) => q.pfad)).toEqual(['02 Projekte/Beispiel Projekt.md']);
});

test('ein Name statt des Pfads wird aufgelöst, Doppelte zählen einmal', () => {
  const quellen = quellenAus('A\nQuellen: Beispiel Projekt | 02 Projekte/Beispiel Projekt.md | beispiel projekt#Teil', finde, PFADE);
  expect(quellen).toHaveLength(1);
  expect(quellen[0].pfad).toBe('02 Projekte/Beispiel Projekt.md');
});

test('höchstens acht Quellen', () => {
  const pfade = Array.from({ length: 10 }, (_, i) => `02 Projekte/P${i}.md`);
  const quellen = quellenAus(`A\nQuellen: ${pfade.join(' | ')}`, (p) => findePfad(dateien(pfade), p), pfade);
  expect(quellen).toHaveLength(8);
});

test('ohne Zeile Quellen keine Quellen', () => {
  expect(quellenAus('Nur Text mit Quellen: mitten drin.', finde, PFADE)).toEqual([]);
});

test('die Zeile Quellen ist nie zu sehen, auch nicht beim Schreiben', () => {
  expect(ohneQuellenZeile('Text\nQuellen: a | b')).toBe('Text');
  expect(ohneQuellenZeile('Text\n\nQuellen: a\n')).toBe('Text');
  expect(ohneQuellenZeile('Text\nQuel')).toBe('Text');
  expect(ohneQuellenZeile('Text\nQ')).toBe('Text');
  expect(ohneQuellenZeile('Text\nQuer')).toBe('Text\nQuer');
  expect(ohneQuellenZeile('Quellen: a')).toBe('');
  expect(ohneQuellenZeile('Text')).toBe('Text');
  expect(ohneQuellenZeile('Quellen: a\nund weiter')).toBe('Quellen: a\nund weiter');
});

test('die Zeile fürs Übernehmen: Namen ohne .md, doppelte Namen mit Pfad', () => {
  const quellen = quellenAus('A\nQuellen: 05 Daily Notes/2026-11-25.md | Sperren Abschnitte Lehne | Sperren IB 2027.csv', finde, PFADE);
  expect(quellenZeile(quellen, PFADE)).toBe('Quellen: [[2026-11-25]], [[Sperren Abschnitte Lehne]], [[Sperren IB 2027.csv]]');
  const doppelt = [...PFADE, '06 Archiv/Beispiel Projekt.md'];
  const q = quellenAus('A\nQuellen: 02 Projekte/Beispiel Projekt.md', (p) => findePfad(dateien(doppelt), p), doppelt);
  expect(quellenZeile(q, doppelt)).toBe('Quellen: [[02 Projekte/Beispiel Projekt]]');
});
