import { render, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

// Die Rückfrage der App. Sie ist ein eigener Dialog, kein `window.confirm`: Der blockiert auf dem iPad die ganze Seite.
// Es ist das eingebaute <dialog>: Der Browser sperrt alles dahinter (kein Antippen, kein Tabulator dorthin), schließt auf
// Escape und gibt den Fokus an den Knopf zurück, von dem man kam. Beide Knöpfe sind mit Finger, Stift und Maus gleich zu
// treffen (mindestens 44 Punkte, siehe app.css). Dazu gibt es die Eingabe mit Feldern (`formDialog`), zum Beispiel für eine
// neue Besprechung.

type DialogProps = {
  frage: string;
  /** Beschriftung des Knopfs für „ja“, zum Beispiel „Löschen“. */
  ja: string;
  nein: string;
  onAnswer(yes: boolean): void;
};

export function Dialog({ frage, ja, nein, onAnswer }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // Der Dialog öffnet sich einmal. Wer ihn zeichnet, darf `onAnswer` später ändern, ohne dass er sich noch einmal öffnet.
  const answer = useRef(onAnswer);
  answer.current = onAnswer;

  // Vor dem ersten Zeichnen und nicht danach: Die Rückfrage soll nie einen Augenblick unbeachtet im Bild stehen.
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Escape löst `cancel` aus. Der Browser würde den Dialog schließen, ohne dass jemand antwortet: Die Antwort „nein“ gibt
    // der Aufrufer, und er schließt den Dialog.
    const onCancel = (e: Event) => {
      e.preventDefault();
      answer.current(false);
    };
    el.addEventListener('cancel', onCancel);
    el.showModal();
    // Zuerst der Knopf, der nichts tut: Ein Druck auf Enter oder ein Tipp daneben soll nie etwas löschen.
    cancel.current?.focus();
    return () => {
      el.removeEventListener('cancel', onCancel);
      if (el.open) el.close(); // gibt den Fokus zurück an die Stelle, von der man kam
    };
  }, []);

  return (
    <dialog ref={dialog} class="rueckfrage" aria-label={frage}>
      <p class="rueckfrage-text">{frage}</p>
      <div class="rueckfrage-knoepfe">
        <button type="button" class="knopf" ref={cancel} onClick={() => onAnswer(false)}>
          {nein}
        </button>
        <button type="button" class="knopf gefahr" onClick={() => onAnswer(true)}>
          {ja}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Zeigt einen Dialog und wartet auf seine Antwort. `view` baut ihn und bekommt die Funktion, mit der er antwortet. Es zählt nur
 * die erste Antwort. Mit `signal` endet der Dialog mit „nein“, sobald das Signal abbricht. Ist es schon abgebrochen, öffnet er sich gar nicht.
 */
function ask(signal: AbortSignal | undefined, view: (answer: (yes: boolean) => void) => VNode): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const host = document.createElement('div');
    document.body.append(host);
    let answered = false;
    const answer = (yes: boolean) => {
      if (answered) return;
      answered = true;
      signal?.removeEventListener('abort', abort);
      render(null, host); // schließt den Dialog (siehe `Dialog`)
      host.remove();
      resolve(yes);
    };
    const abort = () => answer(false);
    signal?.addEventListener('abort', abort);
    render(view(answer), host);
  });
}

/**
 * Stellt die Frage und wartet auf die Antwort: `true` für „ja“, `false` für „nein“, Escape und alles andere. Es zählt nur die
 * erste Antwort. Mit `signal` endet die Frage mit „nein“, sobald das Signal abbricht: Verschwindet die Seite, um die es geht
 * (zurück-Wischen mitten in der Frage), bleibt keine Frage stehen, die sich auf eine andere Seite zu beziehen scheint.
 */
export function confirmDialog(o: { frage: string; ja: string; nein?: string; signal?: AbortSignal }): Promise<boolean> {
  return ask(o.signal, (answer) => <Dialog frage={o.frage} ja={o.ja} nein={o.nein ?? 'Abbrechen'} onAnswer={answer} />);
}

// ---------- Eingabe mit mehreren Feldern ----------

/** Ein Feld des Dialogs: `name` ist der Schlüssel in den Werten, `value` der Vorschlag. */
export type FormField = { name: string; label: string; value: string; type?: 'text' | 'time' };

const FAILED = 'Das hat nicht geklappt. Bitte noch einmal versuchen.';

type FormDialogProps = {
  frage: string;
  felder: FormField[];
  ja: string;
  nein: string;
  /** Eine Meldung von Anfang an, zum Beispiel wenn die Frage nach einem Fehler noch einmal gestellt wird. */
  fehler: string;
  onSubmit(values: Record<string, string>): Promise<string | null>;
  onAnswer(yes: boolean): void;
};

export function FormDialog({ frage, felder, ja, nein, fehler, onSubmit, onAnswer }: FormDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState(fehler);
  const [busy, setBusy] = useState(false);
  // Wie `busy`, aber sofort: Zwei Eingaben kurz nacheinander sehen sonst beide noch „nicht beschäftigt“.
  const working = useRef(false);
  const answer = useRef(onAnswer);
  answer.current = onAnswer;
  const check = useRef(onSubmit);
  check.current = onSubmit;

  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Escape löst `cancel` aus. Der Browser würde den Dialog schließen, ohne dass jemand antwortet: Die Antwort „nein“ gibt
    // der Aufrufer, und er schließt den Dialog. Mitten in der Prüfung gilt Escape nicht, sonst bliebe unklar, ob es geklappt hat.
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (!working.current) answer.current(false);
    };
    el.addEventListener('cancel', onCancel);
    el.showModal();
    // Ins erste Feld: Wer eine neue Besprechung anlegt, will sofort das Thema tippen.
    form.current?.querySelector('input')?.focus();
    return () => {
      el.removeEventListener('cancel', onCancel);
      if (el.open) el.close(); // gibt den Fokus zurück an die Stelle, von der man kam
    };
  }, []);

  // Nach einer Meldung ist alles wieder frei, aber der Fokus ging beim Sperren verloren: Er kommt ins erste Feld zurück.
  useEffect(() => {
    if (!busy && message !== '') form.current?.querySelector('input')?.focus();
  }, [busy, message]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('');
    const values: Record<string, string> = {};
    for (const input of Array.from(form.current?.querySelectorAll('input') ?? [])) values[input.name] = input.value;
    let result: string | null;
    try {
      result = await check.current(values);
    } catch {
      result = FAILED;
    }
    working.current = false;
    if (result === null) {
      answer.current(true); // der Dialog verschwindet
      return;
    }
    setBusy(false);
    setMessage(result);
  };

  return (
    <dialog ref={dialog} class="rueckfrage" aria-label={frage}>
      <form ref={form} onSubmit={(e) => void submit(e)}>
        <p class="rueckfrage-text">{frage}</p>
        {felder.map((field) => (
          <label key={field.name} class="rueckfrage-feld">
            <span>{field.label}</span>
            {field.type === 'time' ? (
              <input name={field.name} type="time" defaultValue={field.value} autoComplete="off" disabled={busy} />
            ) : (
              <input name={field.name} type="text" defaultValue={field.value} autoComplete="off" disabled={busy} />
            )}
          </label>
        ))}
        <p class="rueckfrage-fehler" role="alert">
          {message}
        </p>
        <div class="rueckfrage-knoepfe">
          <button type="button" class="knopf" disabled={busy} onClick={() => answer.current(false)}>
            {nein}
          </button>
          <button type="submit" class="knopf primaer" disabled={busy}>
            {ja}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Fragt nach Werten in einem Dialog mit Feldern und wartet auf die Antwort: `true`, wenn `onSubmit` die Werte angenommen
 * hat, `false` bei „Abbrechen“, Escape und allem anderen. `onSubmit` prüft die Werte und legt an, was damit zu tun ist.
 * Gibt es `null` zurück, ist der Dialog fertig. Gibt es einen Text zurück (oder wirft), steht der Text im Dialog, der Dialog
 * bleibt offen und behält, was getippt wurde. Solange die Prüfung läuft, ist alles gesperrt. Mit `signal` endet der Dialog
 * mit „nein“, sobald das Signal abbricht.
 */
export function formDialog(o: {
  frage: string;
  felder: FormField[];
  ja: string;
  nein?: string;
  fehler?: string;
  signal?: AbortSignal;
  onSubmit(values: Record<string, string>): Promise<string | null>;
}): Promise<boolean> {
  return ask(o.signal, (answer) => (
    <FormDialog frage={o.frage} felder={o.felder} ja={o.ja} nein={o.nein ?? 'Abbrechen'} fehler={o.fehler ?? ''} onSubmit={o.onSubmit} onAnswer={answer} />
  ));
}
