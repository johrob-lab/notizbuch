import { AuthError, OfflineError, RateLimitError, statusOf } from '../sync/github';
import type { Store } from '../sync/store';
import { isValidDay, type Day } from './dates';
import { SETTINGS_KEY, type Settings } from './settings';

// Der Zugang zu GitHub: Token, Repository und das Ablaufdatum des Tokens. Die Einrichtung und „Zugang ändern“ in den
// Einstellungen prüfen und speichern ihn hier. Der Token steht in keinem Text, den dieser Teil liefert, und nirgends außer
// in den Einstellungen in der IndexedDB des Geräts.

/** Die beiden Vaults, zwischen denen das Gerät wählen kann. */
export const REPOS = ['johrob-lab/2-gehirn', 'johrob-lab/2-gehirn-test'] as const;

const NO_TOKEN = 'Bitte den Token eingeben.';
const BAD_CHARACTERS = 'Der Token enthält ungültige Zeichen.';
const NO_EXPIRY = 'Bitte das Ablaufdatum des Tokens eintragen.';
const EXPIRY_IN_PAST = 'Das Ablaufdatum muss in der Zukunft liegen.';
const DENIED = 'Der Zugang klappt nicht. Bitte Token prüfen.';
const NO_CONNECTION = 'Keine Verbindung. Bitte später noch einmal.';
const RATE_LIMITED = 'GitHub nimmt gerade keine weiteren Anfragen an. Bitte später noch einmal.';
const READ_ONLY_TOKEN = 'Der Token darf nicht schreiben. Bitte beim Token „Contents: Read and write“ wählen.';

// ---------- Prüfen, ohne GitHub zu fragen ----------

/** Der eingefügte Token ohne Leerzeichen und Zeilenumbrüche drumherum (auch das geschützte Leerzeichen vom Kopieren). */
export function cleanToken(raw: string): string {
  return raw.trim();
}

/**
 * Warum der Token so nicht gehen kann, oder `null`. Ein Token besteht aus sichtbaren ASCII-Zeichen ohne Leerzeichen. Alles
 * andere (Umlaute, unsichtbare Zeichen aus der Zwischenablage, Zeilenumbruch mittendrin) wäre sonst ein Kopf, den der
 * Browser nicht schicken kann, und die Meldung dazu wäre unverständlich.
 */
export function tokenProblem(raw: string): string | null {
  const token = cleanToken(raw);
  if (token === '') return NO_TOKEN;
  return /^[\x21-\x7e]+$/.test(token) ? null : BAD_CHARACTERS;
}

/** Warum dieses Ablaufdatum nicht geht, oder `null`: Es muss ein Tag im Kalender sein, nach heute. */
export function expiryProblem(value: string, today: Day): string | null {
  if (!isValidDay(value)) return NO_EXPIRY;
  // `YYYY-MM-DD` ordnet sich als Text wie der Kalender.
  return value > today ? null : EXPIRY_IN_PAST;
}

// ---------- GitHub fragen ----------

/**
 * Fragt GitHub, ob der Token ins Repository schreiben darf. Der Text sagt, was nicht stimmt, oder `null`, wenn alles geht.
 * Ein Fehler, den es nicht kennt, wird weitergereicht und nie in Text verwandelt: Er könnte Teile der Anfrage enthalten.
 * Ein Repository, das der Token nicht sehen darf, meldet GitHub als „nicht gefunden“, das gilt als Fehler des Tokens.
 */
export async function accessProblem(client: { checkAccess(): Promise<{ canWrite: boolean }> }): Promise<string | null> {
  try {
    const { canWrite } = await client.checkAccess();
    return canWrite ? null : READ_ONLY_TOKEN;
  } catch (error) {
    if (error instanceof AuthError || statusOf(error) === 404) return DENIED;
    if (error instanceof OfflineError) return NO_CONNECTION;
    if (error instanceof RateLimitError) return RATE_LIMITED;
    throw error;
  }
}

// ---------- Speichern ----------

/** Der Text, wenn noch Änderungen auf ihren Upload warten: Erst müssen sie oben sein, dann kann das Repository wechseln. */
export function waitingText(count: number): string {
  return count === 1 ? 'Erst sichern: Es wartet noch 1 Änderung.' : `Erst sichern: Es warten noch ${count} Änderungen.`;
}

/** Das Repository kann nicht wechseln, solange Änderungen warten: Sie gehörten zum alten und gingen ins neue. */
export class PendingChangesError extends Error {
  constructor(readonly count: number) {
    super(waitingText(count));
    this.name = 'PendingChangesError';
  }
}

/**
 * Speichert den Zugang. Ohne bisherige Einstellungen (die Einrichtung) entstehen sie mit den Vorgaben und dem gewählten
 * Gerät. Sonst bleiben alle anderen Einstellungen, wie sie sind, auch das Gerät. Bleibt das Repository gleich, ändern sich
 * nur Token und Ablaufdatum: Dateien und Warteschlange bleiben, auch wenn Änderungen warten. Wechselt es, wird alles geleert,
 * was zum alten gehört (Dateien, Warteschlange, den Merkzettel der Abfrage), und das in einem Zug mit den Einstellungen.
 * Warten noch Änderungen, geschieht nichts, und `PendingChangesError` sagt, wie viele: Die Prüfung steht in derselben
 * Transaktion wie das Leeren, es kann also keine Änderung des alten Repositorys mehr in das neue gelangen.
 */
export function saveAccess(store: Store, input: { token: string; repo: string; expiry: Day }, device: Settings['device']): Promise<Settings> {
  return store.transact(['settings', 'files', 'outbox', 'meta'], async (tx) => {
    const old = await tx.objectStore('settings').get(SETTINGS_KEY);
    let next: Settings;
    if (!old) {
      next = { token: input.token, repo: input.repo, device, smoothing: 'mittel', prediction: true, tokenExpiry: input.expiry };
    } else {
      next = { ...old, token: input.token, repo: input.repo, tokenExpiry: input.expiry };
      if (old.repo !== input.repo) {
        const waiting = await tx.objectStore('outbox').count();
        if (waiting > 0) throw new PendingChangesError(waiting);
        await Promise.all([tx.objectStore('files').clear(), tx.objectStore('outbox').clear(), tx.objectStore('meta').clear()]);
      }
    }
    await tx.objectStore('settings').put(next, SETTINGS_KEY);
    return next;
  });
}
