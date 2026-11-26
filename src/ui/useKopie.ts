import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Kopie, kopieImSpeicher, setzeKopieImSpeicher, type KopieStand } from '../gehirn/kopie';
import type { CopyClient } from '../sync/github';

// Die Kopie des Vaults für „Frag Claude“ (src/gehirn/kopie.ts), solange das Fenster eingehängt ist: Die Datenbank öffnet beim
// Einhängen und schließt beim Aushängen. Mit einem anderen Repo schließt die alte Kopie, und die des neuen öffnet (gehörte die
// Datenbank zu einem anderen Repo, ist sie danach leer). Aufgefrischt wird nur, wenn das Fenster es verlangt (Öffnen, Fragen), und nur
// bei GitHub.

/** So lange wartet eine Frage höchstens auf das Auffrischen. Danach fragt sie mit dem, was da ist. */
export const KOPIE_WARTEN_MS = 3000;

export type KopieHaken = {
  /** Der Stand fürs Zeichnen, `null`, solange die Kopie nicht offen ist (oder sich die Datenbank nicht öffnen ließ). */
  stand: KopieStand | null;
  /** Die offene Kopie fürs Zeichnen, `null` vorher und ohne Datenbank. */
  kopie: Kopie | null;
  /** Ob gerade aufgefrischt wird. */
  laeuft: boolean;
  /** Die offene Kopie in diesem Augenblick, auch zwischen zwei Mal Zeichnen (für eine Frage, die auf sie gewartet hat). */
  jetzt(): Kopie | null;
  /** Frischt die Kopie bei GitHub auf, sobald sie offen ist. Läuft das schon, wartet es mit. Wirft nie. */
  auffrischen(): Promise<void>;
};

/** `repo` ist das Repo der Einstellungen (`owner/name`): Die Kopie gehört zu genau diesem. */
export function useKopie(client: CopyClient, repo: string): KopieHaken {
  const [kopie, setKopie] = useState<Kopie | null>(null);
  const [stand, setStand] = useState<KopieStand | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const clientNow = useRef(client);
  clientNow.current = client;
  // Die Kopie, die gerade gilt. Nur sie meldet ihren Stand, nach dem Aushängen und nach einem Wechsel des Repos keine alte mehr.
  const offen = useRef<Kopie | null>(null);
  const geoeffnet = useRef<Promise<Kopie | null>>(Promise.resolve(null));
  const lauf = useRef<Promise<KopieStand> | null>(null);

  // Gleich beim Einhängen, noch vor dem ersten Tipp: Wer das Fenster öffnet, findet die Datenbank schon im Öffnen.
  useLayoutEffect(() => {
    let vorbei = false;
    // Beim ersten Einhängen ändert das nichts, nach einem Wechsel des Repos zeigt das Fenster bis zum Öffnen keine Kopie.
    setKopie(null);
    setStand(null);
    setLaeuft(false);
    geoeffnet.current = Kopie.open(repo).then(
      (k) => {
        if (vorbei) {
          k.close();
          return null;
        }
        offen.current = k;
        setzeKopieImSpeicher(k);
        setKopie(k);
        setStand(k.stand());
        return k;
      },
      () => null, // ohne Datenbank gibt es keine Kopie, gefragt wird trotzdem
    );
    return () => {
      vorbei = true;
      const k = offen.current;
      offen.current = null;
      lauf.current = null;
      if (k === null) return;
      if (kopieImSpeicher() === k) setzeKopieImSpeicher(null);
      k.close();
    };
  }, [repo]);

  const jetzt = useCallback(() => offen.current, []);

  const auffrischen = useCallback(async (): Promise<void> => {
    const k = await geoeffnet.current;
    if (k === null || offen.current !== k) return;
    const p = k.auffrischen(clientNow.current, (s) => {
      if (offen.current === k) setStand(s);
    });
    lauf.current = p;
    setLaeuft(true);
    const s = await p.catch(() => k.stand());
    // Nur das Ende des Laufs, der zuletzt begann, beendet `laeuft`, und nur, solange seine Kopie gilt.
    if (offen.current !== k || lauf.current !== p) return;
    lauf.current = null;
    setLaeuft(false);
    setStand(s);
  }, []);

  return { stand, kopie, laeuft, jetzt, auffrischen };
}
