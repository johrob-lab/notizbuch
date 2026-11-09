import { formatDayLong, MONTHS, monthGrid, monthKey, type Day } from './dates';
import type { Geburtstag } from './geburtstage';
import { holidaysAT } from './holidays';
import type { Termin } from './termine';

// Der Kalender auf der Tagesseite: ein Monat, Montag zuerst, mit heute, dem gezeigten Tag, Feiertagen, Geburtstagen und Tagen
// mit Terminen. Reine Rechnung ohne DOM und ohne Uhr: Was "heute" ist, kommt von außen.

/** Ein Tag im Raster. */
export type CalendarCell = {
  day: Day;
  /** Die Zahl im Feld, 1 bis 31. */
  number: number;
  /** Der Tag gehört zum Monat und nicht zu den Nachbarn, die das Raster auffüllen. Nur dort gelten `today`, `shown` und `holiday`. */
  inMonth: boolean;
  today: boolean;
  /** Der Tag, dessen Seite offen ist. */
  shown: boolean;
  /** Name des gesetzlichen Feiertags. Nur für Tage des Monats, wie im Planer des Monats. */
  holiday?: string;
  /** Wie viele Termine der Tag in `Termine.md` hat. Auch für die Nachbartage im Raster. */
  appointments: number;
  /** Geburtstage und Jahrestage des Tages in der Reihenfolge der Eingabe. Auch für die Nachbartage im Raster, sonst leer. */
  geburtstage: Geburtstag[];
  /** Für Sprachausgabe und Tests: `Do 29.10.2026, heute, Nationalfeiertag, Geburtstag von Max Beispiel, 2 Termine`. */
  label: string;
};

/** Zum Beispiel `Oktober 2026` für `2026-10`. */
export function monthTitle(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function labelOf(day: Day, today: boolean, holiday: string | undefined, geburtstage: Geburtstag[], appointments: number): string {
  const parts = [formatDayLong(day)];
  if (today) parts.push('heute');
  if (holiday) parts.push(holiday);
  for (const g of geburtstage) parts.push(`${g.art} von ${g.name}`);
  if (appointments > 0) parts.push(`${appointments} ${appointments === 1 ? 'Termin' : 'Termine'}`);
  return parts.join(', ');
}

/**
 * Die Wochen des Monats `month` (`2026-10`), Montag bis Sonntag: nur die Wochen, in denen ein Tag des Monats liegt, also
 * vier bis sechs.
 */
export function calendarWeeks(month: string, o: { today: Day; shown: Day; termine: Termin[]; geburtstage?: Geburtstag[] }): CalendarCell[][] {
  const holidays = holidaysAT(Number(month.slice(0, 4)));
  const count = new Map<Day, number>();
  for (const termin of o.termine) count.set(termin.date, (count.get(termin.date) ?? 0) + 1);
  const births = new Map<Day, Geburtstag[]>();
  for (const g of o.geburtstage ?? []) births.set(g.date, [...(births.get(g.date) ?? []), g]);

  return monthGrid(month)
    .filter((week) => week.some((day) => monthKey(day) === month))
    .map((week) =>
      week.map((day): CalendarCell => {
        const inMonth = monthKey(day) === month;
        const holiday = inMonth ? holidays.get(day) : undefined;
        // Heute und der gezeigte Tag sind nur dort markiert, wo sie hingehören: im Raster eines Nachbarmonats sind die
        // Randtage (Auffüller) einfach Tage.
        const today = inMonth && day === o.today;
        const appointments = count.get(day) ?? 0;
        const geburtstage = births.get(day) ?? [];
        return {
          day,
          number: Number(day.slice(8, 10)),
          inMonth,
          today,
          shown: inMonth && day === o.shown,
          holiday,
          appointments,
          geburtstage,
          label: labelOf(day, today, holiday, geburtstage, appointments),
        };
      }),
    );
}
