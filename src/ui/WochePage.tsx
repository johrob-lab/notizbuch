import { useCallback, useMemo } from 'preact/hooks';
import { weekDays, type Day } from '../lib/dates';
import { wochePagePath } from '../lib/filenames';
import { termineAm } from '../lib/termine';
import { agendaInfo } from '../pages/agenda';
import { agendaMarks, wocheLayout, type AgendaDay } from '../pages/layouts';
import { PageView, type PageProps } from './PageView';
import { usePrioritaeten } from './usePrioritaeten';
import { useTermine } from './useTermine';

/**
 * Die Wochenseite: ein Feld je Tag von Montag bis Sonntag und die Wochenziele. `week` ist zum Beispiel `2026-W44`. In der
 * Kopfzeile jedes Tages stehen seine Termine und Prioritäten, nur auf dem Bildschirm, nie in der Datei.
 */
export function WochePage({ week, ...rest }: PageProps & { week: string }) {
  const layout = useMemo(() => wocheLayout(week), [week]);
  const days = useMemo(() => weekDays(week), [week]);
  const termine = useTermine(rest.engine);
  const prioritaeten = usePrioritaeten(rest.engine, days);
  // Was ein Tag hat: für seine Kopfzeile auf dem Bildschirm und für die Liste der Tage.
  const dayData = useCallback((day: Day): AgendaDay => ({ termine: termineAm(termine, day), prioritaeten: prioritaeten.get(day) ?? [] }), [termine, prioritaeten]);
  const marks = useMemo(() => agendaMarks(layout, dayData), [layout, dayData]);
  const dayInfo = (day: Day) => {
    return agendaInfo(dayData(day));
  };
  return <PageView layout={layout} path={wochePagePath(week)} {...rest} marks={marks} dayInfo={dayInfo} />;
}
