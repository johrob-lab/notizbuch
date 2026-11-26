import { expect, test } from 'vitest';
import {
  aktuellerSperrenKey,
  ersterMonat,
  keineListe,
  mitFachlinie,
  neuerSperrenKey,
  parseSperrenKey,
  seitenMonate,
  seitenSchluessel,
  sperrenMonatsname,
  sperrenTitel,
  stepSperrenKey,
} from '../../src/lib/sperren';

test('parseSperrenKey liest nur Seiten mit erstem Monat 01, 03, 05, 07, 09 oder 11', () => {
  expect(parseSperrenKey('IB-2027-03')).toEqual({ fachlinie: 'IB', jahr: 2027, monat: 3 });
  expect(parseSperrenKey('Lehne-2026-11')).toEqual({ fachlinie: 'Lehne', jahr: 2026, monat: 11 });
  for (const bad of ['IB-2027-04', 'IB-2027-12', 'IB-2027-00', 'IB-2027-3', 'IB-2027-Q1', 'ib-2027-03', 'Lehne-9999-01', 'IB-0999-11', ' IB-2027-03'])
    expect(parseSperrenKey(bad)).toBeNull();
});

test('ersterMonat und aktuellerSperrenKey', () => {
  expect(ersterMonat('2027-04-15')).toBe(3);
  expect(ersterMonat('2027-01-31')).toBe(1);
  expect(ersterMonat('2027-12-01')).toBe(11);
  expect(aktuellerSperrenKey('2026-10-29')).toBe('IB-2026-09');
  expect(aktuellerSperrenKey('2026-11-25', 'Lehne')).toBe('Lehne-2026-11');
});

test('stepSperrenKey blättert um zwei Monate und bleibt am Rand', () => {
  expect(stepSperrenKey('IB-2027-03', 1)).toBe('IB-2027-05');
  expect(stepSperrenKey('IB-2027-11', 1)).toBe('IB-2028-01');
  expect(stepSperrenKey('IB-2028-01', -1)).toBe('IB-2027-11');
  expect(stepSperrenKey('IB-9998-11', 1)).toBe('IB-9998-11');
  expect(stepSperrenKey('IB-1000-01', -1)).toBe('IB-1000-01');
});

test('Monate, Speicherschlüssel und Titel der Seite', () => {
  expect(mitFachlinie('IB-2027-05', 'Lehne')).toBe('Lehne-2027-05');
  expect(seitenMonate({ fachlinie: 'IB', jahr: 2027, monat: 3 })).toEqual(['2027-03', '2027-04']);
  expect(seitenSchluessel({ fachlinie: 'IB', jahr: 2027, monat: 3 })).toBe('03');
  expect(seitenSchluessel({ fachlinie: 'IB', jahr: 2027, monat: 11 })).toBe('11');
  expect(sperrenTitel('IB-2027-03')).toBe('Sperren IB, März und April 2027');
  expect(sperrenTitel('Lehne-2027-01')).toBe('Sperren Lehne, Jänner und Februar 2027');
});

test('neuerSperrenKey führt alte Quartalsschlüssel auf die neue Seite', () => {
  expect(neuerSperrenKey('IB-2027-Q1')).toBe('IB-2027-01');
  expect(neuerSperrenKey('Lehne-2027-Q2')).toBe('Lehne-2027-03');
  expect(neuerSperrenKey('IB-2027-Q3')).toBe('IB-2027-07');
  expect(neuerSperrenKey('IB-2026-Q4')).toBe('IB-2026-09');
  expect(neuerSperrenKey('IB-2027-05')).toBe('IB-2027-05');
  for (const bad of ['IB-2027-Q5', 'IB-2027-04', 'Lehne-9999-Q1', '']) expect(neuerSperrenKey(bad)).toBeNull();
});

test('the Sperren page calls the first month Jänner', () => {
  expect(sperrenMonatsname('2027-01')).toBe('Jänner');
  expect(sperrenMonatsname('2027-12')).toBe('Dezember');
});

test('keineListe nennt Fachlinie und Jahr', () => {
  expect(keineListe('IB', 2026)).toBe('Noch keine Liste für IB 2026. Sie kommt mit der Abendroutine, sobald Sperren gelesen sind.');
  expect(keineListe('Lehne', 2027)).toBe('Noch keine Liste für Lehne 2027. Sie kommt mit der Abendroutine, sobald Sperren gelesen sind.');
});
