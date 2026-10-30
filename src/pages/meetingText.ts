import { serializePage } from '../ink/svg';
import type { Page } from '../ink/types';
import { besprechungLayout } from './layouts';

// Der Text der Datei zu einer Besprechungsseite. Er braucht das Layout der Seite und gehört darum zu den Seiten, nicht zur
// Rechnung in `lib/` (die kennt keine Seiten).

/** Der Text der Datei zu einer Besprechungsseite: mit Kopfdaten und dem Hintergrund, der sie zeigt. */
export function meetingPageText(page: Page): string {
  const layout = besprechungLayout(page.meta);
  return serializePage(page, layout.fields, layout.background());
}
