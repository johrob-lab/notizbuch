import { afterEach, expect, test } from 'vitest';
import { confirmDialog } from '../../src/ui/Dialog';

// Die Rückfrage der App: ein eigener Dialog statt window.confirm, der das iPad blockiert. Alles hier ist erfunden.

const dialog = () => document.querySelector('dialog');
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('dialog button')];
const press = (label: string) => {
  const found = buttons().find((b) => b.textContent === label);
  if (!found) throw new Error(`Kein Knopf ${label}`);
  found.click();
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.innerHTML = '';
});

test('the question is shown in a modal dialog with the buttons Abbrechen and Löschen, and Abbrechen has the focus', async () => {
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen' });
  await settle();
  const open = dialog()!;
  expect(open.hasAttribute('open')).toBe(true);
  expect(open.getAttribute('aria-label')).toBe('Seite wirklich löschen?');
  expect(open.textContent).toContain('Seite wirklich löschen?');
  expect(buttons().map((b) => b.textContent)).toEqual(['Abbrechen', 'Löschen']);
  expect(document.activeElement).toBe(buttons()[0]);
  press('Abbrechen');
  await answer;
});

test('Löschen answers yes, and the dialog is gone', async () => {
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen' });
  await settle();
  press('Löschen');
  expect(await answer).toBe(true);
  expect(dialog()).toBeNull();
  expect(document.body.children).toHaveLength(0);
});

test('Abbrechen answers no, and the dialog is gone', async () => {
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen' });
  await settle();
  press('Abbrechen');
  expect(await answer).toBe(false);
  expect(dialog()).toBeNull();
  expect(document.body.children).toHaveLength(0);
});

test('Escape (the cancel event of the dialog) answers no and is not left to the browser', async () => {
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen' });
  await settle();
  const cancel = new Event('cancel', { cancelable: true });
  dialog()!.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(await answer).toBe(false);
  expect(dialog()).toBeNull();
});

test('only the first answer counts', async () => {
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen' });
  await settle();
  const [no, yes] = buttons();
  yes.click();
  no.click();
  dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(await answer).toBe(true);
});

test('the label of the other button can be chosen', async () => {
  const answer = confirmDialog({ frage: 'Weiter?', ja: 'Ja', nein: 'Nein' });
  await settle();
  expect(buttons().map((b) => b.textContent)).toEqual(['Nein', 'Ja']);
  press('Nein');
  expect(await answer).toBe(false);
});

test('two questions one after the other each get their own answer', async () => {
  const first = confirmDialog({ frage: 'Erste Frage?', ja: 'Ja' });
  await settle();
  press('Ja');
  expect(await first).toBe(true);

  const second = confirmDialog({ frage: 'Zweite Frage?', ja: 'Ja' });
  await settle();
  expect(dialog()!.textContent).toContain('Zweite Frage?');
  press('Abbrechen');
  expect(await second).toBe(false);
});

test('when the page behind the question goes away, the signal answers no and the dialog is gone', async () => {
  const gone = new AbortController();
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen', signal: gone.signal });
  await settle();
  expect(dialog()).not.toBeNull();
  gone.abort();
  expect(await answer).toBe(false);
  expect(dialog()).toBeNull();
  expect(document.body.children).toHaveLength(0);
});

test('a signal that has already aborted asks nothing and answers no', async () => {
  const gone = new AbortController();
  gone.abort();
  expect(await confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen', signal: gone.signal })).toBe(false);
  expect(dialog()).toBeNull();
  expect(document.body.children).toHaveLength(0);
});

test('an abort after the answer changes nothing', async () => {
  const gone = new AbortController();
  const answer = confirmDialog({ frage: 'Seite wirklich löschen?', ja: 'Löschen', signal: gone.signal });
  await settle();
  press('Löschen');
  gone.abort();
  expect(await answer).toBe(true);
});
