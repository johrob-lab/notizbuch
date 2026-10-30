import { useState } from 'preact/hooks';
import { formatDay } from '../lib/dates';
import type { Settings } from '../lib/settings';
import { AccessForm, type AccessValues } from './AccessForm';
import { FAILED } from './texts';

// Die Einstellungen dieses Geräts: Glättung des Stifts, Vorhersage, Gerät und der Zugang zu GitHub. Eine Wahl gilt sofort
// (der nächste Strich schreibt damit) und wird gespeichert. Der Token steht hier nie: nur, dass er gespeichert ist und bis
// wann er gilt. „Zugang ändern“ öffnet dasselbe Formular wie die Einrichtung, immer leer.

type Choices = Pick<Settings, 'smoothing' | 'prediction' | 'device'>;

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
const ON_OFF: Option<'an' | 'aus'>[] = [
  { value: 'an', label: 'an' },
  { value: 'aus', label: 'aus' },
];
const DEVICES: Option<Settings['device']>[] = [
  { value: 'iPad', label: 'iPad' },
  { value: 'Firmen-PC', label: 'Firmen-PC' },
];

/** Eine Wahl aus wenigen Möglichkeiten: Jede ist eine große Fläche, die ein Finger trifft. */
function Choice<T extends string>({ title, name, value, options, onPick }: { title: string; name: string; value: T; options: Option<T>[]; onPick(value: T): void }) {
  return (
    <fieldset class="wahl">
      <legend>{title}</legend>
      <div class="wahl-flaechen">
        {options.map((option) => (
          <label key={option.value}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onPick(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
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
        <Choice title="Glättung" name="glaettung" value={settings.smoothing} options={SMOOTHING} onPick={(smoothing) => pick({ smoothing })} />
        <Choice
          title="Vorhersage"
          name="vorhersage"
          value={settings.prediction ? 'an' : 'aus'}
          options={ON_OFF}
          onPick={(next) => pick({ prediction: next === 'an' })}
        />
        <Choice title="Gerät" name="geraet" value={settings.device} options={DEVICES} onPick={(device) => pick({ device })} />
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
