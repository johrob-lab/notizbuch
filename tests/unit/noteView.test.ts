import { Fragment, h, render } from 'preact';
import { afterEach, expect, test, vi } from 'vitest';
import { renderNote } from '../../src/lib/markdown';
import { noteToVNodes, type NoteContext } from '../../src/ui/noteView';
import { fixture, lineOf } from './helpers';

// Die Tagesnotiz als Bauteile der Karte: Kästchen und Stift sind echte Elemente mit eigenen Handlern, und nur bekannte
// Elemente kommen durch. Die Notiz kann Text aus Mails enthalten, daraus darf nie Markup mit Wirkung werden.

const note = fixture('05 Daily Notes/2026-10-29.md');
const lines = note.split('\n');
const task1 = lineOf(note, 'Liste Planobjekte');
const task2 = lineOf(note, 'Urlaube im Plan');
const done = lineOf(note, 'Reorga abstimmen');
const termin = lineOf(note, '08:00 bis 14:00');

const hosts: HTMLElement[] = [];

function context(md: string, over: Partial<NoteContext> = {}): NoteContext {
  return {
    lines: md.split('\n'),
    editing: null,
    draft: { current: '' },
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDraft: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

function show(html: string, ctx: NoteContext): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  render(h(Fragment, null, noteToVNodes(html, ctx)), host);
  return host;
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

const boxes = (host: HTMLElement) => [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
const pencils = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('button.stift')];

test('tasks get a real checkbox named after their visible text, and every list item gets a pencil', () => {
  const host = show(renderNote(note), context(note));
  expect(boxes(host).map((b) => [b.getAttribute('aria-label'), b.checked])).toEqual([
    ['Liste Planobjekte ergänzen (fällig 30.10.)', false],
    ['Urlaube im Plan nachziehen', false],
    ['Reorga abstimmen', true],
  ]);
  expect(pencils(host).map((b) => b.getAttribute('aria-label'))).toEqual([
    'Bearbeiten: 08:00 bis 14:00 Abstimmung Beispiel 2027 (Musterstadt)',
    'Bearbeiten: Liste Planobjekte ergänzen (fällig 30.10.)',
    'Bearbeiten: Urlaube im Plan nachziehen',
    'Bearbeiten: Reorga abstimmen',
    'Bearbeiten: Max Muster, Freigabe Beispiel, bittet um Rückmeldung',
    'Bearbeiten: nichts',
  ]);
});

test('no marker shows up anywhere, not in the text and not in an attribute', () => {
  const host = show(renderNote(note), context(note));
  expect(host.textContent).not.toContain('%%');
  expect(host.innerHTML).not.toContain('%%');
  expect(host.innerHTML).not.toContain('todo:');
});

test('the headings of the note become plain headings of one level, and the text stays', () => {
  const host = show(renderNote(note), context(note));
  expect([...host.querySelectorAll('h4')].map((e) => e.textContent)).toEqual([
    '2026-10-29',
    'Morgenbriefing (automatisch)',
    'Termine heute',
    'Offene Punkte',
    'Mails',
    'Abendüberblick (automatisch)',
    'Offene Punkte',
  ]);
  expect(host.querySelector('h1,h2,h3,h5,h6')).toBeNull();
  expect(host.textContent).toContain('Max Muster, Freigabe Beispiel, bittet um Rückmeldung');
});

test('a tap on a checkbox reports the line and the source line as it was shown, with its markers', () => {
  const ctx = context(note);
  const host = show(renderNote(note), ctx);
  boxes(host)[0].dispatchEvent(new Event('change', { bubbles: true }));
  expect(ctx.onToggle).toHaveBeenCalledWith(task1, lines[task1]);
  expect(lines[task1]).toContain('%%todo:AAMkTEST1%%');
  boxes(host)[2].dispatchEvent(new Event('change', { bubbles: true }));
  expect(ctx.onToggle).toHaveBeenLastCalledWith(done, lines[done]);
});

test('a tap on a pencil reports the line and the source line as it was shown', () => {
  const ctx = context(note);
  const host = show(renderNote(note), ctx);
  pencils(host)[2].click();
  expect(ctx.onEdit).toHaveBeenCalledWith(task2, lines[task2]);
  pencils(host)[0].click();
  expect(ctx.onEdit).toHaveBeenLastCalledWith(termin, lines[termin]);
});

test('a tap on a checkbox is never taken back, and nothing is disabled so that nothing blinks while the card writes', () => {
  const host = show(renderNote(note), context(note));
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  boxes(host)[0].dispatchEvent(tap);
  expect(tap.defaultPrevented).toBe(false);
  expect(boxes(host).some((b) => b.disabled)).toBe(false);
  expect(pencils(host).some((b) => b.disabled)).toBe(false);
});

test('while a line is being edited, the pencils of the other lines are disabled and so is the checkbox of the edited line', () => {
  const host = show(renderNote(note), context(note, { editing: { line: task2, saving: false }, draft: { current: 'x' } }));
  expect(pencils(host).every((b) => b.disabled)).toBe(true);
  const own = host.querySelector(`li[data-line="${task2}"] input[type=checkbox]`) as HTMLInputElement;
  expect(own.disabled).toBe(true);
});

test('only list items get a pencil: a quote, a paragraph and a heading do not', () => {
  const md = '# Titel\n\nText mit **Fett**\n\n> - [ ] Zitat\n\n- [ ] Echt\n  - Kind\n';
  const host = show(renderNote(md), context(md));
  expect(pencils(host).map((b) => b.getAttribute('aria-label'))).toEqual(['Bearbeiten: Echt', 'Bearbeiten: Kind']);
  expect(boxes(host)).toHaveLength(1);
  expect(host.querySelector('strong')?.textContent).toBe('Fett');
  expect(host.textContent).toContain('Zitat');
});

test('the line that is being edited shows an input with the draft instead of the text, and keeps its checkbox', () => {
  const ctx = context(note, { editing: { line: task2, saving: false }, draft: { current: 'Neuer Text' } });
  const host = show(renderNote(note), ctx);
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Text bearbeiten"]')!;
  expect(input.value).toBe('Neuer Text');
  expect(input.closest('li')?.getAttribute('data-line')).toBe(String(task2));
  expect(input.closest('li')?.querySelector('input[type=checkbox]')).not.toBeNull();
  expect(input.closest('li')?.textContent).not.toContain('Urlaube im Plan');
  // Der Stift der Zeile ist dann nicht da, die anderen Zeilen sind unverändert.
  expect(pencils(host).map((b) => b.getAttribute('aria-label'))).not.toContain('Bearbeiten: Urlaube im Plan nachziehen');
  expect(host.querySelectorAll('input[aria-label="Text bearbeiten"]')).toHaveLength(1);
});

test('typing, Enter, Escape and the buttons of the input report to the card', () => {
  const ctx = context(note, { editing: { line: task2, saving: false }, draft: { current: 'Alt' } });
  const host = show(renderNote(note), ctx);
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Text bearbeiten"]')!;
  input.value = 'Neu getippt';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(ctx.onDraft).toHaveBeenCalledWith('Neu getippt');

  const form = input.closest('form')!;
  const submit = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(submit);
  expect(submit.defaultPrevented).toBe(true);
  expect(ctx.onSave).toHaveBeenCalledTimes(1);
  expect(ctx.onSave).toHaveBeenCalledWith('Neu getippt'); // der Text im Feld, nicht der alte

  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  input.dispatchEvent(escape);
  expect(ctx.onCancel).toHaveBeenCalledTimes(1);

  const buttons = [...form.querySelectorAll('button')];
  expect(buttons.map((b) => b.textContent)).toEqual(['Speichern', 'Abbrechen']);
  buttons[1].click();
  expect(ctx.onCancel).toHaveBeenCalledTimes(2);
});

test('the input holds what is typed itself: it keeps it without the card drawing the note again, and Save is locked while saving', async () => {
  const ctx = context(note, { editing: { line: task2, saving: false }, draft: { current: 'Alt' } });
  const nodes = noteToVNodes(renderNote(note), ctx);
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  render(h(Fragment, null, nodes), host);
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Text bearbeiten"]')!;
  expect(input.value).toBe('Alt'); // beginnt mit dem Text, den die Karte kennt

  // Die Bauteile werden nicht noch einmal gebaut: Das Feld zeichnet sich allein.
  const created = vi.spyOn(document, 'createElement');
  for (const typed of ['N', 'Ne', 'Neu']) {
    input.value = typed;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(input.value).toBe('Neu');
  expect(created.mock.calls.filter(([name]) => name === 'template')).toEqual([]);
  created.mockRestore();

  // Das Feld lässt sich nicht erneut absenden, solange gespeichert wird.
  const saving = show(renderNote(note), context(note, { editing: { line: task2, saving: true }, draft: { current: 'Alt' } }));
  const save = [...saving.querySelectorAll('form.bearbeiten button')].find((b) => b.textContent === 'Speichern') as HTMLButtonElement;
  expect(save.disabled).toBe(true);
});

test('an edit of a task with a nested list keeps the nested list', () => {
  const md = '- [ ] Eltern %%m%%\n  - Kind\n';
  const host = show(renderNote(md), context(md, { editing: { line: 0, saving: false }, draft: { current: 'Eltern neu' } }));
  const parent = host.querySelector('li[data-line="0"]')!;
  expect(parent.querySelector('input[aria-label="Text bearbeiten"]')).not.toBeNull();
  expect(parent.querySelector('li[data-line="1"]')?.textContent).toContain('Kind');
});

test('an embed shows the neutral hint', () => {
  const md = '- [ ] Skizze ![[a.svg]]\n';
  const host = show(renderNote(md), context(md));
  expect(host.querySelector('.anhang')?.textContent).toBe('Anhang');
  expect(host.textContent).not.toContain('a.svg');
});

test('links: days open in the app, web links open elsewhere without access to the app, everything else is text', () => {
  const html =
    '<p><a href="#/tag/2026-10-30">Morgen</a> <a href="https://example.org/x">Extern</a> <a href="javascript:alert(1)">Skript</a> <a href="data:text/html,x">Daten</a> <a href="//evil.example/x">Relativ</a> <a href="#/besprechung/x/1">Anderes</a></p>';
  const host = show(html, context(''));
  const anchors = [...host.querySelectorAll('a')];
  expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['#/tag/2026-10-30', 'https://example.org/x']);
  expect(anchors[0].hasAttribute('target')).toBe(false);
  expect(anchors[1].getAttribute('target')).toBe('_blank');
  expect(anchors[1].getAttribute('rel')).toBe('noopener noreferrer');
  expect(host.textContent).toContain('Skript');
  expect(host.textContent).toContain('Daten');
  expect(host.textContent).toContain('Relativ');
  expect(host.textContent).toContain('Anderes');
});

test('raw markup from a hostile note has no effect: no scripts, no images, no frames, no handlers, no styles', () => {
  const html =
    '<p onclick="alert(1)" style="position:fixed" class="x" id="y">Hallo<script>alert(1)</script><img src="https://evil.example/p.png" onerror="alert(2)" alt="Bild"><iframe src="https://evil.example"></iframe></p>' +
    '<div onmouseover="alert(3)"><form action="https://evil.example"><input name="pw"><button>Los</button></form></div><style>body{display:none}</style><svg onload="alert(4)"><circle/></svg>';
  const host = show(html, context(''));
  expect(host.querySelector('script,img,iframe,style,form,svg,div')).toBeNull();
  expect(host.querySelector('input,button')).toBeNull();
  for (const el of host.querySelectorAll('*')) {
    expect([...el.attributes].map((a) => a.name)).toEqual([]);
  }
  expect(host.textContent).toContain('Hallo');
  expect(host.textContent).not.toContain('alert');
  expect(host.textContent).not.toContain('display:none');
});

test('text is never read as markup', () => {
  const md = '- <b>fett</b> & "zitat" <script>x</script>\n';
  const host = show(renderNote(md), context(md));
  expect(host.querySelector('b,script')).toBeNull();
  expect(host.textContent).toContain('<b>fett</b> & "zitat" <script>x</script>');
});

test('tables, code, emphasis and line breaks come through', () => {
  const md = 'Eine `Zeile` mit *Betonung*  \nund Umbruch\n\n| A | B |\n| - | - |\n| 1 | 2 |\n';
  const host = show(renderNote(md), context(md));
  expect(host.querySelector('code')?.textContent).toBe('Zeile');
  expect(host.querySelector('em')?.textContent).toBe('Betonung');
  expect(host.querySelector('br')).not.toBeNull();
  expect([...host.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['1', '2']);
});

test('a list item whose line the note does not know gets no pencil and no checkbox', () => {
  const html = '<ul><li data-line="40"><input type="checkbox" data-line="40"> fremd</li></ul>';
  const host = show(html, context('nur eine Zeile'));
  expect(pencils(host)).toHaveLength(0);
  expect(boxes(host)).toHaveLength(0);
  expect(host.textContent).toContain('fremd');
});
