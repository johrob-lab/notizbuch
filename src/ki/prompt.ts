import { formatDayLong, timeVienna, todayVienna } from '../lib/dates';
import type { ApiMessage, ImageBlock, TextBlock } from './claude';

/** Die Regeln für Claude. Das Datum und die Uhrzeit kommen aus Wien, damit „heute“ und „morgen“ stimmen. */
export function systemPrompt(now: Date): string {
  return [
    'Du bist Claude und hilfst in einer Notizbuch-App auf dem iPad. Wer dich fragt, schreibt dort mit dem Stift Tagesnotizen und Besprechungen.',
    `Heute ist ${formatDayLong(todayVienna(now))}, ${timeVienna(now)} Uhr (Wien).`,
    '',
    'So antwortest du:',
    '- Auf Deutsch, per du, kurz und direkt.',
    '- Keine Gedankenstriche.',
    '- Schreib „KI“, nie „AI“.',
    '- Ein Mail-Entwurf endet mit „SG“.',
    '- Aufgaben schreibst du als eigene Zeilen „- [ ] …“.',
    '- Einfache Formatierung genügt: Absätze, Listen mit „- “, **fett**.',
    '- Was weder auf der Seite noch in den Angaben dazu steht, weißt du nicht. Sag das, statt zu raten.',
  ].join('\n');
}

/** Eine Runde des Gesprächs: die Frage, die Seite dazu (Text und Bild als Base64 ohne Präfix) und, wenn es sie gibt, die Antwort. */
export type SentTurn = { question: string; page: { text: string; image: string | null } | null; answer?: string };

/** Der Satz, der in früheren Runden anstelle des Bildes steht: Das Bild geht nur mit der neuesten Frage mit. */
export const EARLIER_IMAGE = '(Zu dieser Frage ging ein Bild der Seite mit.)';

/** Die Nachrichten an Claude. Nur die letzte Frage trägt ihr Bild, als ersten Block vor dem Text. */
export function buildMessages(turns: SentTurn[]): ApiMessage[] {
  const messages: ApiMessage[] = [];
  turns.forEach((turn, index) => {
    const newest = index === turns.length - 1;
    const parts: string[] = [];
    if (turn.page) parts.push(turn.page.text);
    if (turn.page?.image && !newest) parts.push(EARLIER_IMAGE);
    parts.push(`Frage: ${turn.question}`);
    const content: (TextBlock | ImageBlock)[] = [];
    if (newest && turn.page?.image) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: turn.page.image } });
    }
    content.push({ type: 'text', text: parts.join('\n\n') });
    messages.push({ role: 'user', content });
    if (turn.answer !== undefined) messages.push({ role: 'assistant', content: turn.answer });
  });
  return messages;
}
