import { expect, test } from 'vitest';
import { buildMessages, systemPrompt } from '../../src/ki/prompt';

test('the rules are all there', () => {
  const text = systemPrompt(new Date('2026-11-18T14:05:00Z'));
  expect(text).toBe(
    [
      'Du bist Claude und hilfst in einer Notizbuch-App auf dem iPad. Wer dich fragt, schreibt dort mit dem Stift Tagesnotizen und Besprechungen.',
      'Heute ist Mi 18.11.2026, 15:05 Uhr (Wien).',
      '',
      'So antwortest du:',
      '- Auf Deutsch, per du, kurz und direkt.',
      '- Keine Gedankenstriche.',
      '- Schreib „KI“, nie „AI“.',
      '- Ein Mail-Entwurf endet mit „SG“.',
      '- Aufgaben schreibst du als eigene Zeilen „- [ ] …“.',
      '- Einfache Formatierung genügt: Absätze, Listen mit „- “, **fett**.',
      '- Was weder auf der Seite noch in den Angaben dazu steht, weißt du nicht. Sag das, statt zu raten.',
    ].join('\n'),
  );
  expect(text).not.toContain('–');
  expect(text).not.toContain('—');
});

test('a question without page is just the question', () => {
  expect(buildMessages([{ question: 'Was steht an?', page: null }])).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'Frage: Was steht an?' }] },
  ]);
});

test('the picture comes first, the page text before the question', () => {
  expect(
    buildMessages([{ question: 'Was steht an?', page: { text: 'Offene Seite: Tagesseite Do 29.10.2026', image: 'AAAA' } }]),
  ).toEqual([
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'text', text: 'Offene Seite: Tagesseite Do 29.10.2026\n\nFrage: Was steht an?' },
      ],
    },
  ]);
});

test('only the newest question carries the picture', () => {
  const messages = buildMessages([
    { question: 'Eins', page: { text: 'Offene Seite: A', image: 'AAAA' }, answer: 'Antwort 1' },
    { question: 'Zwei', page: { text: 'Offene Seite: B', image: 'BBBB' } },
  ]);
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  const blocks = messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content));
  expect(blocks.filter((b) => b.type === 'image')).toHaveLength(1);
  const last = messages[2].content;
  expect(Array.isArray(last) && last[0].type).toBe('image');
  expect(messages[0].content).toEqual([
    { type: 'text', text: 'Offene Seite: A\n\n(Zu dieser Frage ging ein Bild der Seite mit.)\n\nFrage: Eins' },
  ]);
  expect(messages[1]).toEqual({ role: 'assistant', content: 'Antwort 1' });
});
