import { MONTHS } from '../pages/layouts';

const SHORT = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];

type Props = {
  /** Die Reiter gehören zu diesem Jahr: Januar bis Dezember. */
  year: number;
  /** Der Monat der Seite, die gerade offen ist, als `YYYY-MM`. Sein Reiter ist hervorgehoben. */
  current: string;
};

/** Reiter am rechten Rand, wie bei einem Kalender mit Griffregister: Ein Tipp öffnet den Monat. */
export function MonthTabs({ year, current }: Props) {
  return (
    <nav class="monatsreiter" aria-label="Monate">
      {SHORT.map((short, i) => {
        const key = `${String(year).padStart(4, '0')}-${String(i + 1).padStart(2, '0')}`;
        return (
          <a key={key} class="reiter" href={`#/monat/${key}`} aria-label={`${MONTHS[i]} ${year}`} aria-current={key === current ? 'true' : undefined}>
            {short}
          </a>
        );
      })}
    </nav>
  );
}
