import { useMemo } from 'preact/hooks';
import { wochePagePath } from '../lib/filenames';
import { wocheLayout } from '../pages/layouts';
import { PageView, type PageProps } from './PageView';

/** Die Wochenseite: ein Feld je Tag von Montag bis Sonntag und die Wochenziele. `week` ist zum Beispiel `2026-W44`. */
export function WochePage({ week, ...rest }: PageProps & { week: string }) {
  const layout = useMemo(() => wocheLayout(week), [week]);
  return <PageView layout={layout} path={wochePagePath(week)} {...rest} />;
}
