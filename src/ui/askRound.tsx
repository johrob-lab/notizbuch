import type { ComponentChildren, JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { costLabel } from '../ki/cost';
import type { SentTurn } from '../ki/prompt';
import { timeVienna, type Day } from '../lib/dates';
import { renderNote } from '../lib/markdown';
import type { CopyState, TakeState } from './askTakeover';
import { noteToVNodes, type NoteContext } from './noteView';
import type { Pressable } from './pointerBits';
import { FAILED } from './texts';

// Eine Runde im Fenster „Frag Claude“ (AskWindow.tsx): die Frage, darunter klein die Uhrzeit und die Seite, die mitging, die grauen
// Zeilen der Suche, dann die Antwort mit ihren Hinweisen und den Kosten. Die Antwort erscheint wie eine Notiz in der Karte
// Morgenbriefing (`renderNote` und `noteToVNodes`): nur bekannte Elemente, nie HTML aus dem Text. Links auf einen Tag der App und mit http oder https bleiben Links (die ins Netz mit `noopener`), jede andere Adresse wird Text.

/**
 * Eine Runde des Gesprächs. `label` ist der Name der Seite, die mit der Frage ging, `null` ohne Seite. `noteDay` ist der Tag der
 * Notiz, zu der die Antwort gehört: der Tag der Seite, die beim Fragen offen war, auch wenn sie nicht mitging, auf Woche, Monat oder
 * ohne Seite der Tag der Frage. `sent` ist, was mit der Frage an Claude ging (eine Nachfrage schickt es noch einmal mit). `cost` sind
 * die Kosten der Antwort in Cent über alle Schritte, `null` ohne Zahlen und nach „Stopp“, `partial` heißt: Es fehlten Zahlen, die
 * Kosten sind eine Untergrenze. `schritte` sind die grauen Zeilen (je Werkzeugaufruf eine und Text, den Claude davor schrieb),
 * `pfade` die Pfade aller Werkzeugergebnisse. Brach die Antwort nach dem ersten Text an einem Fehler ab (`fehler`), stehen in
 * `failure` der Satz dazu und in `code` die Spur zur Ursache (`400`, `overloaded_error`), sonst `null`.
 */
export type Turn = {
  id: number;
  question: string;
  at: Date;
  label: string | null;
  noteDay: Day;
  sent: SentTurn;
  answer: string;
  state: 'laeuft' | 'fertig' | 'gestoppt' | 'abgeschnitten' | 'fehler';
  cost: number | null;
  partial: boolean;
  imageFailed: boolean;
  schritte: string[];
  pfade: string[];
  failure: string | null;
  code: string | null;
};

const IMAGE_FAILED = 'Das Bild der Seite ließ sich nicht erstellen. Claude bekam nur die Angaben zur Seite.';
const STOPPED = 'Gestoppt.';
const CUT = 'Die Antwort war zu lang und ist hier abgeschnitten.';

/**
 * Die Antwort als Markdown für `renderNote`, so entschärft, dass nichts von ihr versteckt bleibt. In einer Notiz versteckt
 * `renderNote` alles zwischen `%%` und einen Kopf, der mit `---` in der ersten Zeile beginnt. Darum steht zwischen zwei `%` ein
 * unsichtbares Zeichen (U+2060, es hält die beiden auch auf einer Zeile), und vor der Antwort eine leere Zeile. Zu sehen ist alles
 * wie geschrieben.
 */
function visibleMarkdown(answer: string): string {
  return `\n${answer.replace(/%(?=%)/g, '%\u2060')}`;
}

/** Was die Knöpfe unter der Antwort brauchen: die Stände dieser Runde, ihre Aktionen und `press` des Fensters (Tor gegen Handballen). */
export type RoundActions = {
  take: TakeState;
  copy: CopyState;
  onTake(): void;
  onCopy(): void;
  press(b: Pressable & { run(): void }): JSX.IntrinsicElements['button'];
};

const TAKE_LABEL: Record<TakeState, string> = { nein: 'In Ergänzungen übernehmen', laeuft: 'Wird übernommen …', fertig: 'Übernommen', fehler: 'In Ergänzungen übernehmen' };
const COPY_LABEL: Record<CopyState, string> = { nein: 'Kopieren', kopiert: 'Kopiert', fehler: 'Kopieren ging nicht.' };

const ignore = (): void => undefined;

/** Die Antwort als Bauteile, nur zum Lesen: Aufgaben haben ein gesperrtes Kästchen, es gibt keinen Stift und nichts zu bearbeiten. */
function answerNodes(answer: string): ComponentChildren {
  const md = visibleMarkdown(answer);
  const ctx: NoteContext = {
    lines: md.split('\n'),
    editing: null,
    draft: { current: '' },
    readOnly: true,
    onToggle: ignore,
    onEdit: ignore,
    onDraft: ignore,
    onSave: ignore,
    onCancel: ignore,
    onBetra: ignore,
  };
  return noteToVNodes(renderNote(md), ctx);
}

/** Eine Runde. Die Antwort wird nur neu zerlegt, wenn ihr Text sich ändert: Während eine Antwort läuft, bleiben die älteren, wie sie sind. */
export function Round({ turn, actions }: { turn: Turn; actions: RoundActions }) {
  const answer = useMemo(() => answerNodes(turn.answer), [turn.answer]);
  const waiting = turn.state === 'laeuft' && turn.answer === '';
  // Knöpfe gibt es nur für eine Runde mit Text, nicht, solange sie noch läuft.
  const hasText = turn.state !== 'laeuft' && turn.answer.trim() !== '';
  const { take, copy, press } = actions;
  return (
    <li class="frag-runde">
      <p class="frag-frage">{turn.question}</p>
      <p class="frag-wann">{`${timeVienna(turn.at)} · ${turn.label ?? 'ohne Seite'}`}</p>
      {turn.schritte.length > 0 && (
        <ol class="frag-schritte">
          {turn.schritte.map((schritt, i) => (
            <li key={i}>{schritt}</li>
          ))}
        </ol>
      )}
      <div class="frag-antwort">{waiting ? '…' : answer}</div>
      {turn.imageFailed && <p class="frag-hinweis">{IMAGE_FAILED}</p>}
      {turn.state === 'gestoppt' && <p class="frag-hinweis">{STOPPED}</p>}
      {turn.state === 'abgeschnitten' && <p class="frag-hinweis">{CUT}</p>}
      {turn.failure !== null && (
        <p class="frag-fehlersatz" role="alert">
          {turn.failure}
        </p>
      )}
      {turn.code !== null && <p class="frag-code">{`Fehlercode ${turn.code}`}</p>}
      {hasText && (
        <div class="frag-aktionen">
          <button type="button" class="knopf" {...press({ key: `kopieren-${turn.id}`, run: actions.onCopy })}>
            {COPY_LABEL[copy]}
          </button>
          <button
            type="button"
            class="knopf"
            disabled={take === 'laeuft' || take === 'fertig'}
            {...press({ key: `uebernehmen-${turn.id}`, disabled: take === 'laeuft' || take === 'fertig', run: actions.onTake })}
          >
            {TAKE_LABEL[take]}
          </button>
        </div>
      )}
      {hasText && take === 'fehler' && (
        <p class="frag-hinweis" role="alert">
          {FAILED}
        </p>
      )}
      {turn.cost !== null && <p class="frag-kosten">{costLabel(turn.cost, turn.partial)}</p>}
    </li>
  );
}
