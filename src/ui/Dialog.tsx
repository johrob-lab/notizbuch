import { render } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

// Die Rückfrage der App. Sie ist ein eigener Dialog, kein `window.confirm`: Der blockiert auf dem iPad die ganze Seite.
// Es ist das eingebaute <dialog>: Der Browser sperrt alles dahinter (kein Antippen, kein Tabulator dorthin), schließt auf
// Escape und gibt den Fokus an den Knopf zurück, von dem man kam. Beide Knöpfe sind mit Finger, Stift und Maus gleich zu
// treffen (mindestens 44 Punkte, siehe app.css).

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
 * Stellt die Frage und wartet auf die Antwort: `true` für „ja“, `false` für „nein“, Escape und alles andere. Es zählt nur die
 * erste Antwort. Mit `signal` endet die Frage mit „nein“, sobald das Signal abbricht: Verschwindet die Seite, um die es geht
 * (zurück-Wischen mitten in der Frage), bleibt keine Frage stehen, die sich auf eine andere Seite zu beziehen scheint.
 */
export function confirmDialog(o: { frage: string; ja: string; nein?: string; signal?: AbortSignal }): Promise<boolean> {
  return new Promise((resolve) => {
    if (o.signal?.aborted) return resolve(false);
    const host = document.createElement('div');
    document.body.append(host);
    let answered = false;
    const answer = (yes: boolean) => {
      if (answered) return;
      answered = true;
      o.signal?.removeEventListener('abort', abort);
      render(null, host); // schließt den Dialog (siehe `Dialog`)
      host.remove();
      resolve(yes);
    };
    const abort = () => answer(false);
    o.signal?.addEventListener('abort', abort);
    render(<Dialog frage={o.frage} ja={o.ja} nein={o.nein ?? 'Abbrechen'} onAnswer={answer} />, host);
  });
}
