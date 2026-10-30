import { useMemo } from 'preact/hooks';
import { monatPagePath } from '../lib/filenames';
import { monatLayout } from '../pages/layouts';
import { PageView, type PageProps } from './PageView';

/** Die Monatsseite: das Raster mit einem Feld je Tag und die Monatsziele. `month` ist zum Beispiel `2026-10`. */
export function MonatPage({ month, ...rest }: PageProps & { month: string }) {
  const layout = useMemo(() => monatLayout(month), [month]);
  return <PageView layout={layout} path={monatPagePath(month)} {...rest} />;
}
