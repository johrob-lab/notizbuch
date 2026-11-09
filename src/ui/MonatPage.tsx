import { useMemo } from 'preact/hooks';
import type { Day } from '../lib/dates';
import { monatPagePath } from '../lib/filenames';
import { termineAm } from '../lib/termine';
import { agendaInfo } from '../pages/agenda';
import { agendaMarks, monatLayout } from '../pages/layouts';
import { PageView, type PageProps } from './PageView';
import { useTermine } from './useTermine';

/**
 * Die Monatsseite: das Raster mit einem Feld je Tag und die Monatsziele. `month` ist zum Beispiel `2026-10`. In jedem Tag
 * stehen seine Termine, nur auf dem Bildschirm, nie in der Datei. Prioritäten nicht: Dafür müsste jede Monatsseite bis zu 31
 * Tagesnotizen lesen.
 */
export function MonatPage({ month, ...rest }: PageProps & { month: string }) {
  const layout = useMemo(() => monatLayout(month), [month]);
  const termine = useTermine(rest.engine);
  const marks = useMemo(() => agendaMarks(layout, (day) => ({ termine: termineAm(termine, day), prioritaeten: [] })), [layout, termine]);
  const dayInfo = (day: Day) => agendaInfo({ termine: termineAm(termine, day), prioritaeten: [] });
  return <PageView layout={layout} path={monatPagePath(month)} {...rest} marks={marks} dayInfo={dayInfo} />;
}
