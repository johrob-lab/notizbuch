import { expect, test } from 'vitest';
import { dayEntries, meetingRequest, mergeMeetings, namesIn, type MeetingRef } from '../../src/lib/dayMeetings';
import { parseTermine } from '../../src/lib/termine';

const D = '2026-10-29';
const termine = parseTermine(
  [
    '- 2026-10-29 16:00 bis 17:00 | Sperren & "Muster" <2027> | Raum 1',
    '- 2026-10-29 08:00 bis 14:00 | Abstimmung Beispiel 2027 | Klagenfurt | Outlook',
    '- 2026-10-29 ganztägig | Schulung Beispiel',
    '- 2026-10-30 09:00 bis 10:00 | Anderer Tag',
  ].join('\n'),
);
const meeting = (base: string, pages: number[] = [1]): MeetingRef => ({ base, pages });
const shape = (entries: ReturnType<typeof dayEntries>) =>
  entries.map((e) => (e.kind === 'termin' ? `T ${e.termin.start ?? 'ganztägig'} ${e.termin.title} ${e.meeting?.base ?? '-'}` : `B ${e.zeit} ${e.thema}`));

test('without meetings the appointments of the day come in order, all day first', () => {
  expect(shape(dayEntries(D, termine, []))).toEqual([
    'T ganztägig Schulung Beispiel -',
    'T 08:00 Abstimmung Beispiel 2027 -',
    'T 16:00 Sperren & "Muster" <2027> -',
  ]);
});

test('an appointment with a meeting of the same time and topic shows that meeting', () => {
  const found = meeting('2026-10-29 0800 Abstimmung Beispiel 2027', [1, 2]);
  const entries = dayEntries(D, termine, [found]);
  expect(shape(entries)).toEqual([
    'T ganztägig Schulung Beispiel -',
    'T 08:00 Abstimmung Beispiel 2027 2026-10-29 0800 Abstimmung Beispiel 2027',
    'T 16:00 Sperren & "Muster" <2027> -',
  ]);
  expect(entries[1]).toMatchObject({ kind: 'termin', meeting: found });
});

test('the topic of the meeting is the file name form of the title of the appointment', () => {
  const found = meeting('2026-10-29 1600 Sperren & Muster 2027');
  expect(shape(dayEntries(D, termine, [found]))[2]).toBe('T 16:00 Sperren & "Muster" <2027> 2026-10-29 1600 Sperren & Muster 2027');
});

test('a meeting of another time is not the meeting of a timed appointment', () => {
  const entries = dayEntries(D, termine, [meeting('2026-10-29 0900 Abstimmung Beispiel 2027')]);
  expect(shape(entries)).toEqual([
    'T ganztägig Schulung Beispiel -',
    'T 08:00 Abstimmung Beispiel 2027 -',
    'B 09:00 Abstimmung Beispiel 2027',
    'T 16:00 Sperren & "Muster" <2027> -',
  ]);
});

test('an all day appointment has the meeting of the same topic, whatever time it was given', () => {
  const entries = dayEntries(D, termine, [meeting('2026-10-29 0930 Schulung Beispiel')]);
  expect(shape(entries)[0]).toBe('T ganztägig Schulung Beispiel 2026-10-29 0930 Schulung Beispiel');
  expect(entries.filter((e) => e.kind === 'besprechung')).toEqual([]);
});

test('a meeting without an appointment is an entry of its own, sorted by time between the appointments', () => {
  const entries = dayEntries(D, termine, [meeting('2026-10-29 1000 Team Runde', [1, 2, 3])]);
  expect(shape(entries)).toEqual([
    'T ganztägig Schulung Beispiel -',
    'T 08:00 Abstimmung Beispiel 2027 -',
    'B 10:00 Team Runde',
    'T 16:00 Sperren & "Muster" <2027> -',
  ]);
  expect(entries[2]).toMatchObject({ kind: 'besprechung', meeting: { base: '2026-10-29 1000 Team Runde', pages: [1, 2, 3] } });
});

test('one meeting belongs to one appointment only', () => {
  const twice = parseTermine('- 2026-10-29 08:00 bis 09:00 | Doppelt\n- 2026-10-29 08:00 bis 09:00 | Doppelt\n');
  const entries = dayEntries(D, twice, [meeting('2026-10-29 0800 Doppelt')]);
  expect(shape(entries)).toEqual(['T 08:00 Doppelt 2026-10-29 0800 Doppelt', 'T 08:00 Doppelt -']);
});

test('a day without appointments lists just its meetings, a day with nothing lists nothing', () => {
  expect(shape(dayEntries(D, [], [meeting('2026-10-29 1000 Team Runde'), meeting('2026-10-29 0900 Früh')]))).toEqual(['B 09:00 Früh', 'B 10:00 Team Runde']);
  expect(dayEntries(D, [], [])).toEqual([]);
  expect(dayEntries('2026-12-24', termine, [])).toEqual([]);
});

test('umlauts match whether they are one character or a letter and a diaeresis', () => {
  const list = parseTermine('- 2026-10-29 09:00 bis 10:00 | Müller Runde\n');
  const found = meeting('2026-10-29 0900 Müller Runde');
  expect(dayEntries(D, list, [found])[0]).toMatchObject({ kind: 'termin', meeting: found });
});

test('a title that gives no topic matches the meeting named Besprechung', () => {
  const list = parseTermine('- 2026-10-29 09:00 bis 10:00 | ???\n');
  expect(dayEntries(D, list, [meeting('2026-10-29 0900 Besprechung')])[0]).toMatchObject({ kind: 'termin', meeting: { base: '2026-10-29 0900 Besprechung' } });
});

test('a meeting request from a timed appointment carries the day, the time, the title and the place', () => {
  const [timed] = parseTermine('- 2026-10-29 08:00 bis 14:00 | Abstimmung Beispiel 2027 | Klagenfurt | Outlook\n');
  expect(meetingRequest(D, timed)).toEqual({ datum: D, zeit: '08:00', thema: 'Abstimmung Beispiel 2027', ort: 'Klagenfurt' });
  const [noPlace] = parseTermine('- 2026-10-29 08:00 bis 14:00 | Ohne Ort\n');
  expect(meetingRequest(D, noPlace)).toEqual({ datum: D, zeit: '08:00', thema: 'Ohne Ort', ort: undefined });
});

test('an all day appointment needs a time first, so there is no request yet', () => {
  const [allDay] = parseTermine('- 2026-10-30 ganztägig | Schulung Beispiel\n');
  expect(meetingRequest('2026-10-30', allDay)).toBeNull();
});

// ---------- Besprechungen aus zwei Quellen ----------

test('merging puts what GitHub lists and what this device has together, with the pages of both', () => {
  const merged = mergeMeetings({
    listed: [meeting('2026-10-29 0800 A', [1, 2])],
    local: [meeting('2026-10-29 0800 A', [2, 3]), meeting('2026-10-29 0900 B')],
    deleted: [],
  });
  expect(merged).toEqual([meeting('2026-10-29 0800 A', [1, 2, 3]), meeting('2026-10-29 0900 B')]);
});

test('merging without a list from GitHub still shows what this device has', () => {
  expect(mergeMeetings({ listed: [], local: [meeting('2026-10-29 0900 B', [2, 1])], deleted: [] })).toEqual([meeting('2026-10-29 0900 B', [1, 2])]);
});

test('a page whose deletion still waits for the sync is gone, and a meeting without pages disappears', () => {
  const merged = mergeMeetings({
    listed: [meeting('2026-10-29 0800 A', [1, 2]), meeting('2026-10-29 0900 B', [1])],
    local: [],
    deleted: [meeting('2026-10-29 0800 A', [2]), meeting('2026-10-29 0900 B', [1])],
  });
  expect(merged).toEqual([meeting('2026-10-29 0800 A', [1])]);
});

test('merging counts a letter and a diaeresis as the umlaut and sorts by name', () => {
  const merged = mergeMeetings({
    listed: [meeting('2026-10-29 1000 Mu\u0308ller', [1]), meeting('2026-10-29 0800 Zeta', [1])],
    local: [meeting('2026-10-29 1000 M\u00fcller', [2])],
    deleted: [],
  });
  expect(merged).toEqual([meeting('2026-10-29 0800 Zeta', [1]), meeting('2026-10-29 1000 M\u00fcller', [1, 2])]);
});

test('a deleted page of a meeting that is not there changes nothing', () => {
  expect(mergeMeetings({ listed: [meeting('2026-10-29 0800 A')], local: [], deleted: [meeting('2026-10-29 0900 Fremd')] })).toEqual([meeting('2026-10-29 0800 A')]);
});

test('names in a folder are the files directly in it, not those in a subfolder or in another folder', () => {
  const folder = '07 Anh\u00e4nge/Notizbuch/2026';
  const paths = [`${folder}/a S1.svg`, `${folder}/unter/b S1.svg`, '07 Anh\u00e4nge/Notizbuch/2025/c S1.svg', `${folder}/b S2.svg`, '07 Anh\u00e4nge/Notizbuch/2026x/d S1.svg'];
  expect(namesIn(folder, paths)).toEqual(['a S1.svg', 'b S2.svg']);
});

test('names in a folder do not depend on how the umlauts are written', () => {
  expect(namesIn('07 Anha\u0308nge/Notizbuch/2026', ['07 Anh\u00e4nge/Notizbuch/2026/M\u00fcller S1.svg'])).toEqual(['M\u00fcller S1.svg']);
});
