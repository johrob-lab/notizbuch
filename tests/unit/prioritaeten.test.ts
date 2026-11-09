import { describe, expect, it } from 'vitest';
import { parsePrioritaeten } from '../../src/lib/prioritaeten';

const note = [
  '# 2026-10-29',
  '',
  '## Handschrift',
  '',
  '### Prioritäten',
  'Quelle: [[2026-10-29 Tag.svg]]',
  'Sperren 2027 abstimmen',
  '- [ ] Freigabe holen',
  '- [x] Plan schicken',
  '',
  '### Aufgaben',
  '- [ ] anderes',
  '',
].join('\n');

const expected = [
  { text: 'Sperren 2027 abstimmen', done: false },
  { text: 'Freigabe holen', done: false },
  { text: 'Plan schicken', done: true },
];

describe('parsePrioritaeten', () => {
  it('reads the lines of the Prioritäten block under Handschrift', () => {
    expect(parsePrioritaeten(note)).toEqual(expected);
  });

  it('ignores Quelle lines, empty lines, markers and keeps the text of wikilinks', () => {
    const md = [
      '## Handschrift',
      '### Prioritäten',
      'Quelle: [[Seite.svg]]',
      '',
      '- [ ] Text %%ob:abc%%',
      '[[Beispielprojekt A|Projekt A]] anrufen',
      '- [[Beispielprojekt B]]',
      'Quelle: noch eine',
      '   ',
    ].join('\n');
    expect(parsePrioritaeten(md)).toEqual([
      { text: 'Text', done: false },
      { text: 'Projekt A anrufen', done: false },
      { text: 'Beispielprojekt B', done: false },
    ]);
  });

  it('reads every Prioritäten block of the section', () => {
    const md = ['## Handschrift', '### Prioritäten', 'Eins', '### Aufgaben', '- [ ] x', '### Prioritäten', '- [x] Zwei'].join('\n');
    expect(parsePrioritaeten(md)).toEqual([
      { text: 'Eins', done: false },
      { text: 'Zwei', done: true },
    ]);
  });

  it('a Prioritäten heading outside Handschrift does not count', () => {
    const md = ['## Ergänzungen', '### Prioritäten', 'Nicht zählen', '- [ ] auch nicht'].join('\n');
    expect(parsePrioritaeten(md)).toEqual([]);
  });

  it('no Handschrift, an empty block or only a Quelle line give nothing', () => {
    expect(parsePrioritaeten('## Ergänzungen\n- [ ] a\n')).toEqual([]);
    expect(parsePrioritaeten('## Handschrift\n### Prioritäten\n\n### Aufgaben\n- [ ] a\n')).toEqual([]);
    expect(parsePrioritaeten('## Handschrift\n### Prioritäten\nQuelle: [[x.svg]]\n')).toEqual([]);
  });

  it('copes with CRLF, a byte order mark and spaces around the heading', () => {
    const md = '\ufeff' + note.replace('### Prioritäten', '###  Prioritäten  ').replace(/\n/g, '\r\n');
    expect(parsePrioritaeten(md)).toEqual(expected);
  });

  it('a wikilink with an empty display text falls back to the target', () => {
    const md = ['## Handschrift', '### Prioritäten', '- [ ] [[ziel|]] prüfen', '- [ ] [[a|b]] und [[c]]'].join('\n');
    expect(parsePrioritaeten(md).map((p) => p.text)).toEqual(['ziel prüfen', 'b und c']);
  });

  it('removes bold markers ** and __', () => {
    const md = ['## Handschrift', '### Prioritäten', '**Überschrift**', '- [ ] __wichtig__ und **fett**'].join('\n');
    expect(parsePrioritaeten(md).map((p) => p.text)).toEqual(['Überschrift', 'wichtig und fett']);
  });

  it('skips table separator rows', () => {
    const md = ['## Handschrift', '### Prioritäten', '|---|---|', '| :--- | ---: |', '- | - |', 'Text'].join('\n');
    expect(parsePrioritaeten(md).map((p) => p.text)).toEqual(['Text']);
  });

  it('joins the non-empty cells of a table row with a dot', () => {
    const md = ['## Handschrift', '### Prioritäten', '| Was | Wer |', '|---|---|', '| Plan |  | Anna |'].join('\n');
    expect(parsePrioritaeten(md).map((p) => p.text)).toEqual(['Was · Wer', 'Plan · Anna']);
  });

  it('a done task needs a box with x', () => {
    const md = ['## Handschrift', '### Prioritäten', '- [X] groß', '- Text'].join('\n');
    expect(parsePrioritaeten(md)).toEqual([
      { text: 'groß', done: true },
      { text: 'Text', done: false },
    ]);
  });
});
