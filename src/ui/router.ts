import { addDays, isValidDay, isoWeekKey, monthKey, todayVienna, weekDays, type Day } from '../lib/dates';

// Die Adresse (`window.location.hash`) bestimmt, welche Seite offen ist. Jede Seite hat genau eine gültige Adresse,
// und `parseRoute` liest nur Adressen mit einem Schlüssel, den es gibt: Alles andere zeigt den heutigen Tag.

export type View = 'tag' | 'woche' | 'monat' | 'besprechung' | 'einstellungen';

/**
 * Eine Seite des Notizbuchs. Der Schlüssel ist je nach Ansicht der Tag (`2026-10-29`), die Woche (`2026-W44`),
 * der Monat (`2026-10`) oder der Name der Besprechung ohne Seitennummer. Die Einstellungen haben keinen Schlüssel.
 */
export type Route = { view: View; key: string; n?: number };

const WEEK = /^\d{4}-W\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const COUNT = /^[1-9]\d*$/;
const PAGE_ADDRESS = /^#\/(tag|woche|monat)\/(.*)$/;
const MEETING_ADDRESS = /^#\/besprechung\/([^/]+)\/(.*)$/;

function isValidWeek(key: string): boolean {
  // Die Woche gibt es, wenn ihr Donnerstag in dieser Woche und diesem ISO-Jahr liegt: 2026-W53 ja, 2027-W53 nein.
  return WEEK.test(key) && isoWeekKey(weekDays(key)[3]) === key;
}

function isValidKey(view: 'tag' | 'woche' | 'monat', key: string): boolean {
  if (view === 'tag') return isValidDay(key);
  return view === 'woche' ? isValidWeek(key) : MONTH.test(key);
}

// Der Name einer Besprechung beginnt mit ihrem Tag und enthält nie einen Pfad: Er wird zum Dateinamen.
function isValidMeeting(base: string): boolean {
  return isValidDay(base.slice(0, 10)) && base[10] === ' ' && !/[\\/\u0000-\u001f\u007f]/.test(base);
}

function read(hash: string): Route | null {
  if (hash === '#/einstellungen') return { view: 'einstellungen', key: '' };

  const page = PAGE_ADDRESS.exec(hash);
  if (page) {
    const view = page[1] as 'tag' | 'woche' | 'monat';
    return isValidKey(view, page[2]) ? { view, key: page[2] } : null;
  }

  const meeting = MEETING_ADDRESS.exec(hash);
  if (meeting && COUNT.test(meeting[2]) && Number.isSafeInteger(Number(meeting[2]))) {
    try {
      const base = decodeURIComponent(meeting[1]);
      if (isValidMeeting(base)) return { view: 'besprechung', key: base, n: Number(meeting[2]) };
    } catch {
      // kaputte Prozent-Kodierung: keine Seite
    }
  }
  return null;
}

/** Die Seite zur Adresse. Fehlt die Adresse oder ist sie ungültig, gilt der heutige Tag in Wiener Zeit. */
export function parseRoute(hash: string): Route {
  return read(hash) ?? { view: 'tag', key: todayVienna() };
}

export function routeHash(r: Route): string {
  if (r.view === 'einstellungen') return '#/einstellungen';
  if (r.view === 'besprechung') return `#/besprechung/${encodeURIComponent(r.key)}/${r.n ?? 1}`;
  return `#/${r.view}/${r.key}`;
}

function stepMonth(key: string, delta: number): string {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// Einen Tag, eine Woche oder einen Monat weiter. Am Rand des Kalenders (Jahr 0000 und 9999) und bei Besprechung und
// Einstellungen bleibt die Seite, wo sie ist, statt einen Schlüssel zu erfinden, den es nicht gibt.
function step(r: Route, delta: 1 | -1): Route {
  if (r.view === 'besprechung' || r.view === 'einstellungen') return r;
  let key: string;
  if (r.view === 'tag') key = addDays(r.key, delta);
  else if (r.view === 'woche') key = isoWeekKey(addDays(weekDays(r.key)[0], 7 * delta));
  else key = stepMonth(r.key, delta);
  return isValidKey(r.view, key) ? { view: r.view, key } : r;
}

export function prevRoute(r: Route): Route {
  return step(r, -1);
}

export function nextRoute(r: Route): Route {
  return step(r, 1);
}

/**
 * Der Tag, den die Seite zeigt, wenn man die Ansicht wechselt: bei einer Woche oder einem Monat mit heute der heutige
 * Tag, sonst der Montag bzw. der Erste. Eine Besprechung zeigt den Tag aus ihrem Namen, die Einstellungen heute.
 */
export function shownDay(r: Route, today: Day = todayVienna()): Day {
  if (r.view === 'tag') return r.key;
  if (r.view === 'woche') {
    const days = weekDays(r.key);
    return days.includes(today) ? today : days[0];
  }
  if (r.view === 'monat') return monthKey(today) === r.key ? today : `${r.key}-01`;
  const day = r.key.slice(0, 10);
  return r.view === 'besprechung' && isValidDay(day) ? day : today;
}

/** Dieselbe Zeit in einer anderen Ansicht: der Tag, die Woche oder der Monat, in dem `shownDay` liegt. */
export function viewRoute(r: Route, view: 'tag' | 'woche' | 'monat', today: Day = todayVienna()): Route {
  const day = shownDay(r, today);
  if (view === 'tag') return { view, key: day };
  return { view, key: view === 'woche' ? isoWeekKey(day) : monthKey(day) };
}
