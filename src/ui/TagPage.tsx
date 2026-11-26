import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { kopieImSpeicher } from '../gehirn/kopie';
import { dayExtras } from '../ki/pageInfo';
import { todayVienna, type Day } from '../lib/dates';
import type { DayEntry } from '../lib/dayMeetings';
import { dailyNotePath, tagPagePath } from '../lib/filenames';
import { geburtstageAm } from '../lib/geburtstage';
import { agendaMarks, tagLayout, type Layout, type Rect } from '../pages/layouts';
import type { ListDir } from '../sync/github';
import { BriefingCard } from './BriefingCard';
import { MeetingsCard } from './MeetingsCard';
import { MiniCalendar } from './MiniCalendar';
import { neighborsOf, withMarks } from './neighbors';
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
  // Im Kopf nur die Geburtstage und Jahrestage: Termine stehen schon in der Karte Besprechungen, Prioritäten im eigenen Feld.
  // Ebenso im Kopf der Nachbarn, die über und unter der Seite hängen.
  const headMarks = useCallback(
    (l: Layout) => agendaMarks(l, (d) => ({ geburtstage: geburtstageAm(geburtstage, d), termine: [], prioritaeten: [] })),
    [geburtstage],
  );
  const marks = useMemo(() => headMarks(layout), [layout, headMarks]);
  const briefing = rectOf(layout, 'briefing');
  const calendar = rectOf(layout, 'kalender');
  const meetings = rectOf(layout, 'besprechungen');
  // Darüber der Tag davor, darunter der Tag danach. Ihre Vorschau zeigt wie diese Seite die Geburtstage im Kopf, die Karten aber
  // erst, wenn sie offen sind.
  const neighbors = useMemo(() => withMarks(neighborsOf({ view: 'tag', key: day }), headMarks), [day, headMarks]);
  // „Frag Claude“ schickt mit der Tagesseite die Notiz des Tages und die Einträge der Karte „Besprechungen“ mit, so wie sie beim
  // Fragen sind. Die Notiz wird dafür nur gelesen (`peek`): Die Seite bleibt an ihre eigene Datei gebunden.
  const entries = useRef<DayEntry[]>([]);
  const onEntries = useCallback((list: DayEntry[]) => {
    entries.current = list;
  }, []);
  const askExtra = useCallback(async () => {
    const look = await rest.engine.peekLookup(dailyNotePath(day));
    const ausKopie = look.unknown ? (kopieImSpeicher()?.text(dailyNotePath(day)) ?? null) : null;
    return dayExtras(day, look, entries.current, ausKopie);
  }, [day, rest.engine]);

  return (
    <PageView
      layout={layout}
      path={tagPagePath(day)}
      {...rest}
      marks={marks}
      neighbors={neighbors}
      askExtra={askExtra}
      overlay={
        <>
          {briefing && <BriefingCard engine={rest.engine} day={day} rect={briefing} />}
          {calendar && <MiniCalendar rect={calendar} day={day} today={today} termine={termine} geburtstage={geburtstage} />}
          {meetings && <MeetingsCard engine={rest.engine} day={day} rect={meetings} termine={termine} listDir={listDir} onEntries={onEntries} />}
        </>
      }
    />
  );
}
