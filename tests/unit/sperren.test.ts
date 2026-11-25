import { expect, test } from 'vitest';
import {
  aktuellerSperrenKey,
  keineListe,
  mitFachlinie,
  parseSperrenKey,
  sperrenMonatsname,
  quartalMonate,
  quartalOf,
  sperrenTitel,
  stepSperrenKey,
} from '../../src/lib/sperren';

test('parseSperrenKey liest gültige Schlüssel', () => {
  expect(parseSperrenKey('IB-2027-Q1')).toEqual({ fachlinie: 'IB', jahr: 2027, quartal: 1 });
  expect(parseSperrenKey('Lehne-2026-Q4')).toEqual({ fachlinie: 'Lehne', jahr: 2026, quartal: 4 });
});

test('parseSperrenKey lehnt ungültige Schlüssel ab', () => {
  for (const bad of ['ib-2027-Q1', 'IB-2027-Q5', 'IB-2027-Q0', 'IB-27-Q1', 'IB-2027-q1', 'Lehne-9999-Q1', 'IB-0999-Q4', ' IB-2027-Q1'])
    expect(parseSperrenKey(bad)).toBeNull();
});

test('quartalOf', () => {
  expect(quartalOf('2027-03-31')).toBe(1);
  expect(quartalOf('2027-04-01')).toBe(2);
  expect(quartalOf('2027-12-31')).toBe(4);
});

test('aktuellerSperrenKey', () => {
  expect(aktuellerSperrenKey('2026-11-25')).toBe('IB-2026-Q4');
  expect(aktuellerSperrenKey('2026-11-25', 'Lehne')).toBe('Lehne-2026-Q4');
});

test('stepSperrenKey blättert und bleibt am Rand stehen', () => {
  expect(stepSperrenKey('IB-2026-Q4', 1)).toBe('IB-2027-Q1');
  expect(stepSperrenKey('IB-2027-Q1', -1)).toBe('IB-2026-Q4');
  expect(stepSperrenKey('IB-9998-Q4', 1)).toBe('IB-9998-Q4');
  expect(stepSperrenKey('IB-1000-Q1', -1)).toBe('IB-1000-Q1');
});

test('mitFachlinie, quartalMonate, sperrenTitel', () => {
  expect(mitFachlinie('IB-2027-Q2', 'Lehne')).toBe('Lehne-2027-Q2');
  expect(quartalMonate({ fachlinie: 'IB', jahr: 2027, quartal: 4 })).toEqual(['2027-10', '2027-11', '2027-12']);
  expect(sperrenTitel('Lehne-2027-Q3')).toBe('Sperren Lehne, 3. Quartal 2027');
});

test('the Sperren page calls the first month Jänner', () => {
  expect(sperrenMonatsname('2027-01')).toBe('Jänner');
  expect(sperrenMonatsname('2027-12')).toBe('Dezember');
});

test('keineListe nennt Fachlinie und Jahr', () => {
  expect(keineListe('IB', 2026)).toBe('Noch keine Liste für IB 2026. Sie kommt mit der Abendroutine, sobald Sperren gelesen sind.');
  expect(keineListe('Lehne', 2027)).toBe('Noch keine Liste für Lehne 2027. Sie kommt mit der Abendroutine, sobald Sperren gelesen sind.');
});
