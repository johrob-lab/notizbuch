import { useEffect, useRef, useState } from 'preact/hooks';
import { cleanToken, expiryProblem, REPOS, tokenProblem } from '../lib/access';
import { todayVienna, type Day } from '../lib/dates';
import { defaultExpiry } from '../lib/expiry';
import type { Settings } from '../lib/settings';
import { FAILED } from './texts';

// Das Formular für den Zugang zu GitHub: Token, Repository, Ablaufdatum des Tokens und (nur bei der Einrichtung) das Gerät.
// Es prüft zuerst, was sich ohne GitHub prüfen lässt, und gibt die Eingabe dann weiter. Der Token steht nur in diesem Formular,
// solange es offen ist: Er wird nie vorbelegt und nie angezeigt, und nach dem Speichern ist das Feld leer.

export type AccessValues = {
  /** Ohne Leerzeichen und Zeilenumbrüche drumherum. */
  token: string;
  repo: string;
  device: Settings['device'];
  /** Der letzte Tag, an dem der Token gilt. */
  expiry: Day;
};

type Props = {
  /** Das Repository, das beim Öffnen gewählt ist. Steht es nicht in der Liste, kommt es als erste Wahl dazu: Ein Wechsel geschieht nie aus Versehen. */
  repo: string;
  /** Die Einrichtung fragt auch nach dem Gerät (mit diesem Wert vorgewählt). Die Einstellungen haben dafür eine eigene Wahl. */
  device?: Settings['device'];
  /** Prüft und speichert. Liefert den Text, was nicht geklappt hat, oder `null`. Ein Fehler, den die Funktion wirft, wird zu „Das hat nicht geklappt“. */
  onSubmit(values: AccessValues): Promise<string | null>;
  onCancel?(): void;
};

const DEVICES: Settings['device'][] = ['iPad', 'Firmen-PC'];

export function AccessForm({ repo: initialRepo, device: initialDevice, onSubmit, onCancel }: Props) {
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(initialRepo);
  const [device, setDevice] = useState<Settings['device']>(initialDevice ?? 'iPad');
  // Ein Jahr ab heute: So lange gilt ein Token meistens, wenn man ihn bei GitHub anlegt.
  const [expiry, setExpiry] = useState<string>(() => defaultExpiry(todayVienna()));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const repos: string[] = REPOS.includes(initialRepo as (typeof REPOS)[number]) ? [...REPOS] : [initialRepo, ...REPOS];

  const submit = async (event: Event) => {
    event.preventDefault();
    if (working.current) return; // ein zweiter Tipp, während geprüft wird, tut nichts
    const invalid = tokenProblem(token) ?? expiryProblem(expiry, todayVienna());
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    working.current = true;
    setBusy(true);
    setProblem('');
    try {
      const result = await onSubmit({ token: cleanToken(token), repo, device, expiry });
      if (!mounted.current) return;
      if (result === null) setToken(''); // gespeichert: Der Token bleibt nicht im Feld stehen, auch wenn das Formular noch offen ist
      else setProblem(result);
    } catch {
      // Kein Text aus dem Fehler: Er könnte Teile der Anfrage enthalten.
      if (mounted.current) setProblem(FAILED);
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <form class="zugang-formular" noValidate aria-busy={busy} onSubmit={submit}>
      <div class="feld">
        <label for="zugang-token">Token</label>
        <input
          id="zugang-token"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={token}
          onInput={(e) => setToken(e.currentTarget.value)}
        />
      </div>
      <div class="feld">
        <label for="zugang-repo">Repository</label>
        <select id="zugang-repo" value={repo} onChange={(e) => setRepo(e.currentTarget.value)}>
          {repos.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {initialDevice !== undefined && (
        <div class="feld">
          <label for="zugang-geraet">Gerät</label>
          <select id="zugang-geraet" value={device} onChange={(e) => setDevice(e.currentTarget.value as Settings['device'])}>
            {DEVICES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div class="feld">
        <label for="zugang-bis">Gültig bis</label>
        {/* Manche Auswahlfenster (iPadOS) melden nur `change`, andere beides. */}
        <input
          id="zugang-bis"
          type="date"
          required
          value={expiry}
          onInput={(e) => setExpiry(e.currentTarget.value)}
          onChange={(e) => setExpiry(e.currentTarget.value)}
        />
      </div>
      {/* Auch leer im Baum: Eine Meldung, die erst später erscheint, liest die Sprachausgabe nur dann vor. */}
      <p class="zugang-fehler" role="alert">
        {problem}
      </p>
      <div class="zugang-knoepfe">
        <button type="submit" class="knopf primaer" disabled={busy}>
          Prüfen und speichern
        </button>
        {/* Solange GitHub gefragt wird, lässt sich nichts abbrechen: Die Prüfung läuft weiter, und ein neues Formular daneben wäre ein zweiter Versuch. */}
        {onCancel && (
          <button type="button" class="knopf" disabled={busy} onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <span class="zugang-prueft" aria-live="polite">
          {busy ? 'GitHub wird gefragt …' : ''}
        </span>
      </div>
    </form>
  );
}
