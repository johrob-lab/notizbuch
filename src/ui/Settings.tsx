import { useState } from 'preact/hooks';
import { formatDay } from '../lib/dates';
import { vollbildOf, type Settings } from '../lib/settings';
import { AccessForm, type AccessValues } from './AccessForm';
import { FAILED } from './texts';
import { inkPrefs, setInkPrefs } from './inkPrefs';

// Die Einstellungen dieses Geräts: Glättung des Stifts, Vorhersage, Gerät und der Zugang zu GitHub. Eine Wahl gilt sofort
// (der nächste Strich schreibt damit) und wird gespeichert. Der Token steht hier nie: nur, dass er gespeichert ist und bis
// wann er gilt. „Zugang ändern“ öffnet dasselbe Formular wie die Einrichtung, immer leer.

type Choices = Pick<Settings, 'smoothing' | 'prediction' | 'device' | 'messung' | 'vollbild'>;

type Props = {
  settings: Settings;
  /** Die Warnung, dass der Zugang bald abläuft (oder schon abgelaufen ist), oder `null`. */
  warning: string | null;
  /** Das zweite Fenster eines Geräts darf nichts ändern: Alles ist gesperrt. */
  passive: boolean;
  /** Übernimmt die Wahl sofort und speichert sie. Scheitert das Speichern, wirft es. */
  onChange(patch: Partial<Choices>): Promise<void>;
  /** Prüft den neuen Zugang und speichert ihn. Liefert den Text, was nicht geklappt hat, oder `null`. */
  onAccess(values: AccessValues): Promise<string | null>;
};

type Option<T extends string> = { value: T; label: string };

const SMOOTHING: Option<Settings['smoothing']>[] = [
  { value: 'aus', label: 'aus' },
  { value: 'leicht', label: 'leicht' },
  { value: 'mittel', label: 'mittel' },
  { value: 'stark', label: 'stark' },
];
/** Die Füllfeder glättet nicht mit der Glättung, sondern mit der Strich-Stabilisierung in ihrem Regler-Fenster. */
const SMOOTHING_HINT = 'Gilt für Kugelschreiber und Fineliner. Die Füllfeder hat eigene Regler: zweimal auf die Füllfeder tippen.';
const ON_OFF: Option<'an' | 'aus'>[] = [
  { value: 'an', label: 'an' },
  { value: 'aus', label: 'aus' },
];
const VOLLBILD_TOOLS: Option<'kreis' | 'tab'>[] = [
  { value: 'kreis', label: 'Kreis' },
  { value: 'tab', label: 'Tab' },
];
const DEVICES: Option<Settings['device']>[] = [
  { value: 'iPad', label: 'iPad' },
  { value: 'Firmen-PC', label: 'Firmen-PC' },
];

/** Eine Wahl aus wenigen Möglichkeiten: Jede ist eine große Fläche, die ein Finger trifft. `hint` steht als Zeile darunter. */
function Choice<T extends string>({
  title,
  name,
  value,
  options,
  hint,
  onPick,
}: {
  title: string;
  name: string;
  value: T;
  options: Option<T>[];
  hint?: string;
  onPick(value: T): void;
}) {
  const hintId = hint ? `${name}-hinweis` : undefined;
  return (
    <fieldset class="wahl" aria-describedby={hintId}>
      <legend>{title}</legend>
      <div class="wahl-flaechen">
        {options.map((option) => (
          <label key={option.value}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onPick(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} class="wahl-hinweis">
          {hint}
        </p>
      )}
    </fieldset>
  );
}

export function SettingsPage({ settings, warning, passive, onChange, onAccess }: Props) {
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState('');

  const pick = (patch: Partial<Choices>) => {
    setProblem('');
    onChange(patch).catch(() => setProblem(FAILED));
  };

  return (
    <section class="einstellungen">
      <h1>Einstellungen</h1>
      {/* Im zweiten Fenster eines Geräts ist alles gesperrt: Gespeichert wird nur vom Fenster, das schreiben darf. */}
      <fieldset class="einstellungen-gruppe" disabled={passive}>
        <Choice title="Glättung" name="glaettung" value={settings.smoothing} options={SMOOTHING} hint={SMOOTHING_HINT} onPick={(smoothing) => pick({ smoothing })} />
        <Choice
          title="Vorhersage"
          name="vorhersage"
          value={settings.prediction ? 'an' : 'aus'}
          options={ON_OFF}
          onPick={(next) => pick({ prediction: next === 'an' })}
        />
        <Choice title="Gerät" name="geraet" value={settings.device} options={DEVICES} onPick={(device) => pick({ device })} />
        <Choice
          title="Werkzeuge im Vollbild"
          name="vollbild-werkzeuge"
          value={vollbildOf(settings).werkzeuge}
          options={VOLLBILD_TOOLS}
          onPick={(werkzeuge) => pick({ vollbild: { ...vollbildOf(settings), werkzeuge } })}
        />
        <Choice
          title="Kritzeln löscht"
          name="kritzeln"
          value={inkPrefs.value.scribble ? 'an' : 'aus'}
          options={ON_OFF}
          onPick={(next) => setInkPrefs({ scribble: next === 'an' })}
        />
        <Choice
          title="Messung anzeigen"
          name="messung"
          value={settings.messung ? 'an' : 'aus'}
          options={ON_OFF}
          onPick={(next) => pick({ messung: next === 'an' })}
        />
        <p class="einstellungen-fehler" role="alert">
          {problem}
        </p>

        <section class="zugang" aria-labelledby="zugang-titel">
          <h2 id="zugang-titel">Zugang</h2>
          <dl class="zugang-daten">
            <div>
              <dt>Token</dt>
              <dd>{settings.tokenExpiry ? `gespeichert, gültig bis ${formatDay(settings.tokenExpiry)}` : 'gespeichert'}</dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd>{settings.repo}</dd>
            </div>
          </dl>
          {warning !== null && <p class="ablauf">{warning}</p>}
          {changing ? (
            <AccessForm
              repo={settings.repo}
              onCancel={() => setChanging(false)}
              onSubmit={async (values) => {
                const result = await onAccess(values);
                if (result === null) setChanging(false);
                return result;
              }}
            />
          ) : (
            <button type="button" class="knopf" onClick={() => setChanging(true)}>
              Zugang ändern
            </button>
          )}
        </section>
      </fieldset>
    </section>
  );
}
