import { useEffect, useRef, useState } from 'preact/hooks';
import { ohneQuellenZeile } from '../gehirn/quellen';
import { answerItems } from '../ki/answerItems';
import { addItemsToNote } from '../lib/briefingEdit';
import { timeVienna } from '../lib/dates';
import { dailyNotePath } from '../lib/filenames';
import type { SyncEngine } from '../sync/engine';
import type { Turn } from './askRound';
import { announceNoteWrite, noteQueue } from './noteQueue';

// Was die Knöpfe unter einer Antwort tun: „Kopieren“ legt die Antwort in die Zwischenablage, „In Ergänzungen übernehmen“ hängt Frage
// und Antwort an die Tagesnotiz der Antwort. Nur dieser Tipp ändert eine Notiz. Der Vorgang läuft in der Warteschlange der Notiz
// (`noteQueue`), dieselbe wie bei der Karte „Morgenbriefing“: So überschreibt keiner den anderen.

/** Stand des Übernehmens einer Runde. Ein Tipp wirkt nur bei `nein` und `fehler`. */
export type TakeState = 'nein' | 'laeuft' | 'fertig' | 'fehler';
/** Stand des Kopierens einer Runde: `kopiert` und `fehler` bleiben 2 Sekunden stehen. */
export type CopyState = 'nein' | 'kopiert' | 'fehler';

/** So lange zeigt „Kopieren“ das Ergebnis. */
export const COPY_MS = 2000;

/** Hängt Frage, Antwort und (mit `quellen`, der Zeile aus `quellenZeile`) die Quellen der Runde an „Ergänzungen“ ihrer Tagesnotiz. Wirft, wenn etwas nicht klappt (auch ohne Netz). */
export async function takeOver(engine: SyncEngine, turn: Turn, quellen?: string): Promise<void> {
  const path = dailyNotePath(turn.noteDay);
  await noteQueue(engine, path)(async () => {
    const { text, unknown } = await engine.lookupFresh(path);
    // Ob es die Notiz gibt, ist offen (kein Netz): Nichts schreiben, sonst entstünde neben ihr eine zweite.
    if (unknown) throw new Error('offline');
    const next = addItemsToNote(text, turn.noteDay, answerItems(turn.question, turn.answer, timeVienna(turn.at), quellen));
    if (next !== null) await engine.write(path, next, 'md');
  });
  announceNoteWrite(engine, path);
}

/** Die Stände der Knöpfe aller Runden und was sie auslöst. Beim Abbau des Fensters laufen keine Uhren weiter. */
export function useRoundActions(engine: SyncEngine) {
  const [taking, setTaking] = useState<Record<number, TakeState>>({});
  const [copying, setCopying] = useState<Record<number, CopyState>>({});
  // Der Stand auch außerhalb des Zeichnens: Zwei schnelle Tipps sehen beide den Stand des ersten.
  const takeNow = useRef(taking);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  const setTake = (id: number, state: TakeState) => {
    takeNow.current = { ...takeNow.current, [id]: state };
    if (!gone.current) setTaking(takeNow.current);
  };

  const take = async (turn: Turn, quellen?: string): Promise<void> => {
    const now = takeNow.current[turn.id] ?? 'nein';
    if (now !== 'nein' && now !== 'fehler') return;
    setTake(turn.id, 'laeuft');
    try {
      await takeOver(engine, turn, quellen);
      setTake(turn.id, 'fertig');
    } catch {
      setTake(turn.id, 'fehler');
    }
  };

  const copy = async (turn: Turn): Promise<void> => {
    let result: CopyState = 'kopiert';
    try {
      await navigator.clipboard.writeText(ohneQuellenZeile(turn.answer));
    } catch {
      result = 'fehler';
    }
    if (gone.current) return;
    setCopying((all) => ({ ...all, [turn.id]: result }));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (!gone.current) setCopying((all) => ({ ...all, [turn.id]: 'nein' }));
    }, COPY_MS);
    timers.current.add(timer);
  };

  return { taking, copying, take, copy };
}
