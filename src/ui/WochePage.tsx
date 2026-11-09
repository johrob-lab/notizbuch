import { useCallback, useMemo } from 'preact/hooks';
import { weekDays, type Day } from '../lib/dates';
import { wochePagePath } from '../lib/filenames';
import { geburtstageAm } from '../lib/geburtstage';
import { termineAm } from '../lib/termine';
import { agendaInfo, type AgendaDay } from '../pages/agenda';
import { agendaMarks, wocheLayout } from '../pages/layouts';
import { neighborsOf } from './neighbors';
import { PageView, type PageProps } from './PageView';
import { useGeburtstage } from './useGeburtstage';
import { usePrioritaeten } from './usePrioritaeten';
import { useTermine } from './useTermine';

/**
 * Die Wochenseite: ein Feld je Tag von Montag bis Sonntag und die Wochenziele. `week` ist zum Beispiel `2026-W44`. In der
 * Kopfzeile jedes Tages stehen seine Geburtstage, Jahrestage, Termine und Prioritäten (Geburtstage und Jahrestage vor den
 * Terminen), nur auf dem Bildschirm, nie in der Datei.
 */
export function WochePage({ week, ...rest }: PageProps & { week: string }) {
  const layout = useMemo(() => wocheLayout(week), [week]);
  const days = useMemo(() => weekDays(week), [week]);
  const geburtstage = useGeburtstage(rest.engine);
  const termine = useTermine(rest.engine);
  const prioritaeten = usePrioritaeten(rest.engine, days);
  // Was ein Tag hat: für seine Kopfzeile auf dem Bildschirm und für die Liste der Tage.
  const dayData = useCallback(
    (day: Day): AgendaDay => ({
      geburtstage: geburtstageAm(geburtstage, day),
      termine: termineAm(termine, day),
      prioritaeten: prioritaeten.get(day) ?? [],
    }),
    [geburtstage, termine, prioritaeten],
  );
  const marks = useMemo(() => agendaMarks(layout, dayData), [layout, dayData]);
  const dayInfo = (day: Day) => agendaInfo(dayData(day));
  // Darüber die Woche davor, darunter die Woche danach.
  const neighbors = useMemo(() => neighborsOf({ view: 'woche', key: week }), [week]);
  return <PageView layout={layout} path={wochePagePath(week)} {...rest} marks={marks} dayInfo={dayInfo} neighbors={neighbors} />;
}
