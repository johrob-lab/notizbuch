import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isoWeekKey, todayVienna } from '../../src/lib/dates';
import {
  nextRoute,
  parseRoute,
  prevRoute,
  routeHash,
  shownDay,
  shownMonth,
  viewRoute,
  type Route,
} from '../../src/ui/router';

// Heute ist in diesen Tests fest der 29.10.2026, damit "ohne Adresse gilt heute" nicht von der Uhr abhängt.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const TODAY: Route = { view: 'tag', key: '2026-10-29' };
const BASE = '2026-10-29 0800 Sperren & Muster 2027';

test('routes', () => {
  expect(parseRoute('#/woche/2026-W44')).toEqual({ view: 'woche', key: '2026-W44' });
  expect(routeHash(prevRoute(parseRoute('#/woche/2027-W01')))).toBe('#/woche/2026-W53');
  expect(routeHash(nextRoute(parseRoute('#/tag/2026-12-31')))).toBe('#/tag/2027-01-01');
  expect(parseRoute('')).toEqual({ view: 'tag', key: todayVienna() });
});

test('today is the day in Vienna, also in the hour when UTC is still on the day before', () => {
  // 00:30 in Wien, im Winter und im Sommer. In UTC ist es noch der Vortag.
  const nights: [string, string][] = [
    ['2026-10-29T23:30:00Z', '2026-10-30'],
    ['2026-07-14T22:30:00Z', '2026-07-15'],
  ];
  for (const [now, day] of nights) {
    vi.setSystemTime(new Date(now));
    expect(parseRoute(''), now).toEqual({ view: 'tag', key: day });
    expect(parseRoute('#/unsinn'), now).toEqual({ view: 'tag', key: day });
    expect(shownDay({ view: 'einstellungen', key: '' }), now).toBe(day);
    expect(viewRoute({ view: 'monat', key: day.slice(0, 7) }, 'tag'), now).toEqual({ view: 'tag', key: day });
  }
});

test('every view has its hash and reads back the same', () => {
  const routes: [Route, string][] = [
    [{ view: 'tag', key: '2026-10-29' }, '#/tag/2026-10-29'],
    [{ view: 'woche', key: '2026-W44' }, '#/woche/2026-W44'],
    [{ view: 'monat', key: '2026-10' }, '#/monat/2026-10'],
    [{ view: 'einstellungen', key: '' }, '#/einstellungen'],
    [{ view: 'besprechung', key: BASE, n: 2 }, `#/besprechung/${encodeURIComponent(BASE)}/2`],
  ];
  for (const [route, hash] of routes) {
    expect(routeHash(route)).toBe(hash);
    expect(parseRoute(hash)).toEqual(route);
  }
});

test('no address, a foreign address or a broken key land on today', () => {
  const broken = [
    '',
    '#',
    '#/',
    '#/unbekannt',
    '#/tag',
    '#/tag/',
    '#/tag/heute',
    '#/tag/2026-02-30', // den Tag gibt es nicht
    '#/tag/2026-13-01',
    '#/tag/2026-1-5',
    '#/tag/2026-10-29/',
    '#/tag/2026-10-29/mehr',
    '#/woche/2027-W53', // 2027 hat nur 52 Wochen
    '#/woche/2026-W00',
    '#/woche/2026-W54',
    '#/woche/2026-W5',
    '#/woche/2026-w44',
    '#/woche/2026-44',
    '#/monat/2026-13',
    '#/monat/2026-00',
    '#/monat/2026-1',
    '#/monat/2026-10-01',
    '#/einstellungen/mehr',
    '#/besprechung',
    '#/besprechung/',
    '#/besprechung//1',
    `#/besprechung/${encodeURIComponent(BASE)}`,
    `#/besprechung/${encodeURIComponent(BASE)}/0`,
    `#/besprechung/${encodeURIComponent(BASE)}/-1`,
    `#/besprechung/${encodeURIComponent(BASE)}/01`,
    `#/besprechung/${encodeURIComponent(BASE)}/1.5`,
    `#/besprechung/${encodeURIComponent(BASE)}/eins`,
    `#/besprechung/${encodeURIComponent(BASE)}/${'9'.repeat(30)}`,
    '#/besprechung/%E0%A4%A/1', // kaputte Prozent-Kodierung
    `#/besprechung/${encodeURIComponent('Montag 0800 Thema')}/1`, // beginnt nicht mit einem Tag
    `#/besprechung/${encodeURIComponent('2026-02-30 0800 Thema')}/1`,
    `#/besprechung/${encodeURIComponent('2026-10-29')}/1`, // ohne Uhrzeit und Thema
    `#/besprechung/${encodeURIComponent('2026-10-29 0800 ../../Thema')}/1`, // ein Pfad statt eines Namens
    `#/besprechung/${encodeURIComponent('2026-10-29 0800 a\\b')}/1`,
    `#/besprechung/${encodeURIComponent('2026-10-29 0800 a\nb')}/1`,
    '#/besprechung/a/b/1',
  ];
  for (const hash of broken) expect(parseRoute(hash), hash).toEqual(TODAY);
});

test('a week exists only in a year that has it', () => {
  expect(parseRoute('#/woche/2026-W53')).toEqual({ view: 'woche', key: '2026-W53' });
  expect(parseRoute('#/woche/2020-W53')).toEqual({ view: 'woche', key: '2020-W53' });
  expect(parseRoute('#/woche/2027-W52')).toEqual({ view: 'woche', key: '2027-W52' });
  expect(parseRoute('#/woche/2027-W53')).toEqual(TODAY);
  expect(parseRoute('#/woche/2025-W53')).toEqual(TODAY);
  expect(parseRoute('#/woche/2026-W01')).toEqual({ view: 'woche', key: '2026-W01' });
});

test('months run from 01 to 12', () => {
  expect(parseRoute('#/monat/2026-01')).toEqual({ view: 'monat', key: '2026-01' });
  expect(parseRoute('#/monat/2026-12')).toEqual({ view: 'monat', key: '2026-12' });
  expect(parseRoute('#/monat/2026-13')).toEqual(TODAY);
});

test('a meeting keeps its name with every special character', () => {
  const base = '2026-10-29 0800 Sperren & Muster 100 % #1 [x] ü ß € 🙂';
  const route: Route = { view: 'besprechung', key: base, n: 12 };
  expect(parseRoute(routeHash(route))).toEqual(route);
  // Im Hash steht kein Schrägstrich und kein Leerzeichen aus dem Namen, nur die zwei Trenner der Adresse.
  expect(routeHash(route).slice('#/besprechung/'.length).split('/')).toHaveLength(2);
});

test('arrows step a day across month, year and leap day', () => {
  const next = (key: string) => routeHash(nextRoute({ view: 'tag', key }));
  const prev = (key: string) => routeHash(prevRoute({ view: 'tag', key }));
  expect(next('2026-10-31')).toBe('#/tag/2026-11-01');
  expect(prev('2026-11-01')).toBe('#/tag/2026-10-31');
  expect(next('2026-12-31')).toBe('#/tag/2027-01-01');
  expect(prev('2027-01-01')).toBe('#/tag/2026-12-31');
  expect(next('2028-02-28')).toBe('#/tag/2028-02-29');
  expect(next('2027-02-28')).toBe('#/tag/2027-03-01');
  // Zeitumstellung: der Tag mit 25 Stunden zählt wie jeder andere
  expect(next('2026-10-25')).toBe('#/tag/2026-10-26');
  expect(prev('2026-10-26')).toBe('#/tag/2026-10-25');
});

test('arrows step a week across the ISO year', () => {
  const next = (key: string) => routeHash(nextRoute({ view: 'woche', key }));
  const prev = (key: string) => routeHash(prevRoute({ view: 'woche', key }));
  expect(next('2026-W44')).toBe('#/woche/2026-W45');
  expect(prev('2026-W44')).toBe('#/woche/2026-W43');
  expect(next('2026-W52')).toBe('#/woche/2026-W53');
  expect(next('2026-W53')).toBe('#/woche/2027-W01');
  expect(prev('2027-W01')).toBe('#/woche/2026-W53');
  expect(next('2027-W52')).toBe('#/woche/2028-W01'); // 2027 hat keine Woche 53
  expect(prev('2028-W01')).toBe('#/woche/2027-W52');
  expect(next('2025-W52')).toBe('#/woche/2026-W01');
  expect(prev('2026-W01')).toBe('#/woche/2025-W52');
  expect(next('2020-W53')).toBe('#/woche/2021-W01');
});

test('arrows step a month across the year', () => {
  const next = (key: string) => routeHash(nextRoute({ view: 'monat', key }));
  const prev = (key: string) => routeHash(prevRoute({ view: 'monat', key }));
  expect(next('2026-10')).toBe('#/monat/2026-11');
  expect(prev('2026-10')).toBe('#/monat/2026-09');
  expect(next('2026-12')).toBe('#/monat/2027-01');
  expect(prev('2027-01')).toBe('#/monat/2026-12');
});

test('forward and back are the same way', () => {
  const samples: Route[] = [
    { view: 'tag', key: '2026-12-31' },
    { view: 'tag', key: '2028-02-29' },
    { view: 'woche', key: '2026-W53' },
    { view: 'woche', key: '2027-W01' },
    { view: 'woche', key: '2027-W52' },
    { view: 'monat', key: '2026-12' },
    { view: 'monat', key: '2027-01' },
  ];
  for (const route of samples) {
    expect(prevRoute(nextRoute(route)), routeHash(route)).toEqual(route);
    expect(nextRoute(prevRoute(route)), routeHash(route)).toEqual(route);
  }
});

function walk(start: Route, step: (r: Route) => Route, count: number): Route[] {
  const visited = [start];
  for (let i = 0; i < count; i++) visited.push(step(visited[visited.length - 1]));
  return visited;
}

test('arrows never leave a key that parseRoute would refuse, and every step is a new page', () => {
  const starts: Route[] = [
    { view: 'tag', key: '2026-02-26' },
    { view: 'woche', key: '2026-W50' },
    { view: 'monat', key: '2026-10' },
  ];
  for (const start of starts) {
    for (const step of [nextRoute, prevRoute]) {
      const visited = walk(start, step, 400);
      for (const route of visited) expect(parseRoute(routeHash(route)), routeHash(route)).toEqual(route);
      expect(new Set(visited.map(routeHash)).size).toBe(visited.length);
    }
  }
});

test('day, week and month keys need a year from 1000 to 9998, anything else lands on today', () => {
  const outside = ['#/tag/0000-01-01', '#/tag/0999-12-31', '#/tag/9999-01-01', '#/woche/0999-W52', '#/woche/9999-W01', '#/monat/0000-01', '#/monat/0999-12', '#/monat/9999-12'];
  for (const hash of outside) expect(parseRoute(hash), hash).toEqual(TODAY);
  const lastWeek = isoWeekKey('9998-12-28'); // der 28.12. liegt immer in der letzten Woche seines Jahres
  const inside: Route[] = [
    { view: 'tag', key: '1000-01-01' },
    { view: 'tag', key: '9998-12-31' },
    { view: 'woche', key: '1000-W01' },
    { view: 'woche', key: lastWeek },
    { view: 'monat', key: '1000-01' },
    { view: 'monat', key: '9998-12' },
  ];
  for (const route of inside) expect(parseRoute(routeHash(route)), routeHash(route)).toEqual(route);
});

test('arrows stop at the end of the calendar instead of making up a key', () => {
  expect(nextRoute({ view: 'tag', key: '9998-12-31' })).toEqual({ view: 'tag', key: '9998-12-31' });
  expect(prevRoute({ view: 'tag', key: '1000-01-01' })).toEqual({ view: 'tag', key: '1000-01-01' });
  expect(nextRoute({ view: 'monat', key: '9998-12' })).toEqual({ view: 'monat', key: '9998-12' });
  expect(prevRoute({ view: 'monat', key: '1000-01' })).toEqual({ view: 'monat', key: '1000-01' });
  expect(prevRoute({ view: 'woche', key: '1000-W01' })).toEqual({ view: 'woche', key: '1000-W01' });
  const lastWeek = isoWeekKey('9998-12-28');
  expect(nextRoute({ view: 'woche', key: lastWeek })).toEqual({ view: 'woche', key: lastWeek });
  // Eins davor geht es noch weiter
  expect(nextRoute({ view: 'tag', key: '9998-12-30' })).toEqual({ view: 'tag', key: '9998-12-31' });
  expect(prevRoute({ view: 'monat', key: '1000-02' })).toEqual({ view: 'monat', key: '1000-01' });
});

test('a meeting and the settings do not have arrows that go anywhere', () => {
  const meeting: Route = { view: 'besprechung', key: BASE, n: 1 };
  const settings: Route = { view: 'einstellungen', key: '' };
  expect(nextRoute(meeting)).toEqual(meeting);
  expect(prevRoute(meeting)).toEqual(meeting);
  expect(nextRoute(settings)).toEqual(settings);
  expect(prevRoute(settings)).toEqual(settings);
});

test('the shown day follows the page, and today wins when the page contains it', () => {
  expect(shownDay({ view: 'tag', key: '2026-10-05' }, '2026-10-29')).toBe('2026-10-05');
  // Woche mit heute: heute. Andere Woche: ihr Montag.
  expect(shownDay({ view: 'woche', key: '2026-W44' }, '2026-10-29')).toBe('2026-10-29');
  expect(shownDay({ view: 'woche', key: '2026-W45' }, '2026-10-29')).toBe('2026-11-02');
  // Monat mit heute: heute. Anderer Monat: der Erste.
  expect(shownDay({ view: 'monat', key: '2026-10' }, '2026-10-29')).toBe('2026-10-29');
  expect(shownDay({ view: 'monat', key: '2026-12' }, '2026-10-29')).toBe('2026-12-01');
  // Besprechung: der Tag aus ihrem Namen. Einstellungen: heute.
  expect(shownDay({ view: 'besprechung', key: '2026-03-02 0800 Muster', n: 1 }, '2026-10-29')).toBe('2026-03-02');
  expect(shownDay({ view: 'einstellungen', key: '' }, '2026-10-29')).toBe('2026-10-29');
  // Ohne Angabe gilt der heutige Tag in Wiener Zeit
  expect(shownDay({ view: 'einstellungen', key: '' })).toBe(todayVienna());
});

test('the month tabs follow the page, and for a week its Thursday: KW 01 whose Monday is in the old year shows the new year', () => {
  // 2026-W01 geht von Montag, 29.12.2025, bis Sonntag, 4.1.2026. Der Donnerstag ist der 1.1.2026.
  expect(shownMonth({ view: 'woche', key: '2026-W01' }, '2026-10-29')).toBe('2026-01');
  expect(shownMonth({ view: 'woche', key: '2026-W01' }, '2025-12-30')).toBe('2026-01'); // auch wenn heute noch im alten Jahr in dieser Woche liegt
  // 2026-W53 geht bis Sonntag, 3.1.2027. Der Donnerstag ist der 31.12.2026.
  expect(shownMonth({ view: 'woche', key: '2026-W53' }, '2026-10-29')).toBe('2026-12');
  // Eine Woche über das Monatsende gehört zum Monat ihres Donnerstags, auch an ihrem Sonntag
  expect(shownMonth({ view: 'woche', key: '2026-W44' }, '2026-11-01')).toBe('2026-10');
  // Die anderen Seiten: der Monat des Tages, den die Seite zeigt
  expect(shownMonth({ view: 'tag', key: '2026-12-31' }, '2026-10-29')).toBe('2026-12');
  expect(shownMonth({ view: 'monat', key: '2027-02' }, '2026-10-29')).toBe('2027-02');
  expect(shownMonth({ view: 'besprechung', key: '2026-03-02 0800 Muster', n: 1 }, '2026-10-29')).toBe('2026-03');
  expect(shownMonth({ view: 'einstellungen', key: '' }, '2026-10-29')).toBe('2026-10');
  expect(shownMonth({ view: 'einstellungen', key: '' })).toBe(todayVienna().slice(0, 7));
});

test('switching the view keeps the shown date', () => {
  const today = '2026-10-29';
  const day: Route = { view: 'tag', key: '2026-11-03' };
  expect(viewRoute(day, 'woche', today)).toEqual({ view: 'woche', key: '2026-W45' });
  expect(viewRoute(day, 'monat', today)).toEqual({ view: 'monat', key: '2026-11' });
  expect(viewRoute(day, 'tag', today)).toEqual(day);
  // Von der Woche mit heute zum Tag: heute
  expect(viewRoute({ view: 'woche', key: '2026-W44' }, 'tag', today)).toEqual(TODAY);
  // Vom Monat mit heute zur Woche: die Woche von heute
  expect(viewRoute({ view: 'monat', key: '2026-10' }, 'woche', today)).toEqual({ view: 'woche', key: '2026-W44' });
  // Aus den Einstellungen: heute
  expect(viewRoute({ view: 'einstellungen', key: '' }, 'monat', today)).toEqual({ view: 'monat', key: '2026-10' });
  // Eine Woche über den Jahreswechsel: der Montag bestimmt den Monat
  expect(viewRoute({ view: 'woche', key: '2026-W53' }, 'monat', today)).toEqual({ view: 'monat', key: '2026-12' });
  expect(viewRoute({ view: 'woche', key: '2026-W53' }, 'tag', today)).toEqual({ view: 'tag', key: '2026-12-28' });
});

test('the route a button leads to is always one that parseRoute reads back', () => {
  const today = '2026-10-29';
  const routes: Route[] = [
    { view: 'tag', key: '2026-12-31' },
    { view: 'woche', key: '2026-W53' },
    { view: 'monat', key: '2027-02' },
    { view: 'besprechung', key: BASE, n: 1 },
    { view: 'einstellungen', key: '' },
  ];
  for (const route of routes) {
    for (const view of ['tag', 'woche', 'monat'] as const) {
      const target = viewRoute(route, view, today);
      expect(parseRoute(routeHash(target)), `${routeHash(route)} nach ${view}`).toEqual(target);
    }
  }
});
