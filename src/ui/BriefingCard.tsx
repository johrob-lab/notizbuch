import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addToNote, editLine, findLine, STALE_NOTICE, tickLine } from '../lib/briefingEdit';
import { parseSections, visibleText } from '../lib/dailyNote';
import type { Day } from '../lib/dates';
import { dailyNotePath } from '../lib/filenames';
import { renderNote } from '../lib/markdown';
import type { Rect } from '../pages/layouts';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';
import { cardStyle } from './cardStyle';
import { noteToVNodes, type NoteContext } from './noteView';
import { serialQueue } from './serialQueue';

// Die Karte „Morgenbriefing“ der Tagesseite: die Tagesnotiz (`05 Daily Notes/<Tag>.md`) zum Lesen, Abhaken, Bearbeiten und
// Ergänzen. Was die Karte schreibt, geht immer vom neuesten Text der Notiz aus, trifft nur die Zeile, die man angetippt hat,
// und lässt alles andere unberührt, auch die Marker `%%…%%`. Geschrieben wird erst, wenn die Notiz einmal gelesen ist.

const NO_NOTE = 'Noch kein Briefing für diesen Tag';
const UNREADABLE = 'Das Briefing lässt sich nicht lesen und wird nicht verändert.';
const FAILED = 'Das hat nicht geklappt. Bitte noch einmal versuchen.';
const ERGAENZUNGEN = 'Ergänzungen';
/** Diese Abschnitte sind offen, wenn man die Seite öffnet. Alle anderen sind zugeklappt, ein Tipp auf die Überschrift klappt sie auf. */
const OPEN_AT_START = new Set(['Morgenbriefing (automatisch)', ERGAENZUNGEN]);
/** So lange bleibt ein Hinweis stehen, wenn ihn niemand wegtippt. */
const NOTICE_MS = 8000;

type Notice = { text: string; alert: boolean };
type Editing = { line: number; source: string; draft: string };

type State = {
  /** Die Notiz ist einmal gelesen. Vorher wird nichts geschrieben: Sonst entstünde neben einer Notiz, die man noch nicht sieht, eine zweite. */
  loaded: boolean;
  /** Der Text der Notiz, wie die Karte ihn zeigt. `null`: Für den Tag gibt es keine Notiz. */
  text: string | null;
  /** Die Notiz gibt es, aber sie lässt sich nicht lesen (zum Beispiel kein Text): Sie wird nicht angefasst, auch nicht ersetzt. */
  unreadable: boolean;
  notice: Notice | null;
  editing: Editing | null;
  /** Ein Vorgang läuft: Ein Tipp auf ein Kästchen oder einen Stift tut nichts, und der Knopf zum Ergänzen ist gesperrt. */
  busy: boolean;
  /** Abschnitte, die jemand auf- oder zugeklappt hat, nach Überschrift. Was fehlt, gilt nach `OPEN_AT_START`. */
  open: Record<string, boolean>;
  /** Das Feld zum Ergänzen und der Schalter „Aufgabe“. */
  add: string;
  asTask: boolean;
};

const START: State = { loaded: false, text: null, unreadable: false, notice: null, editing: null, busy: false, open: {}, add: '', asTask: true };

/** Der Text ist neu (gelesen oder geschrieben): Eine offene Bearbeitung bleibt an ihrer Zeile, auch wenn die verrutscht ist. */
function shown(state: State, latest: string | null): Partial<State> {
  const editing = state.editing;
  if (!editing) return { text: latest };
  const at = findLine(latest, editing.source, editing.line);
  // Die Zeile gibt es nicht mehr oder sie ist eine andere: Geschrieben würde sie nie, also auch nicht offen halten.
  if (at === null) return { text: latest, editing: null, notice: { text: STALE_NOTICE, alert: false } };
  return { text: latest, editing: { ...editing, line: at } };
}

type Props = {
  engine: SyncEngine;
  day: Day;
  rect: Rect;
};

export function BriefingCard({ engine, day, rect }: Props) {
  const path = dailyNotePath(day);
  const [state, setState] = useState<State>(START);
  // Der Zustand auch außerhalb des Zeichnens: Ein Vorgang, der auf die Platte wartet, liest und ändert ihn danach.
  const current = useRef(state);
  const queue = useRef(serialQueue());
  const gone = useRef(false);
  const root = useRef<HTMLElement>(null);
  // Die Zeile, deren Bearbeitung zu Ende ist: Ihr Stift bekommt den Fokus zurück (das Feld, in dem er war, ist weg).
  const refocus = useRef<number | null>(null);

  const update = (patch: Partial<State> | ((now: State) => Partial<State>)) => {
    const next = { ...current.current, ...(typeof patch === 'function' ? patch(current.current) : patch) };
    current.current = next;
    if (!gone.current) setState(next);
  };

  /** Liest die Notiz neu und zeigt sie. Läuft nach allem, was schon wartet, damit es nie einen neueren Stand überholt. */
  const reload = () =>
    queue.current(async () => {
      try {
        const latest = await engine.read(path);
        update((now) => ({ ...shown(now, latest), loaded: true, unreadable: false }));
      } catch {
        // Ein Text, der sich nicht lesen lässt (zum Beispiel kein UTF-8): Die Karte zeigt nichts davon und schreibt nichts.
        update({ loaded: true, unreadable: true, text: null, editing: null });
      }
    });

  useEffect(() => {
    gone.current = false;
    void reload();
    // Ein anderes Gerät hat die Notiz geändert: neu lesen, ohne die Bearbeitung zu verlieren.
    const stop = engine.addRemoteChangeListener((paths) => {
      if (paths.some((changed) => normalizePath(changed) === path)) void reload();
    });
    return () => {
      gone.current = true;
      stop();
    };
    // `reload` hängt nur von `engine` und `path` ab.
  }, [engine, path]);

  // Wer mit der Tastatur bearbeitet hat (Enter, Escape), bleibt bei der Zeile, statt dass der Fokus ins Leere fällt.
  useEffect(() => {
    if (state.editing !== null || refocus.current === null) return;
    const line = refocus.current;
    refocus.current = null;
    root.current?.querySelector<HTMLElement>(`li[data-line="${line}"] > .stift`)?.focus({ preventScroll: true });
  }, [state.editing]);

  // Ein Hinweis verschwindet von selbst.
  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(() => update({ notice: null }), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice]);

  /**
   * Ein Vorgang an der Notiz. Er läuft in der Warteschlange und liest zuerst den neuesten Text. `change` bekommt ihn und liefert
   * den neuen Text, `'stale'` (die Zeile gibt es so nicht mehr: nichts schreiben, den neuen Stand zeigen und es sagen) oder
   * `null` (nichts zu tun). `after` sagt, was nach dem Schreiben sonst noch anders ist. Scheitert etwas, steht danach wieder
   * da, was wirklich in der Notiz ist.
   */
  const act = (change: (latest: string | null) => { text: string } | 'stale' | null, after: () => Partial<State> = () => ({})) => {
    update({ busy: true, notice: null });
    void queue.current(async () => {
      try {
        const latest = await engine.read(path);
        const result = change(latest);
        if (result === 'stale') {
          update((now) => ({ ...shown(now, latest), notice: { text: STALE_NOTICE, alert: false } }));
        } else if (result !== null) {
          await engine.write(path, result.text, 'md');
          // Zuerst das, was sich sonst ändert (eine Bearbeitung ist danach zu Ende), dann der neue Text für das, was offen bleibt.
          update((now) => {
            const patch = after();
            return { ...patch, ...shown({ ...now, ...patch }, result.text) };
          });
        } else {
          update((now) => shown(now, latest));
        }
      } catch {
        // Unklar, was geschrieben ist: neu lesen und zeigen, was wirklich da ist.
        try {
          const latest = await engine.read(path);
          update((now) => ({ ...shown(now, latest), notice: { text: FAILED, alert: true } }));
        } catch {
          update({ notice: { text: FAILED, alert: true } });
        }
      } finally {
        update({ busy: false });
      }
    });
  };

  const locked = state.busy || !state.loaded;

  const onToggle = (line: number, source: string) => {
    const now = current.current;
    if (now.busy || !now.loaded) {
      update({}); // das Kästchen hat sich unter dem Finger gedreht: neu zeichnen, damit es wieder zeigt, was in der Notiz steht
      return;
    }
    // Das Kästchen zeigt den neuen Stand sofort. Ob er stimmt, entscheidet der neueste Text (siehe `act`).
    const optimistic = now.text === null ? null : tickLine(now.text, line, source);
    if (optimistic?.ok) update({ text: optimistic.text });
    act((latest) => {
      const result = tickLine(latest, line, source);
      return result.ok ? { text: result.text } : 'stale';
    });
  };

  const onEdit = (line: number, source: string) => {
    const now = current.current;
    if (now.busy || !now.loaded || now.editing) return;
    update({ editing: { line, source, draft: visibleText(source) }, notice: null });
  };

  const onDraft = (draft: string) => update((now) => (now.editing ? { editing: { ...now.editing, draft } } : {}));

  const onCancel = () => {
    refocus.current = current.current.editing?.line ?? null;
    update({ editing: null });
  };

  const onSave = () => {
    const now = current.current;
    const editing = now.editing;
    if (!editing || now.busy || !now.loaded) return;
    // Ohne sichtbaren Text bliebe von der Zeile nichts: Gelöscht wird hier nie, das Feld bleibt offen.
    if (editing.draft.replace(/%%/g, '').trim() === '') return;
    // Unverändert: Es gibt nichts zu schreiben, und die Zeile bliebe nicht einmal Byte für Byte gleich (Marker wandern ans Ende).
    if (editing.draft.trim() === visibleText(editing.source)) {
      refocus.current = editing.line;
      update({ editing: null });
      return;
    }
    refocus.current = editing.line;
    act(
      (latest) => {
        const result = editLine(latest, editing.line, editing.source, editing.draft);
        return result.ok ? { text: result.text } : 'stale';
      },
      () => ({ editing: null }),
    );
  };

  const onAdd = () => {
    const now = current.current;
    if (now.busy || !now.loaded || now.unreadable) return;
    const wanted = now.add;
    const asTask = now.asTask;
    // Ohne sichtbaren Text gibt es nichts zu ergänzen, und es entsteht auch keine Notiz.
    if (wanted.replace(/%%/g, '').trim() === '') return;
    act(
      (latest) => {
        const next = addToNote(latest, day, wanted, asTask);
        return next === null ? null : { text: next };
      },
      // Das Feld ist leer, wenn nichts Neues hineingetippt wurde, und der Eintrag soll zu sehen sein, auch in einem zugeklappten Abschnitt.
      () => ({ add: current.current.add === wanted ? '' : current.current.add, open: { ...current.current.open, [ERGAENZUNGEN]: true } }),
    );
  };

  const toggleSection = (heading: string) =>
    update((now) => ({ open: { ...now.open, [heading]: !(now.open[heading] ?? OPEN_AT_START.has(heading)) } }));

  const lines = useMemo(() => state.text?.split('\n') ?? [], [state.text]);
  // Jeder Abschnitt der Notiz als Überschrift, die man antippt, und sein Inhalt, solange er offen ist.
  const sections = useMemo(() => (state.text === null ? [] : parseSections(state.text)), [state.text]);
  const html = useMemo(() => {
    if (state.text === null) return { intro: '', parts: [] as string[] };
    const text = state.text;
    const first = sections[0]?.start ?? lines.length;
    // Vor dem ersten Abschnitt steht der Titel mit dem Tag: Den zeigt die Seite schon. Nur anderer Inhalt dort erscheint.
    const intro = renderNote(text, { start: 0, end: first }).replace(/<h1>.*?<\/h1>/g, '');
    const parts = sections.map((section) => {
      const isOpen = state.open[section.heading] ?? OPEN_AT_START.has(section.heading);
      return isOpen ? renderNote(text, { start: section.start + 1, end: section.end }) : '';
    });
    return { intro: intro.trim() === '' ? '' : intro, parts };
  }, [state.text, state.open, sections, lines.length]);

  const context: NoteContext = {
    lines,
    editing: state.editing && { line: state.editing.line, draft: state.editing.draft },
    busy: locked,
    onToggle,
    onEdit,
    onDraft,
    onSave,
    onCancel,
  };

  const empty = state.loaded && state.text === null && !state.unreadable;
  const nothing = state.text !== null && html.intro === '' && sections.length === 0;

  return (
    <section ref={root} class="karte briefing" aria-label="Morgenbriefing" aria-busy={locked} style={cardStyle(rect)}>
      <div class="karten-inhalt">
        {!state.loaded && <p class="leer">Briefing wird geladen</p>}
        {empty && <p class="leer">{NO_NOTE}</p>}
        {state.unreadable && <p class="leer">{UNREADABLE}</p>}
        {nothing && <p class="leer">Noch keine Einträge</p>}
        {html.intro !== '' && <div class="vorspann">{noteToVNodes(html.intro, context)}</div>}
        {sections.map((section, index) => {
          const isOpen = state.open[section.heading] ?? OPEN_AT_START.has(section.heading);
          return (
            <Fragment key={`${section.heading}#${sections.slice(0, index).filter((other) => other.heading === section.heading).length}`}>
              <h4 class="abschnitt">
                <button type="button" aria-expanded={isOpen} onClick={() => toggleSection(section.heading)}>
                  <span class="abschnitt-pfeil" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span>{section.heading}</span>
                </button>
              </h4>
              {isOpen && <div class="abschnitt-inhalt">{noteToVNodes(html.parts[index], context)}</div>}
            </Fragment>
          );
        })}
      </div>
      {state.notice && (
        <p class={`karten-hinweis${state.notice.alert ? ' fehler' : ''}`} role={state.notice.alert ? 'alert' : 'status'}>
          {state.notice.text}
        </p>
      )}
      <form
        class="ergaenzen"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
      >
        <input
          type="text"
          aria-label="Ergänzung"
          placeholder="Ergänzen"
          value={state.add}
          autoComplete="off"
          enterKeyHint="done"
          onInput={(e) => update({ add: e.currentTarget.value })}
        />
        <label class="schalter">
          <input type="checkbox" role="switch" checked={state.asTask} onChange={(e) => update({ asTask: e.currentTarget.checked })} />
          <span>Aufgabe</span>
        </label>
        <button type="submit" class="knopf" disabled={locked || state.unreadable}>
          Hinzufügen
        </button>
      </form>
    </section>
  );
}
