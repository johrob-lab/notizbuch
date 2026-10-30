import { expect, test, vi } from 'vitest';
import { base64ToUtf8, isNotUtf8, utf8ToBase64 } from '../../src/sync/base64';

test('utf8 roundtrip', () => {
  expect(base64ToUtf8(utf8ToBase64('## Ergänzungen äöüß € „x“'))).toBe('## Ergänzungen äöüß € „x“');
});

test('a byte order mark at the start survives reading and writing', () => {
  // Manche Editoren setzen ein BOM (U+FEFF, in UTF-8 die Bytes EF BB BF) an den Dateianfang. Geht es beim Lesen verloren,
  // fehlt es nach dem nächsten Speichern in der Datei, und die Datei hat sich still verändert.
  const body = '## Ergänzungen\n- [ ] Aufgabe\n';
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, 'utf8')]);
  const base64 = bytes.toString('base64');
  expect(base64ToUtf8(base64)).toBe('\uFEFF' + body); // lesen: das BOM bleibt das erste Zeichen
  expect(utf8ToBase64('\uFEFF' + body)).toBe(base64); // schreiben: dieselben Bytes wie beim Lesen
  expect(base64ToUtf8(utf8ToBase64('\uFEFF' + body))).toBe('\uFEFF' + body);
  // nur das BOM, ein BOM mitten im Text und zwei BOM hintereinander
  expect(base64ToUtf8(utf8ToBase64('\uFEFF'))).toBe('\uFEFF');
  expect(base64ToUtf8(utf8ToBase64('a\uFEFFb'))).toBe('a\uFEFFb');
  expect(base64ToUtf8(utf8ToBase64('\uFEFF\uFEFFx'))).toBe('\uFEFF\uFEFFx');
});

test('is plain UTF-8 plus standard Base64, same as Node', () => {
  const samples = [
    '',
    'a',
    'ab',
    'abc',
    'abcd',
    '## Ergänzungen äöüß € „x“',
    '<svg viewBox="0 0 1192 1590"/>',
    'Emoji 😀 und 𝄞',
    'Zeile 1\r\nZeile 2\n',
    'Sperren & "Muster" <2027>',
  ];
  for (const text of samples) {
    const reference = Buffer.from(text, 'utf8').toString('base64');
    expect(utf8ToBase64(text)).toBe(reference);
    expect(base64ToUtf8(reference)).toBe(text);
  }
});

test('large text (several MB) does not hit argument limits', () => {
  const unit = '## Ergänzungen äöüß € „x“ 😀 <path d="M 0 0 L 5 5"/>\n';
  const text = unit.repeat(Math.ceil(5_000_000 / unit.length));
  expect(text.length).toBeGreaterThan(5_000_000);
  const encoded = utf8ToBase64(text);
  // Boolean statt toBe: bei einem Fehler soll kein Diff über Millionen Zeichen entstehen.
  expect(encoded === Buffer.from(text, 'utf8').toString('base64')).toBe(true);
  expect(base64ToUtf8(encoded) === text).toBe(true);
});

test('base64 with line breaks or other whitespace, as GitHub sends it, decodes', () => {
  const text = 'Zeile mit Umlauten äöü € und Emoji 😀\n'.repeat(12);
  const plain = Buffer.from(text, 'utf8').toString('base64');
  const wrapped = plain.replace(/(.{60})/g, '$1\n') + '\n'; // GitHub bricht alle 60 Zeichen um
  expect(wrapped).toContain('\n');
  expect(base64ToUtf8(wrapped)).toBe(text);
  expect(base64ToUtf8(plain.replace(/(.{76})/g, '$1\r\n'))).toBe(text);
  expect(base64ToUtf8(` ${plain.slice(0, 8)}\t${plain.slice(8, 20)} \n${plain.slice(20)} `)).toBe(text);
});

test('invalid input is refused instead of silently replaced', () => {
  // Ein einzelnes Latin-1-ä (0xE4) ist kein gültiges UTF-8. Ersatzzeichen würden die Datei beim Speichern verändern.
  expect(() => base64ToUtf8(Buffer.from([0xe4]).toString('base64'))).toThrow();
  expect(() => base64ToUtf8('***')).toThrow();
});

test('removes whitespace itself instead of relying on atob to skip it', () => {
  // Die Vorgabe lautet: Leerraum entfernen, bevor dekodiert wird. Aktuelle Browser überspringen ihn in atob selbst,
  // dieser strenge Ersatz gilt für jede Engine, die das nicht tut.
  const realAtob = globalThis.atob;
  vi.stubGlobal('atob', (data: string) => {
    if (/\s/.test(data)) throw new DOMException('Invalid character', 'InvalidCharacterError');
    return realAtob(data);
  });
  try {
    expect(base64ToUtf8('SGVs\nbG8g\r\nV29y bGQ=\n')).toBe('Hello World');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('bytes that are not UTF-8 are refused with an error that isNotUtf8 recognises, and other errors are not', () => {
  const broken = Buffer.from([0x41, 0xff, 0xfe, 0x42]).toString('base64');
  let caught: unknown;
  try {
    base64ToUtf8(broken);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(isNotUtf8(caught)).toBe(true);
  // Eine Antwort, die kein Base64 ist, oder ein Fehler des Netzes ist etwas anderes: Dort hilft ein neuer Versuch.
  expect(isNotUtf8(new Error('Server Error'))).toBe(false);
  expect(isNotUtf8(Object.assign(new Error('HTTP 503'), { status: 503 }))).toBe(false);
  expect(isNotUtf8(null)).toBe(false);
});
