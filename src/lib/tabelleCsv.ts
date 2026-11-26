import type { Page } from '../ink/types';

// Der Knopf „Für Excel herunterladen“ einer Tabellenseite: die Texte, der Name der Datei und der Hinweis, wie aktuell die CSV ist.

/** Es gibt noch keine CSV: Die Abendroutine hat die Tabelle noch nicht abgetippt. */
export const KEINE_CSV = 'Noch nicht abgetippt. Die CSV kommt mit der Abendroutine.';
/** Zum Holen der CSV von GitHub braucht die App Netz. */
export const OHNE_NETZ = 'Zum Herunterladen braucht die App Netz.';

/** Das Teilen ging nicht mehr (der Fingertipp war beim Laden abgelaufen): Die CSV ist da, ein zweiter Tipp teilt sie. */
export const ERNEUT_TIPPEN = 'Die CSV ist geladen. Zum Teilen bitte noch einmal tippen.';

/** Der Name der Datei, die der Knopf ausgibt: die Besprechung plus ` Tabelle.csv`. */
export const csvDateiname = (base: string): string => `${base} Tabelle.csv`;

const VERARBEITET = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * Der Hinweis, wenn die Seite neuere Striche hat als die CSV (`neuester` ist das größte `t` der Seite, `seite` ihre Nummer).
 * Der Zeilenspeicher nennt die Zeit des Laufs (`verarbeitet`) und je Seite den `stand`. `null` ohne neuere Striche und bei
 * fehlendem oder kaputtem Speicher; wirft nie.
 */
export function standHinweis(json: string | null, seite: number | string, neuester: number): string | null {
  if (json === null) return null;
  try {
    const store: unknown = JSON.parse(json);
    if (typeof store !== 'object' || store === null) return null;
    const { verarbeitet, seiten } = store as { verarbeitet?: unknown; seiten?: unknown };
    const time = typeof verarbeitet === 'string' ? VERARBEITET.exec(verarbeitet) : null;
    if (!time) return null;
    const entry = typeof seiten === 'object' && seiten !== null ? (seiten as Record<string, unknown>)[String(seite)] : undefined;
    const stand = typeof entry === 'object' && entry !== null ? (entry as { stand?: unknown }).stand : undefined;
    if (!(neuester > (typeof stand === 'number' ? stand : 0))) return null;
    return `Stand der CSV: ${time[3]}.${time[2]}., ${time[4]}:${time[5]}. Neuere Striche kommen mit der nächsten Abendroutine dazu.`;
  } catch {
    return null;
  }
}

/** Das größte `t` aller Striche der Seite, 0 ohne Striche. */
export const neuesterStrich = (page: Page): number => page.strokes.reduce((latest, stroke) => Math.max(latest, stroke.t), 0);
