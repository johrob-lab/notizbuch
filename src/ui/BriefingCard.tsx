import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addToNote, editLine, relocate, STALE_NOTICE, tickLine } from '../lib/briefingEdit';
import { parseSections, visibleText } from '../lib/dailyNote';
import type { Day } from '../lib/dates';
import { dailyNotePath } from '../lib/filenames';
import { renderNote } from '../lib/markdown';
import type { Rect } from '../pages/layouts';
import { isNotUtf8 } from '../sync/base64';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';
import { AddForm } from './AddForm';
import { cardStyle } from './cardStyle';
import { noteToVNodes, type NoteContext } from './noteView';
import { retryCues } from './retryCues';
import { serialQueue } from './serialQueue';
import { FAILED } from './texts';

// Die Karte „Morgenbriefing“ der Tagesseite: die Tagesnotiz (`05 Daily Notes/<Tag>.md`) zum Lesen, Abhaken, Bearbeiten und
// Ergänzen. Was die Karte schreibt, geht immer vom neuesten Text der Notiz aus, trifft nur die Zeile, die man angetippt hat,
// und lässt alles andere unberührt, auch die Marker `%%…%%`. Geschrieben wird erst, wenn die Notiz einmal gelesen ist.
//
// Jeder Tipp zählt: Was während eines Vorgangs angetippt wird, reiht sich hinter ihn ein (`serialQueue`) und geht vom Ergebnis
// des vorigen aus. Ein Haken zeigt sich sofort, ob er stimmt, entscheidet der neueste Text. Ändert sich die Zeile, die man gerade
// bearbeitet, woanders, bleibt das Feld mit dem Getippten offen (die Zeile wird an ihrer Kennung wiedergefunden). Nur wenn es
// die Zeile nicht mehr gibt, bleibt der Text sichtbar zum Kopieren stehen.

const NO_NOTE = 'Noch kein Briefing für diesen Tag';
const LOADING = 'Briefing wird geladen';
const OFFLINE = 'Briefing offline nicht verfügbar';
const NOT_LOADED = 'Das Briefing konnte nicht geladen werden. Neuer Versuch, sobald das Netz da ist.';
const UNREADABLE = 'Das Briefing lässt sich nicht lesen und wird nicht verändert.';
const GONE = 'Die Zeile gibt es so nicht mehr. Dein Text steht unten zum Kopieren.';
const ERGAENZUNGEN = 'Ergänzungen';
/** Diese Abschnitte sind offen, wenn man die Seite öffnet. Alle anderen sind zugeklappt, ein Tipp auf die Überschrift klappt sie auf. */
const OPEN_AT_START = new Set(['Morgenbriefing (automatisch)', ERGAENZUNGEN]);
/** So lange bleibt ein Hinweis stehen, wenn ihn niemand wegtippt. */
const NOTICE_MS = 8000;

/**
 * `laden`: noch nicht gelesen. `bereit`: gelesen, die Notiz oder ihr Fehlen steht fest. `offline`: es gibt keine Kopie, und
 * GitHub ließ sich nicht fragen: Ob es die Notiz gibt, ist offen. `nichtGeladen`: das Lesen ist gescheitert (zum Beispiel ein
 * Serverfehler). `unlesbar`: die Notiz gibt es, aber sie lässt sich nicht lesen (kein UTF-8). In allen anderen Phasen als `bereit`
 * wird nichts geschrieben: Sonst entstünde neben einer Notiz, die man noch nicht sieht, eine zweite oder eine überschriebene.
 */
type Phase = 'laden' | 'bereit' | 'offline' | 'nichtGeladen' | 'unlesbar';
type Notice = { text: string; alert: boolean };
/** `source` ist die Zeile, wie die Bearbeitung sie kennt (damit nur genau diese Zeile geändert wird), `saving` das laufende Speichern. */
type Editing = { line: number; source: string; saving: boolean };

type State = {
  phase: Phase;
  /** Der Text der Notiz, wie die Karte ihn zeigt. `null`: Für den Tag gibt es keine Notiz (oder noch keine gelesen). */
  text: string | null;
  notice: Notice | null;
  editing: Editing | null;
  /** Der Text einer Bearbeitung, deren Zeile es nicht mehr gibt. Er bleibt zum Kopieren stehen, bis jemand ihn schließt. */
  rescued: string | null;
  /** Die Zeile, deren Stift den Fokus bekommt, sobald die Bearbeitung zu Ende ist (wer mit der Tastatur arbeitet, bleibt dort). */
  focus: number | null;
  /** Wie viele Vorgänge laufen oder warten. */
  pending: number;
  /** Abschnitte, die jemand auf- oder zugeklappt hat, nach Überschrift. Was fehlt, gilt nach `OPEN_AT_START`. */
  open: Record<string, boolean>;
};

const START: State = { phase: 'laden', text: null, notice: null, editing: null, rescued: null, focus: null, pending: 0, open: {} };

/**
 * Der Text ist neu (gelesen oder geschrieben): Eine offene Bearbeitung bleibt an ihrer Zeile, auch wenn die verrutscht ist.
 * Hat sich die Zeile geändert, gilt sie ab jetzt in ihrer neuen Fassung, und das Getippte bleibt im Feld (ein Hinweis sagt es).
 * Gibt es die Zeile nicht mehr, ist die Bearbeitung zu Ende, und was getippt war, bleibt zum Kopieren stehen.
 */
function shown(state: State, latest: string | null, draft: string): Partial<State> {
  const editing = state.editing;
  if (!editing) return { text: latest };
  const found = relocate(latest, editing.source, editing.line);
  if (found === null) {
    const typed = draft.trim() !== '' && draft.trim() !== visibleText(editing.source);
    return typed
      ? { text: latest, editing: null, focus: null, rescued: draft, notice: { text: GONE, alert: false } }
      : { text: latest, editing: null, focus: null, notice: { text: STALE_NOTICE, alert: false } };
  }
  if (found.source !== editing.source) {
    return { text: latest, editing: { ...editing, line: found.line, source: found.source }, notice: { text: STALE_NOTICE, alert: false } };
  }
  return { text: latest, editing: { ...editing, line: found.line } };
}

/** Was ein Vorgang an der Notiz tut: den neuen Text, `'stale'` (die Zeile gibt es so nicht mehr) oder `null` (nichts zu tun). */
type Change = (latest: string | null) => { text: string } | 'stale' | null;
type Outcome = 'written' | 'nothing' | 'stale' | 'failed';

type Props = {
  engine: SyncEngine;
  day: Day;
  rect: Rect;
};

export function BriefingCard({ engine, day, rect }: Props) {
  const path = dailyNotePath(day);
  // Das zweite Fenster eines Geräts liest die Notiz nur: Kästchen gesperrt, keine Stifte, kein Feld zum Ergänzen.
  const locked = engine.readOnly;
  const [state, setState] = useState<State>(START);
  // Der Zustand auch außerhalb des Zeichnens: Ein Vorgang, der auf die Platte wartet, liest und ändert ihn danach.
  const current = useRef(state);
  const queue = useRef(serialQueue());
  const gone = useRef(false);
  const root = useRef<HTMLElement>(null);
  /** Was im Eingabefeld der Bearbeitung steht. Das Feld hält es selbst, die Karte erfährt es hier, ohne neu zu zeichnen. */
  const draft = useRef('');

  const update = (patch: Partial<State> | ((now: State) => Partial<State>)) => {
    const next = { ...current.current, ...(typeof patch === 'function' ? patch(current.current) : patch) };
    current.current = next;
    if (!gone.current) setState(next);
  };

  /** Liest die Notiz neu und zeigt sie. Läuft nach allem, was schon wartet, damit es nie einen neueren Stand überholt. */
  const reload = () =>
    queue.current(async () => {
      try {
        const { text, unknown } = await engine.lookup(path);
        update((now) => {
          // Ob es die Notiz gibt, ist offen: Was die Karte schon zeigt, bleibt.
          if (unknown) return now.phase === 'bereit' ? {} : { phase: 'offline', text: null, editing: null };
          return { ...shown(now, text, draft.current), phase: 'bereit' };
        });
      } catch (error) {
        update((now) => {
          // Ein Text, der sich nicht lesen lässt (kein UTF-8), bleibt kaputt: Die Karte zeigt nichts davon und schreibt nichts.
          if (isNotUtf8(error)) return { phase: 'unlesbar', text: null, editing: null };
          // Jeder andere Fehler (zum Beispiel ein Serverfehler) kann beim nächsten Mal gelingen. Was schon da ist, bleibt.
          return now.phase === 'bereit' ? {} : { phase: 'nichtGeladen' };
        });
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

  // Konnte die Notiz nicht gelesen werden, wird es wieder versucht, sobald es Sinn hat: Das Netz ist zurück, die App kommt in
  // den Vordergrund, oder es sind drei Minuten vergangen. Eine kaputte Notiz wird nicht neu versucht, bis ein anderes Gerät sie ändert.
  useEffect(() => {
    if (state.phase !== 'offline' && state.phase !== 'nichtGeladen') return;
    return retryCues(() => void reload());
  }, [state.phase, engine, path]);

  // Wer mit der Tastatur bearbeitet hat (Enter, Escape), bleibt bei der Zeile, statt dass der Fokus ins Leere fällt.
  useEffect(() => {
    if (state.editing !== null || state.focus === null) return;
    const line = state.focus;
    update({ focus: null });
    root.current?.querySelector<HTMLElement>(`li[data-line="${line}"] > .stift`)?.focus({ preventScroll: true });
  }, [state.editing, state.focus]);

  // Ein Hinweis verschwindet von selbst.
  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(() => update({ notice: null }), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice]);

  /**
   * Ein Vorgang an der Notiz. Er läuft in der Warteschlange und liest zuerst den neuesten Text. `change` bekommt ihn und liefert
   * den neuen Text, `'stale'` (die Zeile gibt es so nicht mehr: nichts schreiben, den neuen Stand zeigen und es sagen) oder
   * `null` (nichts zu tun). `after` sagt, was nach dem Schreiben sonst noch anders ist. `saves`: Der Vorgang speichert die
   * offene Bearbeitung. Scheitert etwas, steht danach wieder da, was wirklich in der Notiz ist.
   */
  const act = (change: Change, o: { after?: () => Partial<State>; saves?: boolean } = {}): Promise<Outcome> => {
    update((now) => ({ pending: now.pending + 1, notice: null }));
    return queue.current(async (): Promise<Outcome> => {
      try {
        const { text: latest, unknown } = await engine.lookup(path);
        if (unknown) {
          // Ob es die Notiz gibt, ist offen (kein Netz): Nichts schreiben, sonst entstünde neben ihr eine zweite.
          update({ notice: { text: OFFLINE, alert: false } });
          return 'failed';
        }
        const result = change(latest);
        if (result === 'stale') {
          update((now) => {
            const patch = shown(now, latest, draft.current);
            return { ...patch, notice: patch.notice ?? { text: STALE_NOTICE, alert: false } };
          });
          return 'stale';
        }
        if (result === null) {
          update((now) => shown(now, latest, draft.current));
          return 'nothing';
        }
        await engine.write(path, result.text, 'md');
        update((now) => {
          const patch = o.after?.() ?? {};
          // Wartet noch ein Vorgang hinter diesem, zeigt die Karte schon dessen Haken: Den Stand dieses Vorgangs zu zeigen ließe
          // ihn kurz zurückspringen. Der letzte Vorgang zeigt den Stand der Notiz.
          return now.pending > 1 ? patch : { ...patch, ...shown({ ...now, ...patch }, result.text, draft.current) };
        });
        return 'written';
      } catch {
        // Unklar, was geschrieben ist: neu lesen und zeigen, was wirklich da ist.
        try {
          const { text: latest, unknown } = await engine.lookup(path);
          update((now) => ({ ...(unknown ? {} : shown(now, latest, draft.current)), notice: { text: FAILED, alert: true } }));
        } catch {
          update({ notice: { text: FAILED, alert: true } });
        }
        return 'failed';
      } finally {
        update((now) => ({
          pending: now.pending - 1,
          ...(o.saves && now.editing?.saving ? { editing: { ...now.editing, saving: false } } : {}),
        }));
      }
    });
  };

  const ready = state.phase === 'bereit';

  const onToggle = (line: number, source: string) => {
    const now = current.current;
    if (now.phase !== 'bereit' || locked) {
      update({}); // das Kästchen hat sich unter dem Finger gedreht: neu zeichnen, damit es wieder zeigt, was in der Notiz steht
      return;
    }
    // Das Kästchen zeigt den neuen Stand sofort. Ob er stimmt, entscheidet der neueste Text (siehe `act`).
    const optimistic = now.text === null ? null : tickLine(now.text, line, source);
    if (optimistic?.ok) update({ text: optimistic.text });
    void act((latest) => {
      const result = tickLine(latest, line, source);
      return result.ok ? { text: result.text } : 'stale';
    });
  };

  const onEdit = (line: number, source: string) => {
    const now = current.current;
    if (locked || now.phase !== 'bereit' || now.editing) return;
    draft.current = visibleText(source);
    update({ editing: { line, source, saving: false }, notice: null });
  };

  const onDraft = (text: string) => {
    draft.current = text;
  };

  const onCancel = () => update((now) => ({ editing: null, focus: now.editing?.line ?? null }));

  const onSave = (text: string) => {
    const now = current.current;
    const editing = now.editing;
    if (locked || !editing || editing.saving || now.phase !== 'bereit') return;
    // Ohne sichtbaren Text bliebe von der Zeile nichts: Gelöscht wird hier nie, das Feld bleibt offen.
    if (text.replace(/%%/g, '').trim() === '') return;
    // Unverändert: Es gibt nichts zu schreiben, und die Zeile bliebe nicht einmal Byte für Byte gleich (Marker wandern ans Ende).
    if (text.trim() === visibleText(editing.source)) {
      update({ editing: null, focus: editing.line });
      return;
    }
    update({ editing: { ...editing, saving: true }, focus: editing.line });
    void act(
      (latest) => {
        const result = editLine(latest, editing.line, editing.source, text);
        return result.ok ? { text: result.text } : 'stale';
      },
      { after: () => ({ editing: null }), saves: true },
    );
  };

  /** Ergänzt die Notiz. `true`, wenn der Eintrag in der Notiz steht. */
  const onAdd = async (wanted: string, asTask: boolean): Promise<boolean> => {
    const now = current.current;
    if (locked || now.phase !== 'bereit' || now.pending > 0) return false;
    // Ohne sichtbaren Text gibt es nichts zu ergänzen, und es entsteht auch keine Notiz.
    if (wanted.replace(/%%/g, '').trim() === '') return false;
    const outcome = await act(
      (latest) => {
        const next = addToNote(latest, day, wanted, asTask);
        return next === null ? null : { text: next };
      },
      // Der Eintrag soll zu sehen sein, auch in einem zugeklappten Abschnitt.
      { after: () => ({ open: { ...current.current.open, [ERGAENZUNGEN]: true } }) },
    );
    return outcome === 'written';
  };

  const toggleSection = (heading: string) =>
    update((now) => ({ open: { ...now.open, [heading]: !(now.open[heading] ?? OPEN_AT_START.has(heading)) } }));

  // Die Handler, die die Notiz kennt, bleiben dieselben Funktionen: So ändert sich ihr Kontext nur, wenn sich wirklich etwas ändert.
  const api = useRef({ onToggle, onEdit, onSave, onCancel });
  api.current = { onToggle, onEdit, onSave, onCancel };
  const handlers = useMemo(
    () => ({
      onToggle: (line: number, source: string) => api.current.onToggle(line, source),
      onEdit: (line: number, source: string) => api.current.onEdit(line, source),
      onDraft,
      onSave: (text: string) => api.current.onSave(text),
      onCancel: () => api.current.onCancel(),
    }),
    [],
  );

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

  // Die Bauteile der Notiz entstehen nur neu, wenn sich Text, Abschnitte oder die Bearbeitung ändern. Das Getippte gehört nicht
  // dazu (es steht im Feld selbst): Sonst würde bei jedem Zeichen die ganze Notiz neu zerlegt.
  const editing = state.editing;
  const noteEditing = useMemo(() => (editing ? { line: editing.line, saving: editing.saving } : null), [editing?.line, editing?.saving]);
  const context = useMemo<NoteContext>(() => ({ lines, editing: noteEditing, draft, readOnly: locked, ...handlers }), [lines, noteEditing, locked, handlers]);
  const intro = useMemo(() => (html.intro === '' ? null : noteToVNodes(html.intro, context)), [html.intro, context]);
  const bodies = useMemo(() => html.parts.map((part) => (part === '' ? null : noteToVNodes(part, context))), [html.parts, context]);

  const busy = state.phase === 'laden' || state.pending > 0;
  const empty = ready && state.text === null;
  const nothing = state.text !== null && html.intro === '' && sections.length === 0;
  const notice = state.notice;

  return (
    <section ref={root} class="karte briefing" aria-label="Morgenbriefing" aria-busy={busy} style={cardStyle(rect)}>
      <div class="karten-inhalt">
        {state.phase === 'laden' && <p class="leer">{LOADING}</p>}
        {state.phase === 'offline' && <p class="leer">{OFFLINE}</p>}
        {state.phase === 'nichtGeladen' && <p class="leer">{NOT_LOADED}</p>}
        {state.phase === 'unlesbar' && <p class="leer">{UNREADABLE}</p>}
        {empty && <p class="leer">{NO_NOTE}</p>}
        {nothing && <p class="leer">Noch keine Einträge</p>}
        {intro !== null && <div class="vorspann">{intro}</div>}
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
              {isOpen && <div class="abschnitt-inhalt">{bodies[index]}</div>}
            </Fragment>
          );
        })}
      </div>
      {/* Die Meldungen bleiben im Baum, auch wenn sie leer sind: Eine Meldung, die erst später erscheint, liest die Sprachausgabe nur dann vor. */}
      <p class="karten-hinweis" role="status">
        {notice && !notice.alert ? notice.text : ''}
      </p>
      <p class="karten-hinweis fehler" role="alert">
        {notice?.alert ? notice.text : ''}
      </p>
      {state.rescued !== null && (
        <div class="gerettet">
          <label>
            <span>Dein Text</span>
            <textarea readOnly rows={2} value={state.rescued} />
          </label>
          <button type="button" class="knopf" onClick={() => update({ rescued: null })}>
            Schließen
          </button>
        </div>
      )}
      {!locked && <AddForm ready={ready} busy={state.pending > 0} onAdd={onAdd} />}
    </section>
  );
}
