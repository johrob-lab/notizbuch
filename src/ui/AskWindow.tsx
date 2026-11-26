import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { csvZeilen } from '../gehirn/daten';
import type { KopieStand } from '../gehirn/kopie';
import { quellenAus, quellenZeile, type Quelle } from '../gehirn/quellen';
import { findePfad, fuehreAus, WERKZEUGE } from '../gehirn/werkzeuge';
import { GestureFilter } from '../ink/gestures';
import { FAILURE_TEXT, KiError } from '../ki/claude';
import { costCents } from '../ki/cost';
import { frage } from '../ki/gespraech';
import { pageImage } from '../ki/pageImage';
import { buildMessages, systemBlocks, type SentTurn } from '../ki/prompt';
import { todayVienna } from '../lib/dates';
import { dailyNotePath } from '../lib/filenames';
import type { KiModel } from '../lib/settings';
import type { SyncEngine } from '../sync/engine';
import type { CopyClient } from '../sync/github';
import type { AskPage } from './ask';
import { Round, readOnlyNodes, type Turn } from './askRound';
import { useRoundActions } from './askTakeover';
import { routeHash } from './router';
import { keepFocusAfterTap, watchHand } from './palmGuard';
import { useActivation, type Pressable } from './pointerBits';
import { KOPIE_WARTEN_MS, useKopie } from './useKopie';

// Das Fenster „Frag Claude“: eine Frage tippen oder diktieren, die offene Seite mitschicken, die Antwort lesen. Es gehört der App,
// nicht der Seite: Darum bleibt es offen, wenn man blättert, und nennt immer die Seite, die gerade offen ist (`page`). In den
// Einstellungen und in der Liste der Besprechungen ist es versteckt (`away`) und behält, was im Feld steht. Es liegt außerhalb der
// Bühne: Die Schreibfläche sieht nie, was auf ihm geschieht. Ein Stiftstrich darauf wird also nie Tinte, Finger und Rad bewegen
// die Seite nicht. Vor der Hand, die beim Schreiben aufliegt, schützt es dasselbe Tor wie die Seite (`watchHand` in palmGuard.ts).
// Gefragt wird nur mit „Fragen“ oder Enter. Öffnen und Fragen frischen nur die Kopie des Vaults bei GitHub auf (useKopie.ts).

/** Was die App mit dem Fenster tun kann. */
export type AskControl = {
  /**
   * Öffnet das Fenster und setzt den Fokus ins Feld, beides sofort im selben Aufruf: Das iPad öffnet die Tastatur nur, solange der
   * Tipp auf den Knopf noch läuft.
   */
  open(): void;
};

type Props = {
  engine: SyncEngine;
  /** Der Zugang zu GitHub, über den die Kopie des Vaults auffrischt. */
  client: CopyClient;
  kiKey: string;
  model: KiModel;
  /** Die offene Seite, sobald sie gelesen ist und sich angemeldet hat. Sonst `null`. */
  page: AskPage | null;
  /** Einstellungen oder Liste der Besprechungen: Das Fenster ist versteckt und behält alles. */
  away: boolean;
  /** Hier legt das Fenster ab, wie die App es öffnet. */
  control: { current: AskControl | null };
};

/** Ein Knopf des Fensters und was er tut. */
type Knopf = Pressable & { run(): void };

/** Ein Fehler, der im Fenster steht: der Satz und die Spur zur Ursache (`null` ohne). */
type Fehler = { satz: string; code: string | null };

/** Was die Werkzeuge ohne Kopie sehen (die Datenbank ließ sich nicht öffnen): nichts. */
const OHNE_KOPIE: KopieStand = {
  geladen: 0,
  gesamt: 0,
  vollstaendig: false,
  ohneNetz: false,
};

/** Die Frage mit der Seite: ihre Angaben als Text und ihr Bild, beides zugleich gelesen. Ohne Bild ist `image` `null`. */
async function questionWithPage(page: AskPage, question: string): Promise<SentTurn> {
  const [text, image] = await Promise.all([page.describe(), pageImage(page.svg())]);
  return { question, page: { text, image } };
}

/** Wartet auf `promise`, bis das Signal abbricht. Dann gibt es sofort `null`, was danach noch kommt, zählt nicht. */
function untilStopped<T>(signal: AbortSignal, promise: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const stopped = () => resolve(null);
    if (signal.aborted) return stopped();
    signal.addEventListener('abort', stopped, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stopped));
  });
}

/** Wartet auf `promise`, aber höchstens `ms`. Die Uhr läuft danach nicht weiter. */
async function atMost(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Der Text einer CSV als Liste, eine Zeile je Punkt. */
const csvListe = (text: string) => (
  <ul>
    {csvZeilen(text).map((zeile, i) => (
      <li key={i}>{zeile}</li>
    ))}
  </ul>
);

/**
 * Die Ansicht zum Lesen: die Notiz einer Quelle aus der Kopie, nur zum Lesen, mit dem Abschnitt der Quelle in Sicht. Darunter
 * „Zurück zur Antwort“. Fehlt die Notiz inzwischen in der Kopie, steht ein Satz.
 */
function Lesen({
  quelle,
  text,
  press,
  onZurueck,
}: {
  quelle: Quelle;
  text: string | null;
  press: (b: Knopf) => JSX.IntrinsicElements['button'];
  onZurueck(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !quelle.abschnitt) return;
    const gesucht = quelle.abschnitt.trim().toLowerCase();
    const kopf = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((h) => (h.textContent ?? '').trim().toLowerCase() === gesucht);
    kopf?.scrollIntoView({ block: 'start' });
  }, [quelle, text]);
  const csv = /\.csv$/i.test(quelle.pfad);
  return (
    <div class="frag-lesen">
      <h3>{quelle.etikett}</h3>
      <div ref={box} class="frag-antwort frag-lesetext">
        {text === null ? <p>Diese Notiz ist nicht mehr in der Kopie.</p> : csv ? csvListe(text) : readOnlyNodes(text)}
      </div>
      <button type="button" class="knopf" {...press({ key: 'zurueck', run: onZurueck })}>
        Zurück zur Antwort
      </button>
    </div>
  );
}

/**
 * Die Zeile zur Kopie unter den Knöpfen: während des Ladens der Fortschritt, nach einem Laden ohne Netz, was fehlt. Ist die Kopie
 * vollständig, steht nichts da, auch nicht für den Augenblick, in dem sie beim Öffnen nachsieht.
 */
function brainLine(stand: KopieStand | null, laeuft: boolean): string {
  if (stand === null || stand.geladen >= stand.gesamt) return '';
  if (laeuft) return `Gehirn wird geladen … ${stand.geladen} von ${stand.gesamt}`;
  return stand.ohneNetz ? `Gehirn: ${stand.geladen} von ${stand.gesamt} Notizen da, der Rest kommt mit Netz.` : '';
}

/**
 * Das Fenster: oben „Frag Claude“ und „Schließen“, darunter das Feld für die Frage, der Schalter „Seite mitschicken“ mit dem Namen der
 * offenen Seite, „Fragen“ (während einer Antwort „Stopp“) und „Neue Frage“, die Zeile zur Kopie, die Zeile für Fehler und der
 * Verlauf mit der neuesten Runde oben. Alle Knöpfe und der Schalter laufen über `useActivation` mit dem Tor der offenen Seite, ohne
 * Seite mit einem eigenen.
 */
export function AskWindow({ engine, client, kiKey, model, page, away, control }: Props) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [withPage, setWithPage] = useState(true);
  /** Das Gespräch, die neueste Runde zuerst. */
  const [turns, setTurns] = useState<Turn[]>([]);
  const [failure, setFailure] = useState<Fehler | null>(null);
  /** Die Quelle, die das Fenster statt des Verlaufs zeigt, `null` ohne. */
  const [lesen, setLesen] = useState<Quelle | null>(null);
  const gehirn = useKopie(client);
  // Die Runden, wie sie zuletzt gezeichnet wurden: Eine Nachfrage schickt die früheren mit.
  const turnsNow = useRef(turns);
  turnsNow.current = turns;
  const lastId = useRef(0);
  // Die laufende Anfrage, `null` ohne. „Neue Frage“, „Schließen“ und der Abbau des Fensters beenden das Gespräch (`endTalk`): Die
  // Anfrage bricht ab, und `talk` zählt weiter. Was danach noch von ihr kommt, gehört zu einem Gespräch, das es nicht mehr gibt.
  const request = useRef<AbortController | null>(null);
  const talk = useRef(0);
  // Ohne offene Seite gibt es auch keinen Stift auf ihr: Dann gilt ein eigenes Tor, das nur hört, was auf dem Fenster geschieht.
  const [ownGate] = useState(() => new GestureFilter());
  const gate = page?.filter ?? ownGate;
  // Was auf dem Fenster geschieht, fragt immer das Tor, das gerade gilt.
  const gateNow = useRef(gate);
  gateNow.current = gate;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    return watchHand(el, () => gateNow.current);
  }, []);

  // Den Fokus ins Feld, und er bleibt dort, auch wenn der Browser nach dem Tipp noch die Maustaste auf dem Knopf meldet.
  const keeping = useRef<(() => void) | null>(null);
  const focusField = () => {
    field.current?.focus();
    keeping.current?.();
    keeping.current = keepFocusAfterTap();
  };
  useLayoutEffect(() => () => keeping.current?.(), []);

  // Direkt am Element sichtbar, nicht erst nach dem nächsten Zeichnen: Ein verstecktes Feld nähme den Fokus nicht. Die Kopie frischt
  // dabei auf, ohne dass das Öffnen darauf wartet (`auffrischen` bleibt dieselbe Funktion).
  useLayoutEffect(() => {
    const mine: AskControl = {
      open: () => {
        const el = root.current;
        if (el) el.hidden = false;
        focusField();
        setOpen(true);
        void gehirn.auffrischen();
      },
    };
    control.current = mine;
    return () => {
      if (control.current === mine) control.current = null;
    };
  }, [control]);

  /** Beendet das Gespräch: Eine laufende Anfrage bricht ab, und was sie danach noch bringt, ändert nichts mehr. */
  const endTalk = () => {
    talk.current += 1;
    request.current?.abort();
    request.current = null;
  };
  // Geht das Fenster (kein Schlüssel mehr, Firmen-PC, das Fenster der App darf nicht mehr schreiben), endet auch die Anfrage.
  useEffect(() => () => endTalk(), []);

  /**
   * Stellt die Frage im Feld, mit der Seite, die jetzt offen ist, wenn der Schalter an ist. Die Frage steht sofort oben als neue Runde.
   * Während die Seite gelesen wird, frischt die Kopie auf (höchstens `KOPIE_WARTEN_MS`). Dann sucht Claude in der Kopie: je
   * Werkzeugaufruf eine graue Zeile, die Antwort kommt Wort für Wort dazu. Endet sie mit „Stopp“, bevor etwas zu sehen war, oder
   * scheitert sie vor dem ersten Text, verschwindet die Runde wieder, und die Frage steht wieder im Feld.
   */
  const ask = async (): Promise<void> => {
    const text = question.trim();
    if (text === '' || request.current) return;
    const stop = new AbortController();
    request.current = stop;
    const mine = talk.current;
    const at = new Date();
    const sending = withPage ? page : null;
    const id = ++lastId.current;
    // Frühere Runden mit Text, die älteste zuerst: So kennt Claude das Gespräch.
    const earlier: SentTurn[] = turnsNow.current
      .filter((turn) => turn.answer.trim() !== '')
      .reverse()
      .map((turn) => ({ ...turn.sent, answer: turn.answer }));
    const turn: Turn = {
      id,
      question: text,
      at,
      label: sending?.label ?? null,
      noteDay: page?.day ?? todayVienna(at),
      sent: { question: text, page: null },
      answer: '',
      state: 'laeuft',
      cost: null,
      partial: false,
      imageFailed: false,
      schritte: [],
      pfade: [],
      failure: null,
      code: null,
    };
    setQuestion('');
    setFailure(null);
    setLesen(null);
    field.current?.blur(); // am iPad geht die Tastatur zu
    setTurns((all) => [turn, ...all]);

    /** Ändert diese Runde, solange ihr Gespräch noch läuft. */
    const change = (next: (now: Turn) => Partial<Turn>) => {
      if (talk.current === mine) setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...next(t) } : t)));
    };
    /** Die Runde verschwindet, und die Frage kommt zurück ins Feld, wenn dort nicht schon etwas Neues steht. */
    const giveBack = () => {
      setTurns((all) => all.filter((t) => t.id !== id));
      setQuestion((now) => (now.trim() === '' ? text : now));
    };
    // Was die Runde schon zeigt: ihre grauen Zeilen und den Text des laufenden Schritts (ein neuer Schritt leert ihn).
    const lines: string[] = [];
    let shown = '';
    /** „Stopp“: Ist schon etwas zu sehen, bleibt die Runde mit „Gestoppt.“ stehen, sonst kommt die Frage zurück ins Feld. */
    const stopped = (pfade: string[] = []) =>
      lines.length === 0 && shown.trim() === '' ? giveBack() : change(() => ({ answer: shown, state: 'gestoppt', pfade }));

    try {
      // Die Seite wird gelesen, während die Kopie auffrischt. „Stopp“ wirkt sofort, auch wenn eines davon hängt.
      const ready = await untilStopped(
        stop.signal,
        Promise.all([sending ? questionWithPage(sending, text) : turn.sent, atMost(gehirn.auffrischen(), KOPIE_WARTEN_MS)]),
      );
      if (talk.current !== mine) return;
      if (ready === null) return giveBack(); // „Stopp“, bevor etwas hinausging
      const [sent] = ready;
      if (sent !== turn.sent) change(() => ({ sent, imageFailed: sent.page?.image === null }));
      // Mit dem, was die Kopie jetzt hat. Die Werkzeuge lesen sie, wie sie beim Aufruf ist, und frischen nie selbst auf.
      const kopie = gehirn.jetzt();
      const view = () => (kopie ? { dateien: kopie.dateien(), stand: kopie.stand() } : { dateien: [], stand: OHNE_KOPIE });
      const antwort = await frage({
        key: kiKey,
        model,
        system: systemBlocks(at, kopie?.stand() ?? null),
        messages: buildMessages([...earlier, sent]),
        tools: WERKZEUGE,
        ausfuehren: (aufruf) => fuehreAus(aufruf, view(), todayVienna(at)),
        signal: stop.signal,
        onText: (delta) => {
          shown += delta;
          change((now) => ({ answer: now.answer + delta }));
        },
        onSchritt: (step) => {
          if ('neu' in step) {
            shown = '';
            change(() => ({ answer: '' }));
            return;
          }
          // Text vor einem Werkzeug wird eine graue Zeile und ist nicht mehr Teil der Antwort.
          const notiz = 'notiz' in step;
          lines.push(notiz ? step.notiz : step.zeile);
          if (notiz) shown = '';
          const schritte = [...lines];
          change(() => (notiz ? { schritte, answer: '' } : { schritte }));
        },
      });
      if (talk.current !== mine) return;
      if (antwort.end === 'gestoppt') return stopped(antwort.pfade);
      const cost = antwort.usage ? costCents(model, antwort.usage) : null;
      change(() => ({
        answer: antwort.text,
        state: antwort.end,
        cost,
        partial: antwort.partial,
        pfade: antwort.pfade,
      }));
    } catch (error) {
      if (talk.current !== mine) return;
      // Nach „Stopp“ ist ein Fehler keiner mehr. Alles, was kein Fehler der Schnittstelle ist, zählt wie „nicht erreichbar“.
      if (stop.signal.aborted) return stopped();
      const fehler: Fehler = {
        satz: FAILURE_TEXT[error instanceof KiError ? error.reason : 'unavailable'],
        code: error instanceof KiError ? error.code : null,
      };
      // Kam schon Text, bleibt er stehen, und der Fehler steht darunter. Sonst geht die Frage zurück ins Feld.
      if (shown.trim() !== '')
        change(() => ({
          answer: shown,
          state: 'fehler',
          failure: fehler.satz,
          code: fehler.code,
        }));
      else {
        giveBack();
        setFailure(fehler);
      }
    } finally {
      if (request.current === stop) request.current = null;
    }
  };

  /** „Neue Frage“: Das Gespräch beginnt von vorn. Was im Feld steht, bleibt, und der Fokus geht hinein. */
  const startOver = () => {
    endTalk();
    setTurns([]);
    setFailure(null);
    setLesen(null);
    focusField();
  };

  /** Schließen leert alles: Das nächste Öffnen beginnt von vorn, mit der Seite. */
  const close = () => {
    endTalk();
    field.current?.blur();
    setOpen(false);
    setQuestion('');
    setWithPage(true);
    setTurns([]);
    setFailure(null);
    setLesen(null);
  };

  /** Die Quellen einer Runde: nur Notizen, die es in der Kopie gibt und die in dieser Frage vorkamen (oder die Tagesnotiz der Seite, die mitging). */
  const quellenVon = (turn: Turn): Quelle[] => {
    const dateien = gehirn.kopie?.dateien();
    if (!dateien || turn.state === 'laeuft' || turn.state === 'fehler' || !turn.answer.includes('Quellen:')) return [];
    const erlaubt = turn.label !== null ? [...turn.pfade, dailyNotePath(turn.noteDay)] : turn.pfade;
    return quellenAus(turn.answer, (pfad) => findePfad(dateien, pfad), erlaubt);
  };
  /** Eine Tagesnotiz öffnet den Tag in der App, das Fenster bleibt offen. Jede andere Notiz öffnet die Ansicht zum Lesen. */
  const openQuelle = (quelle: Quelle) => {
    if (quelle.tag !== null) window.location.hash = routeHash({ view: 'tag', key: quelle.tag });
    else setLesen(quelle);
  };
  const press = useActivation(gate, (b: Knopf) => b.run());
  const round = useRoundActions(engine);
  const empty = question.trim() === '';
  const busy = turns.some((turn) => turn.state === 'laeuft');
  const pageName = page?.label ?? 'keine Seite offen';

  return (
    <section ref={root} class="frag-fenster" role="dialog" aria-labelledby="frag-titel" hidden={!open || away}>
      <div class="frag-kopf">
        <h2 id="frag-titel">Frag Claude</h2>
        <button type="button" class="knopf" {...press({ key: 'schliessen', run: close })}>
          Schließen
        </button>
      </div>
      <label for="frag-feld">Was willst du wissen?</label>
      <textarea
        id="frag-feld"
        ref={field}
        rows={3}
        enterkeyhint="send"
        value={question}
        onInput={(e) => setQuestion(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter schickt die Frage, Umschalt+Enter macht eine neue Zeile. Während einer Eingabe mit Vorschlägen gehört Enter ihr.
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
          e.preventDefault();
          void ask();
        }}
      />
      <div class="frag-knoepfe">
        <button
          type="button"
          role="switch"
          class="frag-seite"
          aria-checked={withPage}
          aria-label={`Seite mitschicken: ${pageName}`}
          disabled={!page}
          {...press({
            key: 'seite',
            disabled: !page,
            run: () => setWithPage((on) => !on),
          })}
        >
          <span class="frag-spur" />
          <span class="frag-schaltertext">
            Seite mitschicken
            <small>{pageName}</small>
          </span>
        </button>
        {/* Ein Knopf: Während eine Antwort läuft, heißt er „Stopp“. Ein Tipp, der auf „Fragen“ begann, stoppt nichts. */}
        <button
          type="button"
          class="knopf primaer"
          disabled={!busy && empty}
          {...press(
            busy ? { key: 'stopp', run: () => request.current?.abort() } : { key: 'fragen', disabled: empty, run: () => void ask() },
          )}
        >
          {busy ? 'Stopp' : 'Fragen'}
        </button>
        <button type="button" class="knopf" {...press({ key: 'neu', run: startOver })}>
          Neue Frage
        </button>
      </div>
      <p class="frag-gehirn" role="status">
        {brainLine(gehirn.stand, gehirn.laeuft)}
      </p>
      <p class="frag-fehler" role="alert">
        {failure?.satz ?? ''}
      </p>
      {failure !== null && failure.code !== null && <p class="frag-code">{`Fehlercode ${failure.code}`}</p>}
      {lesen !== null && (
        <Lesen quelle={lesen} text={gehirn.kopie?.text(lesen.pfad) ?? null} press={press} onZurueck={() => setLesen(null)} />
      )}
      <ol class="frag-verlauf" hidden={lesen !== null}>
        {turns.map((turn) => {
          const quellen = quellenVon(turn);
          return (
            <Round
              key={turn.id}
              turn={turn}
              actions={{
                take: round.taking[turn.id] ?? 'nein',
                copy: round.copying[turn.id] ?? 'nein',
                onTake: () =>
                  void round.take(
                    turn,
                    quellen.length > 0
                      ? quellenZeile(
                          quellen,
                          (gehirn.kopie?.dateien() ?? []).map((d) => d.path),
                        )
                      : undefined,
                  ),
                onCopy: () => void round.copy(turn),
                quellen,
                onQuelle: openQuelle,
                press,
              }}
            />
          );
        })}
      </ol>
    </section>
  );
}
