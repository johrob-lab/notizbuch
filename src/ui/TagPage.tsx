import { useMemo, useState } from 'preact/hooks';
import { todayVienna, type Day } from '../lib/dates';
import { tagPagePath } from '../lib/filenames';
import { geburtstageAm } from '../lib/geburtstage';
import { agendaMarks, tagLayout, type Layout, type Rect } from '../pages/layouts';
import type { ListDir } from '../sync/github';
import { BriefingCard } from './BriefingCard';
import { MeetingsCard } from './MeetingsCard';
import { MiniCalendar } from './MiniCalendar';
import { PageView, type PageProps } from './PageView';
import { useGeburtstage } from './useGeburtstage';
import { useTermine } from './useTermine';

const rectOf = (layout: Layout, id: string): Rect | undefined => layout.cards.find((card) => card.id === id)?.rect;

/**
 * Die Tagesseite: Notizen, Prioritäten und Aufgaben des Tages zum Schreiben, dazu drei Karten aus Text, die mit der Seite
 * wandern und zoomen: das Morgenbriefing des Tages, der Kalender des Monats und die Besprechungen des Tages. Die Geburtstage
 * und Jahrestage des Tages stehen rechts im Kopf, nur auf dem Bildschirm, nie in der Datei. Der Kalender markiert alle Tage
 * mit Geburtstagen oder Jahrestagen.
 */
export function TagPage({ day, listDir, ...rest }: PageProps & { day: Day; listDir: ListDir }) {
  const layout = useMemo(() => tagLayout(day), [day]);
  // Heute, solange die Seite offen ist: Die Markierung im Kalender soll sich nicht mitten im Lesen ändern.
  const [today] = useState(() => todayVienna());
  const termine = useTermine(rest.engine);
  const geburtstage = useGeburtstage(rest.engine);
  // Im Kopf nur die Geburtstage und Jahrestage: Termine und Prioritäten stehen auf der Tagesseite schon in den Karten.
  const marks = useMemo(
    () => agendaMarks(layout, (d) => ({ geburtstage: geburtstageAm(geburtstage, d), termine: [], prioritaeten: [] })),
    [layout, geburtstage],
  );
  const briefing = rectOf(layout, 'briefing');
  const calendar = rectOf(layout, 'kalender');
  const meetings = rectOf(layout, 'besprechungen');

  return (
    <PageView
      layout={layout}
      path={tagPagePath(day)}
      {...rest}
      marks={marks}
      overlay={
        <>
          {briefing && <BriefingCard engine={rest.engine} day={day} rect={briefing} />}
          {calendar && <MiniCalendar rect={calendar} day={day} today={today} termine={termine} geburtstage={geburtstage} />}
          {meetings && <MeetingsCard engine={rest.engine} day={day} rect={meetings} termine={termine} listDir={listDir} />}
        </>
      }
    />
  );
}
