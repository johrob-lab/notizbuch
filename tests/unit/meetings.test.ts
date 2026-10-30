import { expect, test } from 'vitest';
import { parsePage } from '../../src/ink/svg';
import { besprechungBase, besprechungPagePath } from '../../src/lib/filenames';
import {
  createMeeting,
  firstFreePage,
  listMeetings,
  meetingMeta,
  meetingPages,
  neighbourPages,
  pageAfterDelete,
  pageLabel,
  parseMeetingBase,
  projectNames,
} from '../../src/lib/meetings';
import { besprechungLayout } from '../../src/pages/layouts';
import { meetingPageText } from '../../src/pages/meetingText';

// Besprechungen: Dateinamen, Kopfdaten und Listen. Alles hier ist erfunden.

const BLOCKED = 'Bitte ein anderes Thema wählen, Wörter wie Passwort sind im Dateinamen nicht erlaubt.';
const BAD_TIME = 'Bitte die Zeit als HH:MM angeben, zum Beispiel 08:00.';
const BAD_DAY = 'Bitte ein gültiges Datum angeben.';

// ---------- Anlegen ----------

test('createMeeting', () => {
  const m = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: 'Abstimmung Beispiel 2027', ort: 'Musterort', projekt: 'Beispielprojekt A' });
  expect(m.path).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 0800 Abstimmung Beispiel 2027 S1.svg');
  expect(m.page.meta).toMatchObject({ thema: 'Abstimmung Beispiel 2027', zeit: '08:00', projekt: 'Beispielprojekt A', seitennr: '1' });
});

test('page 1 carries the whole header and is named after the file', () => {
  const m = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: 'Abstimmung Beispiel 2027', ort: 'Musterort', projekt: 'Beispielprojekt A' });
  expect(m.base).toBe('2026-10-29 0800 Abstimmung Beispiel 2027');
  expect(m.page).toEqual({
    kind: 'besprechung',
    key: '2026-10-29 0800 Abstimmung Beispiel 2027',
    meta: { thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', ort: 'Musterort', projekt: 'Beispielprojekt A', seitennr: '1' },
    strokes: [],
  });
});

test('Ort and Projekt that were not given are written as empty text, and the keys come in a fixed order', () => {
  const m = createMeeting({ datum: '2026-10-29', zeit: '14:30', thema: 'Muster anrufen' });
  expect(m.page.meta).toEqual({ thema: 'Muster anrufen', datum: '2026-10-29', zeit: '14:30', ort: '', projekt: '', seitennr: '1' });
  // Die Reihenfolge zählt: Die Sitzung vergleicht Kopfdaten als Text.
  expect(Object.keys(m.page.meta)).toEqual(['thema', 'datum', 'zeit', 'ort', 'projekt', 'seitennr']);
});

test('the Thema stays as typed in the header while the file name gets the cleaned one', () => {
  const m = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: '  Sperren & "Muster" <2027>  ' });
  expect(m.base).toBe('2026-10-29 0800 Sperren & Muster 2027');
  expect(m.page.meta.thema).toBe('Sperren & "Muster" <2027>');
});

test('a Thema typed with decomposed umlauts (letter plus Trema) gives the file name of the composed one', () => {
  // Der Vault schreibt Umlaute als ein Zeichen (NFC). Ein eingefügter Text kann sie als Buchstabe plus Trema mitbringen:
  // Der Pfad wäre ein anderer als der, den GitHub und der Speicher des Geräts kennen.
  const m = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: 'Mu\u0308ller Abstimmung' });
  expect(m.base).toBe('2026-10-29 0800 M\u00fcller Abstimmung');
  expect(m.path).toBe('07 Anh\u00e4nge/Notizbuch/2026/2026-10-29 0800 M\u00fcller Abstimmung S1.svg');
  expect(m.page.key).toBe(m.base);
  expect(m.page.meta.thema).toBe('M\u00fcller Abstimmung');
});

test('a meeting without a Thema is called Besprechung in the file name', () => {
  const m = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: '' });
  expect(m.path).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 0800 Besprechung S1.svg');
  expect(m.page.meta.thema).toBe('');
});

test('the time must be HH:MM from 00:00 to 23:59', () => {
  for (const zeit of ['8:00', '24:00', '08:60', '0800', '', '08:00:00', '8.00', ' 08:00', '08:0', 'ab:cd']) {
    expect(() => createMeeting({ datum: '2026-10-29', zeit, thema: 'Muster' }), `Zeit "${zeit}"`).toThrow(new Error(BAD_TIME));
  }
  expect(createMeeting({ datum: '2026-10-29', zeit: '00:00', thema: 'Muster' }).base).toBe('2026-10-29 0000 Muster');
  expect(createMeeting({ datum: '2026-10-29', zeit: '23:59', thema: 'Muster' }).base).toBe('2026-10-29 2359 Muster');
});

test('the date must be a day that exists', () => {
  for (const datum of ['2026-02-30', '2026-13-01', '29.10.2026', '', '2026-1-5', '2026-10-29 ']) {
    expect(() => createMeeting({ datum, zeit: '08:00', thema: 'Muster' }), `Datum "${datum}"`).toThrow(new Error(BAD_DAY));
  }
  expect(createMeeting({ datum: '2028-02-29', zeit: '08:00', thema: 'Muster' }).base).toBe('2028-02-29 0800 Muster');
});

test('a Thema with a blocked word part is refused with a hint, because the file name could not be used', () => {
  for (const thema of ['Passwort Liste', 'Zugang TOKEN', 'recovery plan', 'Notiz.key', 'Mein PASSWORD']) {
    expect(() => createMeeting({ datum: '2026-10-29', zeit: '08:00', thema }), thema).toThrow(new Error(BLOCKED));
  }
  expect(() => createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: 'Pass wort' })).not.toThrow();
});

// ---------- Name der Besprechung ----------

test('parseMeetingBase reads date, time and Thema from the name', () => {
  expect(parseMeetingBase('2026-10-29 0800 Thema')).toEqual({ datum: '2026-10-29', zeit: '08:00', thema: 'Thema' });
  expect(parseMeetingBase('2027-01-04 1430 Muster anrufen')).toEqual({ datum: '2027-01-04', zeit: '14:30', thema: 'Muster anrufen' });
  expect(parseMeetingBase('2026-10-29 0800 2027')).toEqual({ datum: '2026-10-29', zeit: '08:00', thema: '2027' });
});

test('parseMeetingBase gives back what createMeeting put into the name', () => {
  const m = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: 'Sperren & "Muster" <2027>' });
  expect(parseMeetingBase(m.base)).toEqual({ datum: '2026-10-29', zeit: '08:00', thema: 'Sperren & Muster 2027' });
  expect(parseMeetingBase(besprechungBase('2026-10-29', '08:00', 'Abstimmung: Beispiel / 2027?'))).toEqual({
    datum: '2026-10-29',
    zeit: '08:00',
    thema: 'Abstimmung Beispiel 2027',
  });
});

test('parseMeetingBase says null for a name that is no meeting', () => {
  const names = ['', 'Thema', '2026-10-29', '2026-10-29 Tag', '2026-10-29 0800', '2026-10-29 0800 ', '2026-02-30 0800 Muster', '2026-10-29 2500 Muster', '2026-10-29 0860 Muster', '2026-10-29 800 Muster', '2026-10-29 08:00 Muster'];
  for (const name of names) expect(parseMeetingBase(name), `"${name}"`).toBeNull();
});

// ---------- Kopfdaten einer Seite ----------

test('meetingMeta fills what is missing from the name and takes the page number from the address', () => {
  expect(meetingMeta('2026-10-29 0800 Muster', 2, {})).toEqual({
    thema: 'Muster',
    datum: '2026-10-29',
    zeit: '08:00',
    ort: '',
    projekt: '',
    seitennr: '2',
  });
});

test('meetingMeta keeps what the page has, in a fixed order, and always takes the number from the address', () => {
  const meta = meetingMeta('2026-10-29 0800 Muster', 3, { seitennr: '1', projekt: 'Beispielprojekt B', ort: 'Musterort', thema: 'Anders', extra: 'bleibt' });
  expect(meta).toEqual({
    thema: 'Anders',
    datum: '2026-10-29',
    zeit: '08:00',
    ort: 'Musterort',
    projekt: 'Beispielprojekt B',
    seitennr: '3',
    extra: 'bleibt',
  });
  expect(Object.keys(meta)).toEqual(['thema', 'datum', 'zeit', 'ort', 'projekt', 'seitennr', 'extra']);
});

test('meetingMeta does not take a day or a time that does not exist from the page, but the name has them', () => {
  expect(meetingMeta('2026-10-29 0800 Muster', 1, { datum: 'kaputt', zeit: '8 Uhr', thema: '' })).toEqual({
    thema: '', // ein leeres Thema hat die Person so gewollt
    datum: '2026-10-29',
    zeit: '08:00',
    ort: '',
    projekt: '',
    seitennr: '1',
  });
});

test('meetingMeta of a name without a time still has the day, and the rest as Thema', () => {
  expect(meetingMeta('2026-10-29 Irgendwas', 1, {})).toEqual({
    thema: 'Irgendwas',
    datum: '2026-10-29',
    zeit: '',
    ort: '',
    projekt: '',
    seitennr: '1',
  });
});

test('meetingPageText writes the header into the file and shows it in the background', () => {
  const { page } = createMeeting({ datum: '2026-10-29', zeit: '08:00', thema: 'Abstimmung Beispiel 2027', ort: 'Musterort', projekt: 'Beispielprojekt A' });
  const text = meetingPageText(page);
  expect(parsePage(text)).toEqual(page);
  expect(text).toContain('data-projekt="Beispielprojekt A"');
  expect(text).toContain(besprechungLayout(page.meta).background());
  expect(text).toContain('Beispielprojekt A</text>'); // auch gezeichnet, nicht nur als Angabe

  const changed = meetingPageText({ ...page, meta: { ...page.meta, thema: 'Neues Thema' } });
  expect(changed).toContain('Neues Thema</text>');
  expect(changed).not.toContain('Abstimmung Beispiel 2027</text>');
});

// ---------- Listen ----------

test('listMeetings', () => {
  expect(listMeetings(['2026-10-29 Tag.svg', '2026-10-29 0800 A S1.svg', '2026-10-29 0800 A S2.svg', '2026-10-30 0900 B S1.svg'], '2026-10-29')).toEqual([
    { base: '2026-10-29 0800 A', pages: [1, 2] },
  ]);
});

test('listMeetings puts the pages of a meeting in numeric order and the meetings by time, then Thema', () => {
  const names = [
    '2026-10-29 1400 Zeta S2.svg',
    '2026-10-29 1400 Zeta S1.svg',
    '2026-10-29 0900 Beta S1.svg',
    '2026-10-29 0900 Alpha S10.svg',
    '2026-10-29 0900 Alpha S3.svg',
    '2026-10-29 0900 Alpha S1.svg',
    '2026-10-29 0900 Alpha S2.svg',
  ];
  expect(listMeetings(names, '2026-10-29')).toEqual([
    { base: '2026-10-29 0900 Alpha', pages: [1, 2, 3, 10] },
    { base: '2026-10-29 0900 Beta', pages: [1] },
    { base: '2026-10-29 1400 Zeta', pages: [1, 2] },
  ]);
});

test('listMeetings sorts Thema the German way', () => {
  const names = ['2026-10-29 0900 Zebra S1.svg', '2026-10-29 0900 Ärger S1.svg', '2026-10-29 0900 Anton S1.svg'];
  expect(listMeetings(names, '2026-10-29').map((m) => m.base)).toEqual(['2026-10-29 0900 Anton', '2026-10-29 0900 Ärger', '2026-10-29 0900 Zebra']);
});

test('listMeetings ignores everything that is not a page of a meeting of that day', () => {
  const names = [
    '2026-10-29 Tag.svg', // eine Tagesseite
    '2026-10-29 0800 A S1.svg', // das einzige gültige
    '2026-10-29 0800 A S1.svg', // zweimal gemeldet: eine Seite
    '2026-10-29 0800 A S1 (Konflikt).svg', // Konfliktkopie
    '2026-10-29 0800 A S0.svg',
    '2026-10-29 0800 A S01.svg',
    '2026-10-29 0800 A S1.svg.bak',
    '2026-10-29 0800 A S1.md',
    '2026-10-29 0800 A.svg',
    '2026-10-29 800 A S1.svg',
    '2026-10-29 2560 A S1.svg',
    '2026-10-29 0800  S1.svg',
    '2026-10-28 0800 A S1.svg',
    'S1.svg',
    '',
  ];
  expect(listMeetings(names, '2026-10-29')).toEqual([{ base: '2026-10-29 0800 A', pages: [1] }]);
  expect(listMeetings(names, '2026-10-31')).toEqual([]);
});

test('listMeetings joins a name with decomposed umlauts to the same meeting', () => {
  const names = ['2026-10-29 0800 Übergabe S1.svg', '2026-10-29 0800 Übergabe S2.svg'.normalize('NFD')];
  expect(listMeetings(names, '2026-10-29')).toEqual([{ base: '2026-10-29 0800 Übergabe', pages: [1, 2] }]);
});

test('projectNames', () => {
  expect(
    projectNames([
      { name: 'Beispielprojekt B.md', type: 'file' },
      { name: 'Archiv', type: 'dir' },
      { name: 'Beispielprojekt A.md', type: 'file' },
    ]),
  ).toEqual(['Beispielprojekt A', 'Beispielprojekt B']);
});

test('projectNames takes only Markdown files, sorts the German way and leaves out blocked names', () => {
  const names = projectNames([
    { name: 'Zebra.md', type: 'file' },
    { name: 'Ärger.md', type: 'file' },
    { name: 'Anton.md', type: 'file' },
    { name: 'Bild.png', type: 'file' },
    { name: 'Notiz.md.bak', type: 'file' },
    { name: 'Ordner.md', type: 'dir' },
    { name: '.md', type: 'file' },
    { name: 'Passwortliste.md', type: 'file' },
    { name: 'Token Projekt.md', type: 'file' },
    { name: 'Alt.key.md', type: 'file' },
  ]);
  expect(names).toEqual(['Anton', 'Ärger', 'Zebra']);
});

// ---------- Seiten ----------

test('after deleting a page the previous one opens, and without one the next', () => {
  expect(pageAfterDelete([1, 2, 3], 2)).toBe(1);
  expect(pageAfterDelete([1, 2, 3], 3)).toBe(2);
  expect(pageAfterDelete([1, 3], 3)).toBe(1); // 2 gibt es nicht
  expect(pageAfterDelete([2, 3], 2)).toBe(3); // davor ist nichts, also die nächste
  expect(pageAfterDelete([1, 2, 3], 1)).toBe(2);
});

test('after deleting the only page there is no page to open', () => {
  expect(pageAfterDelete([1], 1)).toBeNull();
  expect(pageAfterDelete([4], 4)).toBeNull();
  expect(pageAfterDelete([], 1)).toBeNull(); // die Seite war nur geöffnet, sie war noch nicht in der Liste
});

test('when the pages are not known the previous number is the guess', () => {
  expect(pageAfterDelete(null, 3)).toBe(2);
  expect(pageAfterDelete(null, 1)).toBeNull();
});

test('the pages of a meeting are the listed ones and the ones this device has, without those waiting for their delete', () => {
  expect(meetingPages({ listed: [1, 2], local: [2, 3], deleted: [], n: 2 })).toEqual([1, 2, 3]);
  expect(meetingPages({ listed: [1, 2, 3], local: [1, 3], deleted: [2], n: 1 })).toEqual([1, 3]); // GitHub listet 2 noch
  expect(meetingPages({ listed: [3, 1], local: [], deleted: [], n: 1 })).toEqual([1, 3]); // aufsteigend
});

test('the open page counts as a page even when neither GitHub nor this device lists it yet', () => {
  expect(meetingPages({ listed: [1], local: [], deleted: [], n: 2 })).toEqual([1, 2]);
  expect(meetingPages({ listed: null, local: [], deleted: [], n: 4 })).toEqual([4]);
  expect(meetingPages({ listed: [1, 2], local: [], deleted: [2], n: 2 })).toEqual([1, 2]); // wer die Adresse einer gelöschten Seite öffnet, sieht eine neue
});

test('without the list from GitHub the pages are the ones this device has', () => {
  expect(meetingPages({ listed: null, local: [3, 1], deleted: [], n: 3 })).toEqual([1, 3]);
  expect(meetingPages({ listed: null, local: [1, 2, 3], deleted: [2], n: 3 })).toEqual([1, 3]);
});

test('the neighbours of a page are the known pages before and after it', () => {
  expect(neighbourPages([1, 2, 3], 2, true)).toEqual({ prev: 1, next: 3 });
  expect(neighbourPages([1, 3], 3, true)).toEqual({ prev: 1, next: null }); // 2 gibt es nicht
  expect(neighbourPages([1, 3], 1, true)).toEqual({ prev: null, next: 3 });
  expect(neighbourPages([2, 3], 2, true)).toEqual({ prev: null, next: 3 }); // vor 2 ist nichts
  expect(neighbourPages([1], 1, true)).toEqual({ prev: null, next: null });
  expect(neighbourPages([1, 2, 3, 4, 5], 3, true)).toEqual({ prev: 2, next: 4 }); // die nächste, nicht die erste und letzte
  expect(neighbourPages([1, 2, 3, 4, 5], 3, false)).toEqual({ prev: 2, next: 4 });
});

test('without the list from GitHub the page before is the number before when this device has no earlier page, and the page after only if it is known', () => {
  expect(neighbourPages([2], 2, false)).toEqual({ prev: 1, next: null });
  expect(neighbourPages([1], 1, false)).toEqual({ prev: null, next: null });
  expect(neighbourPages([2, 4], 4, false)).toEqual({ prev: 2, next: null }); // die nächste Seite, die dieses Gerät hat
  expect(neighbourPages([3, 4], 3, false)).toEqual({ prev: 2, next: 4 });
});

test('the label is the position among the pages, or only the number of the page when the list is missing', () => {
  expect(pageLabel([1, 2, 3], 2, true)).toBe('Seite 2 von 3');
  expect(pageLabel([1, 3], 3, true)).toBe('Seite 2 von 2'); // die Seite dazwischen gibt es nicht mehr
  expect(pageLabel([1], 1, true)).toBe('Seite 1 von 1');
  expect(pageLabel([1, 2], 2, false)).toBe('Seite 2'); // die Zahl der Seiten wäre geraten
});

test('a new page takes the first number that is free, so no page is overwritten', async () => {
  const base = '2026-10-29 0800 Muster';
  const taken = new Set([besprechungPagePath(base, 3), besprechungPagePath(base, 4)]);
  const asked: string[] = [];
  const exists = async (path: string) => {
    asked.push(path);
    return taken.has(path);
  };
  expect(await firstFreePage(base, 3, exists)).toBe(5);
  expect(asked).toEqual([besprechungPagePath(base, 3), besprechungPagePath(base, 4), besprechungPagePath(base, 5)]);
  expect(await firstFreePage(base, 2, async () => false)).toBe(2);
});
