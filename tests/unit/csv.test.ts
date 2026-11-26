import { expect, test } from 'vitest';
import { parseCsv } from '../../src/lib/csv';

test('Strichpunkt, Anführungszeichen, BOM und CRLF', () => {
  expect(parseCsv('\uFEFFa;b\r\n"x;y";"z ""q"""\r\n')).toEqual([['a', 'b'], ['x;y', 'z "q"']]);
});

test('ein Zeilenumbruch in Anführungszeichen bleibt im Wert', () => {
  expect(parseCsv('a;"x\r\ny";c\r\n')).toEqual([['a', 'x\r\ny', 'c']]);
});

test('LF statt CRLF gibt dasselbe', () => {
  expect(parseCsv('a;b\nc;d\n')).toEqual(parseCsv('a;b\r\nc;d\r\n'));
});

test('leere Werte bleiben erhalten', () => {
  expect(parseCsv(';;')).toEqual([['', '', '']]);
});

test('ohne Zeilenende und leer', () => {
  expect(parseCsv('a')).toEqual([['a']]);
  expect(parseCsv('')).toEqual([]);
});

test('ein offenes Anführungszeichen reicht bis zum Ende und wirft nicht', () => {
  expect(parseCsv('a;"b;c\r\nd')).toEqual([['a', 'b;c\r\nd']]);
});
