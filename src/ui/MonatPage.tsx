import { useCallback, useMemo } from 'preact/hooks';
import type { Day } from '../lib/dates';
import { monatPagePath } from '../lib/filenames';
import { geburtstageAm } from '../lib/geburtstage';
import { termineAm } from '../lib/termine';
import { agendaInfo, type AgendaDay } from '../pages/agenda';
import { agendaMarks, monatLayout } from '../pages/layouts';
import { neighborsOf } from './neighbors';
import { PageView, type PageProps } from './PageView';
import { useGeburtstage } from './useGeburtstage';
import { useTermine } from './useTermine';

/**
 * Die Monatsseite: das Raster mit einem Feld je Tag und die Monatsziele. `month` ist zum Beispiel `2026-10`. In jedem Tag
 * stehen seine Geburtstage, Jahrestage und Termine (Geburtstage und Jahrestage zuerst), nur auf dem Bildschirm, nie in der
 * Datei. Prioritäten nicht: Dafür müsste jede Monatsseite bis zu 31 Tagesnotizen lesen.
 */
export function MonatPage({ month, ...rest }: PageProps & { month: string }) {
  const layout = useMemo(() => monatLayout(month), [month]);
  const geburtstage = useGeburtstage(rest.engine);
  const termine = useTermine(rest.engine);
  // Was ein Tag hat: für sein Feld auf dem Bildschirm und für die Liste der Tage.
  const dayData = useCallback(
    (day: Day): AgendaDay => ({ geburtstage: geburtstageAm(geburtstage, day), termine: termineAm(termine, day), prioritaeten: [] }),
    [geburtstage, termine],
  );
  const marks = useMemo(() => agendaMarks(layout, dayData), [layout, dayData]);
  const dayInfo = (day: Day) => agendaInfo(dayData(day));
  // Darüber der Monat davor, darunter der Monat danach.
  const neighbors = useMemo(() => neighborsOf({ view: 'monat', key: month }), [month]);
  return <PageView layout={layout} path={monatPagePath(month)} {...rest} marks={marks} dayInfo={dayInfo} neighbors={neighbors} />;
}
