import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { costLabel } from '../ki/cost';
import type { SentTurn } from '../ki/prompt';
import { timeVienna, type Day } from '../lib/dates';
import { renderNote } from '../lib/markdown';
import { noteToVNodes, type NoteContext } from './noteView';

// Eine Runde im Fenster „Frag Claude“ (AskWindow.tsx): die Frage, darunter klein die Uhrzeit und die Seite, die mitging, dann die
// Antwort mit ihren Hinweisen und den Kosten. Die Antwort erscheint wie eine Notiz in der Karte Morgenbriefing (`renderNote` und
// `noteToVNodes`): nur bekannte Elemente ohne Attribute, nie HTML aus dem Text.

/**
 * Eine Runde des Gesprächs. `label` ist der Name der Seite, die mit der Frage ging, `null` ohne Seite. `noteDay` ist der Tag der
 * Notiz, zu der die Antwort gehört: der Tag der Seite, die beim Fragen offen war, auch wenn sie nicht mitging, auf Woche, Monat oder
 * ohne Seite der Tag der Frage. `sent` ist, was mit der Frage an Claude ging (eine Nachfrage schickt es noch einmal mit). `cost` sind
 * die Kosten der Antwort in Cent, `null` ohne Zahlen und nach „Stopp“.
 */
export type Turn = {
  id: number;
  question: string;
  at: Date;
  label: string | null;
  noteDay: Day;
  sent: SentTurn;
  answer: string;
  state: 'laeuft' | 'fertig' | 'gestoppt' | 'abgeschnitten';
  cost: number | null;
  imageFailed: boolean;
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
  };
  return noteToVNodes(renderNote(md), ctx);
}

/** Eine Runde. Die Antwort wird nur neu zerlegt, wenn ihr Text sich ändert: Während eine Antwort läuft, bleiben die älteren, wie sie sind. */
export function Round({ turn }: { turn: Turn }) {
  const answer = useMemo(() => answerNodes(turn.answer), [turn.answer]);
  const waiting = turn.state === 'laeuft' && turn.answer === '';
  return (
    <li class="frag-runde">
      <p class="frag-frage">{turn.question}</p>
      <p class="frag-wann">{`${timeVienna(turn.at)} · ${turn.label ?? 'ohne Seite'}`}</p>
      <div class="frag-antwort">{waiting ? '…' : answer}</div>
      {turn.imageFailed && <p class="frag-hinweis">{IMAGE_FAILED}</p>}
      {turn.state === 'gestoppt' && <p class="frag-hinweis">{STOPPED}</p>}
      {turn.state === 'abgeschnitten' && <p class="frag-hinweis">{CUT}</p>}
      {turn.cost !== null && <p class="frag-kosten">{costLabel(turn.cost)}</p>}
    </li>
  );
}
