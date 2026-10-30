import { useMemo } from 'preact/hooks';
import type { Day } from '../lib/dates';
import { tagPagePath } from '../lib/filenames';
import { tagLayout } from '../pages/layouts';
import { PageView, type PageProps } from './PageView';

/** Die Tagesseite: Notizen, Prioritäten und Aufgaben des Tages. */
export function TagPage({ day, ...rest }: PageProps & { day: Day }) {
  const layout = useMemo(() => tagLayout(day), [day]);
  return <PageView layout={layout} path={tagPagePath(day)} {...rest} />;
}
