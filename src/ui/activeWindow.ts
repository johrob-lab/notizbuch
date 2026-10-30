// Ein Fenster je Speicher darf schreiben. Zwei Fenster der App, die sich die Datenbank im Browser teilen (zwei Tabs im selben
// Browser), überholen einander, wenn sie dieselbe Seite schreiben: Das eine schreibt auf einen Stand, den das andere schon
// ersetzt hat. Wer zuerst da ist, hält die Sperre `notizbuch-aktiv`, solange sein Fenster offen ist. Jedes weitere Fenster
// mit demselben Speicher liest nur. Die Sperre ist die einzige Abstimmung zwischen den Fenstern, und sie gilt je Speicher: Am
// iPad haben die App auf dem Home-Bildschirm und ein Tab in Safari getrennte Speicher, also auch getrennte Sperren.

/** Der Name der Sperre. Die Engine hat eine eigene (`notizbuch-sync`) für das Hochladen. */
export const ACTIVE_LOCK = 'notizbuch-aktiv';

/** Wie lange ein Fenster wartet, bevor es ein zweites Mal fragt, ob die Sperre frei ist. */
const RETRY_MS = 400;

/** Das, was von `navigator.locks` gebraucht wird. */
export type ActiveLocks = {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => unknown): Promise<unknown>;
};

export type ActiveWindow = {
  /** Dieses Fenster darf schreiben. */
  active: boolean;
  /** Gibt die Sperre frei. Ohne Aufruf hält sie das Fenster, bis es geschlossen wird. Mehrfach rufen schadet nicht. */
  release(): void;
};

type Answer = { granted: boolean; release(): void };

const nothing = (): void => undefined;

/** Fragt einmal, ob die Sperre frei ist, ohne zu warten. Bekommt das Fenster sie, hält es sie bis `release`. */
function ask(locks: ActiveLocks): Promise<Answer> {
  return new Promise<Answer>((resolve) => {
    let answered = false;
    // Wer nicht antwortet, weil der Browser die Frage ablehnt, arbeitet wie vorher: Besser ein Fenster zu viel, das schreibt,
    // als ein Gerät, das nie schreiben darf.
    const failOpen = () => {
      if (!answered) resolve({ granted: true, release: nothing });
      answered = true;
    };
    try {
      let release: () => void = nothing;
      const held = new Promise<void>((done) => (release = done));
      locks
        .request(ACTIVE_LOCK, { ifAvailable: true }, (lock) => {
          answered = true;
          if (lock === null) {
            resolve({ granted: false, release: nothing });
            return undefined;
          }
          resolve({ granted: true, release });
          return held; // die Sperre gilt, bis `release` gerufen wird
        })
        .catch(failOpen);
    } catch {
      failOpen();
    }
  });
}

/**
 * Fragt, ob dieses Fenster das aktive ist. Gefragt wird nur (`ifAvailable`), gewartet wird nicht: Ein zweites Fenster soll
 * nicht hängen, bis das erste schließt, sondern gleich zeigen, dass es nur liest. Ist die Sperre nicht frei, fragt das Fenster
 * nach kurzer Pause ein zweites Mal: Wer die App neu lädt, gibt die Sperre manchmal erst kurz nach dem Start des neuen
 * Fensters frei, und das neue würde sonst zum Fenster, das nur liest. Ohne Web Locks (`locks: null`) ist jedes Fenster aktiv.
 */
export async function acquireActiveWindow(o: { locks?: ActiveLocks | null; retryMs?: number } = {}): Promise<ActiveWindow> {
  const locks = o.locks === undefined ? ((navigator as { locks?: ActiveLocks }).locks ?? null) : o.locks;
  if (locks === null) return { active: true, release: nothing };
  let answer = await ask(locks);
  if (!answer.granted) {
    await new Promise<void>((resolve) => setTimeout(resolve, o.retryMs ?? RETRY_MS));
    answer = await ask(locks);
  }
  return { active: answer.granted, release: answer.release };
}
