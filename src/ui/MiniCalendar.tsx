import { useMemo } from 'preact/hooks';
import type { Day } from '../lib/dates';
import { monthKey } from '../lib/dates';
import { calendarWeeks, monthTitle } from '../lib/miniCalendar';
import type { Termin } from '../lib/termine';
import type { Rect } from '../pages/layouts';
import { cardStyle } from './cardStyle';
import { routeHash } from './router';

// Die Karte „Kalender“ auf der Tagesseite: der Monat des Tages, Montag zuerst. Heute, der gezeigte Tag, Feiertage (wie im
// Planer: Text #a8674f auf #f8efea) und Tage mit Terminen sind markiert. Jeder Tag ist ein Link auf seine Seite. Die Tage sind
// kleiner als 44 pt (etwa 34 mal 16 bis 19 pt auf dem iPad): eine gewollte Ausnahme, die Begründung steht bei `.karte .tag` in app.css.

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

type Props = {
  rect: Rect;
  /** Der Tag, dessen Seite offen ist, und heute. */
  day: Day;
  today: Day;
  termine: Termin[];
};

export function MiniCalendar({ rect, day, today, termine }: Props) {
  const month = monthKey(day);
  const weeks = useMemo(() => calendarWeeks(month, { today, shown: day, termine }), [month, today, day, termine]);

  return (
    <section class="karte kalender" aria-label="Kalender" style={cardStyle(rect)}>
      <h3 class="monat">{monthTitle(month)}</h3>
      <div class="wochentage" aria-hidden="true">
        {WEEKDAYS.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div class="raster" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.flat().map((cell) => {
          const classes = ['tag'];
          if (!cell.inMonth) classes.push('aussen');
          if (cell.today) classes.push('heute');
          if (cell.shown) classes.push('gezeigt');
          if (cell.holiday) classes.push('feiertag');
          if (cell.appointments > 0) classes.push('termine');
          return (
            <a
              key={cell.day}
              class={classes.join(' ')}
              href={routeHash({ view: 'tag', key: cell.day })}
              aria-label={cell.label}
              aria-current={cell.today ? 'date' : cell.shown ? 'page' : undefined}
            >
              {cell.number}
            </a>
          );
        })}
      </div>
    </section>
  );
}
