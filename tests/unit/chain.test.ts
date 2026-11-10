import { expect, test } from 'vitest';
import { chainSpan, enteredSide, neighborOffset, PAGE_GAP, settledSide, sideAt, viewFor } from '../../src/ink/chain';
import { PAGE_H } from '../../src/ink/types';

const both = { above: true, below: true };
const none = { above: false, below: false };
const size = { w: 1000, h: 1600 };

test('the neighbours hang one page and one gap above and below', () => {
  expect(PAGE_GAP).toBe(24);
  expect(neighborOffset('above')).toBe(-(1590 + 24));
  expect(neighborOffset('below')).toBe(1590 + 24);
});

test('the chain spans the neighbours that are there', () => {
  expect(chainSpan(both)).toEqual({ top: -1614, bottom: 2 * 1590 + 24 });
  expect(chainSpan({ above: false, below: true })).toEqual({ top: 0, bottom: 3204 });
  expect(chainSpan(none)).toEqual({ top: 0, bottom: PAGE_H });
});

test('a point above or below the page belongs to the neighbour, the gap too', () => {
  expect(sideAt(-1, both)).toBe('above');
  expect(sideAt(1591, both)).toBe('below');
  expect(sideAt(1600, both)).toBe('below'); // im Spalt
  expect(sideAt(0, both)).toBeNull();
  expect(sideAt(1590, both)).toBeNull();
  expect(sideAt(-1, none)).toBeNull();
  expect(sideAt(1591, { above: true, below: false })).toBeNull();
});

test('the page that covers the middle of the screen is the one that settles', () => {
  // s = 0.5: die Mitte (800 px) liegt bei Seiteneinheit (800 - y) / 0.5.
  expect(settledSide({ s: 0.5, x: 0, y: 16 }, size, both)).toBeNull(); // Mitte bei 1568, noch auf der Seite
  expect(settledSide({ s: 0.5, x: 0, y: 800 - 0.5 * 1603 }, size, both)).toBe('below'); // Mitte bei 1603
  expect(settledSide({ s: 0.5, x: 0, y: 800 - 0.5 * 1601 }, size, both)).toBeNull(); // Mitte bei 1601, vor der Hälfte des Spalts
  expect(settledSide({ s: 0.5, x: 0, y: 800 + 0.5 * 13 }, size, both)).toBe('above'); // Mitte bei -13
  expect(settledSide({ s: 0.5, x: 0, y: 800 - 0.5 * 1603 }, size, { above: true, below: false })).toBeNull();
  // genau auf der Grenze wird noch nicht gewechselt (strenge Vergleiche)
  expect(settledSide({ s: 0.5, x: 0, y: 800 + 0.5 * 12 }, size, both)).toBeNull(); // Mitte genau bei -12
  expect(settledSide({ s: 0.5, x: 0, y: 800 - 0.5 * 1602 }, size, both)).toBeNull(); // Mitte genau bei 1602
});

test('the next page starts where it was on the screen', () => {
  expect(viewFor({ s: 0.5, x: 7, y: -500 }, 'below')).toEqual({ s: 0.5, x: 7, y: -500 + 0.5 * 1614 });
  expect(viewFor({ s: 2, x: -30, y: 900 }, 'above')).toEqual({ s: 2, x: -30, y: 900 - 2 * 1614 });
});

test('a release opens a neighbour only when the middle moved into it during that move', () => {
  // s = 0.5, Fläche 1600 hoch: Die Mitte (800 px) liegt bei Seiteneinheit (800 - y) / 0.5.
  const at = (unit: number) => ({ s: 0.5, x: 0, y: 800 - 0.5 * unit });
  expect(enteredSide(null, at(1603), size, both)).toBe('below'); // von der Seite in den Nachbarn darunter
  expect(enteredSide(null, at(-13), size, both)).toBe('above');
  expect(enteredSide(null, at(800), size, both)).toBeNull(); // auf der Seite geblieben
  // Lag die Mitte schon zu Beginn auf dem Nachbarn (nach einem Wechsel durch Stift oder Tipp), bleibt die offene Seite offen.
  expect(enteredSide('above', at(-300), size, both)).toBeNull();
  expect(enteredSide('above', at(800), size, both)).toBeNull();
  // Von einem Nachbarn ganz hinüber in den anderen: Das ist ein Hineinschieben.
  expect(enteredSide('above', at(1603), size, both)).toBe('below');
  expect(enteredSide(null, at(1603), size, { above: true, below: false })).toBeNull();
});
