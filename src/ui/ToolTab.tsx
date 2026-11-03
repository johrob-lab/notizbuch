import { signal } from '@preact/signals';
import type { GestureFilter } from '../ink/gestures';
import { useActivation } from './pointerBits';
import type { ActionButton, ActionGroup, ToolAction } from './toolActions';
import { ActionFace } from './ToolRing';
import { Icon } from './Toolbar';

// Die Lasche im Vollbild: ein Griff am linken Rand, der eine senkrechte Leiste mit denselben Knöpfen wie der Ring ausklappt.
// Sie hat kein Schutzfeld und liegt neben der Seite: Schreiben und Wählen lassen sie offen, nur der Griff schließt sie.

type Props = {
  actions: { inner: ActionButton[]; outer: ActionButton[] };
  /** Dasselbe Tor gegen Handballen wie das der Schreibfläche. */
  filter: GestureFilter;
  onAction(a: ToolAction): void;
};

/** Von oben nach unten: das Werkzeug, die Wahl dazu, Verlauf, Blättern, Ansicht. */
const ORDER: ActionGroup[] = ['werkzeug', 'farbe', 'breite', 'radiergroesse', 'radierart', 'verlauf', 'blaettern', 'ansicht'];

/**
 * Ob die Leiste offen ist, gehört nicht zur Seite: Jede Seite wird neu aufgebaut, und wer mit › durch die Seiten blättert, soll die
 * Leiste nicht jedes Mal neu aufklappen müssen. Zu geht sie mit dem Griff und mit „Vollbild aus“.
 */
const stripOpen = signal(false);

export function ToolTab({ actions, filter, onAction }: Props) {
  const open = stripOpen.value;
  const handle = useActivation(filter, () => (stripOpen.value = !stripOpen.value));
  const choose = useActivation(filter, (b: ActionButton) => {
    if (b.action.kind === 'exit') stripOpen.value = false;
    onAction(b.action);
  });

  const all = [...actions.inner, ...actions.outer];
  const groups = ORDER.map((g) => ({ g, buttons: all.filter((b) => b.group === g) })).filter((x) => x.buttons.length > 0);

  return (
    <>
      <button type="button" class="lasche" aria-label="Werkzeuge" title="Werkzeuge" aria-expanded={open} {...handle({ key: 'griff' })}>
        <Icon name="menu" />
      </button>
      {open && (
        <div class="lasche-leiste" role="toolbar" aria-label="Werkzeuge im Vollbild">
          {groups.map(({ g, buttons }) => (
            <div key={g} class="lasche-gruppe">
              {buttons.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  class="lasche-knopf"
                  data-gruppe={b.group}
                  aria-label={b.label}
                  title={b.label}
                  aria-pressed={b.pressed}
                  disabled={b.disabled}
                  {...choose(b)}
                >
                  <ActionFace action={b.action} />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
