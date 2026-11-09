import { monatPagePath, tagPagePath, wochePagePath } from '../lib/filenames';
import { monatLayout, tagLayout, wocheLayout, type Layout } from '../pages/layouts';
import { nextRoute, prevRoute, type Route } from './router';

// Die Nachbarn einer Seite beim Weiterscrollen: über einem Tag der Tag davor, darunter der Tag danach, ebenso bei Woche und
// Monat. Die Fläche zeigt sie als Vorschau über und unter der offenen Seite (siehe `src/ink/chain.ts`).

/**
 * Eine Nachbarseite: ihre Adresse, ihr Layout (für den Hintergrund der Vorschau) und der Pfad ihrer Datei, die nur gelesen
 * wird. `marks` ist SVG nur für den Bildschirm wie das `marks` einer Seite (Termine, Geburtstage), es kommt nie in eine Datei.
 */
export type NeighborSpec = { route: Route; layout: Layout; path: string; marks?: string };

function specOf(route: Route & { view: 'tag' | 'woche' | 'monat' }): NeighborSpec {
  if (route.view === 'tag') return { route, layout: tagLayout(route.key), path: tagPagePath(route.key) };
  if (route.view === 'woche') return { route, layout: wocheLayout(route.key), path: wochePagePath(route.key) };
  return { route, layout: monatLayout(route.key), path: monatPagePath(route.key) };
}

/** Die Nachbarn einer Seite, `null` für einen, den es nicht gibt. */
export type Neighbors = { above: NeighborSpec | null; below: NeighborSpec | null };

/**
 * Die Seiten über (`above`) und unter (`below`) einer Seite. Nur Tag, Woche und Monat haben Nachbarn. Am Rand des Kalenders
 * fehlt der Nachbar in diese Richtung (`null`), denn dort bleibt `prevRoute` oder `nextRoute` bei derselben Seite. Ohne `marks`:
 * Das kommt von der Seite, die Termine und Geburtstage gelesen hat (`withMarks`).
 */
export function neighborsOf(route: Route): Neighbors {
  const { view } = route;
  if (view !== 'tag' && view !== 'woche' && view !== 'monat') return { above: null, below: null };
  const side = (next: Route) => (next.key === route.key ? null : specOf({ view, key: next.key }));
  return { above: side(prevRoute(route)), below: side(nextRoute(route)) };
}

/** Die Nachbarn `n`, jeder mit dem `marks`, das `marksOf` aus seinem Layout macht. Ein fehlender bleibt weg. */
export function withMarks(n: Neighbors, marksOf: (layout: Layout) => string): Neighbors {
  const marked = (spec: NeighborSpec | null): NeighborSpec | null => spec && { ...spec, marks: marksOf(spec.layout) };
  return { above: marked(n.above), below: marked(n.below) };
}
