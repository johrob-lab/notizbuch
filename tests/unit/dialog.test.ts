import { afterEach, expect, test } from 'vitest';
import { confirmDialog, formDialog } from '../../src/ui/Dialog';

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

// ---------- Eingabe mit mehreren Feldern ----------

const field = (label: string) => {
  const found = [...document.querySelectorAll<HTMLInputElement>('dialog input')].find((input) => input.closest('label')?.textContent?.includes(label));
  if (!found) throw new Error(`Kein Feld ${label}`);
  return found;
};
const alertText = () => document.querySelector('dialog [role="alert"]')?.textContent ?? '';
const submitForm = () => {
  const form = document.querySelector('dialog form')!;
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
};
const fields = [
  { name: 'thema', label: 'Thema', value: 'Vorgabe' },
  { name: 'zeit', label: 'Zeit', value: '08:00', type: 'time' as const },
];

test('the form dialog shows its question, the fields with their values and the buttons Abbrechen and the answer', async () => {
  const answer = formDialog({ frage: 'Neue Besprechung', felder: fields, ja: 'Anlegen', onSubmit: async () => null });
  await settle();
  const open = dialog()!;
  expect(open.hasAttribute('open')).toBe(true);
  expect(open.getAttribute('aria-label')).toBe('Neue Besprechung');
  expect(open.textContent).toContain('Neue Besprechung');
  expect(field('Thema').value).toBe('Vorgabe');
  expect(field('Thema').type).toBe('text');
  expect(field('Zeit').value).toBe('08:00');
  expect(field('Zeit').type).toBe('time');
  expect(buttons().map((b) => b.textContent)).toEqual(['Abbrechen', 'Anlegen']);
  expect(document.activeElement).toBe(field('Thema'));
  expect(alertText()).toBe('');
  press('Abbrechen');
  await answer;
});

test('submitting sends the values of the fields, and when the check accepts them the dialog closes and answers yes', async () => {
  const seen: Record<string, string>[] = [];
  const answer = formDialog({
    frage: 'Neue Besprechung',
    felder: fields,
    ja: 'Anlegen',
    onSubmit: async (values) => {
      seen.push(values);
      return null;
    },
  });
  await settle();
  field('Thema').value = 'Team Runde';
  field('Thema').dispatchEvent(new Event('input', { bubbles: true }));
  field('Zeit').value = '09:30';
  field('Zeit').dispatchEvent(new Event('input', { bubbles: true }));
  const event = submitForm();
  expect(event.defaultPrevented).toBe(true);
  expect(await answer).toBe(true);
  expect(seen).toEqual([{ thema: 'Team Runde', zeit: '09:30' }]);
  expect(dialog()).toBeNull();
  expect(document.body.children).toHaveLength(0);
});

test('when the check returns a message, the message is shown and the dialog stays open with what was typed', async () => {
  let calls = 0;
  const answer = formDialog({
    frage: 'Neue Besprechung',
    felder: fields,
    ja: 'Anlegen',
    onSubmit: async (values) => {
      calls++;
      return values.thema === 'Gut' ? null : 'Bitte ein anderes Thema wählen.';
    },
  });
  await settle();
  field('Thema').value = 'Schlecht';
  field('Thema').dispatchEvent(new Event('input', { bubbles: true }));
  submitForm();
  await settle();
  expect(dialog()).not.toBeNull();
  expect(alertText()).toBe('Bitte ein anderes Thema wählen.');
  expect(field('Thema').value).toBe('Schlecht');
  expect(buttons().every((b) => !b.disabled)).toBe(true);

  // Im selben Dialog geht es weiter: Die Meldung verschwindet mit dem Erfolg, und die Antwort kommt erst jetzt.
  field('Thema').value = 'Gut';
  field('Thema').dispatchEvent(new Event('input', { bubbles: true }));
  submitForm();
  expect(await answer).toBe(true);
  expect(calls).toBe(2);
  expect(dialog()).toBeNull();
});

test('a message can be shown from the start, for a question that is asked again after an error', async () => {
  const answer = formDialog({ frage: 'Neue Besprechung', felder: fields, ja: 'Anlegen', fehler: 'Vorher ging etwas schief.', onSubmit: async () => null });
  await settle();
  expect(alertText()).toBe('Vorher ging etwas schief.');
  press('Abbrechen');
  expect(await answer).toBe(false);
});

test('while the check runs, the buttons are off and a second submit does nothing', async () => {
  let release!: (message: string | null) => void;
  let calls = 0;
  const answer = formDialog({
    frage: 'Neue Besprechung',
    felder: fields,
    ja: 'Anlegen',
    onSubmit: () => {
      calls++;
      return new Promise<string | null>((resolve) => (release = resolve));
    },
  });
  await settle();
  submitForm();
  await settle();
  expect(buttons().every((b) => b.disabled)).toBe(true);
  submitForm();
  dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })); // Escape mitten im Speichern
  await settle();
  expect(calls).toBe(1);
  expect(dialog()).not.toBeNull();
  release(null);
  expect(await answer).toBe(true);
});

test('a check that throws is a message too, and the dialog stays open', async () => {
  const answer = formDialog({
    frage: 'Neue Besprechung',
    felder: fields,
    ja: 'Anlegen',
    onSubmit: async () => {
      throw new Error('Netz weg');
    },
  });
  await settle();
  submitForm();
  await settle();
  expect(dialog()).not.toBeNull();
  expect(alertText()).toBe('Das hat nicht geklappt. Bitte noch einmal versuchen.');
  press('Abbrechen');
  expect(await answer).toBe(false);
});

test('Abbrechen and Escape answer no without asking the check, and only the first answer counts', async () => {
  const onSubmit = async () => null;
  const first = formDialog({ frage: 'Neue Besprechung', felder: fields, ja: 'Anlegen', onSubmit });
  await settle();
  press('Abbrechen');
  expect(await first).toBe(false);
  expect(dialog()).toBeNull();

  const second = formDialog({ frage: 'Neue Besprechung', felder: fields, ja: 'Anlegen', onSubmit });
  await settle();
  const cancel = new Event('cancel', { cancelable: true });
  dialog()!.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(await second).toBe(false);
  expect(dialog()).toBeNull();
});

test('when the page behind the form goes away, the signal answers no and the dialog is gone', async () => {
  const gone = new AbortController();
  const answer = formDialog({ frage: 'Neue Besprechung', felder: fields, ja: 'Anlegen', onSubmit: async () => null, signal: gone.signal });
  await settle();
  expect(dialog()).not.toBeNull();
  gone.abort();
  expect(await answer).toBe(false);
  expect(dialog()).toBeNull();
  expect(document.body.children).toHaveLength(0);
  expect(await formDialog({ frage: 'Noch einmal', felder: fields, ja: 'Anlegen', onSubmit: async () => null, signal: gone.signal })).toBe(false);
  expect(dialog()).toBeNull();
});
