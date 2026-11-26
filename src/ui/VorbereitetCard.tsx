import '@fontsource/caveat/latin-500.css';
import '@fontsource/caveat/latin-700.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { STALE_NOTICE, tickLine } from '../lib/briefingEdit';
import { dailyNotePath } from '../lib/filenames';
import { splitBase, vorbereitetFuer } from '../lib/vorbereitet';
import { MEETING_LINE, type Rect } from '../pages/layouts';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';
import { cardStyle } from './cardStyle';
import { announceNoteWrite, noteQueue, onNoteWrite } from './noteQueue';
import { retryCues } from './retryCues';
import { FAILED } from './texts';

// Die vorbereiteten Punkte einer Besprechung: Was Claude in der Tagesnotiz unter `## Besprechungen (vorbereitet)`
// für diese Besprechung eingetragen hat, steht hier in einer Handschrift auf den Linien der Seite, in der Farbe des blauen
// Stifts. Die Karte ist durchsichtig und lässt den Stift durch: Geschrieben wird überall wie sonst, nur die Kästchen fangen
// einen Tipp ab und haken die Zeile in der Tagesnotiz ab (wie in der Karte „Morgenbriefing“, gleiche Warteschlange). In die
// Datei der Seite kommt nichts davon, die Abendroutine tippt es also auch nicht ab.
//
// Passt nicht alles auf Seite 1, geht es auf Seite 2 weiter (und so fort): Jede Seite zeigt denselben Text, um so viele Linien
// nach oben geschoben, wie die Seiten davor fassen. Die letzte Linie einer Seite bleibt frei für den Hinweis, dass es weitergeht.

const NOTICE_MS = 8000;

type Props = {
  engine: SyncEngine;
  /** Name der Besprechung ohne Seitennummer, zum Beispiel `2026-10-29 0800 Thema`. */
  base: string;
  /** Die Nummer dieser Seite der Besprechung. */
  seite: number;
  rect: Rect;
};

export function VorbereitetCard({ engine, base, seite, rect }: Props) {
  const day = splitBase(base)?.day ?? null;
  const path = day === null ? null : dailyNotePath(day);
  const locked = engine.readOnly;
  const [text, setText] = useState<string | null>(null);
  const [phase, setPhase] = useState<'laden' | 'bereit' | 'fehler'>('laden');
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  const [fill, setFill] = useState<{ leer: boolean; mehr: boolean }>({ leer: false, mehr: false });
  const gone = useRef(false);
  const list = useRef<HTMLUListElement>(null);

  const reload = () => {
    if (path === null) return Promise.resolve();
    return noteQueue(engine, path)(async () => {
      try {
        const { text: latest, unknown } = await engine.lookup(path);
        if (gone.current) return;
        if (unknown) {
          setPhase((now) => (now === 'bereit' ? now : 'fehler'));
          return;
        }
        setText(latest);
        setPhase('bereit');
      } catch {
        if (!gone.current) setPhase((now) => (now === 'bereit' ? now : 'fehler'));
      }
    });
  };

  useEffect(() => {
    gone.current = false;
    void reload();
    if (path === null) return;
    const stop = engine.addRemoteChangeListener((paths) => {
      if (paths.some((changed) => normalizePath(changed) === path)) void reload();
    });
    const stopWrites = onNoteWrite(engine, (written) => written === path && void reload());
    return () => {
      gone.current = true;
      stop();
      stopWrites();
    };
    // `reload` hängt nur von `engine` und `path` ab.
  }, [engine, path]);

  useEffect(() => {
    if (phase !== 'fehler') return;
    return retryCues(() => void reload());
  }, [phase, engine, path]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const block = useMemo(() => vorbereitetFuer(text, base), [text, base]);

  // Jede Seite fasst alle Linien bis auf die letzte. Gemessen wird am ganzen Text (das Verschieben ändert `offsetTop` nicht):
  // Endet er vor dieser Seite, zeigt sie nichts (unsichtbar, nicht weg: sonst gäbe es nichts mehr zu messen); geht er über sie
  // hinaus, sagt die letzte Linie, dass es weitergeht.
  const room = rect[3] - MEETING_LINE;
  const offset = (seite - 1) * room;
  useLayoutEffect(() => {
    const items = Array.from(list.current?.children ?? []) as HTMLElement[];
    const end = Math.max(0, ...items.map((li) => li.offsetTop + li.offsetHeight));
    setFill({ leer: end <= offset + 1, mehr: end > offset + room + 1 });
  }, [block, rect, offset, room]);

  const onToggle = (line: number, source: string) => {
    if (path === null || locked || phase !== 'bereit') return;
    const optimistic = text === null ? null : tickLine(text, line, source);
    if (optimistic?.ok) setText(optimistic.text);
    void noteQueue(engine, path)(async () => {
      try {
        const { text: latest, unknown } = await engine.lookupFresh(path);
        if (unknown) throw new Error('offline');
        const result = tickLine(latest, line, source);
        if (!result.ok) {
          if (!gone.current) {
            setText(latest);
            setNotice({ text: STALE_NOTICE, alert: false });
          }
          return;
        }
        await engine.write(path, result.text, 'md');
        if (!gone.current) setText(result.text);
        announceNoteWrite(engine, path);
      } catch {
        if (gone.current) return;
        setNotice({ text: FAILED, alert: true });
        try {
          const { text: latest, unknown } = await engine.lookup(path);
          if (!unknown && !gone.current) setText(latest);
        } catch {
          // Was die Karte zeigt, bleibt.
        }
      }
    });
  };

  if (!block || block.zeilen.length === 0) return null;

  return (
    <section class="karte vorbereitet" aria-label="Vorbereitete Punkte" style={{ ...cardStyle(rect), ...(fill.leer ? { visibility: 'hidden' } : {}) }}>
      <div class="zeilen" style={{ height: `${room}px` }}>
      <ul ref={list} style={offset > 0 ? { transform: `translateY(-${offset}px)` } : undefined}>
        {block.zeilen.map((zeile, index) => {
          if (zeile.art === 'aufgabe') {
            return (
              <li key={`${index}:${zeile.line}`} class={zeile.done ? 'aufgabe erledigt' : 'aufgabe'}>
                <button
                  type="button"
                  role="checkbox"
                  class="haken"
                  aria-checked={zeile.done}
                  aria-label={zeile.text}
                  disabled={locked || phase !== 'bereit'}
                  onClick={() => onToggle(zeile.line, zeile.source)}
                >
                  <svg viewBox="0 0 30 30" aria-hidden="true">
                    <path class="kasten" d="M4 5.5 C10 4.2 19 4.6 26 5 C26.4 12 25.8 19 25.6 25.4 C18 26 11 25.6 4.4 25.8 C4 19 4.2 11 4 5.5 Z" />
                    {zeile.done && <path class="strich" d="M7.5 15.5 L13 21.5 L27 3.5" />}
                  </svg>
                </button>
                <span>{zeile.text}</span>
              </li>
            );
          }
          return (
            <li key={`${index}:${zeile.art}`} class={zeile.art}>
              {zeile.art === 'text' && <span class="punkt" aria-hidden="true" />}
              <span>{zeile.text}</span>
            </li>
          );
        })}
      </ul>
      </div>
      {fill.mehr && <p class="mehr">weiter auf Seite {seite + 1}</p>}
      <p class="karten-hinweis" role="status">
        {notice && !notice.alert ? notice.text : ''}
      </p>
      <p class="karten-hinweis fehler" role="alert">
        {notice?.alert ? notice.text : ''}
      </p>
    </section>
  );
}
