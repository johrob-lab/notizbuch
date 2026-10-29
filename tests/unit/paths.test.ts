import { expect, test } from 'vitest';
import { assertAllowedPath, hasBlockedWordPart, normalizePath, PathNotAllowedError, type Mode } from '../../src/sync/paths';

const MODES: Mode[] = ['read', 'write', 'list'];

function expectAllowed(mode: Mode, paths: string[]) {
  for (const path of paths) {
    expect(() => assertAllowedPath(path, mode), `${mode} ${JSON.stringify(path)} sollte erlaubt sein`).not.toThrow();
  }
}

function expectDenied(mode: Mode, paths: string[]) {
  for (const path of paths) {
    expect(() => assertAllowedPath(path, mode), `${mode} ${JSON.stringify(path)} sollte gesperrt sein`).toThrow(
      PathNotAllowedError,
    );
  }
}

test('path guard', () => {
  expect(() => assertAllowedPath('05 Daily Notes/2026-10-29.md', 'write')).not.toThrow();
  expect(() => assertAllowedPath('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg', 'write')).not.toThrow();
  expect(() => assertAllowedPath('04 Ressourcen/Kalender/Termine.md', 'read')).not.toThrow();
  expect(() => assertAllowedPath('04 Ressourcen/Kalender/Termine.md', 'write')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath('02 Projekte', 'list')).not.toThrow();
  expect(() => assertAllowedPath('02 Projekte/Beispiel.md', 'read')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath('07 Anhänge/Notizbuch/Recovery Codes.md', 'read')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath('05 Daily Notes/../00 Kontext/x.md', 'read')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath('00 Beispiel/Notiz.md', 'read')).toThrow(PathNotAllowedError);
});

test('write: daily notes and everything below the notebook folder, nothing else', () => {
  expectAllowed('write', [
    '05 Daily Notes/2026-10-29.md',
    '05 Daily Notes/2026-10-29 (Konflikt).md',
    '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg',
    '07 Anhänge/Notizbuch/2026/2026 KW44 Woche.svg',
    '07 Anhänge/Notizbuch/2026/2026-10-29 0800 Sperren & "Muster" <2027> S1.svg',
    '07 Anhänge/Notizbuch/2027/Unterordner/Seite.svg',
    '07 Anhänge/Notizbuch/Seite.svg',
  ]);
  expectDenied('write', [
    '04 Ressourcen/Kalender/Termine.md', // Kalender nur lesen
    '02 Projekte/Beispiel.md',
    '00 Beispiel/Notiz.md',
    '01 Inbox/Notiz.md',
    '03 Bereiche/Beispielbereich/Notiz.md',
    '04 Ressourcen/Beispielthema/Notiz.md',
    '06 Archiv/Notiz.md',
    '07 Anhänge/Bild.png', // Anhänge, aber nicht im Ordner Notizbuch
    '.obsidian/app.json',
    '.claude/settings.json',
    'CLAUDE.md',
    '05 Daily Notes', // der Ordner selbst ist keine Datei darin
    '07 Anhänge/Notizbuch',
    '07 Anhänge',
  ]);
});

test('read: what write allows plus the calendar folder', () => {
  expectAllowed('read', [
    '05 Daily Notes/2026-10-29.md',
    '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg',
    '04 Ressourcen/Kalender/Termine.md',
    '04 Ressourcen/Kalender/Unterordner/Termine.md',
  ]);
  expectDenied('read', [
    '02 Projekte/Beispiel.md', // von Projekten gibt es nur die Dateiliste
    '02 Projekte/Unterordner/Datei.md',
    '04 Ressourcen/Beispielthema/Formeln.md',
    '04 Ressourcen/Kalender', // der Ordner selbst
    '04 Ressourcen',
    '00 Beispiel/Notiz.md',
    '05 Daily Notes',
    '07 Anhänge/Notizbuch',
  ]);
});

test('list: the project folder itself and every readable folder', () => {
  expectAllowed('list', [
    '02 Projekte',
    '05 Daily Notes',
    '07 Anhänge/Notizbuch',
    '07 Anhänge/Notizbuch/2026',
    '04 Ressourcen/Kalender',
  ]);
  expectDenied('list', [
    '02 Projekte/Unterordner', // nur der Ordner selbst, nicht darunter
    '02 Projekte/Beispiel.md',
    '07 Anhänge',
    '04 Ressourcen',
    '00 Kontext',
    '01 Inbox',
    '03 Bereiche',
    '06 Archiv',
    '.obsidian',
    '',
  ]);
});

test('folder names match whole path segments and exact case', () => {
  for (const mode of MODES) {
    expectDenied(mode, [
      '05 Daily Notes Archiv/2026-10-29.md',
      '05 Daily Notes2/x.md',
      '05 Daily/x.md',
      '07 Anhänge/Notizbuch2/x.svg',
      '07 Anhänge/NotizbuchX/2026/x.svg',
      '07 Anhänge/Notizbuch.svg',
      '04 Ressourcen/Kalender2/Termine.md',
      '04 Ressourcen/Kalender.md',
      '02 Projekte2',
      // GitHub unterscheidet Groß- und Kleinschreibung, die Sperre auch
      '05 daily notes/2026-10-29.md',
      '07 anhänge/notizbuch/x.svg',
      '04 ressourcen/kalender/Termine.md',
    ]);
  }
});

test('traversal, empty segments, backslashes and malformed paths are refused in every mode', () => {
  for (const mode of MODES) {
    expectDenied(mode, [
      '',
      ' ',
      '/',
      '/05 Daily Notes/2026-10-29.md',
      '05 Daily Notes//2026-10-29.md',
      '05 Daily Notes/',
      '05 Daily Notes/./2026-10-29.md',
      '05 Daily Notes/../00 Kontext/x.md',
      '05 Daily Notes/..',
      '05 Daily Notes/../05 Daily Notes/2026-10-29.md', // kommt zurück, bleibt trotzdem gesperrt
      '07 Anhänge/Notizbuch/../../00 Kontext/x.md',
      '07 Anhänge/Notizbuch/2026/..',
      '..',
      '.',
      '../05 Daily Notes/x.md',
      './05 Daily Notes/x.md',
      '05 Daily Notes\\2026-10-29.md',
      '05 Daily Notes/..\\00 Kontext\\x.md',
      '\\05 Daily Notes/x.md',
      '07 Anhänge\\Notizbuch/2026/x.svg',
    ]);
  }
  // Nur ganze Segmente `.` und `..` sind verboten, Namen mit Punkten sind in Ordnung.
  expectAllowed('write', ['05 Daily Notes/...md', '05 Daily Notes/..x.md', '05 Daily Notes/a..b.md', '05 Daily Notes/.x.md']);
});

test('control characters and broken surrogates are refused, emoji are fine', () => {
  for (const mode of MODES) {
    expectDenied(mode, [
      '05 Daily Notes/2026\n-10-29.md',
      '05 Daily Notes/2026-10-29.md\u0000',
      '05 Daily Notes/a\tb.md',
      '05 Daily Notes/a\rb.md',
      '05 Daily Notes/a\u007fb.md',
      '05 Daily Notes/a\u0085b.md', // Steuerzeichen aus dem C1-Block
      '05 Daily Notes/a\ud83db.md', // einzelnes Surrogat, encodeURIComponent würde werfen
      '05 Daily Notes/a\ude00b.md',
    ]);
  }
  expectAllowed('write', ['05 Daily Notes/😀 Tag.md', '07 Anhänge/Notizbuch/2026/2026-10-29 0800 Besprechung 😀 S1.svg']);
});

test('blocked word parts are refused in any case, in files and folders, in every mode', () => {
  const names = [
    'Recovery',
    'recovery',
    'RECOVERY',
    'Recovery Codes',
    'Notfall-Recovery-Datei',
    'passw',
    'Passwort',
    'PASSWORT',
    'Passwörter',
    'mein Password',
    'Token',
    'TOKEN',
    'GitHub Token',
    'tokens',
    'datei.key',
    'DATEI.KEY',
    'id_rsa.key',
    '.key',
    'speicher.keystore',
    'a.Key.md',
  ];
  for (const name of names) {
    expectDenied('write', [
      `05 Daily Notes/${name}.md`,
      `07 Anhänge/Notizbuch/2026/${name}.svg`,
      `07 Anhänge/Notizbuch/${name}/2026/x.svg`,
    ]);
    expectDenied('read', [
      `05 Daily Notes/${name}.md`,
      `07 Anhänge/Notizbuch/2026/${name}.svg`,
      `04 Ressourcen/Kalender/${name}.md`,
      `04 Ressourcen/Kalender/${name}/Termine.md`,
    ]);
    expectDenied('list', [
      `05 Daily Notes/${name}`,
      `07 Anhänge/Notizbuch/${name}`,
      `07 Anhänge/Notizbuch/2026/${name}`,
      `04 Ressourcen/Kalender/${name}`,
    ]);
  }
});

test('only real word parts are blocked, similar names stay usable', () => {
  expectAllowed('write', [
    '05 Daily Notes/Monkey.md', // "key" ohne Punkt davor
    '05 Daily Notes/Keyboard.md',
    '05 Daily Notes/Tokyo.md',
    '05 Daily Notes/Passage.md',
    '05 Daily Notes/Recover.md',
    '05 Daily Notes/Kompass west.md', // "pass w" mit Leerzeichen ist kein "passw"
    '07 Anhänge/Notizbuch/2026/2026-10-29 0800 Sperren & "Muster" <2027> S1.svg',
  ]);
});

test('NFD input is normalized to NFC before checking', () => {
  const nfc = '07 Anh\u00e4nge/Notizbuch/2026/2026-10-29 Tag.svg'; // so speichert der Vault "Anhänge"
  const nfd = '07 Anha\u0308nge/Notizbuch/2026/2026-10-29 Tag.svg'; // a plus Trema, so liefern manche Eingaben es
  expect(nfd).not.toBe(nfc);
  expect(normalizePath(nfd)).toBe(nfc);
  expect(normalizePath(nfc)).toBe(nfc);
  expectAllowed('write', [nfc, nfd]);
  expectAllowed('read', [nfd]);
  expectAllowed('list', ['07 Anha\u0308nge/Notizbuch', '07 Anha\u0308nge/Notizbuch/2026']);
  expectDenied('write', ['00 Beispiel/U\u0308bung.md', '07 Anha\u0308nge/Notizbuch/Recovery.md', '07 Anha\u0308nge/Bild.png']);
});

test('the error names the path and keeps a stable name', () => {
  const path = '00 Beispiel/Notiz.md';
  let error: unknown;
  try {
    assertAllowedPath(path, 'read');
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(PathNotAllowedError);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).name).toBe('PathNotAllowedError');
  expect((error as Error).message).toBe(`Zugriff auf den Pfad nicht erlaubt: ${path}`);
});

test('anything unexpected is refused (fail closed)', () => {
  expect(() => assertAllowedPath(undefined as unknown as string, 'read')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath(null as unknown as string, 'write')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath(42 as unknown as string, 'list')).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath('05 Daily Notes/x.md', 'delete' as Mode)).toThrow(PathNotAllowedError);
  expect(() => assertAllowedPath('05 Daily Notes/x.md', undefined as unknown as Mode)).toThrow(PathNotAllowedError);
});

test('hasBlockedWordPart', () => {
  expect(hasBlockedWordPart('07 Anhänge/Notizbuch/Recovery Codes.md')).toBe(true);
  expect(hasBlockedWordPart('PASSWORT.txt')).toBe(true);
  expect(hasBlockedWordPart('api.TOKEN')).toBe(true);
  expect(hasBlockedWordPart('id.Key')).toBe(true);
  expect(hasBlockedWordPart('07 Anha\u0308nge/Token/x.svg')).toBe(true);
  expect(hasBlockedWordPart('05 Daily Notes/2026-10-29.md')).toBe(false);
  expect(hasBlockedWordPart('Monkey.md')).toBe(false);
  expect(hasBlockedWordPart('')).toBe(false);
});
