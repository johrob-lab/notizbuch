import { useState } from 'preact/hooks';

// Das Feld „Ergänzen“ der Karte „Morgenbriefing“. Es hält den Text und den Schalter „Aufgabe“ selbst: Bei jedem Zeichen wird nur
// dieses Formular neu gezeichnet und nicht die ganze Notiz mit ihren Abschnitten.

type Props = {
  /** Die Notiz ist gelesen. Vorher bleibt das Getippte im Feld stehen, und es wird nichts ergänzt. */
  ready: boolean;
  /** Ein Vorgang an der Notiz läuft: „Hinzufügen“ ist gesperrt, damit ein zweiter Tipp nicht doppelt ergänzt. */
  busy: boolean;
  /** Ergänzt die Notiz. `true`, wenn der Eintrag in der Notiz steht. */
  onAdd(text: string, asTask: boolean): Promise<boolean>;
};

export function AddForm({ ready, busy, onAdd }: Props) {
  const [text, setText] = useState('');
  const [asTask, setAsTask] = useState(true);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!ready || busy) return;
    const wanted = text;
    // Das Feld ist danach leer, wenn nichts Neues hineingetippt wurde. Scheitert es, bleibt der Text stehen.
    void onAdd(wanted, asTask).then((added) => {
      if (added) setText((now) => (now === wanted ? '' : now));
    });
  };

  return (
    <form class="ergaenzen" onSubmit={submit}>
      <input
        type="text"
        aria-label="Ergänzung"
        placeholder="Ergänzen"
        value={text}
        autoComplete="off"
        enterKeyHint="done"
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <label class="schalter">
        <input type="checkbox" role="switch" checked={asTask} onChange={(e) => setAsTask(e.currentTarget.checked)} />
        <span>Aufgabe</span>
      </label>
      <button type="submit" class="knopf" disabled={!ready || busy}>
        Hinzufügen
      </button>
    </form>
  );
}
